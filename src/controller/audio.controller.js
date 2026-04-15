import prisma from "../prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary, deleteOnCloudinary } from "../utils/cloudinary.js";

// SPECIFIC AUDIO UPLOAD API
export const uploadAudioMessage = asyncHandler(async (req, res) => {
  const { roomId, replyTo, tempId, duration } = req.body;
  const senderId = req.user.id;

  if (!roomId) throw new ApiError(400, "Room ID is required");
  if (!req.file) throw new ApiError(400, "Audio file is required");

  // Validate audio file (double check after middleware)
  const audioMimeTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'application/octet-stream'];
  if (!audioMimeTypes.includes(req.file.mimetype)) {
    // Clean up if invalid type passed middleware somehow
    try { fs.unlinkSync(req.file.path); } catch (e) { }
    throw new ApiError(400, "Invalid audio file format");
  }

  // Check membership
  const membership = await prisma.chatMember.findFirst({
    where: { userId: senderId, roomId, isActive: true },
  });
  if (!membership) {
    try { fs.unlinkSync(req.file.path); } catch (e) { }
    throw new ApiError(403, "You are not a member of this room");
  }

  try {
    // Upload audio to Cloudinary
    const uploadedFile = await uploadOnCloudinary(req.file.path, "chat/audio", {
      resource_type: "video" // Cloudinary handles audio as video sometimes for better format support
    });

    if (!uploadedFile) {
      throw new ApiError(500, "Failed to upload audio to Cloudinary");
    }

    // Generate proper filename
    const fileExtension = getAudioExtension(req.file.mimetype);
    const fileName = `audio_${Date.now()}.${fileExtension}`;

    // Create audio message
    const message = await prisma.message.create({
      data: {
        roomId,
        senderId,
        type: "AUDIO",
        mediaUrl: uploadedFile.secure_url,
        publicId: uploadedFile.public_id,
        fileName: fileName,
        fileSize: uploadedFile.bytes,
        replyToId: replyTo || null,
        content: duration ? duration.toString() : "0", // Store duration as content
        msgId: tempId, // Store tempId if schema supports it, otherwise generic field
        statuses: {
          create: [{ userId: senderId, status: "READ", readAt: new Date() }]
        }
      },
      include: {
        sender: { select: { id: true, username: true, avatarUrl: true, status: true } },
        room: { select: { id: true, name: true, roomType: true, isGroup: true } },
        repliedTo: { include: { sender: { select: { id: true, username: true } } } }
      },
    });

    // Create statuses for others
    const otherMembers = await prisma.chatMember.findMany({
      where: { roomId, isActive: true, userId: { not: senderId } },
      select: { userId: true },
    });

    if (otherMembers.length > 0) {
      await prisma.messageStatus.createMany({
        data: otherMembers.map(m => ({
          messageId: message.id,
          userId: m.userId,
          status: "SENT"
        }))
      });
    }

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      // 1. New message broadcast
      const socketPayload = {
        ...message,
        tempId,
        duration: parseInt(message.content) || 0
      };
      io.to(roomId).emit("new-audio-message", socketPayload);
      io.to(roomId).emit("new-message", socketPayload);

      // 2. WHATSAPP FLOW: Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId, isActive: true },
          select: { userId: true }
        });

        for (const member of members) {
          const unreadCount = await prisma.messageStatus.count({
            where: {
              userId: member.userId,
              message: { roomId, type: { not: "SYSTEM" } },
              status: { in: ["SENT", "DELIVERED"] }
            }
          });

          const updatePayload = {
            roomId,
            unreadCount,
            lastMessage: {
              id: message.id,
              content: '🎵 Audio', // Standard audio preview
              type: 'AUDIO',
              sender: message.sender,
              createdAt: message.createdAt,
            },
            messageId: message.id
          };

          // Emit to user's personal room
          io.to(`user_${member.userId}`).emit("room-updated", updatePayload);
        }
        console.log(`Audio message broadcast & unread counts complete for room: ${roomId}`);
      } catch (countError) {
        console.error("Error broadcasting unread counts (Audio):", countError.message);
      }
    }

    // Update room timestamp
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });

    return res.status(201).json(new ApiResponse(201, {
      message: { ...message, duration: parseInt(message.content) || 0 }
    }, "Audio message sent successfully"));

  } catch (error) {
    // Cleanup already handled in uploadOnCloudinary for failed uploads (it calls safeUnlink)
    // But if we failed AFTER upload (e.g. DB error), we might want to delete from Cloudinary?
    // For now, let's just log.
    console.error('Audio upload process error:', error);
    throw new ApiError(500, error.message || "Failed to send audio message");
  }
});

