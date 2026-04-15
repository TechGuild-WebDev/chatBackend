import prisma from "../prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary, deleteOnCloudinary } from "../utils/cloudinary.js";
import { sendChatNotification } from '../services/notificationService.js';

export const sendFileMessage = asyncHandler(async (req, res) => {
  const { roomId, type, replyTo, tempId, duration, text } = req.body;
  const senderId = req.user.id;

  const files = req.files?.files || [];
  const singleFile = req.files?.file?.[0] || null;

  if (!roomId || !type) {
    throw new ApiError(400, "Room ID and file type are required");
  }

  if (!singleFile && files.length === 0) {
    throw new ApiError(400, "File is required");
  }

  // Check if user is member of the room
  const membership = await prisma.chatMember.findFirst({
    where: {
      userId: senderId,
      roomId: roomId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new ApiError(403, "You are not a member of this room");
  }

  const allowedTypes = ["IMAGE", "VIDEO", "FILE", "AUDIO"];
  if (!allowedTypes.includes(type.toUpperCase())) {
    throw new ApiError(400, "Invalid file type");
  }

  try {
    // Upload file to Cloudinary
    const folderMap = {
      IMAGE: "chat/images",
      VIDEO: "chat/videos",
      FILE: "chat/documents",
      AUDIO: "chat/audio"
    };

    const targetFolder = folderMap[type.toUpperCase()] || "chat/files";
    const { generateThumbnailUrl } = await import("../utils/cloudinary.js");

    let messageData = {
      roomId,
      senderId,
      replyToId: replyTo || null,
      content: text || "", // Default to text caption
    };

    if (files.length > 0) {
      // Handle multiple files sequentially for progress reporting
      console.log(`☁️ Uploading ${files.length} files to Cloudinary...`);
      
      const uploadedFiles = [];
      const io = req.app.get("io");

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uploaded = await uploadOnCloudinary(file.path, targetFolder);
        
        if (uploaded) {
          const thumb = (type.toUpperCase() === 'IMAGE' || type.toUpperCase() === 'VIDEO')
            ? generateThumbnailUrl(uploaded.secure_url, uploaded.resource_type)
            : null;

          uploadedFiles.push({
            url: uploaded.secure_url,
            thumbnail: thumb,
            type: type.toUpperCase(),
            fileName: file.originalname || `file_${Date.now()}`,
            fileSize: uploaded.bytes,
            publicId: uploaded.public_id
          });

          // Emit progress via socket
          if (io && tempId) {
            io.to(`user_${senderId}`).emit("upload-progress", {
              tempId,
              completed: i + 1,
              total: files.length,
              status: "PROCESSING" // Meaning Cloudinary upload phase
            });
          }
        }
      }

      if (uploadedFiles.length === 0) {
        throw new ApiError(500, "Failed to upload files to Cloudinary");
      }

      messageData.type = files.length > 1 ? "IMAGE_GROUP" : type.toUpperCase();
      messageData.mediaFiles = uploadedFiles;
      
      // For compatibility
      messageData.mediaUrl = uploadedFiles[0].url;
      messageData.thumbnailUrl = uploadedFiles[0].thumbnail;
      messageData.fileName = uploadedFiles[0].fileName;
      messageData.fileSize = uploadedFiles[0].fileSize;
      messageData.publicId = uploadedFiles[0].publicId;

    } else {
      // Handle single file (legacy/single mode)
      console.log('☁️ Uploading single file to Cloudinary...');
      const uploadedFile = await uploadOnCloudinary(singleFile.path, targetFolder);

      if (!uploadedFile) {
        throw new ApiError(500, "Failed to upload file to Cloudinary");
      }

      const thumbnailUrl = (type.toUpperCase() === 'IMAGE' || type.toUpperCase() === 'VIDEO')
        ? generateThumbnailUrl(uploadedFile.secure_url, uploadedFile.resource_type)
        : null;

      messageData.type = type.toUpperCase();
      messageData.mediaUrl = uploadedFile.secure_url;
      messageData.publicId = uploadedFile.public_id;
      messageData.fileName = singleFile.originalname || `file_${Date.now()}`;
      messageData.fileSize = uploadedFile.bytes;
      messageData.thumbnailUrl = thumbnailUrl;

      // If it's an audio message and no caption, use duration in content as fallback parity
      if (type.toUpperCase() === "AUDIO" && !text) {
        messageData.content = duration ? duration.toString() : "0";
      }
    }

    // Create message
    const message = await prisma.message.create({
      data: messageData,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            status: true,
          },
        },
        room: {
          select: {
            id: true,
            name: true,
            roomType: true,
            isGroup: true,
          },
        },
        repliedTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        statuses: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });

    console.log('💾 Message saved to database:', message.id);

    // PUSH NOTIFICATION: Send to all receivers
    try {
      const roomMembers = await prisma.chatMember.findMany({
        where: {
          roomId,
          isActive: true,
          userId: { not: senderId } // Exclude sender
        },
        select: { userId: true },
      });

      const receiverIds = roomMembers.map(member => member.userId);

      if (receiverIds.length > 0) {
        await sendChatNotification(receiverIds, {
          roomId: roomId,
          messageId: message.id,
          senderId: senderId,
          senderName: message.sender.username,
          content: type.toUpperCase() === 'AUDIO' ? 'Audio message' :
            type.toUpperCase() === 'IMAGE' ? '📷 Photo' :
              type.toUpperCase() === 'VIDEO' ? 'Video' : '📄 File'
        });
        console.log('Push notification sent to', receiverIds.length, 'users');
      }
    } catch (notificationError) {
      console.error('Push notification failed:', notificationError);
    }

    // Create message status for all room members
    const allRoomMembers = await prisma.chatMember.findMany({
      where: { roomId, isActive: true },
      select: { userId: true },
    });

    const messageStatuses = allRoomMembers.map((member) => ({
      messageId: message.id,
      userId: member.userId,
      status: member.userId === senderId ? "READ" : "SENT",
      ...(member.userId === senderId && { readAt: new Date() }),
    }));

    await prisma.messageStatus.createMany({
      data: messageStatuses,
    });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("new-message", {
        ...message,
        tempId,
        statuses: messageStatuses,
      });

      // Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId, isActive: true },
          select: { userId: true }
        });

        for (const member of members) {
          const unreadCount = await prisma.messageStatus.count({
            where: {
              userId: member.userId,
              message: { roomId: roomId, type: { not: "SYSTEM" } },
              status: { in: ["SENT", "DELIVERED"] }
            }
          });

          io.to(`user_${member.userId}`).emit("room-updated", {
            roomId,
            unreadCount,
            lastMessage: {
              id: message.id,
              content: message.type.toUpperCase() === 'AUDIO' ? '🎵 Audio' :
                message.type.toUpperCase() === 'IMAGE' ? '📷 Photo' :
                  message.type.toUpperCase() === 'VIDEO' ? '🎥 Video' : `📄 ${message.fileName || 'File'}`,
              type: message.type,
              sender: message.sender,
              createdAt: message.createdAt,
              fileName: message.fileName,
              mimeType: message.mimeType,
              mediaUrl: message.mediaUrl,
            },
            messageId: message.id
          });
        }

        // Update room timestamp for sorting
        await prisma.chatRoom.update({
          where: { id: roomId },
          data: { updatedAt: new Date() }
        });

      } catch (countError) {
        console.error("Error broadcasting unread counts (File):", countError);
      }
      console.log('Socket events emitted to participants');
    }

    // Update room's updatedAt
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });


    return res.status(201).json({
      success: true,
      message: message
    });

  } catch (error) {
    console.error('File upload error:', error);


    throw new ApiError(500, `Failed to send file: ${error.message}`);
  }
});

