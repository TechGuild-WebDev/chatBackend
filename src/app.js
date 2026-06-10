// src/app.js
import dotenv from "dotenv";
dotenv.config();

// BigInt serialization fix for JSON responses
BigInt.prototype.toJSON = function() {
  return Number(this);
};

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import passport from "passport";
import { Server } from "socket.io";
import prisma from "./prisma.js";
import jwt from "jsonwebtoken";
import { cloudinary } from "./utils/cloudinary.js";
import errorHandler from "./middlewares/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

import admin from 'firebase-admin';
// Routers
import userRouter from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import chatRouter from "./routes/chat.routes.js";
import groupRoutes from "./routes/group.routes.js";
import meetingRoutes from "./routes/meeting.routes.js";
import fileRoutes from "./routes/file.routes.js";
import roomRoutes from "./routes/room.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import authRoutes from "./routes/auth.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import userStatusRoutes from "./routes/userStatus.routes.js";
import callRoutes from "./routes/call.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import audioRoutes from "./routes/audio.routes.js";
import hierarchyRoutes from "./routes/hierarchy.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import messageRoutes from "./routes/message.routes.js";


// Services
import { reminderService } from "./services/reminderService.js";
import { sendChatNotification } from "./services/notificationService.js";
import { setIoInstance, checkPendingStatusResets } from "./services/statusScheduler.js";
import { authenticate } from "./middlewares/authenticate.js";
import { startStaleCallCleanup } from "./cronJobs.js";
import { createCallLog } from "./controller/call.controller.js";

const app = express();
const server = http.createServer(app);

// -------------------- Port Availability Check --------------------
import net from 'net';

const checkPort = (port) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
};

const findAvailablePort = async (startPort) => {
  let port = startPort;
  let maxAttempts = 10;

  while (maxAttempts > 0) {
    const isAvailable = await checkPort(port);
    if (isAvailable) {
      return port;
    }
    console.log(` Port ${port} is busy, trying ${port + 1}...`);
    port++;
    maxAttempts--;
  }

  throw new Error('Could not find available port after 10 attempts');
};

// -------------------- Allowed origins --------------------
const ALLOWED_ORIGINS = new Set(
  [
    "http://localhost:5173",
    "http://localhost:5174",
    process.env.CORS_ORIGIN,
    process.env.CORS_ORIGIN_ADMIN,
  ].filter(Boolean)
);

// -------------------- Middleware --------------------
app.use(morgan("dev"));

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "defaultsecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Serve uploaded files (avatars, etc.)
// Explicit route is more reliable than express.static across different start directories.
app.get("/uploads/*", (req, res) => {
  const relativePath = req.params[0];
  const absolutePath = path.join(__dirname, "../public/uploads", relativePath);
  console.log(`📁 Serving file: ${absolutePath}`);
  res.sendFile(absolutePath, (err) => {
    if (err && !res.headersSent) {
      console.error(`❌ File not found: ${absolutePath}`);
      res.status(404).json({ message: "File not found", path: absolutePath });
    }
  });
});

// -------------------- Socket.IO --------------------
reminderService.initializeScheduledReminders();

const io = new Server(server, {
  cors: {
    origin: Array.from(ALLOWED_ORIGINS),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  },
  maxHttpBufferSize: 50 * 1024 * 1024,
});

global.io = io;
app.set("io", io);

// -------------------- Online users tracking (FIXED: Consistent Object structure) --------------------
let onlineUsers = {}; // SINGLE declaration - Object structure

// FIXED: Consistent helper functions for Object structure
function addOnlineUser(userId, socketId) {
  if (!onlineUsers[userId]) onlineUsers[userId] = new Set();
  onlineUsers[userId].add(socketId);
}

function removeOnlineUser(userId, socketId) {
  if (!onlineUsers[userId]) return;
  onlineUsers[userId].delete(socketId);
  if (onlineUsers[userId].size === 0) delete onlineUsers[userId];
}

function getUserSocketIds(userId) {
  return Array.from(onlineUsers[userId] || []);
}

// -------------------- Socket auth middleware --------------------
setIoInstance(io);

// Initial check on server start
checkPendingStatusResets().catch(error => {
  console.error('Initial status reset check failed:', error);
});

// Set up interval for status checks (every 1 minute)
setInterval(() => {
  checkPendingStatusResets().catch(error => {
    console.error('Scheduled status reset check failed:', error);
  });
}, 60000);

