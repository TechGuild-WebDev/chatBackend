// services/statusScheduler.js
import prisma from "../prisma.js";

let io;

export const setIoInstance = (ioInstance) => {
  io = ioInstance;
};

export const scheduleStatusReset = async (userId, resetTime) => {
  try {
    const now = new Date();
    const delay = resetTime.getTime() - now.getTime();

    if (delay > 0) {
      console.log(`Scheduling status reset for user ${userId} in ${Math.round(delay / 1000 / 60)} minutes`);

      setTimeout(async () => {
        try {
          // Check if user is still busy before resetting
          const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              username: true,
              status: true,
              busyStartTime: true,
              busyDuration: true,
              avatarUrl: true
            }
          });

          // Only reset if still busy
          if (currentUser && currentUser.status === 'BUSY') {
            console.log(`Auto-resetting status for user: ${currentUser.username}`);

            const updatedUser = await prisma.user.update({
              where: { id: userId },
              data: {
                status: 'AVAILABLE',
                busyStartTime: null,
                busyDuration: null,
                isDND: false
              },
              select: {
                id: true,
                username: true,
                status: true,
                busyStartTime: true,
                busyDuration: true,
                isDND: true,
                avatarUrl: true,
                isOnline: true
              }
            });

            console.log(`Auto status reset to Available for user ${currentUser.username}`);

            // Send real-time updates
            if (io) {
              // Update user profile
              io.emit('user-profile-updated', {
                userId: updatedUser.id,
                username: updatedUser.username,
                status: updatedUser.status,
                avatarUrl: updatedUser.avatarUrl,
                busyStartTime: updatedUser.busyStartTime,
                busyDuration: updatedUser.busyDuration,
                isDND: updatedUser.isDND
              });

              // Update user status
              io.emit('user-status-changed', {
                userId: updatedUser.id,
                status: updatedUser.status,
                busyStartTime: updatedUser.busyStartTime,
                busyDuration: updatedUser.busyDuration,
                isDND: updatedUser.isDND,
                isOnline: updatedUser.isOnline,
                lastSeen: null
              });

              // Specific auto-reset event
              io.emit('status-auto-reset', {
                userId: updatedUser.id,
                message: 'Busy timer ended - Auto reset to Available',
                newStatus: 'AVAILABLE',
                timestamp: new Date()
              });

              // Send to user's personal room
              io.to(userId.toString()).emit('status-auto-reset', {
                message: 'Your busy status has automatically ended',
                newStatus: 'AVAILABLE'
              });
            }
          } else {
            console.log(`User ${userId} status already changed, skipping auto-reset`);
          }

        } catch (error) {
          console.error('Error auto-resetting user status:', error);
        }
      }, delay);
    } else {
      // If delay is negative, reset immediately
      await resetUserStatusImmediately(userId);
    }
  } catch (error) {
    console.error('Error scheduling status reset:', error);
  }
};

// Immediate status reset function
const resetUserStatusImmediately = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'AVAILABLE',
        busyStartTime: null,
        busyDuration: null,
        isDND: false
      },
      select: {
        id: true,
        username: true,
        status: true,
        busyStartTime: true,
        busyDuration: true,
        isDND: true,
        avatarUrl: true
      }
    });

    console.log(`Immediate status reset for user ${user?.username}`);

    if (io) {
      io.emit('user-profile-updated', updatedUser);
      io.emit('user-status-changed', {
        userId: updatedUser.id,
        status: updatedUser.status,
        busyStartTime: updatedUser.busyStartTime,
        busyDuration: updatedUser.busyDuration,
        isDND: updatedUser.isDND,
        isOnline: true
      });
    }

    return updatedUser;
  } catch (error) {
    console.error('Error in immediate status reset:', error);
    throw error;
  }
};

export const checkPendingStatusResets = async () => {
  try {
    console.log("Checking pending status resets...");

    const busyUsers = await prisma.user.findMany({
      where: {
        status: 'BUSY',
        busyStartTime: { not: null },
        busyDuration: { not: null }
      },
      select: {
        id: true,
        username: true,
        busyStartTime: true,
        busyDuration: true
      }
    });

    console.log(`📊 Found ${busyUsers.length} users with BUSY status`);

    for (const user of busyUsers) {
      const resetTime = new Date(
        new Date(user.busyStartTime).getTime() + user.busyDuration * 60 * 1000
      );

      console.log(`User ${user.username}: busy until ${resetTime}`);

      if (resetTime <= new Date()) {
        // Past reset time - reset immediately
        console.log(`Resetting overdue status for user ${user.username}`);
        await resetUserStatusImmediately(user.id);
      } else {
        // Future reset - reschedule it
        console.log(`Scheduling future reset for user ${user.username} at ${resetTime}`);
        await scheduleStatusReset(user.id, resetTime);
      }
    }

    console.log("Pending status resets check completed");
  } catch (error) {
    console.error('Error checking pending status resets:', error);
  }
};