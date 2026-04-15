import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { sendChatNotification } from "../services/notificationService.js";

export const sendMessage = asyncHandler(async (req, res) => {
  try {
    const {
      roomId,
      content,
      type = "TEXT", // Default to TEXT
      tempId,
      replyTo
      // REMOVED: All file fields - this is for TEXT only
    } = req.body;

    const senderId = req.user?.id;

    console.log('DEBUG: sendMessage (TEXT ONLY) called with:', {
      roomId,
      content: content?.substring(0, 50) + '...',
      type,
      senderId
    });

    if (!senderId) throw new ApiError(401, "Unauthorized");
    if (!roomId || !content?.trim()) {
      throw new ApiError(400, "Room ID and content are required");
    }

    // ENFORCE: This endpoint is only for TEXT messages
    if (type && type !== "TEXT") {
      console.warn('sendMessage used for non-TEXT type. Auto-correcting to TEXT:', type);
      type = "TEXT"; // Force to TEXT
    }

    // membership check
    const membership = await prisma.chatMember.findUnique({
      where: { userId_roomId: { userId: senderId, roomId } },
    });
    if (!membership)
      throw new ApiError(403, "You are not a member of this room");

    const others = await prisma.chatMember.findMany({
      where: { roomId, NOT: { userId: senderId } },
      select: { userId: true },
    });

    console.log('DEBUG: Other members in room:', others);

    // TEXT-ONLY: Create message without any file fields
    const created = await prisma.message.create({
      data: {
        roomId,
        senderId,
        type: "TEXT", // Always TEXT
        content: content.trim(),
        replyToId: replyTo || null,
        createdAt: new Date().toISOString(),
        // NO file fields - this is text only
        statuses: {
          create: [
            { userId: senderId, status: "READ", readAt: new Date() },
            ...others.map((o) => ({ userId: o.userId, status: "SENT" })),
          ],
        },
      },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
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

    console.log('DEBUG: TEXT Message created successfully:', created.id);

    // FCM NOTIFICATION (for text messages)
    try {
      const receiverIds = others.map(o => o.userId);

      console.log('DEBUG: Attempting FCM notification for TEXT message');

      if (receiverIds.length > 0) {
        // For text messages, use the actual content
        const notificationContent = content.length > 50
          ? content.substring(0, 50) + '...'
          : content;

        console.log('DEBUG: Text notification content:', notificationContent);

        await sendChatNotification(receiverIds, {
          roomId: roomId,
          messageId: created.id,
          senderId: senderId,
          senderName: created.sender.name || created.sender.username || "User",
          content: notificationContent,
          type: "TEXT" // Always TEXT
        });
        console.log(`FCM TEXT notification sent to ${receiverIds.length} users`);
      } else {
        console.log('DEBUG: No receivers found for TEXT notification');
      }
    } catch (fcmError) {
      console.log('FCM TEXT error (non-blocking):', fcmError.message);
    }

    // TEXT-ONLY: Message format without file fields
    const out = {
      id: created.id,
      roomId,
      tempId: tempId || null,
      content: created.content,
      type: "TEXT", // Always TEXT
      createdAt: created.createdAt,

      // NO file fields - this is text only

      sender: {
        id: created.sender.id,
        username: created.sender.username,
        name: created.sender.name,
        avatarUrl: created.sender.avatarUrl,
      },
      senderId: created.sender.id,
      status: "SENT",
      repliedTo: created.repliedTo
        ? {
          id: created.repliedTo.id,
          content: created.repliedTo.content,
          sender: created.repliedTo.senderId,
          senderId: created.repliedTo.senderId,
          senderName: created.repliedTo.sender?.username || created.repliedTo.sender?.name || "Unknown",
          senderAvatar: created.repliedTo.sender?.avatarUrl || null,
          type: created.repliedTo.type,
        }
        : null,
    };

    // Socket broadcast
    const io = req.app.get("io");
    if (io) {
      console.log(`📤 Broadcasting TEXT message to room: ${roomId}`);
      io.to(roomId).emit("new-message", out);

      // WHATSAPP FLOW: Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId, isActive: true },
          select: { userId: true }
        });

        for (const member of members) {
          const unreadCount = await prisma.messageStatus.count({
            where: {
              userId: member.userId,
              message: { roomId: roomId },
              status: { in: ["SENT", "DELIVERED"] }
            }
          });

          const updatePayload = {
            roomId,
            unreadCount,
            lastMessage: {
              id: out.id,
              content: out.content,
              type: out.type,
              sender: out.sender,
              createdAt: out.createdAt,
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

      } catch (countError) {
        console.error("Error broadcasting unread counts (Text):", countError);
      }

    } else {
      console.warn("Socket.io instance not available");
    }

    return res.status(201).json({ ok: true, message: out });
  } catch (err) {
    console.error("sendMessage error:", err);
    const code = err?.statusCode || 500;
    return res
      .status(code)
      .json({ ok: false, message: err?.message || "Failed to send message" });
  }
});

export const getMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { all = "true" } = req.query;
  const userId = req.user.id;

  const membership = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId: req.user.id, roomId } },
  });
  if (!membership) throw new ApiError(403, "You are not a member of this room");

  // ✅ Get ALL messages (including deleted ones), but EXCLUDE "Delete for me" hidden messages
  const where = {
    roomId,
    NOT: {
      hiddenFor: {
        some: { userId: userId }
      }
    }
  };

  let queryOptions = {
    where,
    include: {
      sender: true,
      statuses: {
        include: {
          user: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
        },
      },
      repliedTo: {
        include: {
          sender: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
        },
      },
      starredBy: {
        where: { userId: req.user.id },
        select: { id: true }
      },
    },
    orderBy: { createdAt: "desc" },
  };

  if (all !== "true") {
    const { page = 1, limit = 50 } = req.query;
    queryOptions.skip = (page - 1) * parseInt(limit);
    queryOptions.take = parseInt(limit);
  }

  const messages = await prisma.message.findMany(queryOptions);

  // Get total count for pagination info
  const totalCount = await prisma.message.count({
    where: {
      roomId,
      NOT: {
        hiddenFor: {
          some: { userId: userId }
        }
      }
    }
  });

  // ✅ Process messages: Fix deleted messages content & calculate status
  const processedMessages = messages.map((msg) => {
    // Handle deleted messages
    let finalContent = msg.content;
    if (msg.deleted) {
      const isAlreadyDeletedText = msg.content === "You deleted this message" ||
        msg.content === "This message was deleted";

      if (!isAlreadyDeletedText) {
        finalContent = msg.senderId === userId
          ? "You deleted this message"
          : "This message was deleted";
      }
    }

    // Determine overall status for the sender/receiver
    let displayStatus = "SENT";
    const isMe = String(msg.senderId) === String(userId);

    if (isMe) {
      const otherStatuses = msg.statuses.filter(s => String(s.userId) !== String(userId));
      if (otherStatuses.length > 0) {
        const allRead = otherStatuses.every(s => (s.status || "").toUpperCase() === "READ");
        const allDelivered = otherStatuses.every(s => ["READ", "DELIVERED"].includes((s.status || "").toUpperCase()));

        if (allRead) displayStatus = "READ";
        else if (allDelivered) displayStatus = "DELIVERED";
        else displayStatus = "SENT";
      } else {
        displayStatus = "SENT";
      }
    } else {
      displayStatus = msg.statuses.find(s => String(s.userId) === String(userId))?.status || "RECEIVED";
    }

    // Auto-correct: If it has file fields but wrong type, fix it
    const hasImageExt = (str) => String(str || "").toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp|heic)$/i);
    const hasAudioExt = (str) => String(str || "").toLowerCase().match(/\.(mp3|wav|m4a|aac|ogg|wma|amr|opus|flac|3gp)$/i);
    const hasVideoExt = (str) => String(str || "").toLowerCase().match(/\.(mp4|mov|avi|wmv|mkv|flv|webm|mpeg)$/i);

    let finalType = msg.type;
    if (msg.mediaUrl || msg.fileName) {
      const url = msg.mediaUrl || "";
      const name = msg.fileName || "";

      if (hasImageExt(url) || hasImageExt(name)) {
        finalType = 'IMAGE';
      } else if (hasAudioExt(url) || hasAudioExt(name)) {
        finalType = 'AUDIO';
      } else if (hasVideoExt(url) || hasVideoExt(name)) {
        finalType = 'VIDEO';
      } else if (msg.type === 'TEXT') {
        finalType = 'FILE';
      }
    }

    // Process individual statuses to ensure deliveredAt is at least message.createdAt
    const processedStatuses = (msg.statuses || []).map(s => ({
      ...s,
      // If deliveredAt is null, use message createdAt as fallback
      // because it was delivered to the server at that time.
      deliveredAt: s.deliveredAt || msg.createdAt,
      // Ensure readAt is also present if status is READ
      readAt: s.readAt || (s.status === "READ" ? (s.deliveredAt || msg.createdAt) : null)
    }));

    return {
      ...msg,
      content: finalContent,
      status: displayStatus,
      statuses: processedStatuses,
      type: finalType,
      thumbnailUrl: msg.thumbnailUrl,
      repliedTo: msg.repliedTo
        ? {
          ...msg.repliedTo,
          senderName: msg.repliedTo.sender?.username || msg.repliedTo.sender?.name || "Unknown",
        }
        : null,
      // Clear media for deleted
      ...(msg.deleted && {
        mediaUrl: null,
        fileName: null,
        fileSize: null,
        fileType: null,
        mimeType: null,
        duration: null,
        type: "TEXT"
      })
    };
  });

  // Mark messages as read (your existing code)
  const unreadMessages = processedMessages.filter(
    (m) => {
      const myStatus = m.statuses.find(s => String(s.userId) === String(userId));
      return !myStatus || myStatus.status !== "READ";
    }
  );

  if (unreadMessages.length > 0) {
    const unreadIds = unreadMessages.map((m) => m.id);

    await prisma.messageStatus.updateMany({
      where: { messageId: { in: unreadIds }, userId: req.user.id },
      data: { status: "READ", readAt: new Date() },
    });

    const noStatus = unreadMessages.filter((m) => !m.statuses.length);
    if (noStatus.length > 0) {
      await prisma.messageStatus.createMany({
        data: noStatus.map((m) => ({
          messageId: m.id,
          userId: req.user.id,
          status: "READ",
          readAt: new Date(),
        })),
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("messages-read-update", {
        roomId,
        messageIds: unreadIds,
        readerId: req.user.id,
        status: "READ"
      });
    }
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        messages: processedMessages,
        totalCount,
        totalPages: all === "true" ? 1 : Math.ceil(totalCount / parseInt(req.query.limit || 50)),
        currentPage: all === "true" ? 1 : parseInt(req.query.page || 1),
      },
      all === "true" ? "All messages fetched successfully" : "Messages fetched successfully"
    )
  );
});

