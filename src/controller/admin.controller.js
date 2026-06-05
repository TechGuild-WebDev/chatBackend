import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import bcrypt from "bcrypt"; // ADD THIS
import jwt from "jsonwebtoken"; // ADD THIS

import {
  cloudinary,
  deleteOnCloudinary,
  uploadOnCloudinary,
} from "../utils/cloudinary.js";

// In your adminLogin controller - MODIFY THIS:
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email) throw new ApiError(400, "Email is required");
  if (!password) throw new ApiError(400, "Password is required");

  // Only allow ADMIN and SUPER_ADMIN roles
  const user = await prisma.user.findFirst({
    where: {
      email: email,
    },
  });

  if (!user) throw new ApiError(404, "Admin account not found");

  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw new ApiError(403, "You are not allowed for the access");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new ApiError(401, "Incorrect Password");

  // FIX: Use separate secret for admin tokens
  const adminToken = jwt.sign(
    {
      id: user.id,
      role: user.role,
      isAdmin: true,
    },
    process.env.ADMIN_ACCESS_TOKEN_SECRET ||
      process.env.ACCESS_TOKEN_SECRET + "_ADMIN", // Different secret
    {
      expiresIn: process.env.ADMIN_ACCESS_TOKEN_EXPIRY || "24h", // Different expiry
    },
  );

  const { password: _, ...loggedInUser } = user;

  const options = {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    // Different cookie name and settings
  };

  return res
    .status(200)
    .cookie("adminAccessToken", adminToken, options) // Different cookie name
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken: adminToken },
        "Admin logged in successfully",
      ),
    );
});

export const adminLogout = asyncHandler(async (req, res) => {
  res.clearCookie("adminAccessToken", { httpOnly: true, secure: true });
  return res
    .status(200)
    .json(new ApiResponse(200, null, "User logged out successfully"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "current user fetched successfully"));
});

export const getUsers = asyncHandler(async (req, res) => {
  const currentUser = req.user;

  const users = await prisma.user.findMany({
    where: {
      // ADD THIS FILTER to exclude soft-deleted users
      isActive: true,
      // OR use status filter if you prefer:
      // status: { not: 'DELETED' }
    },
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      status: true,
      busyStartTime: true,
      busyDuration: true,
      isDND: true,
      isOnline: true,
      lastSeen: true,
      phone: true,
      gender: true,
      birthDate: true,
      officeStartTime: true,
      officeEndTime: true,
      // isActive: true,
    },
  });

  // Add real-time status calculation
  const usersWithRealTimeStatus = users.map((user) => {
    let realTimeStatus = user.status;
    let busyUntil = null;
    let remainingMinutes = 0;

    if (user.status === "BUSY" && user.busyStartTime && user.busyDuration) {
      const startTime = new Date(user.busyStartTime);
      busyUntil = new Date(startTime.getTime() + user.busyDuration * 60 * 1000);
      const now = new Date();
      const timeDiff = busyUntil.getTime() - now.getTime();
      remainingMinutes = Math.max(0, Math.ceil(timeDiff / (1000 * 60)));

      if (timeDiff <= 0) {
        realTimeStatus = "AVAILABLE";
      } else {
        realTimeStatus = `Busy (${remainingMinutes} min)`;
      }
    }

    return {
      ...user,
      realTimeStatus,
      busyUntil,
      remainingMinutes,
      isBusy: user.status === "BUSY",
      isAvailable: realTimeStatus === "AVAILABLE",
    };
  });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        usersWithRealTimeStatus,
        "Users retrieved successfully",
      ),
    );
});

export const getUserById = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      isOnline: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      avatarUrl: true,
      publicId: true,
    },
  });

  if (!user) throw new ApiError(404, "User not found");
  res
    .status(200)
    .json(new ApiResponse(200, user, "User retrieved successfully"));
});

export const deleteUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Check if already soft deleted
    if (user.status === "DELETED" || !user.isActive) {
      throw new ApiError(400, "User is already deleted");
    }

    const deletedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        isActive: false,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
        isOnline: false,
        FcmToken: {
          deleteMany: {}, // deletes all related FCM tokens
        },
      },
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { deletedUserId: deletedUser.id },
          "User soft deleted successfully",
        ),
      );
  } catch (error) {
    console.error("Error in soft delete:", error);
    throw error;
  }
});

// Restore a soft-deleted user
export const restoreUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // RESTORE THE USER - Set fields back to active state
    const restoredUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: "AVAILABLE", // ← Change from 'DELETED' to 'AVAILABLE'
        isActive: true, // ← Set back to true (active)
        deletedAt: null, // ← Clear the deletion timestamp
        deletedBy: null, // ← Clear who deleted it
        isOnline: false, // ← Set to offline (optional)
      },
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          restoredUserId: restoredUser.id,
          status: restoredUser.status,
          isActive: restoredUser.isActive,
        },
        "User restored successfully",
      ),
    );
  } catch (error) {
    console.error("Error restoring user:", error);
    throw error;
  }
});

export const getAllUsersForAdmin = asyncHandler(async (req, res) => {
  try {
    console.log("Fetching all users from database...");

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        isOnline: true,
        status: true,
        isActive: true,
        deletedAt: true,
        deletedBy: true,
        createdAt: true,
        lastSeen: true,
        department: true, // ADD this line
        designation: true,
        parentId: true, // ADD this line
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(`Found ${users.length} users in database`);

    res.status(200).json({
      success: true,
      data: users,
      message: `Found ${users.length} users`,
    });
  } catch (error) {
    console.error("💥 Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message,
    });
  }
});

export const createUserByAdmin = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    username,
    role,
    gender,
    department,
    designation,
  } = req.body; // ADD department

  // Validation - same as registerUser
  if ([name, email, password, phone, username].some((f) => f?.trim() === "")) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await prisma.user.findFirst({
    where: {
      email, // Only check email, not username
    },
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }

  let avatarUrl = null;
  let publicId = null;
  if (req.file) {
    const uploadedImage = await uploadOnCloudinary(req.file.path, "users");
    avatarUrl = uploadedImage?.secure_url || "";
    publicId = uploadedImage?.public_id;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user with department
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      username: username,
      name: name,
      phone: phone,
      avatarUrl: avatarUrl,
      publicId: publicId,
      role: role || "USER",
      gender: gender,
      department: department, // ADD this line
      designation: designation || null,
      officeStartTime: req.body.officeStartTime || "09:00",
      officeEndTime: req.body.officeEndTime || "18:00",
    },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      phone: true,
      avatarUrl: true,
      role: true,
      gender: true,
      department: true, // ADD this line
      createdAt: true,
      designation: true,
      officeStartTime: req.body.officeStartTime || "09:00",
      officeEndTime: req.body.officeEndTime || "18:00",
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, user, "User created successfully by admin"));
});

