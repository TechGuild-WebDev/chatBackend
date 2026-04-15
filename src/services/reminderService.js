import prisma from "../prisma.js";
import { sendReminderMessage } from "./messageService.js";

class ReminderService {
  constructor() {
    this.jobs = new Map();
    this.io = null;
  }

  // Keep the existing scheduleMeetingReminder function as is
  async scheduleMeetingReminder(meeting, io = null) {
    if (io) {
      this.io = io;
    }
    try {
      const meetingDate = new Date(meeting.date);
      const reminderMinutes = parseInt(meeting.reminder) || 10;

      // Calculate reminder time (meeting time - reminder minutes)
      const reminderTime = new Date(
        meetingDate.getTime() - reminderMinutes * 60 * 1000
      );
      const now = new Date();

      // If reminder time is in the past, don't schedule
      if (reminderTime < now) {
        console.log(
          `Reminder time for meeting ${meeting.id} is in the past`
        );
        console.log(
          `   Time difference: ${now - reminderTime}ms (${Math.round(
            (now - reminderTime) / 1000 / 60
          )} minutes in past)`
        );
        return;
      }

      // Calculate delay in milliseconds
      const delay = reminderTime.getTime() - now.getTime();

      // Schedule the job
      const job = setTimeout(async () => {
        try {
          console.log(`REMINDER TRIGGERED for meeting ${meeting.id}`);
          console.log(`   Trigger time: ${new Date().toLocaleString()}`);
          await this.sendMeetingReminder(meeting.id);
        } catch (error) {
          console.error(
            `Error sending reminder for meeting ${meeting.id}:`,
            error
          );
        }
      }, delay);

      // Store job reference
      this.jobs.set(meeting.id, job);

      console.log(`Reminder scheduled for meeting ${meeting.id}`);
    } catch (error) {
      console.error(
        `Error scheduling reminder for meeting ${meeting.id}:`,
        error
      );
    }
  }