// DELETE AUDIO MESSAGE
export const deleteAudioMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) throw new ApiError(404, "Message not found");

  // Only sender can delete (unless admin, but basic logic here)
  if (message.senderId !== userId) {
    throw new ApiError(403, "You can only delete your own messages");
  }

  // Delete from Cloudinary
  if (message.publicId) {
    await deleteOnCloudinary(message.publicId, "video"); // Audio stored as video/auto usually
  }

  // Delete from DB (or soft delete)
  // Hard delete for now as per request implication "delete API"
  await prisma.message.delete({
    where: { id: messageId },
  });

  const io = req.app.get("io");
  if (io) {
    io.to(message.roomId).emit("message-deleted", { messageId, roomId: message.roomId });
  }

  return res.status(200).json(new ApiResponse(200, {}, "Audio message deleted successfully"));
});


// SPECIFIC AUDIO FETCH API
export const getUserAudioFiles = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20, search } = req.query;

  try {
    console.log(`🎵 Fetching audio files for user: ${userId}`);

    // Verify the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true, email: true, avatarUrl: true }
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);

    // Build where clause - ONLY AUDIO FILES
    const where = {
      senderId: userId,
      type: "AUDIO",
      OR: [
        { mediaUrl: { not: null } },
        { fileName: { not: null } }
      ]
    };

    // Add search functionality if provided
    if (search && search.trim() !== '') {
      where.OR.push(
        { fileName: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      );
    }

    // Get only audio messages
    const [audioMessages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatarUrl: true
            }
          },
          room: {
            select: {
              id: true,
              name: true,
              isGroup: true,
              avatarUrl: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: skip,
        take: parseInt(limit)
      }),
      prisma.message.count({ where })
    ]);

    console.log(`Found ${audioMessages.length} audio files for user ${userId}`);

    // Format audio files with proper metadata
    const formattedAudio = audioMessages.map(audio => {
      const fileExtension = audio.fileName ?
        audio.fileName.split('.').pop().toLowerCase() : 'm4a';

      const mimeType = getMimeTypeFromExtension(fileExtension);

      return {
        id: audio.id,
        type: "AUDIO",
        mediaUrl: audio.mediaUrl,
        fileName: audio.fileName,
        fileSize: audio.fileSize,
        fileExtension: fileExtension,
        mimeType: mimeType,
        content: audio.content,
        duration: parseInt(audio.content) || 0,
        createdAt: audio.createdAt,
        updatedAt: audio.updatedAt,
        room: {
          id: audio.room.id,
          name: audio.room.name || (audio.room.isGroup ? 'Group Chat' : 'Direct Message'),
          isGroup: audio.room.isGroup,
          avatarUrl: audio.room.avatarUrl
        },
        sender: {
          id: audio.sender.id,
          username: audio.sender.username,
          name: audio.sender.name,
          avatarUrl: audio.sender.avatarUrl
        }
      };
    });

    // Calculate audio statistics
    const audioStats = {
      total: totalCount,
      totalDuration: formattedAudio.reduce((sum, audio) => sum + audio.duration, 0),
      averageDuration: totalCount > 0 ? Math.round(formattedAudio.reduce((sum, audio) => sum + audio.duration, 0) / totalCount) : 0
    };

    return res.status(200).json(new ApiResponse(200, {
      audio: formattedAudio,
      user: targetUser,
      statistics: audioStats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount: totalCount,
        hasNext: (page * limit) < totalCount,
        hasPrevious: page > 1,
        limit: parseInt(limit)
      }
    }, "User audio files retrieved successfully"));

  } catch (error) {
    console.error("Get user audio error:", error);
    throw new ApiError(500, "Failed to retrieve user audio files");
  }
});

// Helper function to get audio extension
function getAudioExtension(mimeType) {
  const extensionMap = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/x-m4a': 'm4a'
  };
  return extensionMap[mimeType] || 'm4a';
}

// Helper function to get MIME type from extension
function getMimeTypeFromExtension(extension) {
  const mimeMap = {
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac'
  };
  return mimeMap[extension] || 'audio/mp4';
}