// Update user by admin
export const updateUserByAdmin = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const {
    name,
    username,
    phone,
    gender,
    password,
    status,
    role,
    department,
    designation,
    officeStartTime, // Now accepts ISO string or Date object
    officeEndTime, // Now accepts ISO string or Date object
    // timeZone
  } = req.body;

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  const updateData = {};
  if (name) updateData.name = name;
  if (username) updateData.username = username;
  if (phone) updateData.phone = phone;
  if (gender) updateData.gender = gender;
  if (status) updateData.status = status;
  if (role) updateData.role = role;
  if (department) updateData.department = department;
  if (designation) updateData.designation = designation;
  // if (timeZone) updateData.timeZone = timeZone;

  // Simple DateTime handling - no validation needed!
  if (officeStartTime !== undefined)
    updateData.officeStartTime = officeStartTime;
  if (officeEndTime !== undefined) updateData.officeEndTime = officeEndTime;

  if (password) {
    updateData.password = await bcrypt.hash(password, 10);
  }

  // Handle file upload (your existing logic)
  let profileUrl = existingUser.avatarUrl;
  let publicId = existingUser.publicId;

  if (req.file) {
    if (existingUser.publicId) {
      await deleteOnCloudinary(existingUser.publicId);
    }
    const uploadedImage = await uploadOnCloudinary(req.file.path, "users");
    profileUrl = uploadedImage?.secure_url || "";
    publicId = uploadedImage?.public_id;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { ...updateData, avatarUrl: profileUrl, publicId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      avatarUrl: true,
      gender: true,
      department: true,
      designation: true, // ADD this line
      officeStartTime: true, // Now returns DateTime
      officeEndTime: true, // Now returns DateTime
      // timeZone: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, updatedUser, "User updated successfully by admin"),
    );
});

// Get all messages sent by a specific user (for admin view)
export const getUserMessages = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20, type = "TEXT" } = req.query;

  try {
    console.log(`📨 Fetching messages for user: ${userId}, type: ${type}`);

    // Verify the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);

    // Get all messages sent by this user
    const [messages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where: {
          senderId: userId,
          type: type, // Filter by message type
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatarUrl: true,
            },
          },
          room: {
            select: {
              id: true,
              name: true,
              isGroup: true,
              avatarUrl: true,
            },
          },
          repliedTo: {
            include: {
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
        orderBy: { createdAt: "desc" },
        skip: skip,
        take: parseInt(limit),
      }),
      prisma.message.count({
        where: {
          senderId: userId,
          type: type,
        },
      }),
    ]);

    console.log(`Found ${messages.length} messages for user ${userId}`);

    // Format the response
    const formattedMessages = messages.map((message) => ({
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      room: {
        id: message.room.id,
        name:
          message.room.name ||
          (message.room.isGroup ? "Group Chat" : "Direct Message"),
        isGroup: message.room.isGroup,
        avatarUrl: message.room.avatarUrl,
      },
      sender: {
        id: message.sender.id,
        username: message.sender.username,
        name: message.sender.name,
        avatarUrl: message.sender.avatarUrl,
      },
      repliedTo: message.repliedTo
        ? {
            id: message.repliedTo.id,
            content: message.repliedTo.content,
            sender: {
              id: message.repliedTo.sender.id,
              username: message.repliedTo.sender.username,
              name: message.repliedTo.sender.name,
            },
          }
        : null,
    }));

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          messages: formattedMessages,
          user: targetUser,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / limit),
            totalCount: totalCount,
            hasNext: page * limit < totalCount,
            hasPrevious: page > 1,
          },
        },
        "User messages retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get user messages error:", error);
    throw new ApiError(500, "Failed to retrieve user messages");
  }
});

export const getUserGroups = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20, search } = req.query;

  try {
    console.log(
      `👥 Fetching groups for user: ${userId}, page: ${page}, search: ${search}`,
    );

    // Follows YOUR pattern: Verify user exists but don't check permissions
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);

    // Build where clause (follows your search pattern)
    const where = {
      userId: userId,
      room: { isGroup: true },
    };

    // Add search if provided (like your media/files APIs)
    if (search && search.trim() !== "") {
      where.room = {
        ...where.room,
        name: { contains: search, mode: "insensitive" },
      };
    }

    // Get groups with pagination (follows your Promise.all pattern)
    const [groupMemberships, totalCount] = await Promise.all([
      prisma.chatMember.findMany({
        where,
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
                    },
                  },
                },
              },
              messages: {
                take: 1,
                orderBy: { createdAt: "desc" },
                include: {
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
          },
        },
        orderBy: { room: { updatedAt: "desc" } },
        skip: skip,
        take: parseInt(limit),
      }),
      prisma.chatMember.count({ where }),
    ]);

    console.log(`Found ${groupMemberships.length} groups for user ${userId}`);

    // Format groups (follows your mapping pattern)
    const formattedGroups = await Promise.all(
      groupMemberships.map(async (membership) => {
        const room = membership.room;
        const lastMessage = room.messages?.[0] || null;

        const members = room.members.map((m) => ({
          id: m.user.id,
          username: m.user.username || m.user.name || "Unknown",
          avatarUrl: m.user.avatarUrl || null,
          role: m.role,
          mutedUntil: m.mutedUntil,
        }));

        // Calculate unread count for THIS user (like your unread logic)
        const unreadCount = await prisma.messageStatus.count({
          where: {
            message: {
              roomId: room.id,
              type: { not: "SYSTEM" },
            },
            userId: userId, // Use the target user ID
            status: { not: "READ" },
          },
        });

        const formattedLastMessage = lastMessage
          ? {
              id: lastMessage.id,
              content: lastMessage.content,
              type: lastMessage.type || "text",
              sender: lastMessage.sender
                ? {
                    id: lastMessage.sender.id,
                    username:
                      lastMessage.sender.username ||
                      lastMessage.sender.name ||
                      "Unknown",
                    avatarUrl: lastMessage.sender.avatarUrl || null,
                  }
                : null,
              createdAt: lastMessage.createdAt,
            }
          : null;

        const lastMessageTime =
          lastMessage?.createdAt || room.updatedAt || room.createdAt;

        return {
          id: room.id,
          name: room.name || "Unnamed Group",
          avatarUrl: room.avatarUrl || null,
          lastMessage: formattedLastMessage,
          lastMessageTime,
          unreadCount,
          members,
          isPinned: membership.isPinned || false,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
        };
      }),
    );

    // Sort: pinned first, then by last activity
    formattedGroups.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    // Follows YOUR exact response format
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          groups: formattedGroups,
          user: targetUser, // Include user info like your other APIs
          statistics: {
            total: formattedGroups.length,
            totalGroups: totalCount,
            withUnread: formattedGroups.filter((g) => g.unreadCount > 0).length,
            pinned: formattedGroups.filter((g) => g.isPinned).length,
          },
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / limit),
            totalCount: totalCount,
            hasNext: page * limit < totalCount,
            hasPrevious: page > 1,
            limit: parseInt(limit),
          },
        },
        "User groups retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get user groups error:", error);
    throw new ApiError(500, "Failed to retrieve user groups");
  }
});