// Socket.IO logic with JWT auth
io.use(async (socket, next) => {
  try {
    let token = null;

    const cookieHeader = socket.request.headers.cookie;
    console.log("🍪 Raw cookie header:", cookieHeader);

    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [name, value] = cookie.trim().split('=');
        acc[name] = value;
        return acc;
      }, {});

      token = cookies.accessToken;
      console.log("Token from cookies:", token ? `${token.substring(0, 20)}...` : 'No token in cookies');
      console.log("📋 Available cookies:", Object.keys(cookies));
    }

    if (!token) {
      token = socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        socket.handshake.headers?.authorization;
      console.log("Fallback to handshake token:", token ? 'Yes' : 'No');
    }

    if (!token) {
      console.warn("Socket auth: no token provided in cookies or handshake.");
      return next(new Error("Unauthorized: No token provided"));
    }

    const rawToken = typeof token === "string" && token.startsWith("Bearer ")
      ? token.split(" ")[1]
      : token;

    console.log("🔐 Raw token for verification:", rawToken.substring(0, 20) + '...');

    const decoded = jwt.verify(rawToken, process.env.ACCESS_TOKEN_SECRET);
    console.log("Token decoded for user ID:", decoded.id);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        status: true
      },
    });

    if (!user) {
      console.warn("Socket auth: user not found for id:", decoded.id);
      return next(new Error("Unauthorized: User not found"));
    }

    socket.user = user;
    console.log(`Socket auth success for ${user.username} (${user.id})`);
    next();
  } catch (err) {
    console.error("Socket auth error:", err && err.message);
    next(new Error("Unauthorized: Invalid token"));
  }
});

