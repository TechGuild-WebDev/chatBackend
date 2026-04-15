// Get calls for a room (to display in chat)
import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

export const getRoomCalls = asyncHandler(async (req, res) => {
    try {
        const { roomId } = req.params;
        const userId = req.user?.id;

        if (!userId) throw new ApiError(401, "Unauthorized");

        // Check membership
        const membership = await prisma.chatMember.findUnique({
            where: { userId_roomId: { userId, roomId } },
        });
        if (!membership) throw new ApiError(403, "You are not a member of this room");

        // Get room members to find participants
        const members = await prisma.chatMember.findMany({
            where: { roomId },
            select: { userId: true },
        });

        const memberIds = members.map(m => m.userId);

        // Fetch calls where both participants are in this room
        const calls = await prisma.call.findMany({
            where: {
                AND: [
                    { callerId: { in: memberIds } },
                    { receiverId: { in: memberIds } },
                ],
            },
            include: {
                caller: {
                    select: { id: true, username: true, name: true, avatarUrl: true },
                },
                receiver: {
                    select: { id: true, username: true, name: true, avatarUrl: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 50, // Limit to recent 50 calls
        });

        // Transform calls to match message format
        const transformedCalls = calls.map(call => ({
            id: call.id,
            type: 'CALL_LOG',
            callType: call.callType === 'VIDEO' ? 'video' : 'voice',
            callStatus: call.status.toLowerCase(), // 'ended', 'missed', etc.
            duration: call.duration || 0,
            content: `${call.callType === 'VIDEO' ? 'Video' : 'Voice'} call`,
            senderId: call.callerId,
            sender: call.caller,
            createdAt: call.createdAt,
            receiverId: call.receiverId,
            receiver: call.receiver,
        }));

        res.status(200).json(new ApiResponse(200, { calls: transformedCalls }, "Calls fetched successfully"));
    } catch (error) {
        console.error("Get room calls error:", error);
        throw new ApiError(
            error.statusCode || 500,
            error.message || "Failed to fetch calls"
        );
    }
});