export const getUserMedia = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20, type, search } = req.query;

  try {
    console.log(
      `📨 Fetching media for user: ${userId}, type: ${type}, search: ${search}`,
    );

    // Verify the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);

    // FIXED: ADD "AUDIO" TO MEDIA TYPES
    const mediaTypes =
      type && type !== "all"
        ? [type.toUpperCase()]
        : ["IMAGE", "VIDEO", "AUDIO"];

    // Build where clause
    const where = {
      senderId: userId,
      type: { in: mediaTypes },
      OR: [{ mediaUrl: { not: null } }, { fileName: { not: null } }],
    };

    // Add search functionality if provided
    if (search && search.trim() !== "") {
      where.OR.push(
        { fileName: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      );
    }

    // Get all media messages sent by this user
    const [allMessages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatarUrl: true,
            },
          },
          room: {
            select: {
              id: true,
              name: true,
              isGroup: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: skip,
        take: parseInt(limit),
      }),
      prisma.message.count({ where }),
    ]);

    console.log(`Found ${allMessages.length} media files for user ${userId}`);

    // ENHANCED FILTERING: Check both filename AND mediaUrl for PDF indicators
    const filteredMedia = allMessages.filter((message) => {
      if (!message.mediaUrl) return false;

      const fileName = message.fileName || "";
      const mediaUrl = message.mediaUrl || "";

      // Check for PDF indicators
      const isPDF =
        fileName.toLowerCase().includes("resum") ||
        fileName.toLowerCase().includes("cv") ||
        fileName.toLowerCase().includes("resume") ||
        fileName.toLowerCase().includes("document") ||
        fileName.toLowerCase().includes("pdf") ||
        mediaUrl.toLowerCase().includes(".pdf") ||
        mediaUrl.toLowerCase().includes("/pdf") ||
        mediaUrl.toLowerCase().includes("application/pdf") ||
        (/^\d+$/.test(fileName.split(".")[0]) && fileName.length > 8);

      // Keep only if it's NOT a PDF
      return !isPDF;
    });

    console.log(
      `🖼️  After enhanced PDF filter: ${filteredMedia.length} actual media files`,
    );

    // Media formatting
    const formattedMedia = filteredMedia.map((message) => {
      const fileExtension = message.fileName
        ? message.fileName.split(".").pop().toLowerCase()
        : null;

      let mimeType = null;
      if (fileExtension) {
        const mimeMap = {
          // Images
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
          bmp: "image/bmp",
          heic: "image/heic",
          heif: "image/heif",

          // Videos
          mp4: "video/mp4",
          m4v: "video/mp4",
          webm: "video/webm",
          ogv: "video/ogg",
          mov: "video/quicktime",
          avi: "video/x-msvideo",
          mkv: "video/x-matroska",
          "3gp": "video/3gpp",
          wmv: "video/x-ms-wmv",
          flv: "video/x-flv",
          mpg: "video/mpeg",
          mpeg: "video/mpeg",

          // ADDED: Audio types
          mp3: "audio/mpeg",
          m4a: "audio/mp4",
          wav: "audio/wav",
          ogg: "audio/ogg",
          aac: "audio/aac",
          flac: "audio/flac",
        };
        mimeType = mimeMap[fileExtension];
      }

      return {
        id: message.id,
        type: message.type,
        mediaUrl: message.mediaUrl,
        fileName: message.fileName,
        fileSize: message.fileSize,
        fileExtension: fileExtension,
        mimeType: mimeType,
        content: message.content,
        duration: message.duration,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,

        room: {
          id: message.room.id,
          name:
            message.room.name ||
            (message.room.isGroup ? "Group Chat" : "Direct Message"),
          isGroup: message.room.isGroup,
          avatarUrl: message.room.avatarUrl,
        },

        sender: {
          id: message.sender.id,
          username: message.sender.username,
          name: message.sender.name,
          avatarUrl: message.sender.avatarUrl,
        },
      };
    });

    // Calculate statistics by type
    const typeStats = formattedMedia.reduce((stats, item) => {
      stats[item.type] = (stats[item.type] || 0) + 1;
      return stats;
    }, {});

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          media: formattedMedia,
          user: targetUser,
          statistics: {
            total: formattedMedia.length,
            byType: typeStats,
          },
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(formattedMedia.length / limit),
            totalCount: formattedMedia.length,
            hasNext: page * limit < formattedMedia.length,
            hasPrevious: page > 1,
            limit: parseInt(limit),
          },
        },
        "User media files retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get user media error:", error);
    throw new ApiError(500, "Failed to retrieve user media files");
  }
});

