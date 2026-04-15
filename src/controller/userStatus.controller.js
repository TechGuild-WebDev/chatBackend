import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Update user online status
export const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const userId = req.user.id;

  if (!status || !["online", "offline", "away"].includes(status)) {
    throw new ApiError(400, "Valid status (online/offline/away) is required");
  }

  const updateData = {
    isOnline: status === "online",
    status: status,
  };

  // Only set lastSeen when going offline
  if (status === "offline") {
    updateData.lastSeen = new Date();
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      username: true,
      email: true,
      isOnline: true,
      status: true,
      lastSeen: true,
    },
  });

  // Emit socket event for real-time status updates
  const io = req.app.get("io");
  io.emit("user-status", {
    userId: user.id,
    status: user.status,
    lastSeen: user.lastSeen,
  });

  res.json(
    new ApiResponse(200, user, `Status updated to ${status} successfully`)
  );
});

// Get user status
export const getUserStatus = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // Try find by ID first
  let user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      isOnline: true,
      status: true,
      lastSeen: true,
    },
  });

  // If not found by ID, try username
  if (!user) {
    user = await prisma.user.findFirst({
      where: { username: userId },
      select: {
        id: true,
        username: true,
        email: true,
        isOnline: true,
        status: true,
        lastSeen: true,
      },
    });
  }

  // If not found by username, try email (optional fallback)
  if (!user && userId.includes("@")) {
    user = await prisma.user.findFirst({
      where: { email: userId },
      select: {
        id: true,
        username: true,
        email: true,
        isOnline: true,
        status: true,
        lastSeen: true,
      },
    });
  }

  // If still not found, return 404
  if (!user) {
    throw new ApiError(404, `User not found for id/username: ${userId}`);
  }

  // Return status
  return res.json(
    new ApiResponse(
      200,
      {
        userId: user.id,
        status:
          user.status && ["online", "offline", "away"].includes(user.status)
            ? user.status
            : user.isOnline
            ? "online"
            : "offline",
        lastSeen: user.lastSeen,
      },
      "User status retrieved successfully"
    )
  );
});

// Get multiple users status
export const getUsersStatus = asyncHandler(async (req, res) => {
  const { userIds } = req.body;

  if (!userIds || !Array.isArray(userIds)) {
    throw new ApiError(400, "User IDs array is required");
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
    select: {
      id: true,
      username: true,
      isOnline: true,
      lastSeen: true,
    },
  });

  const statuses = users.map((user) => ({
    userId: user.id,
    status: user.isOnline ? "online" : "offline",
    lastSeen: user.lastSeen,
  }));

  res.json(
    new ApiResponse(200, statuses, "Users status retrieved successfully")
  );
});
