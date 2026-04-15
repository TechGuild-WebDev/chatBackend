import { agoraService } from "../services/agoraService.js";
import prisma from "../prisma.js";
import { cloudinary } from "../utils/cloudinary.js";
import { sendIncomingCallNotification, sendCallEndNotification } from "../services/notificationService.js";
import crypto from "crypto";

// Helper to generate a compliant Agora UID (random 32-bit integer)
// We use a max of 2^31 - 1 to ensure compatibility across all SDK versions (signed/unsigned issues)
function generateAgoraUid() {
  return Math.floor(Math.random() * 2147483647);
}

// Helper to find or create a 1:1 room for call logs
export async function findOrCreateRoom(callerId, receiverId) {
  let room = await prisma.chatRoom.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: callerId } } },
        { members: { some: { userId: receiverId } } },
      ],
    },
  });

  if (!room) {
    room = await prisma.chatRoom.create({
      data: {
        isGroup: false,
        members: {
          create: [{ userId: callerId }, { userId: receiverId }],
        },
      },
    });
  }
  return room.id;
}

// Helper to create a CALL_LOG message in chat
export async function createCallLog(call, status, io) {
  try {
    const callId = call.id || call.callId;
    
    // DEDUPLICATION: Check if a log for this call and status already exists
    const existing = await prisma.message.findFirst({
      where: {
        callRefId: callId,
        callStatus: status.toLowerCase()
      }
    });
    
    if (existing) {
      console.log(`Call log for ${callId} (${status}) already exists. Skipping.`);
      return existing;
    }

    const roomId = await findOrCreateRoom(call.callerId, call.receiverId);
    
    const logMsg = await prisma.message.create({
      data: {
        roomId,
        senderId: call.callerId,
        type: "CALL_LOG",
        content: `${call.callType === 'VIDEO' ? 'Video' : 'Voice'} call ${status}`,
        callType: call.callType.toLowerCase(),
        callStatus: status.toLowerCase(),
        callRefId: call.id || call.callId,
        duration: call.duration || 0,
        createdAt: new Date(),
        statuses: {
          create: [
            { userId: call.callerId, status: "READ", readAt: new Date() },
            { userId: call.receiverId, status: "SENT" },
          ],
        },
      },
      include: {
        sender: {
          select: { id: true, username: true, name: true, avatarUrl: true },
        },
        statuses: true,
      },
    });

    if (io) {
      io.to(roomId).emit("new-message", {
        ...logMsg,
        sender: { id: call.callerId }
      });
    }
    
    return logMsg;
  } catch (error) {
    console.error("Error creating call log:", error);
    return null;
  }
}

// Helper to sanitize BigInt for JSON serialization
function sanitizeBigInt(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeBigInt);
  if (typeof obj === 'object') {
    // For date objects and other special objects, return as is
    if (obj instanceof Date) return obj;
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeBigInt(obj[key]);
    }
    return sanitized;
  }
  return obj;
}