export const getUserFiles = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20, fileType = "all", search } = req.query;

  try {
    console.log(
      `📁 Fetching files for user: ${userId}, type: ${fileType}, search: ${search}`,
    );

    // Verify the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
      },
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);
    const currentPage = parseInt(page);
    const limitInt = parseInt(limit);

    // Build base WHERE clause
    const baseWhere = {
      senderId: userId,
      deleted: false,
    };

    // Add search if provided
    if (search && search.trim() !== "") {
      baseWhere.OR = [
        { fileName: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    // Get ALL messages first (we need to detect files in JavaScript)
    const allMessages = await prisma.message.findMany({
      where: baseWhere,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
        room: {
          select: {
            id: true,
            name: true,
            isGroup: true,
            avatarUrl: true,
          },
        },
        repliedTo: {
          include: {
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
      orderBy: { createdAt: "desc" },
      // REMOVE skip/take here since we need ALL messages for file detection
    });

    console.log(`Found ${allMessages.length} total messages for filtering`);

    // Your file detection logic (keep as is)
    const getExt = (s = "") => {
      try {
        const clean = s.split("?")[0].split("#")[0];
        const parts = clean.split(".");
        if (parts.length < 2) return "";
        return parts.pop().toLowerCase();
      } catch {
        return "";
      }
    };

    const normalizeUrl = (msg) => {
      return msg.mediaUrl || msg.url || "";
    };

    const extractFirstUrl = (text = "") => {
      const m = text.match(/https?:\/\/\S+/i);
      return m ? m[0].replace(/[)\]}>,.;]+$/, "") : "";
    };

    const formatBytes = (bytes) => {
      if (bytes == null) return "";
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      const mb = kb / 1024;
      if (mb < 1024) return `${mb.toFixed(1)} MB`;
      const gb = mb / 1024;
      return `${gb.toFixed(1)} GB`;
    };

    const detectFileType = (msg) => {
      const name = msg.fileName || "";
      const url = normalizeUrl(msg);
      const mime = (msg.mimeType || "").toLowerCase();
      const extName = getExt(name);
      const extUrl = getExt(url);

      const contentUrl = extractFirstUrl(msg.content || "");
      const contentExt = getExt(contentUrl);

      // 🚨 EXCLUDE images, videos, audio first
      const mediaTypes = {
        image: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico"],
        video: ["mp4", "avi", "mov", "wmv", "flv", "webm", "mkv", "m4v"],
        audio: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"],
      };

      const allExtensions = [extName, extUrl, contentExt];

      // Check if this is a media file
      for (const [mediaType, extensions] of Object.entries(mediaTypes)) {
        for (const ext of extensions) {
          if (allExtensions.includes(ext) || mime.includes(mediaType)) {
            return null; // Skip media files
          }
        }
      }

      // Your existing document detection
      const fileTypes = {
        pdf: ["pdf"],
        document: ["doc", "docx", "odt", "docm", "dotx", "rtf", "txt"],
        spreadsheet: ["xls", "xlsx", "ods", "csv", "xlsm", "xltx"],
        presentation: ["ppt", "pptx", "odp", "ppsx", "potx"],
        archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
        code: [
          "js",
          "ts",
          "py",
          "java",
          "cpp",
          "c",
          "html",
          "css",
          "php",
          "rb",
          "go",
          "rs",
          "swift",
        ],
        config: ["json", "xml", "yml", "yaml", "ini", "conf", "env"],
      };

      const allMimes = [mime];

      for (const [type, extensions] of Object.entries(fileTypes)) {
        for (const ext of extensions) {
          if (
            allExtensions.includes(ext) ||
            allMimes.some((m) => m.includes(ext))
          ) {
            return type;
          }
        }
      }

      // Default to 'file' if we can't determine specific type but it's a file message
      if (msg.type === "FILE") {
        return "file";
      }

      return null;
    };
    // Filter messages to find ALL files
    const allFileMessages = allMessages.filter((msg) => {
      const fileType = detectFileType(msg);
      return fileType !== null;
    });

    console.log(
      `📁 Detected ${allFileMessages.length} total files from ${allMessages.length} messages`,
    );

    // Apply file type filter if specified
    let filteredFiles = allFileMessages;
    if (fileType && fileType !== "all") {
      filteredFiles = allFileMessages.filter((msg) => {
        const detectedType = detectFileType(msg);
        return detectedType === fileType.toLowerCase();
      });
    }

    console.log(`📁 After '${fileType}' filter: ${filteredFiles.length} files`);

    // CORRECT PAGINATION: Apply pagination AFTER filtering
    const totalFileCount = filteredFiles.length;
    const totalPages = Math.ceil(totalFileCount / limitInt);

    // Get the slice for current page
    const startIndex = skip;
    const endIndex = startIndex + limitInt;
    const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

    console.log(
      `📄 Page ${currentPage}: showing ${paginatedFiles.length} files (${startIndex}-${endIndex} of ${totalFileCount})`,
    );

    // Format the files response
    const formattedFiles = paginatedFiles.map((message) => {
      const fileType = detectFileType(message);
      const fileUrl = normalizeUrl(message);
      const contentUrl = extractFirstUrl(message.content || "");
      const finalUrl = fileUrl || contentUrl;

      return {
        id: message.id,
        type: message.type,
        fileType: fileType,
        mediaUrl: finalUrl,
        fileName: message.fileName || finalUrl?.split("/").pop() || "file",
        fileSize: message.fileSize ? formatBytes(message.fileSize) : "",
        fileExtension: getExt(message.fileName || finalUrl),
        mimeType: message.mimeType,
        content: message.content,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,

        room: {
          id: message.room.id,
          name:
            message.room.name ||
            (message.room.isGroup ? "Group Chat" : "Direct Message"),
          isGroup: message.room.isGroup,
          avatarUrl: message.room.avatarUrl,
        },

        sender: {
          id: message.sender.id,
          username: message.sender.username,
          name: message.sender.name,
          avatarUrl: message.sender.avatarUrl,
        },

        repliedTo: message.repliedTo
          ? {
              id: message.repliedTo.id,
              content: message.repliedTo.content,
              type: message.repliedTo.type,
              sender: {
                id: message.repliedTo.sender.id,
                username: message.repliedTo.sender.username,
                name: message.repliedTo.sender.name,
              },
            }
          : null,
      };
    });

    // CORRECT PAGINATION DATA
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          files: formattedFiles,
          user: targetUser,
          statistics: {
            total: formattedFiles.length,
            byType: formattedFiles.reduce((stats, file) => {
              stats[file.fileType] = (stats[file.fileType] || 0) + 1;
              return stats;
            }, {}),
            totalFromMessages: totalFileCount,
          },
          // FIXED PAGINATION - now consistent
          pagination: {
            currentPage: currentPage,
            totalPages: totalPages,
            totalCount: totalFileCount, // Total files after filtering
            hasNext: currentPage < totalPages,
            hasPrevious: currentPage > 1,
            limit: limitInt,
          },
          filters: {
            appliedFileType: fileType,
            availableTypes: [
              "all",
              "pdf",
              "document",
              "spreadsheet",
              "presentation",
              "archive",
              "code",
              "config",
              "file",
            ],
          },
        },
        "User files retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get user files error:", error);
    throw new ApiError(500, "Failed to retrieve user files");
  }
});

export const uploadAudioMessage = asyncHandler(async (req, res) => {
  const { roomId, replyTo, tempId, duration } = req.body;
  const senderId = req.user.id;

  console.log("Audio upload request:", {
    roomId,
    hasFile: !!req.file,
    fileName: req.file?.originalname,
    duration,
    fileSize: req.file?.size,
  });

  if (!roomId) {
    throw new ApiError(400, "Room ID is required");
  }

  if (!req.file) {
    throw new ApiError(400, "Audio file is required");
  }

  // Validate audio file
  const audioMimeTypes = [
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/ogg",
    "audio/aac",
    "audio/x-m4a",
  ];
  if (!audioMimeTypes.includes(req.file.mimetype)) {
    throw new ApiError(400, "Invalid audio file format");
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

  try {
    // Upload audio to Cloudinary - SPECIFIC AUDIO FOLDER
    console.log("☁ Uploading audio to Cloudinary...");
    const uploadedFile = await uploadOnCloudinary(
      req.file.path,
      "chat/audio", // Specific folder for audio
    );

    if (!uploadedFile) {
      throw new ApiError(500, "Failed to upload audio to Cloudinary");
    }

    console.log("Audio uploaded to Cloudinary:", {
      url: uploadedFile.secure_url,
      size: uploadedFile.bytes,
      format: uploadedFile.format,
    });

    // Generate proper filename with extension
    const originalName = req.file.originalname || `recording_${Date.now()}`;
    const fileExtension = getAudioExtension(req.file.mimetype);
    const fileName = `${originalName.split(".")[0]}_${Date.now()}.${fileExtension}`;

    // Create audio message with PROPER AUDIO TYPE
    const messageData = {
      roomId,
      senderId,
      type: "AUDIO", // FORCE AUDIO TYPE
      mediaUrl: uploadedFile.secure_url,
      publicId: uploadedFile.public_id,
      fileName: fileName,
      fileSize: uploadedFile.bytes,
      replyToId: replyTo || null,
      content: duration ? duration.toString() : "0", // Store duration in content
    };

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

    console.log("💾 Audio message saved:", {
      id: message.id,
      type: message.type,
      fileName: message.fileName,
      duration: message.content,
    });

    // PUSH NOTIFICATION for audio
    try {
      const roomMembers = await prisma.chatMember.findMany({
        where: {
          roomId,
          isActive: true,
          userId: { not: senderId },
        },
        select: { userId: true },
      });

      const receiverIds = roomMembers.map((member) => member.userId);

      if (receiverIds.length > 0) {
        await sendChatNotification(receiverIds, {
          roomId: roomId,
          messageId: message.id,
          senderId: senderId,
          senderName: message.sender.username,
          content: "Audio message",
          type: "AUDIO",
        });
        console.log("Audio notification sent to", receiverIds.length, "users");
      }
    } catch (notificationError) {
      console.error("Audio notification failed:", notificationError);
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

    // Emit socket event for audio
    const io = req.app.get("io");
    if (io) {
      io.to(roomId).emit("new-audio-message", {
        ...message,
        tempId,
        duration: parseInt(message.content) || 0,
      });
      console.log("Audio socket event emitted to room:", roomId);
    }

    // Update room's updatedAt
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });

    // Clean up temp file
    try {
      if (req.file.path) {
        fs.unlinkSync(req.file.path);
      }
    } catch (cleanupError) {
      console.log("⚠ Audio temp file cleanup failed:", cleanupError.message);
    }

    return res.status(201).json(
      new ApiResponse(
        201,
        {
          message: {
            ...message,
            duration: parseInt(message.content) || 0,
          },
        },
        "Audio message sent successfully",
      ),
    );
  } catch (error) {
    console.error("Audio upload error:", error);

    // Clean up temp file on error
    try {
      if (req.file?.path) {
        fs.unlinkSync(req.file.path);
      }
    } catch (cleanupError) {
      console.log("⚠ Audio temp file cleanup failed:", cleanupError.message);
    }

    throw new ApiError(500, `Failed to send audio: ${error.message}`);
  }
});

