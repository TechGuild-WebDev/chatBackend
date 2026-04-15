import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { cloudinary } from "../utils/cloudinary.js";

// Create Group
export const createGroup = asyncHandler(async (req, res) => {
  try {
    const { name, memberIds = [] } = req.body;
    const currentUserId = req.user.id;

    console.log("CreateGroup - File received:", req.file);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Group name is required"
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
      const fs = await import('fs');
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    // Parse memberIds (same as before)
    let parsedMemberIds = [];
    if (memberIds) {
      if (typeof memberIds === 'string') {
        try {
          parsedMemberIds = JSON.parse(memberIds);
        } catch (e) {
          parsedMemberIds = memberIds.split(',').filter(id => id.trim());
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
              role: "MEMBER"
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
                email: true
              }
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

// Get my groups (with last message, unread)
export const getMyGroups = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * parseInt(limit);

    const [groupMemberships, totalCount] = await Promise.all([
      prisma.chatMember.findMany({
        where: { userId: req.user.id, room: { isGroup: true } },
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
                take: 10,
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
        skip,
        take: parseInt(limit),
      }),
      prisma.chatMember.count({
        where: { userId: req.user.id, room: { isGroup: true } },
      }),
    ]);

    const formattedGroups = await Promise.all(
      groupMemberships.map(async (membership) => {
        const room = membership.room;

        // FUNCTION: Check if message is a system message
        const isSystemMessage = (message) => {
          const content = message.content || '';
          return (
            message.type === "SYSTEM" ||
            (/added.*to the group/i.test(content) && /by.*/i.test(content)) ||
            (/removed.*from the group/i.test(content) && /by.*/i.test(content)) ||
            /renamed the group to/i.test(content) ||
            /Group renamed to.*by/i.test(content) ||
            /left the group/i.test(content) ||
            /joined the group/i.test(content) ||
            /created the group/i.test(content) ||
            (/added by/i.test(content) && !content.includes('"') && content.split(' ').length <= 5)
          );
        };

        // FILTER OUT system messages and get the last actual message
        const nonSystemMessages = room.messages.filter(msg => !isSystemMessage(msg));
        const lastActualMessage = nonSystemMessages[0] || room.messages[0] || null;

        const members = room.members.map((m) => ({
          id: m.user.id,
          username: m.user.username || m.user.name || "Unknown",
          avatarUrl: m.user.avatarUrl || null,
          role: m.role,
          mutedUntil: m.mutedUntil,
        }));

        const unreadCount = await prisma.messageStatus.count({
          where: {
            userId: req.user.id,
            message: {
              roomId: room.id,
              type: { not: "SYSTEM" }
            },
            status: {
              in: ["SENT", "DELIVERED"],
            },
          },
        });

        // FORMAT last message content based on type
        const formatLastMessageContent = (message) => {
          if (!message) return null;

          switch (message.type) {
            case 'IMAGE':
              return '📷 Photo';
            case 'VIDEO':
              return '🎥 Video';
            case 'AUDIO':
              return '🎵 Audio';
            case 'FILE':
              return '📄 File';
            case 'TEXT':
            default:
              return message.content || 'Message';
          }
        };

        const formattedLastMessage = lastActualMessage
          ? {
            id: lastActualMessage.id,
            content: formatLastMessageContent(lastActualMessage), // Use formatted content
            type: lastActualMessage.type,
            sender: lastActualMessage.sender
              ? {
                id: lastActualMessage.sender.id,
                username:
                  lastActualMessage.sender.username ||
                  lastActualMessage.sender.name ||
                  "Unknown",
                avatarUrl: lastActualMessage.sender.avatarUrl || null,
              }
              : null,
            createdAt: lastActualMessage.createdAt,
            fileName: lastActualMessage.fileName,
            mimeType: lastActualMessage.mimeType,
            mediaUrl: lastActualMessage.mediaUrl,
            thumbnailUrl: lastActualMessage.thumbnailUrl,
            rawContent: lastActualMessage.content,
            isSystem: isSystemMessage(lastActualMessage),
          }
          : null;

        // safer lastMessageTime fallback
        const lastMessageTime = lastActualMessage?.createdAt || room.updatedAt || room.createdAt;

        return {
          id: room.id,
          name: room.name || "Unnamed Group",
          avatarUrl: room.avatarUrl || null,
          lastMessage: formattedLastMessage,
          lastMessageTime,
          unreadCount,
          members,
          isPinned: membership.isPinned || false,
          isFavorite: membership.isFavorite || false,
          isMuted: membership.mutedUntil ? new Date(membership.mutedUntil) > new Date() : false,
          mutedUntil: membership.mutedUntil,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
          // ADD: Debug info
          _debug: {
            totalMessages: room.messages.length,
            nonSystemMessages: nonSystemMessages.length,
            lastMessageIsSystem: lastActualMessage ? isSystemMessage(lastActualMessage) : false
          }
        };
      })
    );

    formattedGroups.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    return res.status(200).json({
      success: true,
      data: {
        groups: formattedGroups,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      },
      message: "Groups fetched successfully",
    });
  } catch (error) {
    console.error("getMyGroups error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching groups",
      error: error.message,
    });
  }
});


// Get group details
export const getGroupDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;

    console.log("Fetching group details for:", id);

    // ADD: Same system message detection function
    const isSystemMessage = (message) => {
      const content = message.content || '';
      return (
        message.type === "SYSTEM" ||
        (/added.*to the group/i.test(content) && /by.*/i.test(content)) ||
        (/removed.*from the group/i.test(content) && /by.*/i.test(content)) ||
        /renamed the group to/i.test(content) ||
        /Group renamed to.*by/i.test(content) ||
        /left the group/i.test(content) ||
        /joined the group/i.test(content) ||
        /created the group/i.test(content) ||
        (/added by/i.test(content) && !content.includes('"') && content.split(' ').length <= 5)
      );
    };

    const group = await prisma.chatRoom.findUnique({
      where: {
        id,
        isGroup: true
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
                avatarUrl: true,
                isOnline: true,
                status: true,
                lastSeen: true
              },
            },
          },
          orderBy: { joinedAt: 'asc' }
        },
        messages: {
          take: 10,
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
    });

    if (!group) {
      console.log("Group not found:", id);
      throw new ApiError(404, "Group not found");
    }

    const userMembership = group.members.find(member => member.userId === currentUserId);
    if (!userMembership) {
      console.log("User not member of group:", currentUserId, id);
      throw new ApiError(403, "You are not a member of this group");
    }

    console.log("Group found:", group.name, "Members:", group.members.length);

    const unreadCount = await prisma.messageStatus.count({
      where: {
        userId: currentUserId,
        message: {
          roomId: group.id,
          type: { not: "SYSTEM" }
        },
        status: {
          in: ["SENT", "DELIVERED"]
        }
      }
    });

    const formattedMembers = group.members.map((member) => ({
      id: member.user.id,
      username: member.user.username || member.user.name || "Unknown",
      name: member.user.name || null,
      email: member.user.email || null,
      avatarUrl: member.user.avatarUrl || null,
      role: member.role,
      mutedUntil: member.mutedUntil,
      isOnline: member.user.isOnline,
      status: member.user.status,
      lastSeen: member.user.lastSeen,
      joinedAt: member.joinedAt,
    }));

    const nonSystemMessages = group.messages.filter(msg => !isSystemMessage(msg));
    const lastActualMessage = nonSystemMessages[0] || group.messages[0] || null;

    const formatLastMessageContent = (message) => {
      if (!message) return null;

      switch (message.type) {
        case 'IMAGE':
          return '📷 Photo';
        case 'VIDEO':
          return '🎥 Video';
        case 'AUDIO':
          return '🎵 Audio';
        case 'FILE':
          return '📄 File';
        case 'TEXT':
        default:
          return message.content || 'Message';
      }
    };

    const formattedLastMessage = lastActualMessage
      ? {
        id: lastActualMessage.id,
        content: formatLastMessageContent(lastActualMessage),
        type: lastActualMessage.type || "text",
        sender: lastActualMessage.sender
          ? {
            id: lastActualMessage.sender.id,
            username: lastActualMessage.sender.username || lastActualMessage.sender.name || "Unknown",
            avatarUrl: lastActualMessage.sender.avatarUrl || null,
          }
          : null,
        createdAt: lastActualMessage.createdAt,
        fileName: lastActualMessage.fileName,
        mimeType: lastActualMessage.mimeType,
        mediaUrl: lastActualMessage.mediaUrl,
        thumbnailUrl: lastActualMessage.thumbnailUrl,
      }
      : null;

    const onlineCount = formattedMembers.filter(member => member.isOnline).length;
    const totalMembers = formattedMembers.length;

    const responseData = {
      id: group.id,
      name: group.name || "Unnamed Group",
      description: group.description,
      avatarUrl: group.avatarUrl || null,
      lastMessage: formattedLastMessage,
      lastMessageTime: lastActualMessage?.createdAt || group.updatedAt || group.createdAt,
      unreadCount,
      members: formattedMembers,
      onlineCount,
      totalMembers,
      currentUserRole: userMembership.role,
      isPinned: userMembership.isPinned || false,
      isFavorite: userMembership.isFavorite || false,
      isMuted: userMembership.mutedUntil ? new Date(userMembership.mutedUntil) > new Date() : false,
      mutedUntil: userMembership.mutedUntil,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    return res.status(200).json({
      success: true,
      data: responseData,
      message: "Group details fetched successfully"
    });

  } catch (error) {
    console.error("getGroupDetails error:", error);

    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error fetching group details",
      error: error.message
    });
  }
});

