import cron from 'node-cron';
import prisma from './prisma.js';
import { findOrCreateRoom, createCallLog } from './controller/call.controller.js';

// Helper function to simulate sending a notification (e.g., WebSocket or In-App Notification)
const sendNotification = async (groupId, message) => {
  console.log(`Sending notification to group ${groupId}: ${message}`);
  // Replace this with the actual logic to send notifications (e.g., WebSocket, in-app push, etc.)
};

// Function to schedule meeting reminders
export const scheduleMeetingReminders = (meetingId, meetingDate, groupId) => {
  // Define the reminder times
  const reminderTimes = [
    { type: '30m', time: new Date(meetingDate.getTime() - 30 * 60 * 1000) }, // 30 minutes before
    { type: '10m', time: new Date(meetingDate.getTime() - 10 * 60 * 1000) }, // 10 minutes before
    { type: 'start', time: new Date(meetingDate) }, // At the start time
  ];

  // Loop over the reminder times and schedule the cron jobs
  reminderTimes.forEach((reminder) => {
    const { time, type } = reminder;

    // Construct the cron expression for the reminder time
    const cronExpression = `${time.getMinutes()} ${time.getHours()} ${time.getDate()} ${time.getMonth() + 1} * *`;

    // Schedule the cron job
    cron.schedule(cronExpression, async () => {
      console.log(`Sending ${type} reminder for meeting ID: ${meetingId}`);

      // Fetch meeting details
      const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: { participants: true },
      });

      if (!meeting) {
        console.log('Meeting not found');
        return;
      }

      // Prepare the notification message
      const notificationMessage = {
        title: `Reminder: ${meeting.title}`,
        body: `The meeting starts at ${meeting.date}. Join using this link: ${meeting.meetLink}`,
      };

      // Send notifications to participants (replace with your notification logic)
      meeting.participants.forEach(async (participant) => {
        await sendNotification(groupId, notificationMessage.body); // Send reminder to group
      });
    });
  });
};

// Function to clean up stale calls (e.g., calls that were never answered or ended properly)
// Run this periodically (e.g., every minute)
export const startStaleCallCleanup = (io) => {
  cron.schedule('* * * * *', async () => {
    try {
      const staleTime = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

      // Find stale calls first to create logs
      const staleCalls = await prisma.call.findMany({
        where: {
          status: { in: ['INITIATED', 'RINGING'] },
          createdAt: { lt: staleTime }
        }
      });

      if (staleCalls.length > 0) {
        for (const call of staleCalls) {
          // Update call status
          await prisma.call.update({
            where: { id: call.id },
            data: {
              status: 'MISSED',
              endedAt: new Date()
            }
          });

          // Create CALL_LOG message using central helper
          await createCallLog(call, "MISSED", io);
        }
        console.log(`[Cron] Cleaned up ${staleCalls.length} stale calls and created logs.`);
      }
    } catch (error) {
      console.error('[Cron] Error cleaning up stale calls:', error);
    }
  });
};