// SPECIFIC AUDIO FETCH API
export const getUserAudioFiles = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  try {
    console.log(`🎵 Fetching audio files for user: ${userId}`);

    // Verify user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true },
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    const skip = (page - 1) * parseInt(limit);

    // Get ONLY audio files
    const where = {
      senderId: userId,
      type: "AUDIO",
      mediaUrl: { not: null },
    };

    const [audioMessages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: {
            select: { id: true, username: true, name: true, avatarUrl: true },
          },
          room: { select: { id: true, name: true, isGroup: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: skip,
        take: parseInt(limit),
      }),
      prisma.message.count({ where }),
    ]);

    console.log(`Found ${audioMessages.length} audio files`);

    // Format response
    const formattedAudio = audioMessages.map((audio) => ({
      id: audio.id,
      type: "AUDIO",
      mediaUrl: audio.mediaUrl,
      fileName: audio.fileName,
      fileSize: audio.fileSize,
      duration: parseInt(audio.content) || 0,
      createdAt: audio.createdAt,
      room: audio.room,
      sender: audio.sender,
    }));

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          audio: formattedAudio,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / limit),
            totalCount: totalCount,
            limit: parseInt(limit),
          },
        },
        "Audio files retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get user audio error:", error);
    throw new ApiError(500, "Failed to retrieve audio files");
  }
});

export const getAllGroupsForAdmin = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const skip = (page - 1) * parseInt(limit);

    // Build search filter
    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { id: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [groups, totalCount] = await Promise.all([
      prisma.chatRoom.findMany({
        where: {
          isGroup: true,
          ...searchFilter,
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
                },
              },
            },
          },
          messages: {
            take: 1, // Get only the last message
            orderBy: { createdAt: "desc" },
            include: {
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
          _count: {
            select: {
              members: true,
              messages: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: parseInt(limit),
      }),
      prisma.chatRoom.count({
        where: {
          isGroup: true,
          ...searchFilter,
        },
      }),
    ]);

    const formattedGroups = groups.map((group) => {
      const lastMessage = group.messages[0] || null;

      // Format last message content
      const formatLastMessageContent = (message) => {
        if (!message) return "No messages yet";

        switch (message.type) {
          case "IMAGE":
            return "📷 Image";
          case "FILE":
            return "📄 File";
          case "AUDIO":
            return "🎵 Audio";
          case "VIDEO":
            return "🎬 Video";
          case "TEXT":
          default:
            return message.content || "Message";
        }
      };

      const formattedLastMessage = lastMessage
        ? {
            id: lastMessage.id,
            content: formatLastMessageContent(lastMessage),
            type: lastMessage.type || "text",
            sender: lastMessage.sender
              ? {
                  id: lastMessage.sender.id,
                  username:
                    lastMessage.sender.username ||
                    lastMessage.sender.name ||
                    "Unknown",
                  avatarUrl: lastMessage.sender.avatarUrl || null,
                }
              : null,
            createdAt: lastMessage.createdAt,
          }
        : null;

      return {
        id: group.id,
        name: group.name || "Unnamed Group",
        avatarUrl: group.avatarUrl || null,
        description: group.description || null,
        roomType: group.roomType,
        lastMessage: formattedLastMessage,
        lastMessageTime:
          lastMessage?.createdAt || group.updatedAt || group.createdAt,
        memberCount: group._count.members,
        messageCount: group._count.messages,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        members: group.members.map((member) => ({
          id: member.user.id,
          username: member.user.username || member.user.name || "Unknown",
          avatarUrl: member.user.avatarUrl || null,
          role: member.role,
          joinedAt: member.joinedAt,
        })),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        groups: formattedGroups,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      },
      message: "All groups fetched successfully for admin",
    });
  } catch (error) {
    console.error("getAllGroupsForAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching all groups",
      error: error.message,
    });
  }
});

export const createGroup = asyncHandler(async (req, res) => {
  try {
    const { name, memberIds = [] } = req.body;
    const currentUserId = req.user.id;

    console.log("CreateGroup - File received:", req.file);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    let avatarUrl = null;
    let publicId = null;

    if (req.file) {
      console.log("🖼️ Uploading avatar using cloudinary.uploader.upload...");

      // USE THE SAME METHOD AS WORKING updateGroupAvatar
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "group_avatars",
      });

      avatarUrl = result.secure_url;
      publicId = result.public_id;
      console.log("Avatar uploaded successfully:", avatarUrl);

      // Clean up local file (same as working API)
      const fs = await import("fs");
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    // Parse memberIds (same as before)
    let parsedMemberIds = [];
    if (memberIds) {
      if (typeof memberIds === "string") {
        try {
          parsedMemberIds = JSON.parse(memberIds);
        } catch (e) {
          parsedMemberIds = memberIds.split(",").filter((id) => id.trim());
        }
      } else if (Array.isArray(memberIds)) {
        parsedMemberIds = memberIds;
      }
    }

    const uniqueMemberIds = [
      ...new Set(parsedMemberIds.filter((id) => id && id !== currentUserId)),
    ];

    // Create the group
    const group = await prisma.chatRoom.create({
      data: {
        name: name.trim(),
        isGroup: true,
        roomType: "GROUP",
        avatarUrl: avatarUrl,
        publicId: publicId,
        members: {
          create: [
            { userId: currentUserId, role: "OWNER" },
            ...uniqueMemberIds.map((id) => ({
              userId: id,
              role: "MEMBER",
            })),
          ],
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    console.log("Group created with avatar:", group.avatarUrl);

    return res.status(201).json({
      success: true,
      data: group,
      message: "Group created successfully",
    });
  } catch (error) {
    console.error("Error creating group:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating group",
      error: error.message,
    });
  }
});

// Rename group
export const renameGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    // Get current user's platform role and group membership (consistent with your pattern)
    const [currentUser, userMembership, group] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, username: true, name: true },
      }),
      prisma.chatMember.findUnique({
        where: { userId_roomId: { userId: req.user.id, roomId: groupId } },
      }),
      prisma.chatRoom.findUnique({
        where: { id: groupId, isGroup: true },
      }),
    ]);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    // Consistent permission check with your other APIs
    const isPlatformAdmin = ["ADMIN", "SUPER_ADMIN"].includes(currentUser.role);
    const isGroupOwnerOrAdmin =
      userMembership && ["OWNER", "ADMIN"].includes(userMembership.role);

    if (!isPlatformAdmin && !isGroupOwnerOrAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Only group owners, admins, or platform admins can rename the group",
      });
    }

    // Update group name
    const updatedGroup = await prisma.chatRoom.update({
      where: {
        id: groupId,
        isGroup: true,
      },
      data: {
        name: name.trim(),
        updatedAt: new Date(),
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    // Create system message (consistent with your pattern)
    const actionBy = isPlatformAdmin ? "Platform Admin" : "";
    const displayName = currentUser.username || currentUser.name;

    await prisma.message.create({
      data: {
        content:
          `Group renamed to "${name.trim()}" by ${actionBy}${displayName}`.trim(),
        roomId: groupId,
        senderId: req.user.id,
        type: "SYSTEM",
        statuses: {
          create: (
            await prisma.chatMember.findMany({
              where: { roomId: groupId },
              select: { userId: true },
            })
          ).map((m) => ({
            userId: m.userId,
            status: "SENT",
          })),
        },
      },
    });

    // Emit socket events (consistent with your pattern)
    const io = req.app.get("io");
    if (io) {
      io.to(groupId).emit("group-renamed", {
        groupId,
        newName: name.trim(),
        renamedBy: req.user.id,
        renamedByUsername: displayName,
        isPlatformAdmin,
      });

      io.to(groupId).emit("group-updated", {
        groupId,
        name: name.trim(),
        updatedAt: updatedGroup.updatedAt,
        updatedBy: req.user.id,
      });
    }

    return res.status(200).json({
      success: true,
      data: updatedGroup,
      message: "Group renamed successfully",
    });
  } catch (error) {
    console.error("Rename group error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error renaming group",
      error: error.message,
    });
  }
};

