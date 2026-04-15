import prisma from "../prisma.js";
import { v4 as uuid } from "uuid";
import { uploadOnCloudinary, cloudinary, generateThumbnailUrl } from "../utils/cloudinary.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendChatNotification } from "../services/notificationService.js"; // IMPORT ADD KARO

// Map resource->type (Robust version)
const mapResourceToType = (resource, mimetype, filename) => {
  const fileExt = filename?.toLowerCase().split('.').pop() || "";
  const mime = mimetype?.toLowerCase() || "";

  // 1. DOCUMENT/FILE DETECTION (Added this first to avoid misidentification by resource type)
  const docExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', 'csv'];
  if (docExtensions.includes(fileExt)) return "FILE";
  if (mime.startsWith('application/')) return "FILE";

  // 2. IMAGE DETECTION
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg'].includes(fileExt)) return "IMAGE";
  if (mime.startsWith('image/')) return "IMAGE";
  
  // 3. AUDIO DETECTION (Checked before Video because Cloudinary returns resource_type: "video" for audio)
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'wma', 'amr', 'opus', 'flac', '3gp'].includes(fileExt)) return "AUDIO";
  if (mime.startsWith('audio/')) return "AUDIO";
  if (resource === "audio") return "AUDIO";

  // 4. VIDEO DETECTION
  if (['mp4', 'mov', 'avi', 'wmv', 'mkv', 'flv', 'webm', 'mpeg'].includes(fileExt)) return "VIDEO";
  if (mime.startsWith('video/')) return "VIDEO";
  if (resource === "video") return "VIDEO";

  // Check resource type last as a fallback
  if (resource === "image") return "IMAGE";

  return "FILE"; // Default
};