// GET /message/:messageId/status — returns delivery/read statuses for a message
export const getMessageStatus = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  // Validate message exists and user has access
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, roomId: true, senderId: true },
  });

  if (!message) throw new ApiError(404, "Message not found");

  const membership = await prisma.chatMember.findFirst({
    where: { userId, roomId: message.roomId, isActive: true },
  });
  if (!membership) throw new ApiError(403, "Not a member of this chat");

  console.log(`[MessageStatus] Fetching for msg: ${messageId}, room: ${message.roomId}`);

  // 1. Get all active members of this room
  const members = await prisma.chatMember.findMany({
    where: { roomId: message.roomId, isActive: true },
    include: {
      user: {
        select: { id: true, username: true, avatarUrl: true, name: true },
      },
    },
  });

  // 2. Get existing status records for this specific message
  const existingStatuses = await prisma.messageStatus.findMany({
    where: { messageId },
  });

  console.log(`[MessageStatus] Found ${existingStatuses.length} existing records for ${members.length} members`);

  // 3. Map members to their status, being very careful with IDs
  const allStatuses = members
    .filter(m => String(m.userId) !== String(message.senderId)) // Exclude sender
    .map(m => {
      const s = existingStatuses.find(es => String(es.userId) === String(m.userId));
      
      // If found, use its status and times; else default to SENT
      const statusValue = s ? String(s.status).toUpperCase() : "SENT";
      
      return {
        userId: m.userId,
        status: statusValue,
        deliveredAt: s?.deliveredAt || null,
        readAt: s?.readAt || null,
        user: m.user,
      };
    });

  return res.status(200).json({
    success: true,
    statuses: allStatuses,
  });
});