// Rename group
export const renameGroup = asyncHandler(async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name } = req.body;
    const currentUserId = req.user.id;

    if (!name || name.trim().length === 0) {
      throw new ApiError(400, "Group name is required");
    }

    // Check if user is admin/owner of the group
    const userMembership = await prisma.chatMember.findFirst({
      where: {
        roomId: groupId,
        userId: currentUserId,
        role: { in: ["OWNER", "ADMIN"] }
      }
    });

    if (!userMembership) {
      throw new ApiError(403, "Only group admins or owners can rename the group");
    }

    // Update group name
    const updatedGroup = await prisma.chatRoom.update({
      where: {
        id: groupId,
        isGroup: true
      },
      data: {
        name: name.trim()
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
              }
            }
          }
        }
      }
    });

    // Create a system message for the rename
    await prisma.message.create({
      data: {
        content: `Group renamed to "${name}" by ${req.user.name || req.user.username}`,
        type: "SYSTEM",
        roomId: groupId,
        senderId: currentUserId,
      }
    });

    return res.status(200).json({
      success: true,
      data: updatedGroup,
      message: "Group renamed successfully"
    });

  } catch (error) {
    console.error("renameGroup error:", error);

    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error renaming group",
      error: error.message
    });
  }
});

// Add members to group
export const addMembers = asyncHandler(async (req, res) => {
  try {
    const { groupId } = req.params;
    const { memberIds = [] } = req.body;
    const currentUserId = req.user.id;

    if (!memberIds || memberIds.length === 0) {
      throw new ApiError(400, "Member IDs are required");
    }

    // Check if group exists and user is admin/owner
    const group = await prisma.chatRoom.findUnique({
      where: { id: groupId, isGroup: true },
      include: {
        members: true
      }
    });

    if (!group) throw new ApiError(404, "Group not found");

    const userMembership = group.members.find(m => m.userId === currentUserId);
    if (!userMembership || !["OWNER", "ADMIN"].includes(userMembership.role)) {
      throw new ApiError(403, "Only group owners or admins can add members");
    }

    // Filter out existing members
    const existingMemberIds = group.members.map(m => m.userId);
    const newMemberIds = memberIds.filter(id => !existingMemberIds.includes(id));

    if (newMemberIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Members are already in the group"
      });
    }

    // Add new members
    await prisma.chatMember.createMany({
      data: newMemberIds.map(id => ({
        roomId: groupId,
        userId: id,
        role: "MEMBER"
      }))
    });

    // Create system message
    const membersList = await prisma.user.findMany({
      where: { id: { in: newMemberIds } },
      select: { username: true }
    });
    const usernames = membersList.map(u => u.username).join(", ");

    await prisma.message.create({
      data: {
        content: `${usernames} added to the group by ${req.user.name || req.user.username}`,
        type: "SYSTEM",
        roomId: groupId,
        senderId: currentUserId
      }
    });

    return res.status(200).json({
      success: true,
      message: `${newMemberIds.length} members added successfully`
    });

  } catch (error) {
    console.error("addMembers error:", error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Error adding members", error: error.message });
  }
});

