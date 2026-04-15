import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Pin/Unpin Chat
export const togglePinChat = asyncHandler(async (req, res) => {
  const { roomId, groupId } = req.body;
  const targetId = roomId || groupId;
  const userId = req.user.id;
  if (!targetId) throw new Error("Room/Group ID is required");

  let membership = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId, roomId: targetId } },
  });
  if (!membership)
    return res
      .status(404)
      .json({ success: false, message: "Membership not found" });

  const updated = await prisma.chatMember.update({
    where: { userId_roomId: { userId, roomId: targetId } },
    data: { isPinned: !membership.isPinned },
  });

  // Emit socket event to the user's personal room
  const io = req.app.get("io");
  if (io) {
    io.to(`user_${userId}`).emit("chat-settings-updated", {
      roomId: targetId,
      isPinned: updated.isPinned,
      type: 'PIN'
    });
  }

  res.status(200).json({
    success: true,
    data: updated,
    message: updated.isPinned ? "Chat pinned" : "Chat unpinned",
  });
});

// Mute/Unmute Chat
export const toggleMuteChat = asyncHandler(async (req, res) => {
  const { roomId, groupId } = req.body;
  const targetId = roomId || groupId;
  const userId = req.user.id;
  if (!targetId) throw new Error("Room/Group ID is required");

  let membership = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId, roomId: targetId } },
  });

  if (!membership) {
    // If it's a 1:1 chat that hasn't been initialized fully, try to create membership?
    // Actually, getChats should have created it.
    return res
      .status(404)
      .json({ success: false, message: "Chat membership not found" });
  }

  const updated = await prisma.chatMember.update({
    where: { userId_roomId: { userId, roomId: targetId } },
    data: { mutedUntil: membership.mutedUntil ? null : new Date("9999-12-31") },
  });

  // Emit socket event to the user's personal room
  const io = req.app.get("io");
  if (io) {
    io.to(`user_${userId}`).emit("chat-settings-updated", {
      roomId: targetId,
      muted: !!updated.mutedUntil,
      type: 'MUTE'
    });
  }

  res.status(200).json({
    success: true,
    data: updated,
    message: updated.mutedUntil ? "Chat muted" : "Chat unmuted",
  });
});

// Favorite/Unfavorite Chat
export const toggleFavoriteChat = asyncHandler(async (req, res) => {
  const { roomId, groupId } = req.body;
  const targetId = roomId || groupId;
  const userId = req.user.id;
  if (!targetId) throw new Error("Room/Group ID is required");

  let membership = await prisma.chatMember.findUnique({
    where: { userId_roomId: { userId, roomId: targetId } },
  });
  
  if (!membership)
    return res
      .status(404)
      .json({ success: false, message: "Membership not found" });

  const updated = await prisma.chatMember.update({
    where: { userId_roomId: { userId, roomId: targetId } },
    data: { isFavorite: !membership.isFavorite },
  });

  // Emit socket event to the user's personal room
  const io = req.app.get("io");
  if (io) {
    io.to(`user_${userId}`).emit("chat-settings-updated", {
      roomId: targetId,
      isFavorite: updated.isFavorite,
      type: 'FAVORITE'
    });
  }

  res.status(200).json({
    success: true,
    data: updated,
    message: updated.isFavorite ? "Chat added to favorites" : "Chat removed from favorites",
  });
});