// -- Mark multiple messages as read
export const markMessageRead = asyncHandler(async (req, res) => {
  const { messageIds } = req.body;
  const { roomId } = req.params;
  const currentUserId = req.user.id;

  if (!roomId) throw new Error("RoomId is required");

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, roomId },
    include: { room: { include: { members: true } } },
  });

  const validMessages = messages.filter((msg) =>
    msg.room.members.some((m) => m.userId === currentUserId)
  );

  const upsertPromises = validMessages.map((msg) =>
    prisma.messageStatus.upsert({
      where: { messageId_userId: { messageId: msg.id, userId: currentUserId } },
      update: { status: "READ", readAt: new Date() },
      create: {
        messageId: msg.id,
        userId: currentUserId,
        status: "READ",
        readAt: new Date(),
      },
    })
  );

  const updatedStatuses = await Promise.all(upsertPromises);

  const io = req.app.get("io");
  if (io) {
    io.to(roomId).emit("messages-read-update", {
      roomId,
      messageIds: validMessages.map((m) => m.id),
      readerId: currentUserId,
      status: "READ"
    });
  }

  res.status(200).json({ success: true, data: updatedStatuses });
});

export const replyMessage = asyncHandler(async (req, res) => {
  try {
    const { messageId, content, type, tempId } = req.body;
    const senderId = req.user.id;

    if (!senderId) throw new ApiError(401, "Unauthorized");
    if (!messageId || !content?.trim())
      throw new ApiError(400, "Message ID and content are required");

    const originalMessage = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        room: {
          include: { members: true },
        },
        sender: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
      },
    });
    if (!originalMessage) throw new ApiError(404, "Original message not found");

    const membership = await prisma.chatMember.findUnique({
      where: {
        userId_roomId: { userId: senderId, roomId: originalMessage.roomId },
      },
    });
    if (!membership) throw new ApiError(403, "You are not a member of this room");

    const others = originalMessage.room.members.filter(
      (m) => m.userId !== senderId
    );

    const reply = await prisma.message.create({
      data: {
        roomId: originalMessage.roomId,
        senderId,
        type: type || "TEXT",
        content: content.trim(),
        replyToId: originalMessage.id,
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
            sender: true,
          },
        },
      },
    });

    // FCM NOTIFICATION FOR REPLY
    try {
      const receiverIds = others.map(o => o.userId);

      if (receiverIds.length > 0) {
        await sendChatNotification(receiverIds, {
          roomId: originalMessage.roomId,
          messageId: reply.id,
          senderId: senderId,
          senderName: reply.sender.name || reply.sender.username || "User",
          content: `Replied: ${content.trim()}`,
          type: type || "TEXT"
        });
        console.log(`FCM reply notification sent to ${receiverIds.length} users`);
      }
    } catch (fcmError) {
      console.log('FCM error (non-blocking):', fcmError.message);
    }

    // FIX: Improved output format
    const out = {
      id: reply.id,
      roomId: originalMessage.roomId,
      tempId: tempId || null,
      content: reply.content,
      type: reply.type,
      createdAt: reply.createdAt,
      sender: {
        id: reply.sender.id,
        username: reply.sender.username,
        name: reply.sender.name,
        avatarUrl: reply.sender.avatarUrl,
      },
      senderId: reply.sender.id,
      status: "SENT",
      repliedTo: {
        id: originalMessage.id,
        content: originalMessage.content,
        sender: originalMessage.senderId,
        senderId: originalMessage.senderId,
        senderName: originalMessage.sender?.username || originalMessage.sender?.name || "Unknown",
        type: originalMessage.type,
      },
    };

    const io = req.app.get("io");
    if (io) {
      console.log(`📤 Broadcasting reply to room: ${originalMessage.roomId}`, out);
      io.to(originalMessage.roomId).emit("new-message", out);

      // Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId: originalMessage.roomId, isActive: true },
          select: { userId: true }
        });

        for (const member of members) {
          const unreadCount = await prisma.messageStatus.count({
            where: {
              userId: member.userId,
              message: { roomId: originalMessage.roomId },
              status: { in: ["SENT", "DELIVERED"] }
            }
          });

          const updatePayload = {
            roomId: originalMessage.roomId,
            unreadCount,
            lastMessage: {
              id: out.id,
              content: out.content,
              type: out.type,
              sender: out.sender,
              createdAt: out.createdAt,
            },
            messageId: out.id
          };

          io.to(`user_${member.userId}`).emit("room-updated", updatePayload);
        }

        // Update room timestamp for sorting
        await prisma.chatRoom.update({
          where: { id: originalMessage.roomId },
          data: { updatedAt: new Date() }
        });

      } catch (countError) {
        console.error("Error broadcasting unread counts (Reply):", countError);
      }
    }


    return res.status(201).json({ ok: true, message: out });
  } catch (err) {
    console.error("replyMessage error:", err);
    const code = err?.statusCode || 500;
    return res
      .status(code)
      .json({ ok: false, message: err?.message || "Failed to send reply" });
  }
});
// -- Search users
export const searchUsers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const currentUserId = req.user.id;

  if (!q || q.length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters long",
    });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [{ username: { contains: q } }, { email: { contains: q } }],
        NOT: { id: currentUserId },
      },
      select: { id: true, username: true, email: true, avatarUrl: true },
      take: 20,
    });

    res.status(200).json({
      success: true,
      data: users,
      message: "Users found successfully",
    });
  } catch (error) {
    console.error("Search users error:", error);
    res.status(500).json({
      success: false,
      message: "Error searching users. Please try again.",
    });
  }
});