// message.controller.js में getMessages function
export const getMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;
  const { cursor, limit = 50 } = req.query;

  // Check if user is member of the room
  const membership = await prisma.chatMember.findFirst({
    where: {
      userId: userId,
      roomId: roomId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new ApiError(403, "You are not a member of this room");
  }

  // Cursor-based pagination logic
  let whereClause = {
    roomId: roomId,
    NOT: {
      hiddenFor: { some: { userId: userId } }
    }
  };

  if (cursor) {
    // Find the cursor message to get its timestamp
    const cursorMessage = await prisma.message.findUnique({
      where: { id: cursor },
      select: { createdAt: true }
    });

    if (cursorMessage) {
      whereClause.createdAt = {
        lt: cursorMessage.createdAt
      };
    }
  }

  const messages = await prisma.message.findMany({
    where: whereClause,
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          status: true,
        },
      },
      room: {
        select: {
          id: true,
          name: true,
          roomType: true,
          isGroup: true,
        },
      },
      pinnedBy: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
      repliedTo: {
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
      statuses: {
        select: {
          userId: true,
          status: true,
          readAt: true,
          deliveredAt: true,
        },
      },
      reactions: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
      starredBy: {
        where: { userId: userId },
        select: { id: true },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: parseInt(limit),
  });

  // Format messages for client
  const formattedMessages = messages.map(message => {
    // Determine overall status
    let displayStatus = "SENT";
    const isMe = String(message.senderId) === String(userId);
    
    if (isMe) {
      const otherStatuses = message.statuses.filter(s => String(s.userId) !== String(userId));
      if (otherStatuses.length > 0) {
        const anyRead = otherStatuses.some(s => (s.status || "").toUpperCase() === "READ");
        const anyDelivered = otherStatuses.some(s => (s.status || "").toUpperCase() === "DELIVERED");
        if (anyRead) displayStatus = "READ";
        else if (anyDelivered) displayStatus = "DELIVERED";
      }
    } else {
      displayStatus = message.statuses.find(s => String(s.userId) === String(userId))?.status || "SENT";
    }

    let messageType = message.type.toLowerCase();
    if (message.type === "AUDIO" || (message.mediaUrl && message.mediaUrl.includes('/chat/audio/'))) {
      messageType = "audio";
    }

    return {
      id: message.id,
      type: message.deleted ? "msg" : messageType,
      text: message.deleted
        ? (message.sender.id === userId ? "You deleted this message" : "This message was deleted")
        : message.content,
      content: message.deleted
        ? (message.sender.id === userId ? "You deleted this message" : "This message was deleted")
        : message.content,
      deleted: message.deleted,
      uri: message.mediaUrl, // Full Resolution
      thumbnailUrl: message.thumbnailUrl, // Fast Resolution
      time: message.createdAt,
      sender: message.sender.id === userId ? "me" : "other",
      senderName: message.sender.username,
      senderAvatar: message.sender.avatarUrl,
      senderId: message.sender.id,
      status: displayStatus,
      timestamp: message.createdAt,
      fileName: message.fileName,
      fileSize: message.fileSize,
      mediaFiles: message.mediaFiles,
      duration: message.type === "AUDIO" ? parseInt(message.content) || 0 : 0,
      replyTo: message.repliedTo ? {
        id: message.repliedTo.id,
        text: message.repliedTo.content,
        type: message.repliedTo.type.toLowerCase(),
        sender: message.repliedTo.sender.id === userId ? "me" : "other",
        senderName: message.repliedTo.sender.username,
      } : null,
      isPinned: message.isPinned,
      pinnedAt: message.pinnedAt,
      pinnedExpiresAt: message.pinnedExpiresAt,
      pinnedBy: message.pinnedBy,
      edited: message.edited,
      updatedAt: message.updatedAt,
    };
  });

  // Next cursor is the ID of the last message in current result (oldest)
  const nextCursor = messages.length > 0 ? messages[messages.length - 1].id : null;

  res.status(200).json(
    new ApiResponse(200, {
      messages: formattedMessages.reverse(), 
      nextCursor,
      hasMore: messages.length === parseInt(limit)
    }, "Messages retrieved successfully")
  );
});

// Soft Delete Message
export const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // Check if the user is the sender of the message
  if (message.senderId !== userId) {
    throw new ApiError(403, "You can only delete your own messages");
  }

  // Text to show for deleted messages
  const senderDeletedText = "You deleted this message";
  const othersDeletedText = "This message was deleted";

  // Update the message with deleted text
  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: {
      deleted: true,
      deletedAt: new Date(),
      // ✅ Replace content with deleted text
      content: senderDeletedText,
      // ✅ Clear all media/file data (only fields that exist in your schema)
      mediaUrl: null,
      fileName: null,
      fileSize: null,
      fileType: null,
      mimeType: null,
      duration: null,
      // ✅ Change type to TEXT since it's now a text message
      type: "TEXT",
      // ✅ Unpin the message
      isPinned: false,
      pinnedAt: null,
      pinnedExpiresAt: null,
      pinnedById: null,
    },
  });

  // ✅ Remove from all users' Starred Messages
  try {
    await prisma.starredMessage.deleteMany({
      where: { messageId: messageId },
    });
    console.log(`🗑️ Removed starred records for deleted message: ${messageId}`);
  } catch (starErr) {
    console.log("Failed to remove starred records:", starErr.message);
  }

  // Emit socket event to notify other members
  const io = req.app.get("io");
  if (io) {
    io.to(message.roomId).emit("message-deleted", {
      messageId: messageId,
      roomId: message.roomId,
      deletedText: othersDeletedText,
      deletedBy: userId,
    });

    // ✅ Also notify all users to remove from their starred/pinned lists
    try {
      const members = await prisma.chatMember.findMany({
        where: { roomId: message.roomId, isActive: true },
        select: { userId: true },
      });
      for (const member of members) {
        io.to(`user_${member.userId}`).emit("message-unstarred-deleted", {
          messageId: messageId,
          roomId: message.roomId,
        });
      }
    } catch (emitErr) {
      console.log("Error emitting unstar notification:", emitErr.message);
    }
  }

  return res.status(200).json(
    new ApiResponse(200, null, "Message deleted successfully")
  );
});

// Delete for me (persist in DB — removes message from this user's view only)
export const deleteForMe = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // Persist: mark message as hidden for this user
  await prisma.messageHiddenFor.upsert({
    where: {
      messageId_userId: { messageId, userId }
    },
    update: {}, // already hidden, no-op
    create: { messageId, userId },
  });

  // Emit real-time removal to ONLY THIS USER's personal socket room
  const io = req.app.get("io");
  if (io) {
    io.to(`user_${userId}`).emit("message-removed-for-user", {
      messageId,
      roomId: message.roomId,
    });
  }

  return res.status(200).json(
    new ApiResponse(200, null, "Message removed from your view")
  );
});


