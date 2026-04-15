import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Create or get a 1:1 room
export const createOrGetChatRoom = asyncHandler(async (req, res) => {
  const { participantId } = req.body;
  const currentUserId = req.user.id;

  if (!participantId) {
    return res.status(400).json({ success: false, message: "Participant ID is required" });
  }

  try {
    // OPTIMIZED: Fast room existence check (NO messages include)
    let room = await prisma.chatRoom.findFirst({
      where: {
        isGroup: false,
        AND: [
          { members: { some: { userId: currentUserId } } },
          { members: { some: { userId: participantId } } },
        ],
      },
      select: { id: true } // ONLY get what we need
    });

    // OPTIMIZED: Fast room creation (NO messages include)
    if (!room) {
      room = await prisma.chatRoom.create({
        data: {
          isGroup: false,
          members: {
            create: [{ userId: currentUserId }, { userId: participantId }],
          },
        },
        select: { id: true } // ONLY get what we need
      });
    }

    // OPTIMIZED: Get room details separately (only if room exists)
    const roomDetails = await prisma.chatRoom.findUnique({
      where: { id: room.id },
      include: {
        members: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
      },
    });

    const otherParticipant = roomDetails.members.find(
      (m) => m.userId !== currentUserId
    )?.user;

    // OPTIMIZED: Simple response (NO lastMessage - get it in chat.jsx)
    const formattedRoom = {
      id: room.id,
      isGroup: false,
      name: otherParticipant?.username || "Unknown",
      avatarUrl: otherParticipant?.avatarUrl || null,
      // REMOVED: lastMessage - not needed for navigation
    };

    return res.status(200).json({
      success: true,
      message: "Room created or found",
      data: formattedRoom,
    });

  } catch (error) {
    console.error("Room creation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create or get room"
    });
  }
});
// Get my rooms (all)
export const getMyRooms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  const [roomMemberships, totalCount] = await Promise.all([
    prisma.chatMember.findMany({
      where: { userId: req.user.id },
      include: {
        room: {
          include: {
            members: {
              include: {
                user: { select: { id: true, username: true, avatarUrl: true } },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: "desc" },
              include: { sender: { select: { username: true } } },
            },
          },
        },
      },
      orderBy: { room: { updatedAt: "desc" } },
      skip,
      take: parseInt(limit),
    }),
    prisma.chatMember.count({ where: { userId: req.user.id } }),
  ]);

  const formattedRooms = roomMemberships.map((membership) => {
    const room = membership.room;
    const lastMessage = room.messages[0];

    const members = room.members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      avatarUrl: member.user.avatarUrl,
      role: member.role,
    }));

    return {
      id: room.id,
      name: room.name,
      isGroup: room.isGroup,
      avatarUrl: room.avatarUrl,
      lastMessage: lastMessage?.content || "No messages yet",
      lastMessageTime: lastMessage?.createdAt || room.updatedAt,
      members,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        rooms: formattedRooms,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      },
      "Rooms fetched successfully"
    )
  );
});

// Get room details (any room)
export const getRoomDetails = asyncHandler(async (req, res) => {
  const { roomId } = req.params;

  const membership = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId: req.user.id, roomId } },
  });
  if (!membership) throw new ApiError(403, "You are not a member of this room");

  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      messages: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          sender: { select: { id: true, username: true, avatarUrl: true } },
        },
      },
    },
  });

  const formattedRoom = {
    ...room,
    members: room.members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
  };

  res
    .status(200)
    .json(
      new ApiResponse(200, formattedRoom, "Room details fetched successfully")
    );
});