// Get all 1:1 chats for logged-in user (Updated with online status)
export const getChats = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const chats = await prisma.chatRoom.findMany({
      where: {
        members: { some: { userId } }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
                isOnline: true,
                lastSeen: true,
              },
            },
          },
        },
        messages: {
          where: { deleted: false },
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
            fileName: true,
            mimeType: true,
            mediaUrl: true,
            thumbnailUrl: true,
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const formatted = await Promise.all(
      chats.map(async (chat) => {
        const lastMessage = chat.messages[0] || null;

        let chatInfo = {};
        let otherParticipant = null;

        if (chat.isGroup) {
          // GROUP CHAT LOGIC
          chatInfo = {
            name: chat.name || "Unnamed Group", // Assuming you have 'name' field for groups
            avatarUrl: chat.avatarUrl || null,
            isOnline: false, // Groups don't have online status
            lastSeen: null,
          };
        } else {
          // PRIVATE CHAT LOGIC (original)
          otherParticipant = chat.members.find(
            (m) => m.userId !== userId
          )?.user;

          chatInfo = {
            name: otherParticipant?.username || otherParticipant?.name || "Unknown",
            avatarUrl: otherParticipant?.avatarUrl || null,
            isOnline: otherParticipant?.isOnline || false,
            status: otherParticipant?.status || (otherParticipant?.isOnline ? "online" : "offline"),
            lastSeen: otherParticipant?.lastSeen || null,
          };
        }


        const unreadCount = await prisma.message.count({
          where: {
            roomId: chat.id,
            senderId: { not: userId }, // Don't count your own messages
            type: { not: "SYSTEM" },   // Skip system messages like pinning
            NOT: {
              statuses: {
                some: {
                  userId: userId,
                  OR: [
                    { status: "READ" },
                    { status: "DELIVERED" }
                  ]
                }
              }
            }
          }
        });

        // Optional: Debug logging for unread messages
        if (unreadCount > 0) {

          // Optional: See what types of messages are unread
          const unreadMessages = await prisma.message.findMany({
            where: {
              roomId: chat.id,
              senderId: { not: userId },
              type: { not: "SYSTEM" },
              NOT: {
                statuses: {
                  some: {
                    userId: userId,
                    OR: [
                      { status: "READ" },
                      { status: "DELIVERED" }
                    ]
                  }
                }
              }
            },
            select: { type: true, content: true }
          });

          const typeCount = {};
          unreadMessages.forEach(msg => {
            typeCount[msg.type] = (typeCount[msg.type] || 0) + 1;
          });
        }

        // Find MY membership data specifically
        const myMembership = chat.members.find(m => m.userId === userId);

        // Prepare members list
        const members = chat.members.map((m) => ({
          id: m.user.id,
          username: m.user.username || m.user.name || "Unknown",
          avatarUrl: m.user.avatarUrl || null,
          isOnline: m.user.isOnline || false,
          lastSeen: m.user.lastSeen || null,
          role: m.role,
          mutedUntil: m.mutedUntil,
          isPinned: m.isPinned,
          isFavorite: m.isFavorite
        }));

        // Format last message content
        const formatLastMessageContent = (message) => {
          if (!message) return null;

          let type = message.type;
          const url = message.mediaUrl || "";
          const name = message.fileName || "";

          // Extension-based detection for more accurate labels
          const hasImageExt = (str) => String(str || "").toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp|heic)$/i);
          const hasAudioExt = (str) => String(str || "").toLowerCase().match(/\.(mp3|wav|m4a|aac|ogg|wma|amr|opus|flac|3gp)$/i);
          const hasVideoExt = (str) => String(str || "").toLowerCase().match(/\.(mp4|mov|avi|wmv|mkv|flv|webm|mpeg)$/i);
          const hasDocExt = (str) => String(str || "").toLowerCase().match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|csv)$/i);

          if (hasImageExt(url) || hasImageExt(name)) {
            type = 'IMAGE';
          } else if (hasAudioExt(url) || hasAudioExt(name)) {
            type = 'AUDIO';
          } else if (hasVideoExt(url) || hasVideoExt(name)) {
            type = 'VIDEO';
          } else if (hasDocExt(url) || hasDocExt(name)) {
            type = 'FILE';
          }

          // For display purposes
          if (type === 'IMAGE') return '📷 Photo';
          if (type === 'VIDEO') return '🎥 Video';
          if (type === 'AUDIO') return '🎵 Audio';
          if (type === 'FILE') return `📄 ${message.fileName || 'File'}`;
          return message.content || 'Message';
        };

        // Build response object
        const response = {
          id: chat.id,
          roomId: chat.id,
          senderId: !chat.isGroup ? otherParticipant?.id : null,
          name: chatInfo.name,
          avatarUrl: chatInfo.avatarUrl,
          isOnline: chatInfo.isOnline,
          lastSeen: chatInfo.lastSeen,
          isGroup: !!chat.isGroup,
          pinned: myMembership?.isPinned || false,
          muted: !!myMembership?.mutedUntil,
          isFavorite: myMembership?.isFavorite || false,
          lastMessage: lastMessage
            ? {
              id: lastMessage.id,
              content: formatLastMessageContent(lastMessage),
              rawContent: lastMessage.content, // Keep original for reference
              type: lastMessage.type,
              fileName: lastMessage.fileName,
              mimeType: lastMessage.mimeType,
              mediaUrl: lastMessage.mediaUrl,
              sender: lastMessage.sender
                ? {
                  id: lastMessage.sender.id,
                  username: lastMessage.sender.username || lastMessage.sender.name || "Unknown",
                  avatarUrl: lastMessage.sender.avatarUrl || null,
                }
                : null,
              createdAt: lastMessage.createdAt,
            }
            : null,
          lastMessageTime: lastMessage?.createdAt || chat.updatedAt,
          unreadCount,
          members,
          isPinned: false,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        };

        // Add type-specific fields
        if (chat.isGroup) {
          // Group-specific fields
          response.groupName = chat.name || "Unnamed Group";
          response.groupAvatarUrl = chat.avatarUrl || null;
          response.membersCount = chat.members.length;

        } else {
          // Private chat-specific fields
          response.senderId = otherParticipant?.id;
          response.isPrivate = true;
        }

        return response;
      })
    );

    const privateChats = formatted.filter(c => !c.isGroup);
    const groupChats = formatted.filter(c => c.isGroup);
    const totalUnread = formatted.reduce((sum, chat) => sum + chat.unreadCount, 0);
    const privateUnread = privateChats.reduce((sum, chat) => sum + chat.unreadCount, 0);
    const groupUnread = groupChats.reduce((sum, chat) => sum + chat.unreadCount, 0);



    return res.status(200).json({
      success: true,
      data: formatted,
      message: "Chats fetched successfully",
    });
  } catch (error) {
    console.error("getChats error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching chats",
      error: error.message,
    });
  }
});