export const editMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  // Quick validation
  if (!content || content.trim() === "") {
    throw new ApiError(400, "Content is required to edit message");
  }

  const trimmedContent = content.trim();

  // First, check if user can edit this message
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      roomId: true,
      senderId: true,
      type: true,
      deleted: true
    }
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  if (message.deleted) {
    throw new ApiError(400, "Cannot edit a deleted message");
  }

  // Only allow editing text content (captions). 
  // We allow editing TEXT, IMAGE, VIDEO, FILE, IMAGE_GROUP, etc. as long as it's not deleted.
  // Note: For AUDIO, content might be duration if no text present, but editing it will just update the text/content field.

  if (message.senderId !== userId) {
    throw new ApiError(403, "You can only edit your own messages");
  }

  // Update the message
  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: {
      content: trimmedContent,
      edited: true,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      content: true,
      edited: true,
      updatedAt: true,
      roomId: true,
      type: true,
      senderId: true
    }
  });

  // Emit socket event
  const io = req.app.get("io");
  if (io) {
    io.to(message.roomId).emit("message-edited", {
      messageId: messageId,
      roomId: message.roomId,
      content: updatedMessage.content,
      edited: true,
      updatedAt: updatedMessage.updatedAt,
      senderId: userId
    });

    try {
      const members = await prisma.chatMember.findMany({
        where: { roomId: message.roomId, isActive: true },
        select: { userId: true }
      });

      for (const member of members) {
        io.to(`user_${member.userId}`).emit("message-edited", {
          messageId: messageId,
          roomId: message.roomId,
          content: updatedMessage.content,
          edited: true,
          updatedAt: updatedMessage.updatedAt,
          senderId: userId
        });
      }
    } catch (countError) {
      console.error("Error broadcasting message edit to users:", countError);
    }
  }

  return res.status(200).json(
    new ApiResponse(200, {
      message: updatedMessage
    }, "Message edited successfully")
  );
});



// Forward Messages
export const forwardMessages = asyncHandler(async (req, res) => {
  const { 
    messageIds, 
    targetRoomIds, 
    targetUserIds, 
    selectiveMediaIndex, 
    selectiveMediaUrl, 
    selectiveMediaType 
  } = req.body;
  const currentUserId = req.user.id;

  console.log("🚀 FORWARD REQUEST =================");
  console.log("Current User:", currentUserId);
  console.log("Message IDs:", messageIds);
  console.log("Target Room IDs:", targetRoomIds);
  console.log("Target User IDs:", targetUserIds);
  console.log("Selective Media:", { selectiveMediaIndex, selectiveMediaUrl, selectiveMediaType });

  // 1. BASIC VALIDATION
  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    throw new ApiError(400, "Select messages to forward");
  }

  if ((!targetRoomIds || targetRoomIds.length === 0) && (!targetUserIds || targetUserIds.length === 0)) {
    throw new ApiError(400, "Select users or groups to forward to");
  }

  // 2. GET MESSAGES
  const messagesToForward = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      deleted: false
    }
  });

  console.log(`✅ Found ${messagesToForward.length} messages to forward`);

  if (messagesToForward.length === 0) {
    throw new ApiError(404, "Messages not found");
  }

  // 3. PROCESS TARGETS
  const targetRooms = new Set();

  // Add group/room IDs directly
  if (targetRoomIds && targetRoomIds.length > 0) {
    targetRoomIds.forEach(roomId => {
      if (roomId && roomId !== "undefined" && roomId !== "null") {
        targetRooms.add(roomId);
      }
    });
  }

  // Create/find DM rooms for individual users
  if (targetUserIds && targetUserIds.length > 0) {
    console.log(`👥 Processing ${targetUserIds.length} users...`);

    for (const targetUserId of targetUserIds) {
      if (targetUserId === currentUserId) continue;

      // Find existing DM
      const dmRoom = await prisma.chatRoom.findFirst({
        where: {
          isGroup: false,
          AND: [
            { members: { some: { userId: currentUserId } } },
            { members: { some: { userId: targetUserId } } }
          ]
        }
      });

      if (dmRoom) {
        targetRooms.add(dmRoom.id);
      } else {
        // Create new DM
        const newRoom = await prisma.chatRoom.create({
          data: {
            isGroup: false,
            roomType: "DIRECT",
            members: {
              create: [
                { userId: currentUserId, role: "ADMIN" },
                { userId: targetUserId, role: "MEMBER" }
              ]
            }
          }
        });
        targetRooms.add(newRoom.id);
      }
    }
  }

  const finalRoomIds = Array.from(targetRooms);

  console.log(`🎯 Final target rooms: ${finalRoomIds}`);

  if (finalRoomIds.length === 0) {
    throw new ApiError(400, "No valid chats to forward to");
  }

  const results = [];

  // 4. FORWARD MESSAGES
  for (const roomId of finalRoomIds) {
    console.log(`📤 Forwarding to room: ${roomId}`);

    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { id: true, isGroup: true, name: true }
    });

    if (!room) {
      console.log(`❌ Room ${roomId} not found, skipping`);
      continue;
    }

    for (const originalMsg of messagesToForward) {
      try {
        // If selective media is provided (forwarding one image from a group)
        const isSelective = selectiveMediaUrl && messageIds.length === 1 && messageIds[0] === originalMsg.id;
        
        // Create forwarded message
        const newMessage = await prisma.message.create({
          data: {
            roomId,
            senderId: currentUserId,
            type: isSelective ? (selectiveMediaType || "IMAGE") : originalMsg.type,
            content: originalMsg.content,
            mediaUrl: isSelective ? selectiveMediaUrl : originalMsg.mediaUrl,
            fileName: originalMsg.fileName,
            fileSize: originalMsg.fileSize,
            fileType: originalMsg.fileType,
            mimeType: originalMsg.mimeType,
            duration: originalMsg.duration,
            thumbnailUrl: isSelective ? selectiveMediaUrl : originalMsg.thumbnailUrl,
            mediaFiles: isSelective ? null : originalMsg.mediaFiles, // Remove group files if selective
            isForwarded: true,
            forwardedFromId: originalMsg.senderId,
          }
        });

        // Create message status for yourself (sender)
        await prisma.messageStatus.create({
          data: {
            messageId: newMessage.id,
            userId: currentUserId,
            status: "READ",
            readAt: new Date()
          }
        });

        // Send socket events
        const io = req.app.get("io");
        if (io) {
          const socketMsg = {
            ...newMessage,
            sender: {
              id: currentUserId,
              username: req.user.username,
              avatarUrl: req.user.avatarUrl
            },
            room: room,
            forwardedFrom: {
              id: originalMsg.senderId
            }
          };

          io.to(roomId).emit("new-message", socketMsg);

          // WHATSAPP FLOW: Notify each member about room update with their unread count
          try {
            const members = await prisma.chatMember.findMany({
              where: { roomId, isActive: true },
              select: { userId: true }
            });

            // Standard icon mapping
            const iconMap = {
              IMAGE: '📷 Photo',
              VIDEO: '🎥 Video',
              AUDIO: '🎵 Audio',
              FILE: '📄 File',
              IMAGE_GROUP: '🖼️ Gallery'
            };

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
                  id: newMessage.id,
                  content: newMessage.content || iconMap[newMessage.type] || 'Forwarded message',
                  type: newMessage.type,
                  sender: socketMsg.sender,
                  createdAt: newMessage.createdAt,
                  fileName: newMessage.fileName,
                  mimeType: newMessage.mimeType,
                  mediaUrl: newMessage.mediaUrl,
                },
                messageId: newMessage.id
              };

              io.to(`user_${member.userId}`).emit("room-updated", updatePayload);
            }

            // Update room timestamp for sorting
            await prisma.chatRoom.update({
              where: { id: roomId },
              data: { updatedAt: new Date() }
            });

          } catch (countError) {
            console.error("Error broadcasting unread counts (Forward):", countError.message);
          }
        }

        results.push(newMessage);
        console.log(`✅ Created message ${newMessage.id} in room ${roomId}`);

      } catch (error) {
        console.error(`❌ Error creating message in room ${roomId}:`, error.message);
      }
    }

    // Update room timestamp
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() }
    });
  }

  console.log(`🎉 Forward complete: ${results.length} messages sent`);

  // 5. RETURN RESPONSE
  return res.status(200).json({
    success: true,
    message: `Forwarded ${results.length > 0 ? results.length : 0} message(s)`,
    data: {
      sentCount: results.length,
      details: {
        roomsTargeted: finalRoomIds.length,
        messagesForwarded: messagesToForward.length,
        messagesCreated: results.length
      }
    }
  });
});


