import prisma from "../prisma.js";
import { cloudinary } from "../utils/cloudinary.js";
import { reminderService } from "../services/reminderService.js";
import { sendChatNotification } from "../services/notificationService.js"; // NOTIFICATION SERVICE IMPORT KARO

// Helper function to format URLs for display with truncation
const formatUrlForDisplay = (url, maxLength = 50) => {
  if (!url) return "";

  // If URL is short, show it fully
  if (url.length <= maxLength) return url;

  // For long URLs, truncate but keep it copyable as full URL
  const start = url.substring(0, 25);
  const end = url.substring(url.length - 20);
  return `${start}...${end}`;
};

// Helper function to make URLs clickable (simple approach)
const makeUrlClickable = (url) => {
  if (!url) return "";
  return formatUrlForDisplay(url);
};

// FIX: Safe IO getter function
const getIO = (req) => {
  try {
    // Try to get io from app first
    if (req.app && req.app.get) {
      const io = req.app.get("io");
      if (io) return io;
    }

    // Fallback to global.io
    if (global.io) {
      return global.io;
    }

    console.warn("IO instance not available in meeting controller");
    return null;
  } catch (error) {
    console.error("Error getting IO instance:", error);
    return null;
  }
};

// Create a new meeting with invitation message
export const createMeeting = async (req, res) => {
  const {
    title,
    agenda,
    date,
    participantsEmails,
    recurring,
    inviteLink,
    reminder,
    attachfile,
    groupIds,
  } = req.body;

  const creatorId = req.user.id;

  try {
    let attachfileUrl = null;
    let uploadedFiles = [];

    // Handle file uploads to Cloudinary
    if (attachfile && attachfile.length > 0) {
      for (const file of attachfile) {
        try {
          if (file.base64) {
            // Upload base64 data directly WITHOUT upload preset
            const uploadResult = await cloudinary.uploader.upload(file.base64, {
              folder: "meeting_attachments",
              resource_type: "auto",
            });

            uploadedFiles.push({
              url: uploadResult.secure_url,
              name: file.name || "Meeting Attachment",
              type: file.type || "application/octet-stream",
              size: uploadResult.bytes,
              public_id: uploadResult.public_id,
            });
          } else if (file.uri) {
            // Upload from URI WITHOUT upload preset
            const uploadResult = await cloudinary.uploader.upload(file.uri, {
              folder: "meeting_attachments",
              resource_type: "auto",
            });

            uploadedFiles.push({
              url: uploadResult.secure_url,
              name: file.name || "Meeting Attachment",
              type: file.type || "application/octet-stream",
              size: uploadResult.bytes,
              public_id: uploadResult.public_id,
            });
          }
        } catch (fileError) {
          console.error(`Failed to upload file ${file.name}:`, fileError);
        }
      }

      // Store the first file URL as the main attachment
      if (uploadedFiles.length > 0) {
        attachfileUrl = uploadedFiles[0].url;
      }
    }

    // Parse the date properly with timezone info
    const meetingDate = new Date(date);

    // Validate the date
    if (isNaN(meetingDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    const allowedReminders = ["5", "10", "15"];
    const finalReminder = allowedReminders.includes(reminder) ? reminder : "10";

    // Format date for display in message
    const formattedDate = meetingDate.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    // Get creator info
    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      select: { username: true, email: true },
    });

    // Get participants by email
    let participants = [];
    if (participantsEmails && participantsEmails.length > 0) {
      participants = await prisma.user.findMany({
        where: {
          email: { in: participantsEmails },
        },
        select: { id: true, username: true, email: true },
      });
    }

    // Get groups if groupIds provided
    let groups = [];
    if (groupIds && groupIds.length > 0) {
      groups = await prisma.chatRoom.findMany({
        where: {
          id: { in: groupIds },
        },
        include: {
          members: {
            include: {
              user: {
                select: { id: true, username: true, email: true },
              },
            },
          },
        },
      });
    }

    // Create the meeting
    const newMeeting = await prisma.meeting.create({
      data: {
        title,
        agenda: agenda || "",
        date: meetingDate,
        recurring: recurring || "None",
        inviteLink: inviteLink || "",
        reminder: finalReminder,
        attachfile: attachfileUrl,
        createdBy: creatorId,
        reminderSent: false,
        reminderTime: new Date(
          meetingDate.getTime() - finalReminder * 60 * 1000
        ),
        // Connect participants by their IDs
        participants:
          participants.length > 0
            ? {
              connect: participants.map((p) => ({ id: p.id })),
            }
            : undefined,
        // Connect groups by their IDs
        groups:
          groups.length > 0
            ? {
              connect: groups.map((g) => ({ id: g.id })),
            }
            : undefined,
      },
      include: {
        participants: {
          select: { id: true, username: true, email: true, avatarUrl: true },
        },
        creator: {
          select: { id: true, username: true, email: true, avatarUrl: true },
        },
        groups: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, username: true, email: true },
                },
              },
            },
          },
        },
      },
    });

    // STEP 1: GET ALL PARTICIPANT IDs FOR FCM NOTIFICATIONS
    let allParticipantIds = new Set();

    // Add individual participants
    if (participants.length > 0) {
      participants.forEach(p => {
        if (p.id !== creatorId) { // Creator ko exclude karo
          allParticipantIds.add(p.id);
        }
      });
    }

    // Add group members
    if (groups.length > 0) {
      groups.forEach(group => {
        group.members.forEach(member => {
          if (member.userId !== creatorId) { // Creator ko exclude karo
            allParticipantIds.add(member.userId);
          }
        });
      });
    }

    const participantIdsArray = Array.from(allParticipantIds);
    console.log('Meeting notification participants:', participantIdsArray);

    // STEP 2: SEND FCM NOTIFICATIONS FOR MEETING
    if (participantIdsArray.length > 0) {
      try {
        // Format meeting date for notification
        const meetingDateTime = meetingDate.toLocaleString("en-US", {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        // Notification content
        const notificationContent = `Meeting: ${title}\n${meetingDateTime}`;

        // Send notifications to all participants
        await sendChatNotification(participantIdsArray, {
          roomId: 'meeting-' + newMeeting.id, // Virtual room ID
          messageId: newMeeting.id,
          senderId: creatorId,
          senderName: creator.username || "Meeting Organizer",
          content: notificationContent,
          type: 'MEETING_INVITATION',
          // MEETING SPECIFIC DATA
          meetingId: newMeeting.id,
          meetingTitle: title,
          meetingDate: meetingDate.toISOString(),
          meetingLink: inviteLink || '',
          // GROUP NAME ADD KARO (Agar group meeting hai toh)
          groupName: groups.length > 0 ? groups[0]?.name : "Meeting"
        });

        console.log(`Meeting notifications sent to ${participantIdsArray.length} participants`);
      } catch (notificationError) {
        console.error('Meeting notification error:', notificationError);
        // Don't fail the whole request if notification fails
      }
    }

    // Create invitation message
    let invitationMessage = `Dear Team,\nYou are requested to join the meeting on "${title}" as per the details below:\n\n`;
    invitationMessage += `Date: ${meetingDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}\n`;
    invitationMessage += `Time: ${meetingDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    })}\n`;

    // ENHANCED: Format invite link with URL detection
    if (inviteLink) {
      invitationMessage += `Venue/Link: ${makeUrlClickable(inviteLink)}\n`;
    } else {
      invitationMessage += `Venue/Link: To be specified\n`;
    }

    // ENHANCED: Add attachment information with properly formatted URLs
    if (uploadedFiles.length > 0) {
      invitationMessage += `\n📎 Attached Files:\n`;
      uploadedFiles.forEach((file, index) => {
        invitationMessage += ` ${makeUrlClickable(file.url)}\n\n`;
      });
    }

    if (agenda) {
      invitationMessage += `\n📋 Agenda:\n`;
      if (Array.isArray(agenda)) {
        agenda.forEach((point, index) => {
          invitationMessage += `${index + 1}. ${point}\n`;
        });
      } else {
        const agendaPoints = agenda.split("\n").filter((point) => point.trim());
        agendaPoints.forEach((point, index) => {
          invitationMessage += `${index + 1}. ${point}\n`;
        });
      }
    }

    invitationMessage += `\nYour presence and valuable inputs are highly appreciated.\n\nRegards,\n${creator.username}`;

    // For group messages, create an even shorter version
    const groupMessageContent = `New Meeting: ${title}\n${formattedDate}${agenda
      ? `\n📝 ${agenda.substring(0, 100)}${agenda.length > 100 ? "..." : ""}`
      : ""
      }`;

    const MAX_MESSAGE_LENGTH = 1000;
    if (invitationMessage.length > MAX_MESSAGE_LENGTH) {
      invitationMessage =
        invitationMessage.substring(0, MAX_MESSAGE_LENGTH - 3) + "...";
    }

    // FIX: Use safe IO getter
    const io = getIO(req);

    // Send invitation messages to individual participants
    if (participants.length > 0) {
      for (const participant of participants) {
        if (participant.id === creatorId) continue; // Skip creator

        try {
          // Find or create a direct message room between creator and participant
          let directRoom = await prisma.chatRoom.findFirst({
            where: {
              roomType: "DIRECT",
              members: {
                every: {
                  userId: { in: [creatorId, participant.id] },
                },
              },
            },
            include: { members: true },
          });

          // If no direct room exists, create one
          if (!directRoom) {
            directRoom = await prisma.chatRoom.create({
              data: {
                name: `Direct-${creatorId}-${participant.id}`,
                roomType: "DIRECT",
                members: {
                  create: [
                    { userId: creatorId, role: "MEMBER" },
                    { userId: participant.id, role: "MEMBER" },
                  ],
                },
              },
              include: { members: true },
            });
          }

          // Create the meeting invitation message
          const validMessageType = "MEETING_INVITATION";

          const invitationMsg = await prisma.message.create({
            data: {
              roomId: directRoom.id,
              senderId: creatorId,
              content: invitationMessage,
              type: validMessageType,
              createdAt: new Date(),
            },
            include: {
              sender: {
                select: { id: true, username: true, avatarUrl: true },
              },
            },
          });

          // Create message status for the participant
          await prisma.messageStatus.create({
            data: {
              messageId: invitationMsg.id,
              userId: participant.id,
              status: "SENT",
            },
          });

          // ADD FCM NOTIFICATION FOR DIRECT MESSAGE
          await sendChatNotification([participant.id], {
            roomId: directRoom.id,
            messageId: invitationMsg.id,
            senderId: creatorId,
            senderName: creator.username || "Meeting Organizer",
            content: `Meeting Invitation: ${title}`,
            type: 'MEETING_INVITATION',
            meetingId: newMeeting.id,
            meetingTitle: title
          });

          // FIX: Emit the message via socket with safe check
          if (io) {
            io.to(directRoom.id).emit("new-message", {
              ...invitationMsg,
              roomId: directRoom.id,
            });

            // Also emit a meeting-specific event
            io.to(participant.id.toString()).emit("meeting-invitation", {
              meeting: newMeeting,
              message: invitationMessage,
              invitedBy: creator.username,
              timestamp: new Date(),
            });
          } else {
            console.warn(`IO not available for participant ${participant.id}`);
          }
        } catch (error) {
          console.error(
            `Failed to send invitation to ${participant.username}:`,
            error
          );
        }
      }
    }

    // Send group meeting invitations
    if (groups.length > 0) {
      for (const group of groups) {
        try {
          // Create group invitation message using the template
          let groupInvitationMessage = `Dear Team,\nYou are requested to join the meeting on ${title} as per the details below:\n\n`;
          groupInvitationMessage += `Date: ${meetingDate.toLocaleDateString(
            "en-US",
            {
              year: "numeric",
              month: "long",
              day: "numeric",
            }
          )}\n`;
          groupInvitationMessage += `Time: ${meetingDate.toLocaleTimeString(
            "en-US",
            { hour: "2-digit", minute: "2-digit" }
          )}\n`;

          // ENHANCED: Format group invite link
          if (inviteLink) {
            groupInvitationMessage += `Venue/Link: ${makeUrlClickable(
              inviteLink
            )}\n`;
          } else {
            groupInvitationMessage += `Venue/Link: To be specified\n`;
          }

          // ENHANCED: Group attachments with properly formatted URLs
          if (uploadedFiles.length > 0) {
            groupInvitationMessage += `\n📎 Attached Files:\n`;
            uploadedFiles.forEach((file, index) => {
              groupInvitationMessage += ` ${makeUrlClickable(file.url)}\n\n`;
            });
          } else if (attachfileUrl) {
            groupInvitationMessage += `\n📎 Attached File:\n`;
            groupInvitationMessage += `🔗 ${formatUrlForDisplay(
              attachfileUrl
            )}\n`;
          }

          if (agenda) {
            groupInvitationMessage += `\n📋 Agenda:\n`;
            if (Array.isArray(agenda)) {
              agenda.forEach((point, index) => {
                groupInvitationMessage += `${index + 1}. ${point}\n`;
              });
            } else {
              const agendaPoints = agenda
                .split("\n")
                .filter((point) => point.trim());
              agendaPoints.forEach((point, index) => {
                groupInvitationMessage += `${index + 1}. ${point}\n`;
              });
            }
          }

          groupInvitationMessage += `\nYour presence and valuable inputs are highly appreciated.\n\nBest regards,\n${creator.username}`;

          // Create the group message with meeting ID
          const groupMessage = await prisma.message.create({
            data: {
              roomId: group.id,
              senderId: creatorId,
              content: groupInvitationMessage,
              type: "MEETING_INVITATION",
              meetingId: newMeeting.id,
              createdAt: new Date(),
            },
            include: {
              sender: {
                select: { id: true, username: true, avatarUrl: true },
              },
            },
          });

          // Create message status for all group members
          const messageStatusPromises = group.members.map((member) =>
            prisma.messageStatus.create({
              data: {
                messageId: groupMessage.id,
                userId: member.userId,
                status: "SENT",
              },
            })
          );

          await Promise.all(messageStatusPromises);

          // ADD FCM NOTIFICATION FOR GROUP MEMBERS
          const groupMemberIds = group.members
            .map(member => member.userId)
            .filter(userId => userId !== creatorId);

          if (groupMemberIds.length > 0) {
            await sendChatNotification(groupMemberIds, {
              roomId: group.id,
              messageId: groupMessage.id,
              senderId: creatorId,
              senderName: creator.username || "Meeting Organizer",
              content: `Meeting in ${group.name}: ${title}`,
              type: 'MEETING_INVITATION',
              meetingId: newMeeting.id,
              meetingTitle: title,
              groupName: group.name // GROUP NAME INCLUDED
            });
          }

          // FIX: Emit to group room with proper data and safe check
          if (io) {
            io.to(group.id).emit("new-message", {
              ...groupMessage,
              roomId: group.id,
            });

            // Emit meeting invitation event to all group members
            group.members.forEach((member) => {
              io.to(member.userId.toString()).emit("meeting-invitation", {
                meeting: newMeeting,
                message: groupInvitationMessage,
                invitedBy: creator.username,
                groupName: group.name,
                timestamp: new Date(),
              });
            });
          } else {
            console.warn(`IO not available for group ${group.id}`);
          }
        } catch (error) {
          console.error(
            `Failed to send group announcement to ${group.name}:`,
            error
          );
        }
      }
    }

    // FIX: Schedule reminder with safe IO check
    try {
      await reminderService.scheduleMeetingReminder(newMeeting, io);
    } catch (reminderError) {
      console.error("Error scheduling reminder:", reminderError);
      // Don't fail the whole request if reminder scheduling fails
    }

    res.status(200).json({
      success: true,
      message: "Meeting created successfully and invitations sent.",
      meeting: newMeeting,
    });
  } catch (error) {
    console.error("Error creating meeting:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create meeting.",
      error: error.message,
    });
  }
};