// Toggle favorite (Placeholder - Persisted via AsyncStorage in Frontend)
export const toggleFavorite = asyncHandler(async (req, res) => {
  try {
    const { groupId } = req.params;
    // Note: Database persistence for favorites is not yet implemented in the schema.
    // Currently relying on Frontend AsyncStorage.
    return res.status(200).json({
      success: true,
      message: "Favorite toggled",
      groupId
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error toggling favorite" });
  }
});

// Remove member from group
export const removeMember = asyncHandler(async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const currentUserId = req.user.id;

    // Check if group exists and user is admin/owner
    const group = await prisma.chatRoom.findUnique({
      where: { id: groupId, isGroup: true },
      include: {
        members: true
      }
    });

    if (!group) throw new ApiError(404, "Group not found");

    const userMembership = group.members.find(m => m.userId === currentUserId);
    if (!userMembership || !["OWNER", "ADMIN"].includes(userMembership.role)) {
      throw new ApiError(403, "Only group owners or admins can remove members");
    }

    // Check if target user is in the group
    const targetMembership = group.members.find(m => m.userId === userId);
    if (!targetMembership) throw new ApiError(404, "Member not found in this group");

    // Cannot remove owner
    if (targetMembership.role === "OWNER") {
      throw new ApiError(400, "Group owner cannot be removed");
    }

    // Admins cannot remove other admins (only owner can)
    if (userMembership.role === "ADMIN" && targetMembership.role === "ADMIN") {
      throw new ApiError(403, "Admins cannot remove other admins");
    }

    // Remove the member
    await prisma.chatMember.delete({
      where: {
        userId_roomId: {
          userId: userId,
          roomId: groupId
        }
      }
    });

    // Create system message
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });

    await prisma.message.create({
      data: {
        content: `${targetUser.username} removed from the group by ${req.user.name || req.user.username}`,
        type: "SYSTEM",
        roomId: groupId,
        senderId: currentUserId
      }
    });

    return res.status(200).json({
      success: true,
      message: "Member removed successfully"
    });

  } catch (error) {
    console.error("removeMember error:", error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: "Error removing member", error: error.message });
  }
});