export const togglePinMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { duration, action = 'pin' } = req.body;
  const userId = req.user.id;
  const username = req.user.username;

  console.log(`📌 Pin request: Message ${messageId}, User: ${userId}, Duration: ${duration}, Action: ${action}`);

  // 1. Configuration
  const MAX_PINS_PER_ROOM = 3;
  const DURATION_OPTIONS = {
    '24hours': 24 * 60 * 60 * 1000,
    '7days': 7 * 24 * 60 * 60 * 1000,
    '30days': 30 * 24 * 60 * 60 * 1000,
    'forever': null
  };

  // 2. Validate duration if provided
  if (duration && !(duration in DURATION_OPTIONS)) {
    throw new ApiError(400, `Invalid duration. Options: ${Object.keys(DURATION_OPTIONS).join(', ')}`);
  }

  // 3. Get message (NOW WITH pinnedBy relation!)
  const message = await prisma.message.findUnique({
    where: { id: messageId, deleted: false },
    include: {
      sender: { select: { id: true, username: true, avatarUrl: true } },
      pinnedBy: { select: { id: true, username: true, avatarUrl: true } }, // ✅ NOW WORKS!
      room: { select: { id: true, name: true, isGroup: true } }
    }
  });

  if (!message) {
    throw new ApiError(404, "Message not found or deleted");
  }

  // 4. Get current pinned count
  const currentPinCount = await prisma.message.count({
    where: {
      roomId: message.roomId,
      isPinned: true,
      deleted: false
    }
  });

  console.log(`📊 Current pinned messages in room: ${currentPinCount}/${MAX_PINS_PER_ROOM}`);

  let updateData = {};
  let systemMessage = "";
  let expiresAt = null;

  // 5. Calculate expiration if pinning
  if (!message.isPinned && duration && duration !== 'forever') {
    expiresAt = new Date(Date.now() + DURATION_OPTIONS[duration]);
  }

  // 6. Decide if we are pinning or unpinning
  const isUnpinning = action === 'unpin' || (action === 'pin' && message.isPinned);

  if (isUnpinning) {
    // If not pinned and we want to unpin, just return success
    if (!message.isPinned) {
      return res.status(200).json({ success: true, message: "Message already unpinned" });
    }
    updateData = {
      isPinned: false,
      pinnedExpiresAt: null,
      pinnedAt: null,
      pinnedById: null
    };
    systemMessage = `${username} unpinned a message`;

    // 7. Handle PIN (with limit check)
  } else {
    // If already pinned and we want to pin, just return success
    if (message.isPinned && action === 'pin') {
      return res.status(200).json({ success: true, message: "Message already pinned", data: { message: message } });
    }

    // Check if we're at the limit
    const io = req.app.get("io");
    if (currentPinCount >= MAX_PINS_PER_ROOM) {
      if (action === 'replace-oldest') {
        const oldestPin = await prisma.message.findFirst({
          where: {
            roomId: message.roomId,
            isPinned: true,
            deleted: false
          },
          orderBy: { pinnedAt: 'asc' },
          take: 1
        });

        if (oldestPin) {
          const updatedOldest = await prisma.message.update({
            where: { id: oldestPin.id },
            data: {
              isPinned: false,
              pinnedExpiresAt: null,
              pinnedAt: null,
              pinnedById: null
            },
            include: {
              sender: { select: { id: true, username: true, avatarUrl: true } }
            }
          });

          await prisma.message.create({
            data: {
              roomId: message.roomId,
              senderId: userId,
              type: "SYSTEM",
              content: `${username} unpinned an old message to make room for a new pin`,
            }
          });

          // Emit event for unpinned message immediately
          if (io) {
            io.to(message.roomId).emit("message-pinned", {
              action: "unpinned",
              messageId: updatedOldest.id,
              roomId: message.roomId,
              message: {
                ...updatedOldest,
                sender: updatedOldest.sender
              },
              timestamp: new Date()
            });
          }

          console.log(`🔄 Unpinned oldest message: ${oldestPin.id}`);
        }
      } else {
        throw new ApiError(400,
          `Maximum ${MAX_PINS_PER_ROOM} pinned messages per chat. ` +
          `Unpin some messages first or use action: 'replace-oldest'`
        );
      }
    }

    // Update data for pinning
    updateData = {
      isPinned: true,
      pinnedExpiresAt: expiresAt,
      pinnedAt: new Date(),
      pinnedById: userId
    };

    const humanDuration = duration
      ? duration.replace('24hours', '24 hours').replace('7days', '7 days').replace('30days', '30 days')
      : '';
    systemMessage = `${username} pinned a message${humanDuration ? ` for ${humanDuration}` : ''}`;
  }

  // 8. Update the message
  const updatedMessage = await prisma.message.update({
    where: { id: messageId },
    data: updateData,
    include: {
      sender: { select: { id: true, username: true, avatarUrl: true } },
      pinnedBy: { select: { id: true, username: true, avatarUrl: true } }, // ✅ NOW INCLUDED
      room: { select: { id: true, name: true, isGroup: true } }
    }
  });

  // 9. Create system message
  if (systemMessage) {
    await prisma.message.create({
      data: {
        roomId: message.roomId,
        senderId: userId,
        type: "SYSTEM",
        content: systemMessage,

      }
    });
  }

  // 10. Emit socket event
  if (io) {
    const eventData = {
      action: message.isPinned ? "unpinned" : "pinned",
      messageId: updatedMessage.id,
      roomId: message.roomId,
      message: {
        id: updatedMessage.id,
        content: updatedMessage.content,
        type: updatedMessage.type,
        isPinned: updatedMessage.isPinned,
        pinnedExpiresAt: updatedMessage.pinnedExpiresAt,
        pinnedAt: updatedMessage.pinnedAt,
        pinnedBy: updatedMessage.pinnedBy, // ✅ NOW INCLUDED
        sender: updatedMessage.sender
      },
      pinnedBy: {
        id: userId,
        username: username
      },
      duration: duration,
      timestamp: new Date(),
      currentPinCount: currentPinCount + (message.isPinned ? -1 : 1),
      maxPins: MAX_PINS_PER_ROOM
    };

    io.to(message.roomId).emit("message-pinned", eventData);
    io.to(userId).emit("my-message-pinned", eventData);
  }

  // 11. Return response
  return res.status(200).json({
    success: true,
    message: message.isPinned ? "Message unpinned" : "Message pinned successfully",
    data: {
      message: updatedMessage,
      action: message.isPinned ? "unpinned" : "pinned",
      duration: duration,
      expiresAt: updatedMessage.pinnedExpiresAt,
      pinnedAt: updatedMessage.pinnedAt,
      pinnedBy: updatedMessage.pinnedBy, // ✅ NOW INCLUDED
      limits: {
        current: currentPinCount + (message.isPinned ? -1 : 1),
        max: MAX_PINS_PER_ROOM
      }
    }
  });
});