export const deleteGroup = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const currentUserId = req.user.id;
  const currentUserRole = req.user.role; // This comes from adminAuthenticate

  try {
    // Check if group exists
    const group = await prisma.chatRoom.findUnique({
      where: {
        id: groupId,
        isGroup: true,
      },
      include: {
        members: {
          where: { userId: currentUserId },
          select: { role: true },
        },
      },
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    // UPDATED: Allow ADMIN, SUPER_ADMIN, or group OWNER to delete
    const userMembership = group.members[0];
    const isOwner = userMembership && userMembership.role === "OWNER";
    const isAdmin =
      currentUserRole === "ADMIN" || currentUserRole === "SUPER_ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only group owner or admins can delete the group",
      });
    }

    // Use transaction to delete all related data
    await prisma.$transaction(async (tx) => {
      // 1. Delete all message statuses
      await tx.messageStatus.deleteMany({
        where: {
          message: {
            roomId: groupId,
          },
        },
      });

      // 2. Delete all messages
      await tx.message.deleteMany({
        where: { roomId: groupId },
      });

      // 3. Delete all chat members
      await tx.chatMember.deleteMany({
        where: { roomId: groupId },
      });

      // 4. Delete the group itself
      await tx.chatRoom.delete({
        where: { id: groupId },
      });
    });

    // Emit socket event for real-time updates
    const io = req.app.get("io");
    if (io) {
      io.to(groupId).emit("group-deleted", {
        groupId,
        deletedBy: currentUserId,
        deletedByRole: currentUserRole,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully",
    });
  } catch (error) {
    console.error("Delete group error:", error);

    if (error.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error deleting group",
      error: error.message,
    });
  }
});

export const getGroupMessagesAsAdmin = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  // Verify it's a group room
  const room = await prisma.chatRoom.findUnique({
    where: {
      id: roomId,
      roomType: "GROUP",
    },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              email: true,
              role: true,
              avatarUrl: true,
            },
          },
        },
        where: { isActive: true },
      },
    },
  });

  if (!room) {
    throw new ApiError(404, "Group chat not found");
  }

  // Pure fetch - no status updates, no socket emissions
  const [messages, totalCount] = await Promise.all([
    prisma.message.findMany({
      where: { roomId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
            email: true,
          },
        },
        repliedTo: {
          include: {
            sender: {
              select: { id: true, username: true, name: true, avatarUrl: true },
            },
          },
        },
        reactions: {
          include: {
            user: { select: { id: true, username: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: parseInt(limit),
    }),
    prisma.message.count({ where: { roomId } }),
  ]);

  // Format messages for admin view
  const formattedMessages = messages.map((msg) => ({
    ...msg,
    repliedTo: msg.repliedTo
      ? {
          ...msg.repliedTo,
          senderName:
            msg.repliedTo.sender?.username ||
            msg.repliedTo.sender?.name ||
            "Unknown",
        }
      : null,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        messages: formattedMessages.reverse(),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
        roomId: room.id,
        groupInfo: {
          id: room.id,
          name: room.name,
          description: room.description,
          avatarUrl: room.avatarUrl,
          createdAt: room.createdAt,
          memberCount: room.members.length,
          members: room.members.map((m) => ({
            id: m.user.id,
            username: m.user.username,
            name: m.user.name,
            email: m.user.email,
            role: m.user.role,
            chatMemberRole: m.role,
            joinedAt: m.joinedAt,
          })),
        },
      },
      "Group messages fetched successfully (Admin View)",
    ),
  );
});

export const addMembersToRoom = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { memberIds } = req.body;

  if (!memberIds || !Array.isArray(memberIds))
    throw new ApiError(400, "Member IDs array is required");

  // Get current user's platform role and group membership
  const [currentUser, userMembership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, username: true, name: true },
    }),
    prisma.chatMember.findUnique({
      where: { userId_roomId: { userId: req.user.id, roomId } },
    }),
  ]);

  // Allow: Platform ADMIN OR Group OWNER/ADMIN
  const isPlatformAdmin = currentUser.role === "ADMIN" || "SUPER_ADMIN";
  const isGroupOwnerOrAdmin =
    userMembership &&
    ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(userMembership.role);

  if (!isPlatformAdmin && !isGroupOwnerOrAdmin) {
    throw new ApiError(
      403,
      "Only group owners, admins, or super admins can add members",
    );
  }

  const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
  if (!room || !room.isGroup)
    throw new ApiError(400, "Cannot add members to 1-to-1 chat");

  const newMembers = await Promise.all(
    memberIds.map((userId) =>
      prisma.chatMember.upsert({
        where: { userId_roomId: { userId, roomId } },
        update: {},
        create: { userId, roomId, joinedAt: new Date(), role: "MEMBER" },
      }),
    ),
  );

  // Get usernames of added members for the notification
  const addedUsers = await prisma.user.findMany({
    where: { id: { in: memberIds } },
    select: { username: true, name: true },
  });

  const addedUserNames = addedUsers
    .map((user) => user.username || user.name)
    .join(", ");

  await prisma.message.create({
    data: {
      content: `${addedUserNames} added by ${currentUser.username || currentUser.name}`,
      roomId,
      senderId: req.user.id,
      type: "SYSTEM",
      statuses: {
        create: (
          await prisma.chatMember.findMany({
            where: { roomId },
            select: { userId: true },
          })
        ).map((m) => ({ userId: m.userId, status: "SENT" })),
      },
    },
  });

  const io = req.app.get("io");
  io?.to(roomId).emit("members-added", {
    roomId,
    members: newMembers,
    addedBy: req.user.id,
  });

  res
    .status(200)
    .json(new ApiResponse(200, newMembers, "Members added successfully"));
});