// Add new function to get meeting reminders
export const getMeetingReminders = async (req, res) => {
  try {
    const userId = req.user.id;

    const reminders = await prisma.meetingReminder.findMany({
      where: {
        userId: userId,
        status: "SENT",
      },
      include: {
        meeting: {
          include: {
            creator: {
              select: { username: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: {
        sentAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      reminders,
    });
  } catch (error) {
    console.error("Error fetching meeting reminders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch meeting reminders",
    });
  }
};

export const getMeetings = async (req, res) => {
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
    console.error("Error fetching meetings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch meetings",
    });
  }
};

export const getMeeting = async (req, res) => {
  const { id } = req.params;

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id },
      include: {
        participants: true,
        groups: true,
        creator: true,
      },
    });

    if (!meeting) {
      return res
        .status(404)
        .json({ success: false, message: "Meeting not found" });
    }

    res.status(200).json({ success: true, meeting });
  } catch (error) {
    console.error("Error fetching meeting:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch meeting" });
  }
};

// Test reminder function
export const triggerTestReminder = async (req, res) => {
  try {
    const { meetingId } = req.params;
    await reminderService.sendMeetingReminder(meetingId);

    res.status(200).json({
      success: true,
      message: "Reminder triggered successfully",
    });
  } catch (error) {
    console.error("Error triggering reminder:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger reminder",
    });
  }
};