export const getPinnedMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  console.log(`📌 Getting pinned messages for room: ${roomId}`);

  // Get pinned messages (not expired, not deleted)
  const pinnedMessages = await prisma.message.findMany({
    where: {
      roomId,
      isPinned: true,
      deleted: false,
      OR: [
        { pinnedExpiresAt: null },
        { pinnedExpiresAt: { gt: new Date() } }
      ]
    },
    include: {
      sender: { select: { id: true, username: true, avatarUrl: true } },
      pinnedBy: { select: { id: true, username: true, avatarUrl: true } }, // ✅ NOW INCLUDED
      room: { select: { id: true, name: true, isGroup: true } }
    },
    orderBy: { pinnedAt: 'desc' }
  });

  console.log(`📊 Found ${pinnedMessages.length} pinned messages`);

  // Auto-unpin expired messages (cleanup)
  const expiredPins = await prisma.message.findMany({
    where: {
      roomId,
      isPinned: true,
      pinnedExpiresAt: { lte: new Date() }
    }
  });

  if (expiredPins.length > 0) {
    await prisma.message.updateMany({
      where: {
        id: { in: expiredPins.map(m => m.id) }
      },
      data: {
        isPinned: false,
        pinnedExpiresAt: null,
        pinnedAt: null,
        pinnedById: null
      }
    });

    // Emit socket event for expired pins
    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("pins-expired", {
        roomId,
        messageIds: expiredPins.map(m => m.id),
        count: expiredPins.length
      });
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      pinnedMessages,
      count: pinnedMessages.length,
      roomId
    },
    message: "Pinned messages retrieved"
  });
});