// -------------------- SINGLE Socket connection handler --------------------
io.on("connection", (socket) => {
  const userId = socket.user.id;
  const username = socket.user.username;

  console.log(`🔗 User connected: ${username} (${userId})`);

  // Track online users
  addOnlineUser(userId, socket.id);
  socket.join(`user_${userId}`); // Consistent personal room naming
  socket.join(userId.toString()); // Legacy support
  console.log(`Joined personal rooms for: ${userId}`);

  // Fetch birthdays on connection and on request
  const emitBirthdays = async () => {
    try {
      const today = new Date();
      const monthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      
      console.log(`🎂 Checking birthdays for monthDay match: -${monthDay} (Current User ID: ${userId})`);

      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          birthDate: { endsWith: `-${monthDay}` },
          id: { not: userId }
        },
        select: { id: true, username: true, name: true, avatarUrl: true, birthDate: true }
      });

      console.log(`🎂 Birthdays found: ${users.length}`);
      if (users.length > 0) {
        users.forEach(u => console.log(`  - ${u.username} (${u.birthDate})`));
      }

      socket.emit("today-birthdays", users);
    } catch (err) {
      console.error("Birthday socket error:", err);
    }
  };

  emitBirthdays();
  socket.on("get-today-birthdays", emitBirthdays);

  // Update DB: set user online
  prisma.user
    .update({
      where: { id: userId },
      data: {
        isOnline: true,
        lastSeen: null,
      },
    })
    .then(async (user) => {
      console.log(`User ${user.username} set to online in database`);

      // OPTIMIZED: Instead of global emit, notify members of all shared rooms
      const memberships = await prisma.chatMember.findMany({
        where: { userId, isActive: true },
        select: { roomId: true }
      });

      const statusPayload = {
        userId,
        status: user.status,
        lastSeen: null,
        isOnline: true,
      };

      memberships.forEach(m => {
        io.to(m.roomId).emit("user-status", statusPayload);
      });
    })
    .catch((error) => {
      console.error("Error updating user status on connection:", error);
    });

  // Room management (see verified join-room handler below)
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    console.log(`User ${userId} left room: ${roomId}`);
  });

  // NEW: Join all my chat rooms (groups & DMs)
  socket.on("join-my-rooms", async () => {
    try {
      console.log(`User ${userId} requested to join all their rooms...`);
      const memberships = await prisma.chatMember.findMany({
        where: { userId, isActive: true },
        select: { roomId: true }
      });

      if (memberships.length > 0) {
        memberships.forEach(m => {
          socket.join(m.roomId);
        });
        console.log(`User ${userId} joined ${memberships.length} rooms`);
      } else {
        console.log(`User ${userId} has no rooms to join`);
      }
    } catch (error) {
      console.error("Error joining user rooms:", error);
    }
  });

  // Typing events
  socket.on("typing-start", (data) => {
    try {
      console.log("⌨️ TYPING START:", {
        userId: socket.user.id,
        username: socket.user.username,
        roomId: data.roomId,
      });

      socket.to(data.roomId).emit("user-typing", {
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: true,
        roomId: data.roomId,
      });
    } catch (error) {
      console.error("Error handling typing-start:", error);
    }
  });

  socket.on("typing-stop", (data) => {
    try {
      console.log("🛑 TYPING STOP:", {
        userId: socket.user.id,
        username: socket.user.username,
        roomId: data.roomId,
      });

      socket.to(data.roomId).emit("user-typing", {
        userId: socket.user.id,
        username: socket.user.username,
        isTyping: false,
        roomId: data.roomId,
      });
    } catch (error) {
      console.error("Error handling typing-stop:", error);
    }
  });

  // Message broadcasting
  socket.on("new-message", async (messageData) => {
    try {
      console.log("📤 Receiving message for saving:", messageData);

      const { roomId, content, type, tempId, replyTo } = messageData;
      const userId = socket.user.id;

      const savedMessage = await prisma.message.create({
        data: {
          roomId,
          senderId: userId,
          content: content || "",
          type: type || "TEXT",
          replyToId: replyTo || null,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              status: true
            }
          },
          repliedTo: {
            include: {
              sender: { select: { id: true, username: true } }
            }
          }
        }
      });

      console.log("Message saved to database:", savedMessage.id);

      // Create message status for all room members
      const allRoomMembers = await prisma.chatMember.findMany({
        where: { roomId, isActive: true },
        select: { userId: true },
      });

      const messageStatuses = allRoomMembers.map((member) => ({
        messageId: savedMessage.id,
        userId: member.userId,
        status: member.userId === userId ? "READ" : "SENT",
        ...(member.userId === userId && { readAt: new Date() }),
      }));

      await prisma.messageStatus.createMany({
        data: messageStatuses,
      });

      // Send background FCM push notifications to other participants
      try {
        const receiverIds = allRoomMembers
          .map((m) => m.userId)
          .filter((id) => id !== userId);

        if (receiverIds.length > 0) {
          await sendChatNotification(receiverIds, {
            roomId: roomId,
            messageId: savedMessage.id,
            senderId: userId,
            senderName: savedMessage.sender.name || savedMessage.sender.username || "User",
            content: content || "Sent a message",
            type: type || "TEXT",
          });
        }
      } catch (fcmError) {
        console.error("FCM socket notification failed:", fcmError.message);
      }

      // Emit the new message to the room with its initial statuses
      io.to(roomId).emit("new-message", {
        ...savedMessage,
        tempId: tempId || null,
        statuses: messageStatuses // Include initial statuses for all members
      });

      // WHATSAPP FLOW: Notify each member about room update with their unread count
      try {
        const members = await prisma.chatMember.findMany({
          where: { roomId, isActive: true },
          select: { userId: true }
        });

        for (const member of members) {
          // Calculate unread count for this specific user in this room
          const unreadCount = await prisma.messageStatus.count({
            where: {
              userId: member.userId,
              message: { 
                roomId: roomId,
                type: { not: "SYSTEM" }
              },
              status: { in: ["SENT", "DELIVERED"] }
            }
          });

          const updatePayload = {
            roomId,
            unreadCount,
            lastMessage: {
              id: savedMessage.id,
              content: savedMessage.content,
              type: savedMessage.type,
              sender: savedMessage.sender,
              createdAt: savedMessage.createdAt,
            },
            messageId: savedMessage.id
          };

          // Emit to user's personal room (WhatsApp Style: includes their specific unread count)
          io.to(`user_${member.userId}`).emit("room-updated", updatePayload);
        }

      } catch (countError) {
        console.error("Error broadcasting unread counts:", countError);
      }

    } catch (error) {

      console.error("Socket new-message error:", error);
      socket.emit("message-send-failed", {
        tempId: messageData.tempId,
        error: "Failed to save message"
      });
    }
  });

  // Status update handler
  socket.on("update-status", async (data) => {
    try {
      const { status, busyDuration, isDND } = data;

      let updateData = {
        isOnline: true,
      };

      if (status === 'Busy' && busyDuration) {
        updateData.status = 'BUSY';
        updateData.busyStartTime = new Date();
        updateData.busyDuration = busyDuration;
        updateData.isDND = false;
      } else if (status === 'DND') {
        updateData.status = 'DND';
        updateData.busyStartTime = null;
        updateData.busyDuration = null;
        updateData.isDND = true;
      } else if (status === 'Available') {
        updateData.status = 'AVAILABLE';
        updateData.busyStartTime = null;
        updateData.busyDuration = null;
        updateData.isDND = false;
      } else {
        updateData.isOnline = status === "online";
        if (status === "offline") {
          updateData.lastSeen = new Date();
          updateData.isOnline = false;
        } else {
          updateData.lastSeen = null;
          updateData.isOnline = true;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
      });

      console.log(`User ${username} status updated to: ${updatedUser.status}`);

      const statusPayload = {
        userId: updatedUser.id,
        status: updatedUser.status,
        busyStartTime: updatedUser.busyStartTime,
        busyDuration: updatedUser.busyDuration,
        isDND: updatedUser.isDND,
        isOnline: updatedUser.isOnline,
        lastSeen: updatedUser.lastSeen
      };

      const memberships = await prisma.chatMember.findMany({
        where: { userId, isActive: true },
        select: { roomId: true }
      });

      memberships.forEach(m => {
        io.to(m.roomId).emit("user-status-updated", statusPayload);
        // Also emit legacy event for backward compatibility
        io.to(m.roomId).emit("user-status", statusPayload);
      });

    } catch (error) {
      console.error("Error updating status:", error);
    }
  });

  // Status auto-reset events
  socket.on("status-auto-reset", (data) => {
    console.log(`Status auto-reset received for user ${userId}:`, data);
  });

  socket.on("manual-status-reset", async (data) => {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          status: 'AVAILABLE',
          busyStartTime: null,
          busyDuration: null,
          isDND: false
        }
      });

      console.log(`Manual status reset for user ${username}`);

      const statusPayload = {
        userId: user.id,
        status: user.status,
        busyStartTime: user.busyStartTime,
        busyDuration: user.busyDuration,
        isDND: user.isDND
      };

      const memberships = await prisma.chatMember.findMany({
        where: { userId, isActive: true },
        select: { roomId: true }
      });

      memberships.forEach(m => {
        io.to(m.roomId).emit("user-status-changed", statusPayload);
      });

    } catch (error) {
      console.error('Manual status reset error:', error);
    }
  });


  // Room join with verification
  socket.on("join-room", async (roomId) => {
    try {
      const membership = await prisma.chatMember.findUnique({
        where: { userId_roomId: { userId: socket.user.id, roomId } }
      });

      if (membership) {
        socket.join(roomId);
        console.log(`User ${socket.user.id} successfully joined room ${roomId}`);

        socket.to(roomId).emit("user-joined", {
          userId,
          username: socket.user.username,
        });
      } else {
        console.log(`User ${socket.user.id} not member of room ${roomId}`);
        socket.emit("join-room-error", { roomId, error: "Not a member" });
      }
    } catch (error) {
      console.error("join-room error:", error);
      socket.emit("join-room-error", { roomId, error: "Server error" });
    }
  });

  // Message read
  socket.on("mark-as-read", async ({ roomId, messageIds }) => {
    try {
      if (!messageIds || !Array.isArray(messageIds)) return;
      
      await prisma.messageStatus.updateMany({
        where: {
          messageId: { in: messageIds },
          userId,
          status: { not: "READ" },
        },
        data: { 
          status: "READ", 
          readAt: new Date(),
          deliveredAt: { set: new Date() } // Ensure deliveredAt is set if it was null
        },
      });
      
      // Notify the room that messages were read
      io.to(roomId).emit("messages-read-update", {
        roomId,
        messageIds,
        readerId: userId,
        status: "READ"
      });
    } catch (err) {
      console.error("mark-as-read error:", err);
    }
  });

  // NEW: Mark entire room as read
  socket.on("mark-room-read", async ({ roomId }) => {
    try {
      if (!roomId) return;

      // Find all unread messages for this user in this room
      const unreadStatuses = await prisma.messageStatus.findMany({
        where: {
          userId,
          message: { roomId },
          status: { not: "READ" }
        },
        select: { messageId: true }
      });

      if (unreadStatuses.length === 0) return;

      const messageIds = unreadStatuses.map(s => s.messageId);

      await prisma.messageStatus.updateMany({
        where: {
          messageId: { in: messageIds },
          userId
        },
        data: {
          status: "READ",
          readAt: new Date()
        }
      });

      console.log(`User ${userId} marked room ${roomId} as read (${messageIds.length} messages)`);

      // Notify others in the room
      io.to(roomId).emit("messages-read-update", {
        roomId,
        messageIds,
        readerId: userId,
        status: "READ"
      });

      // Also update unread count for the reader
      io.to(`user_${userId}`).emit("room-updated", {
        roomId,
        unreadCount: 0
      });

    } catch (error) {
      console.error("mark-room-read error:", error);
    }
  });

  // Group Updates Broadcaster (Fixed to reach all members)
  socket.on("group_updated", async (data) => {
    console.log("Broadcasting group_updated:", data);

    // 1. Emit to the group room (for active chatters)
    io.to(data.groupId).emit("group_updated", data);
    io.to(data.groupId).emit("group-updated", data);

    // 2. Fetch members and emit to their individual rooms (for Group List view)
    try {
      if (data.groupId) {
        const group = await prisma.group.findUnique({
          where: { id: data.groupId },
          select: { members: { select: { userId: true } } }
        });

        if (group && group.members) {
          group.members.forEach(member => {
            // Avoid double emission if we can, but safe to emit to userId room
            io.to(member.userId).emit("group-updated", data);
            io.to(member.userId).emit("group_updated", data);
          });
        }
      }
    } catch (e) {
      console.error("Error broadcasting group update to members:", e);
    }
  });

  socket.on("group_profile_updated", async (data) => {
    console.log("Broadcasting group_profile_updated:", data);
    // 1. Emit to group room
    io.to(data.groupId).emit("group_profile_updated", data);

    // 2. Emit to individual members
    try {
      if (data.groupId) {
        const group = await prisma.group.findUnique({
          where: { id: data.groupId },
          select: { members: { select: { userId: true } } }
        });

        if (group && group.members) {
          group.members.forEach(member => {
            io.to(member.userId).emit("group_profile_updated", data);
            // Also trigger generic update
            io.to(member.userId).emit("group-updated", {
              id: data.groupId,
              ...data.groupData
            });
          });
        }
      }
    } catch (e) {
      console.error("Error broadcasting group profile update to members:", e);
    }
  });

  // File upload
  socket.on("upload-file", async ({ roomId, file, type }) => {
    try {
      if (!file) return;
      let fileUrl, finalFileName, publicId;
      let fileExtension = "file";
      if (type === "IMAGE") fileExtension = "image";
      else if (type === "VIDEO") fileExtension = "video";
      else if (type === "AUDIO") fileExtension = "audio";

      const uploadSource = file.path || file;

      const uploadResult = await cloudinary.uploader.upload(uploadSource, {
        folder: "ChatFiles",
        resource_type: "auto",
      });

      fileUrl = uploadResult.secure_url;
      finalFileName = uploadResult.original_filename;
      publicId = uploadResult.public_id;

      // Generate thumbnail
      const { generateThumbnailUrl } = await import("./utils/cloudinary.js");
      const messageType = type || "FILE";
      const thumbnailUrl = (messageType === 'IMAGE' || messageType === 'VIDEO')
        ? generateThumbnailUrl(fileUrl, uploadResult.resource_type)
        : null;

      await prisma.message.create({
        data: {
          roomId,
          senderId: userId,
          content: "File sent",
          type: messageType,
          mediaUrl: fileUrl, // FIXED: Using mediaUrl consistently
          fileName: finalFileName,
          publicId,
          thumbnailUrl,
        },
      });

      io.to(roomId).emit("new-message", {
        roomId,
        senderId: userId,
        content: "File sent",
        type: messageType,
        mediaUrl: fileUrl,
        fileName: finalFileName,
        publicId,
        thumbnailUrl,
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      socket.emit("file-upload-error", { error: "Failed to upload file" });
    }
  });

  // -------------------- Call Handlers --------------------

  // NOTE: The primary call flow uses REST API (/calls/initiate, /calls/accept, /calls/reject, /calls/end).
  // These socket handlers are kept as a fallback / compatibility layer and are now fixed to match REST behavior.

  socket.on("initiate-call", async (data) => {
    try {
      const { receiverId, callId, callType } = data;
      const callerId = socket.user.id;
      console.log(`[Socket] initiate-call from ${callerId} to ${receiverId}`);

      const receiverSockets = getUserSocketIds(receiverId);
      if (!receiverSockets.length) {
        socket.emit("call-failed", { message: "User is offline", receiverId });
        return;
      }

      // Fetch full call record from DB so we can include caller info and agoraConfig
      let callRecord = null;
      let agoraConfig = null;
      if (callId) {
        callRecord = await prisma.call.findUnique({
          where: { callId },
          include: { caller: { select: { id: true, name: true, username: true, avatarUrl: true } } }
        });
      }

      // If we have a DB record, include the real caller data
      const callerInfo = callRecord?.caller || {
        id: callerId,
        username: socket.user.username,
        name: socket.user.username,
        avatarUrl: null,
      };

      io.to(receiverId.toString()).emit("incoming-call", {
        callId,
        callerId,
        callType: callType || callRecord?.callType || 'AUDIO',
        caller: callerInfo,
        callerName: callerInfo.name || callerInfo.username,
        roomName: callRecord?.roomName,
        timestamp: new Date(),
      });

      console.log(`[Socket] incoming-call sent to ${receiverId}`);
    } catch (error) {
      console.error("[Socket] initiate-call error:", error);
      socket.emit("call-failed", { message: error.message });
    }
  });

  socket.on("call-ringing", (data) => {
    const { callId, receiverId } = data;
    io.to(receiverId.toString()).emit("call-ringing", {
      callId,
      callerId: socket.user.id,
    });
  });

  // Fixed: now fetches call from DB and generates proper Agora tokens (like REST /calls/accept)
  socket.on("accept-call", async (data) => {
    try {
      const { callId, callerId } = data;
      console.log(`[Socket] accept-call: ${callId} accepted by ${userId}`);

      if (!callId || !callerId) {
        console.warn('[Socket] accept-call: missing callId or callerId');
        return;
      }

      // Fetch call record to get roomName and UIDs for token generation
      const call = await prisma.call.findUnique({ where: { callId } });
      if (!call) {
        console.warn('[Socket] accept-call: call not found in DB:', callId);
        // Still notify caller without config (graceful degradation)
        io.to(callerId.toString()).emit("call-accepted", { callId, receiverId: userId });
        return;
      }

      // Generate Agora tokens (same logic as REST /calls/accept)
      const { agoraService: agoraSvc } = await import('./services/agoraService.js');
      
      const callerConfig = agoraSvc.generateToken(call.roomName, Number(call.callerUid));
      const receiverConfig = agoraSvc.generateToken(call.roomName, Number(call.receiverUid));
      const agoraConfig = { callerConfig, receiverConfig };

      // Update DB status
      await prisma.call.update({ where: { callId }, data: { status: 'ACCEPTED', startedAt: new Date() } }).catch(() => {});

      io.to(callerId.toString()).emit("call-accepted", { callId, receiverId: userId, agoraConfig });
      console.log(`[Socket] call-accepted emitted to caller ${callerId} with Agora config`);
    } catch (error) {
      console.error('[Socket] accept-call error:', error);
    }
  });

  // Fixed: also updates DB status to REJECTED
  socket.on("reject-call", async (data) => {
    try {
      const { callId, callerId } = data;
      console.log(`[Socket] reject-call: ${callId} rejected by ${userId}`);
      // Update DB status
      if (callId) {
        const call = await prisma.call.update({ 
          where: { callId }, 
          data: { status: 'REJECTED', endedAt: new Date() } 
        }).catch(() => null);

        if (call) {
          await createCallLog(call, "REJECTED", io);
        }
      }
      io.to(callerId.toString()).emit("call-rejected", { callId, receiverId: userId });
    } catch (error) {
      console.error('[Socket] reject-call error:', error);
    }
  });

  // Fixed: end-call socket handler — marks call as MISSED if not yet accepted
  socket.on("end-call", async (data) => {
    try {
      console.log("end-call event received:", data);

      // EXTRACT callId PROPERLY
      let callId;
      let otherUserId;
      let duration = 0;

      // HANDLE BOTH FORMATS: string or object
      if (typeof data === 'string') {
        callId = data;
      } else if (typeof data === 'object') {
        callId = data.callId;
        otherUserId = data.otherUserId;
        duration = data.duration || 0;

        // If callId is still object, extract properly
        if (typeof callId === 'object') {
          callId = callId.callId;
        }
      }

      console.log(`Call ${callId} ended by ${socket.user?.id}`);

      if (!callId) {
        console.log('Call ID missing in end-call');
        return;
      }

      // SAFETY CHECK: otherUserId validate karo
      if (!otherUserId) {
        console.log('otherUserId missing, finding from database...');

        try {
          // Database se call details leke otherUserId find karo
          const call = await prisma.call.findUnique({
            where: { callId: callId } // Use callId field, not id
          });

          if (call) {
            // Determine other user from call data
            const currentUserId = socket.user?.id;
            if (call.callerId && call.callerId.toString() === currentUserId) {
              otherUserId = call.receiverId;
            } else if (call.receiverId && call.receiverId.toString() === currentUserId) {
              otherUserId = call.callerId;
            }
            console.log('Found otherUserId from database:', otherUserId);
          }
        } catch (dbError) {
          console.error('Database lookup error:', dbError);
        }
      }

      // FINAL SAFETY CHECK before emitting
      if (otherUserId && otherUserId.toString) {
        console.log(`Emitting call-ended to: ${otherUserId}`);
        io.to(otherUserId.toString()).emit("call-ended", {
          callId: callId,
          endedBy: socket.user?.id,
        });

        // Auto-mark as MISSED if the call was never accepted
        try {
          const currentCall = await prisma.call.findUnique({ where: { callId } });
          if (currentCall && (currentCall.status === 'INITIATED' || currentCall.status === 'RINGING')) {
            const updated = await prisma.call.update({
              where: { callId },
              data: { status: 'MISSED', endedAt: new Date() }
            });
            console.log(`Call ${callId} auto-marked as MISSED (caller ended before answer)`);
            await createCallLog(updated, "MISSED", io);
          } else if (currentCall && currentCall.status !== 'MISSED' && currentCall.status !== 'REJECTED') {
            const updated = await prisma.call.update({
              where: { callId },
              data: { status: 'ENDED', endedAt: new Date(), duration: duration || 0 }
            }).catch(() => null);
            
            if (updated) {
               await createCallLog(updated, "COMPLETED", io);
            }
          }
        } catch (dbErr) {
          console.error('Error updating call status on end:', dbErr);
        }
      } else {
        console.log('Cannot emit call-ended: otherUserId not available');

        // Fallback: Emit to both users to be safe
        try {
          const call = await prisma.call.findUnique({
            where: { callId: callId }
          });

          if (call) {
            if (call.callerId) {
              io.to(call.callerId.toString()).emit("call-ended", {
                callId: callId,
                endedBy: socket.user?.id
              });
            }
            if (call.receiverId) {
              io.to(call.receiverId.toString()).emit("call-ended", {
                callId: callId,
                endedBy: socket.user?.id
              });
            }
            console.log('Fallback: Emitted call-ended to both users');
            // Auto-mark status
            if (call.status === 'INITIATED' || call.status === 'RINGING') {
              const updated = await prisma.call.update({ where: { callId }, data: { status: 'MISSED', endedAt: new Date() } }).catch(() => null);
              if (updated) await createCallLog(updated, "MISSED", io);
            } else if (call.status !== 'MISSED' && call.status !== 'REJECTED') {
              const updated = await prisma.call.update({ where: { callId }, data: { status: 'ENDED', endedAt: new Date(), duration: duration || 0 } }).catch(() => null);
              if (updated) await createCallLog(updated, "COMPLETED", io);
            }
          }
        } catch (fallbackError) {
          console.error('Fallback emission error:', fallbackError);
        }
      }

    } catch (error) {
      console.error('Error in end-call handler:', error);
    }
  });
  // SINGLE Disconnect Handler (Remove duplicate)
  socket.on("disconnect", async (reason) => {
    console.log(`User ${userId} disconnected: ${reason}`);

    removeOnlineUser(userId, socket.id);

    if (!onlineUsers[userId]) {
      try {
        const user = await prisma.user.update({
          where: { id: userId },
          data: {
            isOnline: false,
            lastSeen: new Date(),
          },
        });

        console.log(`User ${username} set to offline`);

        // Targeted broadcast for offline status
        const sharedRooms = await prisma.chatRoom.findMany({
          where: {
            members: { some: { userId: userId } }
          },
          select: { id: true }
        });

        const offlinePayload = {
          userId,
          status: "offline", // Force status to offline for UI
          lastSeen: user.lastSeen,
          isOnline: false,
        };

        // Emit to all shared rooms
        sharedRooms.forEach(room => {
          io.to(room.id).emit("user-status", offlinePayload);
        });

        // Also emit to user's own room for other devices
        io.to(`user_${userId}`).emit("user-status", offlinePayload);

      } catch (error) {

        console.error("Error updating offline status:", error);
      }
    }
  });
});