// Remove member
export const removeMemberFromRoom = asyncHandler(async (req, res) => {
  const { roomId, userId } = req.params;

  // Get current user's platform role and group membership
  const [currentUser, userMembership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, username: true, name: true },
    }),
    prisma.chatMember.findUnique({
      where: { userId_roomId: { userId: req.user.id, roomId } },
    }),
  ]);

  // Allow: Platform ADMIN OR Group OWNER/ADMIN
  const isPlatformAdmin =
    currentUser.role === "ADMIN" || currentUser.role === "SUPER_ADMIN";
  const isGroupOwnerOrAdmin =
    userMembership && ["OWNER", "ADMIN"].includes(userMembership.role);

  if (!isPlatformAdmin && !isGroupOwnerOrAdmin) {
    throw new ApiError(
      403,
      "Only group owners, admins, or platform admins can remove members",
    );
  }

  // Get the member being removed to check their role
  const targetMember = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId, roomId } },
  });

  if (!targetMember) throw new ApiError(404, "Member not found in this group");

  // Get username of removed member for the notification
  const removedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true },
  });

  const removedUserName = removedUser?.username || removedUser?.name || "User";

  await prisma.chatMember.delete({
    where: { userId_roomId: { userId, roomId } },
  });

  await prisma.message.create({
    data: {
      content: `${removedUserName} removed by ${currentUser.username || currentUser.name}`,
      roomId,
      senderId: req.user.id,
      type: "SYSTEM",
      statuses: {
        create: (
          await prisma.chatMember.findMany({
            where: { roomId },
            select: { userId: true },
          })
        ).map((m) => ({ userId: m.userId, status: "SENT" })),
      },
    },
  });

  const io = req.app.get("io");
  io?.to(roomId).emit("member-removed", {
    roomId,
    userId,
    removedBy: req.user.id,
  });
  io?.to(userId).emit("room-removed", { roomId });

  res
    .status(200)
    .json(new ApiResponse(200, null, "Member removed successfully"));
});

export const getAllAdminsAndSuperAdmins = asyncHandler(async (req, res) => {
  try {
    console.log("Fetching ALL admins and super admins from database...");

    // Fetch ALL users with ADMIN or SUPER_ADMIN role
    const admins = await prisma.user.findMany({
      where: {
        role: {
          in: ["ADMIN", "SUPER_ADMIN"],
        },
        // No filters - get ALL including inactive/deleted if needed
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        isOnline: true,
        status: true,
        isActive: true,
        department: true,
        designation: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        // Include ALL fields you have
      },
      orderBy: [
        { role: "desc" }, // SUPER_ADMIN first
        { name: "asc" }, // Then alphabetically
      ],
    });

    console.log(
      `Found ${admins.length} total admins and super admins in database`,
    );

    // Simple response with all admins
    res.status(200).json(
      new ApiResponse(
        200,
        {
          admins: admins, // Direct array of all admins
          totalCount: admins.length,
          superAdminCount: admins.filter(
            (admin) => admin.role === "SUPER_ADMIN",
          ).length,
          adminCount: admins.filter((admin) => admin.role === "ADMIN").length,
        },
        `Successfully fetched ${admins.length} admins and super admins`,
      ),
    );
  } catch (error) {
    console.error("💥 Error fetching all admins:", error);
    throw new ApiError(500, "Failed to fetch admin team members");
  }
});

// Get all contact messages for admin panel
export const getAllContactMessages = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;

  try {
    const skip = (page - 1) * parseInt(limit);

    // Build where clause
    const where = {};

    if (status && status !== "all") {
      where.status = status;
    }

    if (search && search.trim() !== "") {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
        { message: { contains: search, mode: "insensitive" } },
      ];
    }

    const [messages, totalCount] = await Promise.all([
      prisma.contactMessage.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              department: true,
              designation: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: skip,
        take: parseInt(limit),
      }),
      prisma.contactMessage.count({ where }),
    ]);

    // Calculate statistics
    const totalMessages = await prisma.contactMessage.count();
    const pendingCount = await prisma.contactMessage.count({
      where: { status: "PENDING" },
    });
    const readCount = await prisma.contactMessage.count({
      where: { status: "READ" },
    });
    const repliedCount = await prisma.contactMessage.count({
      where: { status: "REPLIED" },
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          messages,
          statistics: {
            total: totalMessages,
            pending: pendingCount,
            read: readCount,
            replied: repliedCount,
          },
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / limit),
            totalCount: totalCount,
            hasNext: page * limit < totalCount,
            hasPrevious: page > 1,
          },
        },
        "Contact messages retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Error fetching contact messages:", error);
    throw new ApiError(500, "Failed to fetch contact messages");
  }
});

export const getAllMeetingsForAdmin = async (req, res) => {
  try {
    const meetings = await prisma.meeting.findMany({
      include: {
        participants: true,
        groups: true,
        creator: true,
      },
    });

    res.status(200).json({
      success: true,
      meetings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch meetings",
    });
  }
};

// In admin.controller.js - Add this function
export const getMessageAnalytics = asyncHandler(async (req, res) => {
  const { period = "weekly" } = req.query;

  try {
    // EXCLUDE system messages from counts
    const totalMessages = await prisma.message.count({
      where: {
        type: {
          not: "SYSTEM", // ← EXCLUDE system messages
        },
      },
    });

    const totalUsers = await prisma.user.count();
    const totalRooms = await prisma.chatRoom.count();

    let analyticsData = [];

    if (period === "weekly") {
      analyticsData = await getFourWeeksOfCurrentMonth();
    } else {
      analyticsData = await getTwelveMonthsData();
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          period,
          data: analyticsData,
          totalMessages,
          summary: {
            totalMessages,
            totalUsers,
            totalRooms,
          },
        },
        "Analytics retrieved successfully",
      ),
    );
  } catch (error) {
    throw new ApiError(500, "Failed to retrieve analytics");
  }
});

// Get exactly 4 weeks of current month (FIXED: exclude system messages)
async function getFourWeeksOfCurrentMonth() {
  const weeks = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Get all days of current month
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const totalDays = lastDay.getDate();

  // Get messages from current month (EXCLUDE system messages)
  const messages = await prisma.message.findMany({
    where: {
      createdAt: {
        gte: firstDay,
        lte: lastDay,
      },
      type: {
        not: "SYSTEM", // ← EXCLUDE system messages
      },
    },
    select: {
      createdAt: true,
      senderId: true,
    },
  });

  // Divide month into 4 weeks
  const daysPerWeek = Math.ceil(totalDays / 4);

  for (let week = 0; week < 4; week++) {
    const startDay = week * daysPerWeek + 1;
    let endDay = (week + 1) * daysPerWeek;

    // Don't go beyond month end
    if (endDay > totalDays) endDay = totalDays;

    const weekStart = new Date(currentYear, currentMonth, startDay);
    const weekEnd = new Date(currentYear, currentMonth, endDay, 23, 59, 59);

    const weekMessages = messages.filter((msg) => {
      const msgDate = new Date(msg.createdAt);
      return msgDate >= weekStart && msgDate <= weekEnd;
    });

    const uniqueSenders = new Set(weekMessages.map((msg) => msg.senderId));

    weeks.push({
      period: `Week ${week + 1}`,
      messageCount: weekMessages.length,
      activeUsers: uniqueSenders.size,
    });
  }

  return weeks;
}