export const getPinLimits = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;

  const membership = await prisma.chatMember.findFirst({
    where: { userId, roomId, isActive: true }
  });

  if (!membership) {
    throw new ApiError(403, "You are not a member of this room");
  }

  const currentPinCount = await prisma.message.count({
    where: {
      roomId,
      isPinned: true,
      deleted: false,
      OR: [
        { pinnedExpiresAt: null },
        { pinnedExpiresAt: { gt: new Date() } }
      ]
    }
  });

  const MAX_PINS = 5;
  // REMOVED: Admin-only restriction
  // const canPin = membership.role === "ADMIN" || membership.role === "OWNER";
  const canPin = true; // Anyone can pin

  return res.json({
    success: true,
    data: {
      canPin,
      currentCount: currentPinCount,
      maxCount: MAX_PINS,
      remaining: MAX_PINS - currentPinCount,
      role: membership.role,
      limits: {
        maxPinsPerRoom: MAX_PINS,
        durationOptions: ['24hours', '7days', '30days', 'forever']
      }
    }
  });
});

export const autoUnpinExpiredMessages = asyncHandler(async (req, res) => {
  const now = new Date();

  // Find all expired pinned messages
  const expiredMessages = await prisma.message.findMany({
    where: {
      isPinned: true,
      pinnedExpiresAt: {
        not: null,
        lte: now
      },
      deleted: false
    },
    include: {
      room: {
        select: { id: true, name: true }
      },
      sender: { select: { id: true, username: true } }
    }
  });

  if (expiredMessages.length === 0) {
    return res.json({
      success: true,
      message: "No expired pinned messages"
    });
  }

  // Group by room
  const roomMessages = {};
  expiredMessages.forEach(msg => {
    if (!roomMessages[msg.roomId]) {
      roomMessages[msg.roomId] = [];
    }
    roomMessages[msg.roomId].push({
      id: msg.id,
      content: msg.content?.substring(0, 50) || 'Message',
      sender: msg.sender.username
    });
  });

  // Unpin all expired
  await prisma.message.updateMany({
    where: {
      id: { in: expiredMessages.map(m => m.id) }
    },
    data: {
      isPinned: false,
      pinnedExpiresAt: null,
      pinnedAt: null,
      pinnedById: null
    }
  });

  // Create system messages for each room
  for (const [roomId, messages] of Object.entries(roomMessages)) {
    await prisma.message.create({
      data: {
        roomId,
        type: "SYSTEM",
        content: `${messages.length} pinned message(s) have expired and were automatically unpinned`,

      }
    });

    // Emit socket event
    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("pins-expired", {
        roomId,
        messageIds: messages.map(m => m.id),
        count: messages.length,
        messages: messages,
        timestamp: now
      });
    }
  }

  res.json({
    success: true,
    message: `Unpinned ${expiredMessages.length} expired message(s)`,
    data: {
      unpinnedCount: expiredMessages.length,
      roomsAffected: Object.keys(roomMessages).length
    }
  });
});

export const getMessageWithPinInfo = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const message = await prisma.message.findUnique({
    where: { id: messageId, deleted: false },
    include: {
      sender: { select: { id: true, username: true, avatarUrl: true } },
      pinnedBy: { select: { id: true, username: true, avatarUrl: true } },
      room: {
        select: {
          id: true,
          name: true,
          isGroup: true
        }
      }
    }
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // Get pinned count for the room
  const currentPinCount = await prisma.message.count({
    where: {
      roomId: message.roomId,
      isPinned: true,
      deleted: false,
      OR: [
        { pinnedExpiresAt: null },
        { pinnedExpiresAt: { gt: new Date() } }
      ]
    }
  });

  return res.json({
    success: true,
    data: {
      message,
      pinInfo: {
        isPinned: message.isPinned,
        pinnedExpiresAt: message.pinnedExpiresAt,
        pinnedAt: message.pinnedAt,
        pinnedBy: message.pinnedBy,
        canPin: true,
        currentRoomPinCount: currentPinCount,
        maxPinsPerRoom: 5
      }
    }
  });
});

/**
 * Star or Unstar a message (Toggle)
 */
export const toggleStarMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  // 1. Check if message exists
  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // 2. Check if already starred
  const existingStar = await prisma.starredMessage.findUnique({
    where: {
      userId_messageId: {
        userId,
        messageId,
      },
    },
  });

  const io = req.app.get("io");

  if (existingStar) {
    // Unstar
    await prisma.starredMessage.delete({
      where: { id: existingStar.id },
    });

    if (io) {
      io.to(`user_${userId}`).emit("message-starred", {
        messageId,
        isStarred: false,
      });
    }

    return res.status(200).json(new ApiResponse(200, { isStarred: false }, "Message unstarred"));
  } else {
    // Star
    await prisma.starredMessage.create({
      data: {
        userId,
        messageId,
      },
    });

    if (io) {
      io.to(`user_${userId}`).emit("message-starred", {
        messageId,
        isStarred: true,
      });
    }

    return res.status(200).json(new ApiResponse(200, { isStarred: true }, "Message starred"));
  }
});

