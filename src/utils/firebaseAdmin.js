import admin from 'firebase-admin';
import prisma from '../prisma.js';

// FCM V1 format mein message bhejein
export async function sendNotificationV1(userId, notification) {
  try {
    // 1. Get ALL tokens for the user, newest first
    const tokens = await prisma.fcmToken.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' }
    });

    if (tokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}`);
      return;
    }

    console.log(`Sending notification to ${tokens.length} devices for user ${userId}`);

    // 2. Prepare promises for all tokens
    const sendPromises = tokens.map(async (tokenData) => {
      const message = {
        token: tokenData.token,
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: {
          type: notification.type || 'GENERAL',
          roomId: notification.roomId || '',
          callId: notification.callId || '',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          priority: 'high',
          contentAvailable: 'true'
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'chat_messages',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true
          }
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
              badge: 1,
              sound: 'default'
            }
          }
        }
      };

      try {
        const response = await admin.messaging().send(message);
        console.log(`Sent to device ${tokenData.id}:`, response);
        return { success: true, id: tokenData.id };
      } catch (error) {
        console.error(`Failed to send to token ${tokenData.id}:`, error.code);

        // 3. Clean up invalid tokens automatically
        if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token') {
          console.log(`🗑️ Deleting invalid token: ${tokenData.token}`);
          await prisma.fcmToken.delete({ where: { id: tokenData.id } }).catch(e => console.error(e));
        }
        return { success: false, error: error.code };
      }
    });

    // 4. Wait for all sends to complete
    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;
    console.log(`📊 Notification delivery report: ${successCount}/${tokens.length} successful`);

    return { success: successCount > 0, results };

  } catch (error) {
    console.error('FCM V1 System Error:', error);
    throw error;
  }
}