export const callController = {
  async initiateCall(req, res) {
    try {
      const { receiverId, callType = "VIDEO" } = req.body;
      const callerId = req.user.id;

      console.log("Call initiation request:", {
        callerId,
        receiverId,
        callType,
        body: req.body,
      });

      if (!receiverId) {
        return res.status(400).json({
          success: false,
          message: "Receiver ID is required",
        });
      }

      if (callerId === receiverId) {
        return res.status(400).json({
          success: false,
          message: "Cannot call yourself",
        });
      }

      const receiver = await prisma.user.findUnique({
        where: { id: receiverId },
        select: {
          id: true,
          username: true,
          isOnline: true,
        },
      });

      console.log("Receiver lookup result:", receiver);

      if (!receiver) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Generate unique call ID and channel name
      // CRITICAL: callId MUST be a valid UUIDv4 for iOS CallKit compatibility
      const callId = crypto.randomUUID();
      const roomName = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      console.log("Generated call details:", { callId, roomName });

      // Generate Agora UIDs
      const callerUid = generateAgoraUid();
      const receiverUid = generateAgoraUid();

      const agoraConfig = agoraService.generateToken(roomName, callerUid);

      // Create call record
      const call = await prisma.call.create({
        data: {
          callId,
          callerId,
          receiverId,
          roomName,
          callType: callType.toUpperCase(),
          status: "INITIATED",
          callerUid,   // Store these for consistent recovery
          receiverUid,
        },
        include: {
          caller: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          receiver: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      console.log("💾 Call record created:", call.callId);

      // PUSH NOTIFICATION FOR CALL - CALLKEEP COMPATIBLE
      try {
        await sendIncomingCallNotification(receiverId, {
          callId: call.callId,
          callerId: callerId,
          callerName: call.caller.name || call.caller.username,
          callType: callType,
          roomName: roomName,
          // CALLKEEP SPECIFIC FIELDS ADD KARO
          handle: callerId.toString(), // Required for CallKeep
          callUUID: call.callId, // Required for CallKeep  
          hasVideo: callType === 'VIDEO' // For video calls
        });
        console.log('CallKeep compatible push notification sent');
      } catch (notificationError) {
        console.error('Call notification failed:', notificationError);
      }

      // Emit call event to receiver via socket
      const io = req.app.get("io");
      if (io) {
        // First emit ringing event
        io.to(receiverId).emit("call-ringing", {
          callId: call.callId,
          callerId: callerId,
        });

        // FIXED: Emit correct caller data in incoming-call event
        io.to(receiverId).emit("incoming-call", {
          callId: call.callId,
          roomName: call.roomName,
          callType: call.callType,
          caller: {
            id: call.caller.id,
            name: call.caller.name || call.caller.username,
            username: call.caller.username,
            avatarUrl: call.caller.avatarUrl
          },
          callerId: call.caller.id,
          callerName: call.caller.name || call.caller.username,
          agoraConfig, // REAL Agora config
        });

        console.log("Socket events emitted to receiver:", receiverId);
      } else {
        console.warn("Socket.IO not available");
      }

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call initiated successfully",
        data: {
          call,
          agoraConfig, // REAL Agora config
        },
      }));
    } catch (error) {
      console.error("Error initiating call:", error);
      res.status(500).json({
        success: false,
        message: "Failed to initiate call",
        error: error.message,
      });
    }
  },

  // Accept a call
  async acceptCall(req, res) {
    try {
      const { callId } = req.body;
      const userId = req.user.id;

      console.log("Call acceptance request:", { callId, userId });

      if (!callId) {
        return res.status(400).json({
          success: false,
          message: "Call ID is required",
        });
      }

      const call = await prisma.call.findUnique({
        where: { callId },
        include: {
          caller: true,
          receiver: true,
        },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found",
        });
      }

      if (call.receiverId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to accept this call",
        });
      }

      if (call.status !== "INITIATED" && call.status !== "RINGING") {
        return res.status(400).json({
          success: false,
          message: "Call cannot be accepted",
        });
      }

      // Use stored UIDs from the call record
      const callerConfig = agoraService.generateToken(call.roomName, call.callerUid);
      const receiverConfig = agoraService.generateToken(call.roomName, call.receiverUid);

      // FINAL OBJECT
      const agoraConfig = {
        callerConfig,
        receiverConfig,
      };

      // Update call status
      const updatedCall = await prisma.call.update({
        where: { callId },
        data: {
          status: "ACCEPTED",
          startedAt: new Date(),
        },
      });

      // Notify caller that call was accepted
      const io = req.app.get("io");
      if (io) {
        const callerIdStr = String(call.callerId);
        
        // Emit to all possible room formats
        io.to(callerIdStr).emit("call-accepted", {
          callId: call.callId,
          agoraConfig,
        });
        io.to(`user_${callerIdStr}`).emit("call-accepted", {
          callId: call.callId,
          agoraConfig,
        });
        
        console.log("Call accepted event emitted to caller rooms:", {
          callerId: callerIdStr,
          rooms: [callerIdStr, `user_${callerIdStr}`]
        });
      }

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call accepted successfully",
        data: {
          call: updatedCall,
          agoraConfig,
        },
      }));
    } catch (error) {
      console.error("Error accepting call:", error);
      res.status(500).json({
        success: false,
        message: "Failed to accept call",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Reject a call
  async rejectCall(req, res) {
    try {
      const { callId } = req.body;
      const userId = req.user.id;

      console.log("Call rejection request:", { callId, userId });

      if (!callId) {
        return res.status(400).json({
          success: false,
          message: "Call ID is required",
        });
      }

      const call = await prisma.call.findUnique({
        where: { callId },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found",
        });
      }

      if (call.receiverId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to reject this call",
        });
      }

      // Update call status
      const updatedCall = await prisma.call.update({
        where: { callId },
        data: {
          status: "REJECTED",
          endedAt: new Date(),
        },
      });

      // Notify caller that call was rejected
      const io = req.app.get("io");
      if (io) {
        const callerIdStr = String(call.callerId);
        
        // Emit to all possible room formats
        io.to(callerIdStr).emit("call-rejected", {
          callId: call.callId,
        });
        io.to(`user_${callerIdStr}`).emit("call-rejected", {
          callId: call.callId,
        });
        
        console.log("Call rejected event emitted to caller rooms:", {
          callerIdStr,
          callId: call.callId,
        });

        // FALLBACK: Send high-priority Push to clear UI (in case socket is dead)
        await sendCallEndNotification(call.callerId, {
          callId: call.callId,
          type: "CALL_REJECTED"
        }).catch(err => console.error("Reject push failed:", err));
      }

      // Create CALL_LOG message using helper
      await createCallLog(call, "REJECTED", req.app.get("io"));

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call rejected successfully",
        data: {
          call: updatedCall,
        },
      }));
    } catch (error) {
      console.error("Error rejecting call:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reject call",
        error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
      });
    }
  },

  // End a call
  async endCall(req, res) {
    try {
      const { callId, duration, recordingFile } = req.body;
      const userId = req.user.id;

      console.log("Call end request:", { callId, userId, duration });

      if (!callId) {
        return res.status(400).json({
          success: false,
          message: "Call ID is required",
        });
      }

      const call = await prisma.call.findUnique({
        where: { callId },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found",
        });
      }

      if (call.callerId !== userId && call.receiverId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to end this call",
        });
      }

      let recordingUrl = null;
      let recordingPublicId = null;

      if (recordingFile) {
        try {
          const uploadResponse = await cloudinary.uploader.upload(recordingFile, {
            resource_type: "video",
            folder: "call_recordings",
          });
          recordingUrl = uploadResponse.secure_url;
          recordingPublicId = uploadResponse.public_id;
        } catch (uploadError) {
          console.error("Error uploading recording:", uploadError);
        }
      }

      const isMissedCall = (String(call.callerId) === String(userId)) &&
        (call.status === 'INITIATED' || call.status === 'RINGING');

      const finalStatus = isMissedCall ? 'MISSED' : 'ENDED';

      const updatedCall = await prisma.call.update({
        where: { callId },
        data: {
          status: finalStatus,
          endedAt: new Date(),
          duration: isMissedCall ? 0 : (duration || 0),
          recordingUrl,
          recordingPublicId,
        },
      });

      const io = req.app.get("io");
      if (io) {
        const otherUserId = String(call.callerId) === String(userId) ? call.receiverId : call.callerId;
        const otherUserIdStr = String(otherUserId);
        
        io.to(otherUserIdStr).emit("call-ended", {
          callId: call.callId,
          duration: duration || 0,
          endedBy: userId
        });
        io.to(`user_${otherUserIdStr}`).emit("call-ended", {
          callId: call.callId,
          duration: duration || 0,
          endedBy: userId
        });

        // FALLBACK: Send high-priority Push to clear UI (in case socket is dead)
        await sendCallEndNotification(otherUserId, {
          callId: call.callId,
          type: "CALL_ENDED"
        }).catch(err => console.error("End call push failed:", err));
      }

      // Create CALL_LOG message using helper
      await createCallLog(updatedCall, finalStatus === 'MISSED' ? 'MISSED' : 'COMPLETED', req.app.get("io"));

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call ended successfully",
        data: {
          call: updatedCall,
        },
      }));
    } catch (error) {
      console.error("Error ending call:", error);
      res.status(500).json({
        success: false,
        message: "Failed to end call",
        error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
      });
    }
  },

  // Get call history
  async getCallHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, type = "ALL" } = req.query;

      console.log("📋 Call history request:", { userId, page, limit, type });

      let whereClause = {
        OR: [{ callerId: userId }, { receiverId: userId }],
      };

      // Filter by call type
      if (type === "OUTGOING") {
        whereClause = {
          callerId: userId,
          status: { notIn: ["MISSED", "REJECTED"] }
        };
      } else if (type === "INCOMING") {
        whereClause = {
          receiverId: userId,
          status: { notIn: ["MISSED", "REJECTED"] }
        };
      } else if (type === "MISSED") {
        whereClause = {
          receiverId: userId,
          status: { in: ["MISSED", "REJECTED"] }
        };
      }

      const calls = await prisma.call.findMany({
        where: whereClause,
        include: {
          caller: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          receiver: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      });

      const total = await prisma.call.count({
        where: whereClause,
      });

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call history retrieved successfully",
        data: {
          calls,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      }));
    } catch (error) {
      console.error("Error fetching call history:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch call history",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Get call status
  async getCallStatus(req, res) {
    try {
      const { callId } = req.params;
      const userId = req.user.id;

      console.log("📊 Call status request:", { callId, userId });

      if (!callId) {
        return res.status(400).json({
          success: false,
          message: "Call ID is required",
        });
      }

      const call = await prisma.call.findUnique({
        where: { callId },
        include: {
          caller: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
          receiver: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found",
        });
      }

      // Check if user is part of this call
      if (call.callerId !== userId && call.receiverId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to view this call",
        });
      }

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call status retrieved successfully",
        data: {
          call,
        },
      }));
    } catch (error) {
      console.error("Error fetching call status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch call status",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Mark call as missed
  async markCallAsMissed(req, res) {
    try {
      const { callId } = req.body;
      const userId = req.user.id;

      console.log("Mark call as missed request:", { callId, userId });

      if (!callId) {
        return res.status(400).json({
          success: false,
          message: "Call ID is required",
        });
      }

      const call = await prisma.call.findUnique({
        where: { callId },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found",
        });
      }

      if (call.receiverId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to mark this call as missed",
        });
      }

      // Update call status to missed
      const updatedCall = await prisma.call.update({
        where: { callId },
        data: {
          status: "MISSED",
          endedAt: new Date(),
        },
      });

      // Create CALL_LOG message using helper
      await createCallLog(call, "MISSED", req.app.get("io"));

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Call marked as missed",
        data: {
          call: updatedCall,
        },
      }));
    } catch (error) {
      console.error("Error marking call as missed:", error);
      res.status(500).json({
        success: false,
        message: "Failed to mark call as missed",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Get missed calls count
  async getMissedCallsCount(req, res) {
    try {
      const userId = req.user.id;

      console.log("📊 Missed calls count request:", { userId });

      const missedCallsCount = await prisma.call.count({
        where: {
          receiverId: userId,
          status: "MISSED",
        },
      });

      res.status(200).json({
        success: true,
        message: "Missed calls count retrieved successfully",
        data: {
          missedCallsCount,
        },
      });
    } catch (error) {
      console.error("Error fetching missed calls count:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch missed calls count",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Helper endpoint to list users (for debugging)
  async listUsers(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;

      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          isOnline: true,
          status: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      });

      const total = await prisma.user.count();

      res.status(200).json({
        success: true,
        message: "Users retrieved successfully",
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Get users available for calling (excluding current user)
  async getCallableUsers(req, res) {
    try {
      const currentUserId = req.user.id;
      const { page = 1, limit = 20, search = "" } = req.query;

      console.log("Getting callable users for:", currentUserId);

      const whereClause = {
        id: {
          not: currentUserId, // Exclude current user
        },
        status: "active", // Only active users
      };

      // Add search functionality
      if (search) {
        whereClause.OR = [
          { username: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ];
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          avatarUrl: true,
          isOnline: true,
          status: true,
          lastSeen: true,
        },
        orderBy: [
          { isOnline: "desc" }, // Online users first
          { username: "asc" },
        ],
        skip: (page - 1) * limit,
        take: parseInt(limit),
      });

      const total = await prisma.user.count({
        where: whereClause,
      });

      res.status(200).json({
        success: true,
        message: "Callable users retrieved successfully",
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (error) {
      console.error("Error fetching callable users:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch callable users",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Helper endpoint to check if user exists
  async checkUserExists(req, res) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          isOnline: true,
          status: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
          data: { userId },
        });
      }

      res.status(200).json({
        success: true,
        message: "User found",
        data: { user },
      });
    } catch (error) {
      console.error("Error checking user existence:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check user existence",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Validate user ID and return correct mapping
  async validateUserMapping(req, res) {
    try {
      const { frontendUserId, frontendUsername } = req.body;

      console.log("Validating user mapping:", {
        frontendUserId,
        frontendUsername,
      });

      // Try to find user by the provided ID
      let user = await prisma.user.findUnique({
        where: { id: frontendUserId },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          isOnline: true,
          status: true,
        },
      });

      // If not found by ID, try to find by username
      if (!user && frontendUsername) {
        user = await prisma.user.findFirst({
          where: { username: frontendUsername },
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            isOnline: true,
            status: true,
          },
        });
      }

      if (!user) {
        // Get some sample users to help debug
        const sampleUsers = await prisma.user.findMany({
          take: 5,
          select: {
            id: true,
            username: true,
            email: true,
          },
        });

        return res.status(404).json({
          success: false,
          message: "User not found with provided ID or username",
          debug: {
            providedUserId: frontendUserId,
            providedUsername: frontendUsername,
            sampleUsers: sampleUsers.map((u) => ({
              id: u.id,
              username: u.username,
              email: u.email,
            })),
          },
        });
      }

      res.status(200).json({
        success: true,
        message: "User mapping validated",
        data: {
          user,
          correctUserId: user.id,
          isOnline: user.isOnline,
          canCall: user.status === "active",
        },
      });
    } catch (error) {
      console.error("Error validating user mapping:", error);
      res.status(500).json({
        success: false,
        message: "Failed to validate user mapping",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Helper endpoint to create a test user (for debugging)
  async createTestUser(req, res) {
    try {
      const { username, email, name } = req.body;

      if (!username || !email) {
        return res.status(400).json({
          success: false,
          message: "Username and email are required",
        });
      }

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ username: username }, { email: email }],
        },
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User with this username or email already exists",
          data: {
            user: {
              id: existingUser.id,
              username: existingUser.username,
              email: existingUser.email,
            },
          },
        });
      }

      // Create test user
      const testUser = await prisma.user.create({
        data: {
          username,
          email,
          name: name || username,
          password: "test123", // Default password for test users
          isOnline: false,
          status: "active",
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          isOnline: true,
          status: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Test user created successfully",
        data: {
          user: testUser,
        },
      });
    } catch (error) {
      console.error("Error creating test user:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create test user",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  // Refresh token for an active call
  async refreshToken(req, res) {
    try {
      const { callId } = req.params;
      const userId = req.user.id;

      const call = await prisma.call.findUnique({
        where: { callId },
      });

      if (!call) {
        return res.status(404).json({
          success: false,
          message: "Call not found"
        });
      }

      // Verify the user is part of the call
      let uid;
      if (call.callerId === userId) {
        uid = Number(call.callerUid);
      } else if (call.receiverId === userId) {
        uid = Number(call.receiverUid);
      } else {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to refresh token for this call"
        });
      }

      // Generate a new token using the stored roomName and UID
      const newTokenConfig = agoraService.generateToken(call.roomName, uid);

      res.status(200).json(sanitizeBigInt({
        success: true,
        message: "Token refreshed successfully",
        data: {
          agoraConfig: newTokenConfig,
        },
      }));
    } catch (error) {
      console.error("Error refreshing token:", error);
      res.status(500).json({
        success: false,
        message: "Failed to refresh token",
        error: process.env.NODE_ENV === "development" ? error.message : "Internal server error",
      });
    }
  },
};