/**
 * Get all starred messages for the current user
 */
export const getStarredMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { q = "", page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const starredEntries = await prisma.starredMessage.findMany({
    where: { 
      userId,
      message: { 
        deleted: false,
        ...(q.trim() && {
          content: { contains: q, mode: 'insensitive' }
        })
      }
    },
    include: {
      message: {
        include: {
          sender: { select: { id: true, username: true, name: true, email: true, avatarUrl: true } },
          room: {
            include: {
              members: {
                include: {
                  user: { select: { id: true, name: true, username: true, email: true, avatarUrl: true } }
                }
              }
            }
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

  const totalCount = await prisma.starredMessage.count({
    where: { 
      userId,
      message: { 
        deleted: false,
        ...(q.trim() && {
          content: { contains: q, mode: 'insensitive' }
        })
      }
    }
  });

  let formattedMessages = starredEntries.map((entry) => {
    const msg = entry.message;
    const room = msg.room;

    // For direct rooms, find the "other" person to show as room name/email
    let otherPerson = null;
    if (!room.isGroup) {
      const otherMember = room.members.find(m => m.userId !== userId);
      if (otherMember) {
        otherPerson = otherMember.user;
      }
    }

    // Determine the best thumbnail to use
    let displayThumbnail = msg.thumbnailUrl || msg.mediaUrl;
    if (!displayThumbnail && msg.mediaFiles && Array.isArray(msg.mediaFiles) && msg.mediaFiles.length > 0) {
      displayThumbnail = msg.mediaFiles[0].thumbnail || msg.mediaFiles[0].thumbnailUrl || msg.mediaFiles[0].url;
    }

    return {
      id: msg.id,
      type: msg.type.toLowerCase(),
      text: msg.content,
      content: msg.content,
      uri: msg.mediaUrl,
      thumbnailUrl: displayThumbnail,
      time: msg.createdAt,
      sender: msg.senderId === userId ? "me" : "other",
      senderName: msg.sender.name,
      senderUsername: msg.sender.username,
      senderEmail: msg.sender.email,
      senderAvatar: msg.sender.avatarUrl,
      senderId: msg.sender.id,
      timestamp: msg.createdAt,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mediaFiles: msg.mediaFiles,
      room: {
        id: room.id,
        isGroup: room.isGroup,
        name: room.isGroup ? room.name : otherPerson?.name,
        email: room.isGroup ? null : otherPerson?.email,
        username: room.isGroup ? null : otherPerson?.username,
        avatar: room.isGroup ? room.avatarUrl : otherPerson?.avatarUrl,
        otherUserId: room.isGroup ? null : otherPerson?.id,
      },
      starredAt: entry.createdAt,
    };
  });


  return res.status(200).json(new ApiResponse(200, { 
    messages: formattedMessages,
    pagination: {
      total: totalCount,
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: skip + formattedMessages.length < totalCount
    }
  }, "Starred messages retrieved successfully"));
});

/**
 * Unstar all messages for the current user
 */
export const unstarAllMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  await prisma.starredMessage.deleteMany({
    where: { userId },
  });

  const io = req.app.get("io");
  if (io) {
    io.to(`user_${userId}`).emit("all-messages-unstarred", { userId });
  }

  return res.status(200).json(
    new ApiResponse(200, {}, "All messages unstarred successfully")
  );
});

// Search messages in a specific room
export const searchMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const userId = req.user.id;
  const { q = "", page = 1, limit = 30 } = req.query;

  if (!q.trim()) {
    return res.status(200).json(
      new ApiResponse(200, { messages: [], total: 0, query: q }, "No query provided")
    );
  }

  // Verify user is a member of the room
  const membership = await prisma.chatMember.findFirst({
    where: { userId, roomId, isActive: true },
  });

  if (!membership) {
    throw new ApiError(403, "You are not a member of this room");
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Fetch all non-deleted, non-hidden messages for this room, then
  // filter case-insensitively in JS (avoids Prisma `mode: insensitive`
  // which is only supported on PostgreSQL with the official Prisma client).
  const allRoomMessages = await prisma.message.findMany({
    where: {
      roomId,
      deleted: false,
      NOT: {
        hiddenFor: { some: { userId } },
      },
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
      statuses: {
        where: { userId },
        select: { status: true },
      },
      starredBy: {
        where: { userId },
        select: { id: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Case-insensitive JS filter
  const lowerQ = q.toLowerCase();
  const filtered = allRoomMessages.filter(
    (msg) => msg.content && msg.content.toLowerCase().includes(lowerQ)
  );

  const total = filtered.length;
  const messages = filtered.slice(skip, skip + parseInt(limit));

  const formatted = messages.map((msg) => ({
    id: msg.id,
    type: msg.type.toLowerCase(),
    text: msg.content,
    content: msg.content,
    deleted: msg.deleted,
    uri: msg.mediaUrl,
    time: msg.createdAt,
    timestamp: msg.createdAt,
    sender: msg.sender.id === userId ? "me" : "other",
    senderName: msg.sender.username,
    senderAvatar: msg.sender.avatarUrl,
    senderId: msg.sender.id,
    status: msg.statuses[0]?.status || "SENT",
    fileName: msg.fileName,
    fileSize: msg.fileSize,
    isPinned: msg.isPinned,
    edited: msg.edited,
    isStarred: msg.starredBy.length > 0,
  }));

  return res.status(200).json(
    new ApiResponse(200, {
      messages: formatted,
      total,
      query: q,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, "Messages searched successfully")
  );
});