  // FIXED: Send reminder for a specific meeting with proper group handling
  async sendMeetingReminder(meetingId) {
    try {
      // Get meeting with participants, groups, and creator
      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: {
          participants: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarUrl: true,
            },
          },
          creator: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarUrl: true,
            },
          },
          groups: {
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
          },
        },
      });

      if (!meeting) {
        console.log(`Meeting ${meetingId} not found`);
        return;
      }

      // Format meeting date
      const meetingDate = new Date(meeting.date);
      const formattedDate = meetingDate.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });

      // Create reminder message using the template
      let reminderMessage = `Meeting Reminder\nDear Team,\nThis is a kind reminder for the ${meeting.title} meeting scheduled as follows:\n`;
      reminderMessage += `Date: ${formattedDate}\n`;
      reminderMessage += `Time: ${meetingDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })}\n`;
      reminderMessage += `Venue/Link: ${meeting.inviteLink || "To be specified"
        }\n\n`;
      reminderMessage += `We look forward to your participation.\n\nRegards,\n${meeting.creator.username}`;

      // FIXED: Collect all participants including group members
      const allParticipants = new Map();

      // Add direct participants
      meeting.participants.forEach((participant) => {
        allParticipants.set(participant.id, participant);
      });

      // FIXED: Add group members properly
      if (meeting.groups && meeting.groups.length > 0) {
        console.log(
          `Processing ${meeting.groups.length} groups for reminders`
        );

        for (const group of meeting.groups) {
          console.log(
            `   Group: ${group.name} with ${group.members.length} members`
          );

          for (const member of group.members) {
            if (member.user && !allParticipants.has(member.user.id)) {
              allParticipants.set(member.user.id, member.user);
              console.log(`   Added group member: ${member.user.username}`);
            }
          }
        }
      }

      // Convert map to array
      const participantsArray = Array.from(allParticipants.values());

      console.log(
        `📨 Sending reminders to ${participantsArray.length} participants`
      );

      // Send reminder to each participant
      for (const participant of participantsArray) {
        try {
          // Skip if participant is the creator (they already know)
          if (participant.id === meeting.creator.id) {
            continue;
          }

          await sendReminderMessage({
            meeting,
            participant,
            creator: meeting.creator,
            message: reminderMessage,
          });

          // Log reminder sent
          await prisma.meetingReminder.create({
            data: {
              meetingId: meeting.id,
              userId: participant.id,
              status: "SENT",
            },
          });

          console.log(`Reminder sent to ${participant.username}`);
        } catch (error) {
          console.error(
            `Failed to send reminder to ${participant.username}:`,
            error
          );

          // Log failed reminder
          await prisma.meetingReminder.create({
            data: {
              meetingId: meeting.id,
              userId: participant.id,
              status: "FAILED",
            },
          });
        }
      }

      // FIXED: Also send group reminder messages to group chats
      if (meeting.groups && meeting.groups.length > 0) {
        await this.sendGroupReminderMessages(meeting, reminderMessage);
      }

      // Mark meeting as reminder sent
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { reminderSent: true },
      });

      // Remove job from tracking
      this.jobs.delete(meeting.id);

      console.log(`All reminders completed for meeting: ${meeting.title}`);
    } catch (error) {
      console.error(
        `Error in sendMeetingReminder for meeting ${meetingId}:`,
        error
      );
    }
  }

  // NEW: Send reminder messages to group chats
  async sendGroupReminderMessages(meeting, reminderMessage) {
    try {
      for (const group of meeting.groups) {
        try {
          // Create group reminder message using the template
          const groupReminderContent =
            `Meeting Reminder\nDear Team,\nThis is a kind reminder for the ${meeting.title} meeting scheduled as follows:\n` +
            `Date: ${new Date(meeting.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}\n` +
            `Time: ${new Date(meeting.date).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}\n` +
            `Venue/Link: ${meeting.inviteLink || "To be specified"}\n\n` +
            `We look forward to your participation.\n\nRegards,\n${meeting.creator.username}`;

          const groupReminderMessage = await prisma.message.create({
            data: {
              roomId: group.id,
              senderId: meeting.creator.id,
              content: groupReminderContent,
              type: "MEETING_REMINDER",
              meetingId: meeting.id,
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
                messageId: groupReminderMessage.id,
                userId: member.userId,
                status: "SENT",
              },
            })
          );

          await Promise.all(messageStatusPromises);

          console.log(`Group reminder message created for ${group.name}`);

          const io = global.io; // Make sure you set this when server starts
          if (io) {
            io.to(group.id).emit("new-message", {
              ...groupReminderMessage,
              roomId: group.id,
            });

            io.to(group.id).emit("meeting-reminder", {
              meeting: meeting,
              message: reminderMessage,
              groupName: group.name,
            });
          }

          console.log(`Group reminder sent to ${group.name}`);
        } catch (error) {
          console.error(
            `Failed to send group reminder to ${group.name}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("Error sending group reminder messages:", error);
    }
  }

  // Keep the existing cancelReminder function as is
  cancelReminder(meetingId) {
    const job = this.jobs.get(meetingId);
    if (job) {
      clearTimeout(job);
      this.jobs.delete(meetingId);
      console.log(`Cancelled reminder for meeting ${meetingId}`);
    }
  }

  // Keep the existing initializeScheduledReminders function as is
  async initializeScheduledReminders() {
    try {
      const now = new Date();
      const futureMeetings = await prisma.meeting.findMany({
        where: {
          date: {
            gt: now,
          },
          reminderSent: false,
          reminder: {
            not: null,
          },
        },
        include: {
          participants: true,
          groups: {
            include: {
              members: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      console.log(
        `Initializing reminders for ${futureMeetings.length} meetings`
      );

      for (const meeting of futureMeetings) {
        await this.scheduleMeetingReminder(meeting);
      }
    } catch (error) {
      console.error("Error initializing scheduled reminders:", error);
    }
  }
}

export const reminderService = new ReminderService();