// -- Get user online status
export const getUserStatus = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      isOnline: true,
      lastSeen: true,
    },
  });

  if (!user) throw new ApiError(404, "User not found");

  res.status(200).json(
    new ApiResponse(
      200,
      {
        userId: user.id,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        status: user.isOnline ? "online" : "offline",
        lastSeen: user.lastSeen,
      },
      "User status fetched successfully"
    )
  );
});

// -- Get group members online status
export const getGroupMembersStatus = asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  // Check if user is member of this group
  const membership = await prisma.chatMember.findUnique({
    where: {
      userId_roomId: { userId: req.user.id, roomId: groupId },
    },
    include: {
      room: {
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatarUrl: true,
                  isOnline: true,
                  lastSeen: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!membership)
    throw new ApiError(403, "You are not a member of this group");

  const membersWithStatus = membership.room.members.map((member) => ({
    id: member.user.id,
    username: member.user.username,
    name: member.user.name,
    avatarUrl: member.user.avatarUrl,
    status: member.user.isOnline ? "online" : "offline",
    lastSeen: member.user.lastSeen,
    role: member.role,
  }));

  // Calculate online count
  const onlineCount = membersWithStatus.filter(
    (member) => member.status === "online"
  ).length;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        groupId,
        totalMembers: membersWithStatus.length,
        onlineCount,
        members: membersWithStatus,
      },
      "Group members status fetched successfully"
    )
  );
});