// Get last 12 months (FIXED: exclude system messages)
async function getTwelveMonthsData() {
  const months = [];
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Calculate start month (12 months ago)
  let startMonth = currentMonth - 11;
  let startYear = currentYear;

  // Handle year boundary correctly
  if (startMonth < 0) {
    startMonth += 12;
    startYear -= 1;
  }

  // Generate all 12 months correctly
  for (let i = 0; i < 12; i++) {
    const month = (startMonth + i) % 12;
    const year = startYear + Math.floor((startMonth + i) / 12);
    const monthName = monthNames[month];

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0, 23, 59, 59);

    console.log(
      `📊 Processing: ${monthName} ${year} (${firstDay.toDateString()} to ${lastDay.toDateString()})`,
    );

    // Get messages for this specific month (EXCLUDE system messages)
    const monthMessages = await prisma.message.findMany({
      where: {
        createdAt: {
          gte: firstDay,
          lte: lastDay,
        },
        type: {
          not: "SYSTEM", // ← EXCLUDE system messages
        },
      },
      select: {
        senderId: true,
      },
    });

    const uniqueSenders = new Set(monthMessages.map((msg) => msg.senderId));

    months.push({
      period: `${monthName} ${year}`,
      messageCount: monthMessages.length,
      activeUsers: uniqueSenders.size,
    });
  }

  return months;
}

export const getMediaDistribution = asyncHandler(async (req, res) => {
  try {
    // Get counts and total sizes for each media type
    const mediaStats = await prisma.message.groupBy({
      by: ["type"],
      where: {
        type: { in: ["AUDIO", "VIDEO", "IMAGE", "FILE"] },
      },
      _count: {
        id: true,
      },
      _sum: {
        fileSize: true,
      },
    });

    // Convert to object for easier access
    const statsMap = mediaStats.reduce((acc, item) => {
      acc[item.type] = {
        count: item._count.id,
        totalSize: item._sum.fileSize || 0,
      };
      return acc;
    }, {});

    const audioCount = statsMap.AUDIO?.count || 0;
    const videoCount = statsMap.VIDEO?.count || 0;
    const imageCount = statsMap.IMAGE?.count || 0;
    const fileCount = statsMap.FILE?.count || 0;

    const totalFiles = audioCount + videoCount + imageCount + fileCount;

    // Calculate percentages
    const calculatePercentage = (count) =>
      totalFiles > 0 ? Number(((count / totalFiles) * 100).toFixed(1)) : 0;

    // Format size in MB
    const formatSize = (bytes) =>
      bytes ? Math.round(bytes / (1024 * 1024)) : 0;

    const mediaData = [
      {
        type: "audio",
        count: audioCount,
        percentage: calculatePercentage(audioCount),
        color: "#465FFF",
        totalSize: formatSize(statsMap.AUDIO?.totalSize),
      },
      {
        type: "video",
        count: videoCount,
        percentage: calculatePercentage(videoCount),
        color: "#FF4560",
        totalSize: formatSize(statsMap.VIDEO?.totalSize),
      },
      {
        type: "image",
        count: imageCount,
        percentage: calculatePercentage(imageCount),
        color: "#00E396",
        totalSize: formatSize(statsMap.IMAGE?.totalSize),
      },
      {
        type: "file",
        count: fileCount,
        percentage: calculatePercentage(fileCount),
        color: "#FEB019",
        totalSize: formatSize(statsMap.FILE?.totalSize),
      },
    ];

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          mediaData,
          totalFiles,
          summary: {
            totalFiles,
            audioCount,
            videoCount,
            imageCount,
            fileCount,
            totalSize: mediaData.reduce(
              (sum, item) => sum + (item.totalSize || 0),
              0,
            ),
          },
        },
        "Media distribution retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("Get media distribution error:", error);
    throw new ApiError(500, "Failed to retrieve media distribution");
  }
});

export const getDirectConversation = asyncHandler(async (req, res) => {
  const { userId, otherUserId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const skip = (page - 1) * parseInt(limit);

  // Find the direct room between these two specific users
  const room = await prisma.chatRoom.findFirst({
    where: {
      roomType: "DIRECT",
      members: {
        every: {
          userId: { in: [userId, otherUserId] },
        },
      },
    },
  });

  if (!room) {
    return res.status(200).json({
      success: true,
      data: {
        messages: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalCount: 0,
        },
      },
    });
  }

  // Get messages from this specific room only
  const [messages, totalCount] = await Promise.all([
    prisma.message.findMany({
      where: {
        roomId: room.id,
        type: "TEXT",
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
        repliedTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: skip,
      take: parseInt(limit),
    }),
    prisma.message.count({
      where: {
        roomId: room.id,
        type: "TEXT",
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / parseInt(limit));

  res.status(200).json({
    success: true,
    data: {
      messages: messages,
      pagination: {
        currentPage: parseInt(page),
        totalPages: totalPages,
        totalCount: totalCount,
      },
    },
  });
});

export const getDepartments = asyncHandler(async (req, res) => {
  try {
    const departmentStats = await prisma.user.groupBy({
      by: ["department"],
      where: {
        isActive: true,
        deletedAt: null,
        department: { not: null, not: "CLIENT" },
      },
      _count: {
        id: true,
      },
    });

    const departmentsWithCounts = await Promise.all(
      departmentStats.map(async (dept) => {
        // Count team leads (ADMIN role)
        const teamLeadsCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: { in: ["ADMIN", "SUPER_ADMIN"] },
            isActive: true,
          },
        });

        // Count team members (USER role)
        const teamMembersCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: "USER",
            isActive: true,
          },
        });

        // Count SUPER_ADMIN separately or exclude from lead/member counts
        const superAdminCount = await prisma.user.count({
          where: {
            department: dept.department,
            role: "SUPER_ADMIN",
            isActive: true,
          },
        });

        return {
          name: dept.department,
          count: dept._count.id,
          teamLeads: teamLeadsCount,
          teamMembers: teamMembersCount,
          superAdmins: superAdminCount, // Optional: track SUPER_ADMIN separately
        };
      }),
    );

    res.status(200).json(
      new ApiResponse(
        200,
        {
          departments: departmentsWithCounts,
          totalDepartments: departmentsWithCounts.length,
        },
        "Departments retrieved successfully",
      ),
    );
  } catch (error) {
    console.error("💥 Error fetching departments:", error);
    throw new ApiError(500, "Failed to retrieve departments");
  }
});

// Get all signup requests for admin
export const getSignupRequests = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (page - 1) * parseInt(limit);

  const where = {};
  if (
    status &&
    ["PENDING", "APPROVED", "REJECTED"].includes(status.toUpperCase())
  ) {
    where.status = status.toUpperCase();
  }

  const [requests, totalCount] = await Promise.all([
    prisma.signupRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.signupRequest.count({ where }),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        totalRequests: totalCount,
        requests,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
        },
      },
      "Signup requests retrieved successfully",
    ),
  );
});

export const getAllCalls = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 100, type = "ALL" } = req.query;

    console.log("📋 Admin all calls request:", { page, limit, type });

    let whereClause = {};

    // Filter by call type if needed
    if (type === "AUDIO") {
      whereClause.callType = "AUDIO";
    } else if (type === "VIDEO") {
      whereClause.callType = "VIDEO";
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
      skip: (page - 1) * parseInt(limit),
      take: parseInt(limit),
    });

    const total = await prisma.call.count({
      where: whereClause,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          calls,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
        "All call records retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error fetching all call history:", error);
    throw new ApiError(500, error.message || "Failed to fetch all call history");
  }
});