// Upload avatar for group
export const updateGroupAvatar = asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }

  try {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "group_avatars",
    });

    const updatedGroup = await prisma.chatRoom.update({
      where: { id: groupId },
      data: { avatarUrl: result.secure_url },
    });

    res.status(200).json({
      success: true,
      data: { avatarUrl: updatedGroup.avatarUrl },
      message: "Group avatar updated successfully",
    });
  } catch (error) {
    console.error("updateGroupAvatar error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Send file in chat - UPDATED WITH NOTIFICATION

export const sendFile = asyncHandler(async (req, res) => {
  try {
    const { roomId, tempId, duration, text = "" } = req.body;
    const senderId = req.user.id;
    const file = req.file;

    console.log("📁 File upload request:", {
      roomId,
      fileName: file?.originalname,
      fileSize: file?.size,
      mimeType: file?.mimetype,
      caption: text // Log the caption
    });

    if (!file || !roomId) {
      return res.status(400).json({
        ok: false,
        error: "File and roomId are required"
      });
    }

    const membership = await prisma.chatMember.findUnique({
      where: { userId_roomId: { userId: senderId, roomId } },
    });
    if (!membership)
      return res
        .status(403)
        .json({ ok: false, error: "Not a member of this room" });

    const others = await prisma.chatMember.findMany({
      where: { roomId, NOT: { userId: senderId } },
      select: { userId: true },
    });

    let uploadResult = null;
    let mediaUrl = null;
    let publicId = null;

    // Handle file upload (empty or non-empty)
    if (file.size > 0) {
      console.log(`☁️ Uploading ${file.mimetype} to Cloudinary...`);
      uploadResult = await uploadOnCloudinary(file.path, "ChatFiles");
      if (uploadResult?.secure_url) {
        mediaUrl = uploadResult.secure_url;
        publicId = uploadResult.public_id;
      } else {
        return res.status(500).json({ ok: false, error: "Cloudinary upload failed" });
      }
    } else {
      console.log("📝 Empty file detected - handling properly");
      try {
        const placeholderContent = "[Empty file]";
        const placeholderBuffer = Buffer.from(placeholderContent);
        const base64Data = placeholderBuffer.toString('base64');
        const dataUri = `data:${file.mimetype};base64,${base64Data}`;

        uploadResult = await cloudinary.uploader.upload(dataUri, {
          folder: "ChatFiles",
          resource_type: "auto",
          public_id: `empty_${Date.now()}_${file.originalname}`
        });

        if (uploadResult?.secure_url) {
          mediaUrl = uploadResult.secure_url;
          publicId = uploadResult.public_id;
        }
      } catch (uploadError) {
        console.error("Failed to upload empty file placeholder:", uploadError);
      }
    }

    const messageType = mapResourceToType(
      uploadResult?.resource_type,
      file.mimetype,
      file.originalname
    );

    // Generate thumbnail for IMAGE and VIDEO
    const thumbnailUrl = (messageType === 'IMAGE' || messageType === 'VIDEO')
      ? generateThumbnailUrl(mediaUrl, uploadResult?.resource_type)
      : null;

    // FIXED: Use ONLY user-provided caption, no auto-generated text
    const messageContent = text || "";

    // Create message
    const created = await prisma.message.create({
      data: {
        id: uuid(),
        roomId,
        senderId,
        type: messageType,
        content: text,
        mediaUrl: mediaUrl,
        publicId: publicId,
        fileName: file.originalname || uploadResult?.original_filename,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileType: messageType.toLowerCase(),
        thumbnailUrl: thumbnailUrl,
        duration: duration ? parseInt(duration) : null,
        statuses: {
          create: [
            { userId: senderId, status: "READ", readAt: new Date() },
            ...others.map((o) => ({ userId: o.userId, status: "SENT" })),
          ],
        },
      },
      include: {
        sender: true,
        statuses: true,
        repliedTo: {
          include: {
            sender: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        },
      },
    });

    console.log("File message saved:", {
      id: created.id,
      type: created.type,
      fileName: created.fileName,
      fileSize: created.fileSize,
      content: created.content, // Should be empty if no caption
      hasMediaUrl: !!created.mediaUrl
    });

    console.log('DEBUG: File message created successfully:', created.id);

    // UPDATED: Group name ke saath notification call
    try {
      const receiverIds = others.map(o => o.userId);

      console.log('Attempting FCM notification for file upload');
      console.log('Receivers:', receiverIds);

      if (receiverIds.length > 0) {
        let notificationContent = '';

        // MEDIA TYPE KE HISAB SE NOTIFICATION TEXT
        if (messageType === 'IMAGE') {
          notificationContent = '📷 Sent an image';
        } else if (messageType === 'VIDEO') {
          notificationContent = 'Sent a video';
        } else if (messageType === 'AUDIO') {
          notificationContent = '🎵 Sent an audio';
        } else {
          notificationContent = '📄 Sent a file';
        }

        console.log('Notification content:', notificationContent);

        // GROUP NAME KE SAATH NOTIFICATION
        await sendChatNotification(receiverIds, {
          roomId: roomId,
          messageId: created.id,
          senderId: senderId,
          senderName: created.sender.name || created.sender.username || "User",
          content: notificationContent,
          type: messageType,
          mediaUrl: uploadResult?.secure_url,
          imageUrl: messageType === 'IMAGE' ? uploadResult?.secure_url : undefined
        });

        console.log(`FCM group notification sent to ${receiverIds.length} users`);
      } else {
        console.log('No receivers found for file notification');
      }
    } catch (fcmError) {
      console.log('FCM file notification error:', fcmError.message);
    }


    // FIXED: Complete message structure for socket broadcast
    const out = {
      id: created.id,
      roomId,
      url: created.mediaUrl,
      mediaUrl: created.mediaUrl,
      type: messageType,
      fileType: messageType === 'FILE' ? 'pdf' : messageType.toLowerCase(),
      fileName: file.originalname || uploadResult?.original_filename,
      fileSize: file.size,
      mimeType: file.mimetype,
      content: created.content,
      createdAt: created.createdAt,
      thumbnailUrl: created.thumbnailUrl,
      sender: {
        id: created.sender.id,
        username: created.sender.username,
        name: created.sender.name,
        avatarUrl: created.sender.avatarUrl,
      },
      senderId: created.senderId,
    };

    // Broadcast via Socket.io
    const io = req.app.get("io");
    if (io) {
      console.log(`📤 Broadcasting file message to room: ${roomId}`);
      io.to(roomId).emit("new-message", out);

      // WHATSAPP FLOW: Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId, isActive: true },
          select: { userId: true }
        });

        // Icon mapping for chat list preview
        const iconMap = {
          IMAGE: '📷 Photo',
          VIDEO: '🎥 Video',
          AUDIO: '🎵 Audio',
          FILE: `📄 ${out.fileName || 'File'}`
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
              id: out.id,
              content: out.content || iconMap[messageType] || 'File message',
              type: out.type,
              sender: out.sender,
              createdAt: out.createdAt,
              fileName: out.fileName,
              mimeType: out.mimeType,
              mediaUrl: out.mediaUrl,
              thumbnailUrl: out.thumbnailUrl,
            },
            messageId: out.id
          };

          // Emit to user's personal room
          io.to(`user_${member.userId}`).emit("room-updated", updatePayload);
        }

        // Update room timestamp for sorting
        await prisma.chatRoom.update({
          where: { id: roomId },
          data: { updatedAt: new Date() }
        });

        console.log(`File message broadcast & unread counts complete for room: ${roomId}`);
      } catch (countError) {
        console.error("Error broadcasting unread counts (File):", countError);
      }
    } else {
      console.warn("Socket.io instance not available for file broadcast");
    }

    return res.status(200).json({ ok: true, message: out });
  } catch (e) {
    console.error("sendFile error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Upload failed"
    });
  }
});