// -------------------- Routes --------------------
startStaleCallCleanup(io);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/status", userStatusRoutes);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/groups", groupRoutes);
app.use("/api/v1/meetings", meetingRoutes);
app.use("/api/v1/avatar", fileRoutes);
app.use("/api/v1/rooms", roomRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/feedback", feedbackRoutes);
app.use("/api/v1/calls", callRoutes);
app.use("/api/v1/audio", audioRoutes);
app.use("/api/v1/hierarchy", hierarchyRoutes);
app.use("/api/v1/contact", contactRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/message", messageRoutes);


app.use("/api/v1/admin", adminRoutes);


// FCM routes definition update:
app.post('/api/v1/fcm/token', authenticate, async (req, res) => {
  try {
    const { token, platform } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    if (!token) {
      return res.status(400).json({ ok: false, message: "Token required" });
    }

    console.log(`🔐 User ${username} saving FCM token`);

    await prisma.fcmToken.deleteMany({
      where: { userId: userId }
    });

    const result = await prisma.fcmToken.create({
      data: {
        token: token,
        userId: userId,
        platform: platform || 'android'
      }
    });

    console.log(`FCM token saved for ${username}, ID: ${result.id}`);

    return res.json({
      ok: true,
      message: "Token saved successfully",
      tokenId: result.id
    });

  } catch (error) {
    console.error('FCM save error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// NEW: Robust unauthenticated token sync (Moved to /api/v1/fcm/save-token-simple)
app.post('/api/v1/fcm/save-token-simple', async (req, res) => {
  try {
    const { token, userId, platform } = req.body;

    console.log('🤖 FCM Token Sync Request (v1):', { userId, platform, tokenPreview: token?.substring(0, 10) });

    if (!token || !userId) {
      return res.status(400).json({ ok: false, message: "Token and userId required" });
    }

    // 🛡️ CRITICAL VERIFICATION: Make sure the user exists before upserting
    const userExists = await prisma.user.findUnique({ where: { id: userId } });
    if (!userExists) {
        console.warn(`⚠️ BLOCK: Attempted token sync for NON-EXISTENT user: ${userId}`);
        return res.status(404).json({ ok: false, message: "User not found in current database. Please logout and login again." });
    }

    const result = await prisma.fcmToken.upsert({
      where: { token: token },
      update: { userId, platform: platform || 'android' },
      create: { token, userId, platform: platform || 'android' }
    });

    console.log(`✅ FCM token synced for user ${userExists.username} (${userId})`);
    return res.status(200).json({ ok: true, message: "Token synced successfully", id: result.id });

  } catch (error) {
    console.error('❌ Error in /api/v1/fcm/save-token-simple:', error.message);
    res.status(500).json({ ok: false, message: "Internal server error syncing token", error: error.message });
  }
});

// REMOVE TOKEN ON LOGOUT
app.delete('/api/v1/fcm/token', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;

    await prisma.fcmToken.deleteMany({
      where: { userId: userId }
    });

    console.log(`🗑️ FCM tokens removed for user ${username}`);

    return res.json({
      ok: true,
      message: "Token removed successfully"
    });

  } catch (error) {
    console.error('FCM delete error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// GET USER'S TOKENS (FOR DEBUGGING)
app.get('/api/v1/fcm/my-tokens', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const tokens = await prisma.fcmToken.findMany({
      where: { userId: userId },
      select: {
        token: true,
        platform: true,
        addedAt: true
      }
    });

    return res.json({
      ok: true,
      tokens,
      count: tokens.length
    });

  } catch (error) {
    console.error('Get tokens error:', error);
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});

// -------------------- End of FCM Handlers --------------------

app.post('/api/test-fcm', async (req, res) => {
  try {
    const { token } = req.body;

    const message = {
      token: token,
      notification: {
        title: 'Test Notification',
        body: 'This is a test from backend'
      }
    };

    const response = await admin.messaging().send(message);
    console.log('Test notification sent:', response);
    res.json({ success: true, messageId: response });

  } catch (error) {
    console.log('Test notification failed:', {
      errorCode: error.errorInfo?.code,
      errorMessage: error.errorInfo?.message
    });
    res.status(500).json({
      success: false,
      error: error.errorInfo
    });
  }
});

// 404 catch-all — must be AFTER all specific routes
app.use("/api", (req, res) => {
  res.status(404).json({
    status: 404,
    message: `Not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

// -------------------- Start Server with Port Check --------------------
const startServer = async () => {
  try {
    const desiredPort = process.env.PORT || 10000;
    const availablePort = await findAvailablePort(desiredPort);

    server.listen(availablePort, '0.0.0.0', () => {
      console.log(`Server running on port ${availablePort}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();