// controller/chat.controller.js (or wherever deleteRoom lives)
export const deleteRoom = asyncHandler(async (req, res) => {
  try {
    const { roomId: rawRoomId } = req.params;
    const rawUserId = req.user?.id;

    if (!rawRoomId) {
      throw new ApiError(400, "Room ID is required");
    }
    if (!rawUserId) {
      throw new ApiError(401, "User not authenticated");
    }

    // Normalize ids: if numeric strings, convert to Number, otherwise keep as-is.
    const roomId = !isNaN(Number(rawRoomId)) ? Number(rawRoomId) : rawRoomId;
    const userId = !isNaN(Number(rawUserId)) ? Number(rawUserId) : rawUserId;

    // Fetch membership and include room info (and members if needed)
    const membership = await prisma.chatMember.findUnique({
      where: {
        userId_roomId: { userId, roomId },
      },
      include: {
        room: {
          include: {
            members: true,
          },
        },
      },
    });

    // Helpful debug logging (can be removed once confirmed working)
    console.log(
      "[deleteRoom] membership fetched:",
      JSON.stringify(membership, null, 2)
    );

    if (!membership) {
      throw new ApiError(403, "You are not a member of this room");
    }

    // Normalize the isGroup flag safely (covers boolean and string cases)
    const isGroup =
      membership.room &&
      (membership.room.isGroup === true ||
        String(membership.room.isGroup).toLowerCase() === "true");

    if (isGroup) {
      // Normalize role string for safe, case-insensitive comparison
      const roleStr = membership.role
        ? String(membership.role).toUpperCase()
        : "";

      // Accept ADMIN, OWNER, and MODERATOR as admin-equivalents.
      const adminRoles = ["ADMIN", "OWNER", "MODERATOR"];

      if (!adminRoles.includes(roleStr)) {
        throw new ApiError(403, "Only group admins can delete the group");
      }
    }

    // Delete the room (cascade will handle messages, members, etc.)
    await prisma.chatRoom.delete({
      where: { id: roomId },
    });

    // Notify all room members via socket
    const io = req.app.get("io");
    if (io) {
      io.to(String(roomId)).emit("room-deleted", { roomId });
    }

    res
      .status(200)
      .json(new ApiResponse(200, null, "Room deleted successfully"));
  } catch (error) {
    console.error("Delete room error:", error);
    // keep original behavior: wrap and rethrow to be handled by your asyncHandler/error middleware
    throw new ApiError(
      error.statusCode || 500,
      error.message || "Failed to delete room"
    );
  }
});


