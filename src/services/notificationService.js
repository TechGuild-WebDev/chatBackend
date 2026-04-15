// CORRECT IMPORT - Direct Firebase Admin
import admin from 'firebase-admin';
import prisma from "../prisma.js";
import apn from 'apn';
import path from 'path';

// --- APN PROVIDER INITIALIZATION (FOR iOS VoIP PUSHES) ---
const apnConfig = {
  token: {
    key: process.env.APN_AUTH_KEY_BASE64 
      ? Buffer.from(process.env.APN_AUTH_KEY_BASE64, 'base64') 
      : path.join(process.cwd(), 'AuthKey_ZXAQC99GL7.p8'),
    keyId: process.env.APN_KEY_ID || 'ZXAQC99GL7',
    teamId: process.env.APN_TEAM_ID || 'LTSJLZV8VS'
  },
  production: process.env.NODE_ENV === 'production'
};

const apnProvider = new apn.Provider(apnConfig);

// Firebase initialization from Environment
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString());
  } else {
    serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID || "squeako-25fa0",
  "private_key_id": "539283975366217ed03e7c7f25b1aa46c08f63f5",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5Rlp/Pp7nqsHR\ncTQiEn4aDw09j08FxIwsnHnqZjzhzPHQw/iJdkf9wDkAGLB4TDldNpOucYDj0OSH\n1XPXBz0tAGwjTy1P4BtfREb0jOn0e1dYYeyIXb/c/WGOM0ywEB3BS5tNba5OdSDK\nxhWqFh43olFd//fjGSkqwVKznDwDgKvniLit/CaEkvZa2WqO4FWxij/NEAGiGjRi\npKAN3ia4WaWZHP/RA0fLKWwcp4y55s1uIse1s/7yr6fW8fw2Y2YywMWyH9pwF5gf\nnjaivO6HE95q0Ohwr+JmFhCiMdUN73vYzZg+R9+0INpETeKqv52sFmJxlIYV7iIU\n0911a9B/AgMBAAECggEAAMsfrBfVOmIYKRDLtlxPP0an5Ibulwm7x/J2Rd4LjglV\n/RzkaEJMwKDIHbX9W3vdawbGzyJxTjMg0hbEmOZ7s+uiiuwrN4Ja26eWiN7pnusV\npAKXWWYoDNw7mg5M2nGB5HKxxufHV/1XF0c4jzKVDTacE+5QCMryIDAVGJZ8s08h\n4/0UERArs+9L2j9huSLvL6ozXkPbEMPY2zHLaRroZbUsyS6Hn5COKznUMGhBKZze\nOgdTYBVLVGe0XnB9AclE62beLBmVGPCFDxmnpBqCSkB+mABdtIaXZO/deTq35fp8\nT5mcVMYH5dgwOKLosXIR9OLKEXUDodm4Xjc/N82TMQKBgQDpXxaNL3iLNVke94Ff\nt2qLvHultGz054mqx7RJ/jiLAoEUHdlXDnyJq1x+OQ+8Tu8/XUzrjSbRBI/niooW\nSkLPcHLjUNX8OjAmaP5gZb4ugHaPjekfjlpDlw59jVkxc/x2/kREBt9Vc7120G3n\nGs9WOqPbVEOaXL88ytotNq6MQwKBgQDLPWB8PTvDWKbhiIbkD2lVRKqLE99AdQUG\nhuMDwiGAZMEC3cnq9DnClI2daFtmICVOnbWRS9E2HACkMhW0avaYlEjM0p1MZ4Hl\nmC1zV50ZU7uMby8ye+g9VrKtclCeGeczmO+MasO/RJDvKnunUwr4vMbJxzK9VDmk\nSICW9t8FFQKBgEVcA4HWuAb3xhMUEJl4E+yQClfHdhKbtijRzd2n9voptl9aN7xO\nC+mGyqihIPIgq66zdicT/pNkvbhdToktbQnmK98vqUmbqa/gyKmx04JSn+oujTjZ\nwC4SeTYLipTOGhzrmTJ2sG3fRlJHxEJJj5HbP9PyCV2ZbyUMTSfe9qWtAoGBALUB\n9OyxnIhebEJxVbHICAfpH/q9uBewIMmvWIAAZdXz5fKnlS2sVcT2iSmnx78s4g0i\naJL+81U9m1ShRrNokDdT2YKSEYX6qbXR0qjnXwMvj9mDLIXJ1QzMKlZPeX1VlJRf\noPluHOg8KNjY/UgIrbzaZDFRN99nI+8so1nQhNABAoGBAOiJ7PchTsDT381rRZwp\nUqgJBrXICgtKkMS8+Rb+4ZJrd4GaZHTKU1oYQUA8AMTRByAR+9YHwZFHqrrRMRMY\nm9iyDU5eY85QDXsfXWLXl5x3Jra+tqnqlIy0YNMPpN9h8D0xQCDGxP/A76sOIKqt\nmyCe2Yqo3fYyu81pJF1bYllE\n-----END PRIVATE KEY-----\n",
      client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@squeako-25fa0.iam.gserviceaccount.com",
    };
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log(`✅ Firebase Admin initialized with project: ${serviceAccount.project_id || 'squeako-25fa0'}`);
  }
} catch (error) {
  console.error("❌ Notification Service initialization failed:", error.message);
}

// Common notification options
const NOTIFICATION_OPTIONS = {
  android: {
    priority: 'high',
    ttl: 3600 * 1000
  },
  apns: {
    headers: {
      'apns-priority': '10'
    },
    payload: {
      aps: {
        sound: 'default',
        badge: 1
      }
    }
  }
};

// High priority for calls
const CALL_OPTIONS = {
  android: {
    priority: 'high',
    ttl: 60000
  },
  apns: {
    headers: {
      'apns-priority': '10'
    },
    payload: {
      aps: {
        sound: 'default',
        badge: 1,
        contentAvailable: 1
      }
    }
  }
};

// SEND TO TOKENS FUNCTION
export async function sendToTokens(tokens = [], payload = {}, options = {}) {
  if (!tokens || tokens.length === 0) {
    console.log("No tokens provided for notification");
    return { successCount: 0, failureCount: 0 };
  }

  try {
    const validTokens = tokens.filter(token => token && token.length > 0);
    console.log(`📤 Sending notification to ${validTokens.length} tokens (Total input: ${tokens.length})`);

    // Clean root message object to only include valid FCM v1 fields
    const { notification, data, android, apns, fcmOptions } = payload;
    const message = {
      tokens: validTokens,
      notification: notification || options.notification,
      data: data || options.data,
      android: android || options.android || CALL_OPTIONS.android,
      apns: apns || options.apns || CALL_OPTIONS.apns,
      fcmOptions: fcmOptions || options.fcmOptions
    };

    console.log('📤 Sending notification to tokens:', validTokens.length);

    const response = await admin.messaging().sendEachForMulticast(message);

    // Log results
    response.responses.forEach((result, index) => {
      if (result.success) {
        console.log(`Token ${index}: Success - ${result.messageId}`);
      } else {
        console.log(`Token ${index}: Error - ${result.error?.code} - ${result.error?.message}`);
      }
    });

    console.log(`📊 Notification delivery: ${response.successCount} successful, ${response.failureCount} failed`);

    // AUTO CLEANUP INVALID TOKENS
    if (response.failureCount > 0) {
      await cleanupInvalidTokens(response.responses, validTokens);
    }

    return response;
  } catch (err) {
    console.error("FCM sendToTokens error:", err);
    if (err.errorInfo) {
      console.error("FCM Error details:", err.errorInfo);
    }
    return { successCount: 0, failureCount: tokens.length };
  }
}

// Clean invalid tokens from database - FIXED VERSION
async function cleanupInvalidTokens(results, tokens) {
  try {
    // FIX: Check if results exists and is array
    if (!results || !Array.isArray(results)) {
      console.log('No results to clean up');
      return;
    }

    const removePromises = [];

    results.forEach((result, idx) => {
      // FIX: Add proper bounds checking
      if (idx >= tokens.length) return;

      const token = tokens[idx];

      // FIX: Check if token exists and result has error
      if (token && result && result.error) {
        const err = result.error;
        if (err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered') {
          console.log(`🗑️ Removing invalid token: ${token.substring(0, 10)}...`);
          removePromises.push(
            prisma.fcmToken.deleteMany({
              where: { token }
            }).catch(e => console.error('Error deleting token:', e))
          );
        }
      }
    });

    if (removePromises.length > 0) {
      await Promise.allSettled(removePromises);
      console.log(`Cleaned up ${removePromises.length} invalid tokens`);
    }
  } catch (error) {
    console.error('cleanupInvalidTokens error:', error);
  }
}

export async function getTokensForUsers(userIds = []) {
  if (!userIds.length) return [];
  try {
    console.log(`DEBUG: Getting tokens for users: ${userIds}`);
    const tokens = await prisma.fcmToken.findMany({
      where: {
        userId: { in: userIds },
        platform: { not: 'ios-voip' } // CRITICAL: Skip VoIP tokens for standard FCM
      },
      select: { token: true }
    });
    console.log(`DEBUG: Found ${tokens.length} standard tokens for users ${userIds}`);
    return tokens.map(t => t.token).filter(token => token && token.length > 0);
  } catch (error) {
    console.error("Error getting tokens for users:", error);
    return [];
  }
}

// GET TOKENS FOR USER
async function getTokensForUser(userId) {
  if (!userId) return [];
  try {
    console.log(`Getting tokens for user: ${userId}`);
    const fcmTokens = await prisma.fcmToken.findMany({
      where: { userId, platform: { not: 'ios-voip' } }, // Only standard FCM
      select: { token: true }
    });
    console.log(`Found ${fcmTokens.length} FCM tokens for user ${userId}`);
    return fcmTokens.map(t => t.token).filter(token => token && token.length > 0);
  } catch (error) {
    console.error("Error getting tokens for user:", error);
    return [];
  }
}

// GET VOIP TOKENS FOR USER
async function getVoipTokensForUser(userId) {
  if (!userId) return [];
  try {
    console.log(`Getting VoIP tokens for user: ${userId}`);
    const voipTokens = await prisma.fcmToken.findMany({
      where: { userId, platform: 'ios-voip' },
      select: { token: true }
    });
    console.log(`Found ${voipTokens.length} VoIP tokens for user ${userId}`);
    return voipTokens.map(t => t.token).filter(token => token && token.length > 0);
  } catch (error) {
    console.error("Error getting VoIP tokens:", error);
    return [];
  }
}

// services/notificationService.js - sendChatNotification function update karo

export async function sendChatNotification(userIds, message) {
  try {
    console.log('DEBUG: sendChatNotification called with:', { userIds, message });

    let tokens = Array.isArray(userIds)
      ? await getTokensForUsers(userIds)
      : await getTokensForUser(userIds);

    console.log(`DEBUG: sendChatNotification - UserIDs: ${JSON.stringify(userIds)}, Tokens found: ${tokens.length}`);

    // MUTE FEATURE: Filter out users who have muted this room
    if (message.roomId && tokens.length > 0) {
      console.log(`DEBUG: Checking mute status for RoomID: ${message.roomId}`);
      try {
        const idArray = Array.isArray(userIds) ? userIds : [userIds];
        const mutedMembers = await prisma.chatMember.findMany({
          where: {
            roomId: message.roomId,
            userId: { in: idArray },
            mutedUntil: { gt: new Date() }
          },
          select: { userId: true }
        });

        const mutedIds = new Set(mutedMembers.map(m => m.userId));
        if (mutedIds.size > 0) {
          console.log(`🔇 Mute Feature: Found ${mutedIds.size} muted users: ${Array.from(mutedIds)}`);
          
          if (Array.isArray(userIds)) {
            const activeUserIds = userIds.filter(id => !mutedIds.has(id));
            if (activeUserIds.length === 0) {
                console.log("All recipients have muted this chat. Skipping notification.");
                return { success: true, message: "Muted" };
            }
            // Re-fetch tokens for ONLY active users
            tokens = await getTokensForUsers(activeUserIds);
          } else {
            if (mutedIds.has(userIds)) {
              console.log("Recipient has muted this chat. Skipping notification.");
              return { success: true, message: "Muted" };
            }
          }
        }
      } catch (muteError) {
        console.error("Error checking muted members:", muteError);
      }
    }

    if (tokens.length === 0) {
      console.log("No FCM tokens found for users:", userIds);
      return { success: false, message: "No tokens found" };
    }

    // STEP 1: GROUP NAME FETCH KARO DATABASE SE
    let groupName = "Group"; // Default
    let isGroupChat = false; // ADDED: Group chat check

    try {
      if (message.roomId && !message.roomId.startsWith('meeting-')) {
        console.log(`🏷️ Fetching group name for room: ${message.roomId}`);

        // DATABASE SE GROUP NAME FETCH KARO
        const room = await prisma.chatRoom.findUnique({
          where: { id: message.roomId },
          select: { name: true, isGroup: true }
        });

        if (room) {
          isGroupChat = room.isGroup; // SET GROUP FLAG
          if (room.name && room.isGroup) {
            groupName = room.name;
            console.log(`Group name found: ${groupName}`);
          } else {
            console.log('One-to-one chat or group name not found');
            groupName = ""; // One-to-one chat mein group name empty rakho
          }
        } else {
          console.log('Room not found in database');
        }
      }
    } catch (groupError) {
      console.log('Error fetching group name:', groupError.message);
    }

    // NOTIFICATION CONTENT
    let notificationBody = '';
    let notificationTitle = '';
    let imageUrl = null;

    if (message.type === 'MEETING_INVITATION') {
      // Meeting notifications - normal behavior
      const meetingTitle = message.meetingTitle || 'Meeting';
      const meetingGroupName = message.groupName || groupName;

      notificationTitle = `Meeting Invitation`;

      // MEETING KE LIYE BHI GROUP CHECK
      if (meetingGroupName && isGroupChat) {
        notificationBody = `${meetingGroupName}: ${meetingTitle}`;
      } else {
        notificationBody = meetingTitle;
      }

      console.log('Meeting notification:', {
        title: notificationTitle,
        body: notificationBody,
        meetingId: message.meetingId,
        isGroup: isGroupChat
      });

    } else {
      // CHAT MESSAGES
      if (isGroupChat && groupName) {
        notificationTitle = groupName;
        const senderPrefix = message.senderName ? `${message.senderName}: ` : "";
        
        if (message.type === 'IMAGE') {
          notificationBody = `📷 ${senderPrefix}Sent an image`;
        } else if (message.type === 'VIDEO') {
          notificationBody = `🎥 ${senderPrefix}Sent a video`;
        } else if (message.type === 'AUDIO') {
          notificationBody = `🎵 ${senderPrefix}Sent an audio`;
        } else if (message.type === 'FILE') {
          notificationBody = `📄 ${senderPrefix}Sent a file`;
        } else {
          notificationBody = `${senderPrefix}${message.content || 'Sent a message'}`;
        }
      } else {
        notificationTitle = message.senderName || "New message";
        if (message.type === 'IMAGE') {
          notificationBody = `📷 Sent an image`;
        } else if (message.type === 'VIDEO') {
          notificationBody = `🎥 Sent a video`;
        } else if (message.type === 'AUDIO') {
          notificationBody = `🎵 Sent an audio`;
        } else if (message.type === 'FILE') {
          notificationBody = `📄 Sent a file`;
        } else {
          notificationBody = message.content || 'Sent a message';
        }
      }

      // Truncate long bodies
      if (notificationBody.length > 150) {
        notificationBody = notificationBody.substring(0, 150) + '...';
      }
    }

    console.log('Final notification content:', {
      title: notificationTitle,
      body: notificationBody,
      groupName: groupName,
      isGroupChat: isGroupChat,
      type: message.type,
    });

    // CONSTRUCT PAYLOAD
    const payload = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        title: notificationTitle,
        body: notificationBody,
        image: imageUrl || '',
        type: message.type || "CHAT_MESSAGE",
        roomId: String(message.roomId || ''),
        messageId: String(message.messageId || ''),
        senderId: String(message.senderId || ''),
        senderName: String(message.senderName || 'Unknown'),
        messageType: String(message.type || 'TEXT'),
        content: String(message.content || ''),
        groupName: isGroupChat ? String(groupName) : '',
        isGroup: String(isGroupChat),
        mediaUrl: String(message.mediaUrl || ''),
        imageUrl: String(imageUrl || ''),
        timestamp: String(Date.now()),
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: 'high',
        ttl: 3600 * 1000,
        notification: {
          sound: 'default',
          channelId: 'chat_messages', // High priority channel
          icon: 'ic_launcher', // Use existing launcher icon
          color: '#FF0000',
          image: imageUrl || undefined,
        }
      },
      apns: {
        headers: {
          'apns-priority': '10'
        },
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
            alert: {
              title: notificationTitle,
              body: notificationBody
            },
            'content-available': 1
          },
          fcm_options: {
            image: imageUrl || undefined
          }
        }
      }
    };

    // MEETING SPECIFIC OVERRIDES
    if (message.type === 'MEETING_INVITATION') {
      payload.data.meetingId = String(message.meetingId || '');
      payload.data.meetingTitle = String(message.meetingTitle || '');
      payload.data.meetingDate = String(message.meetingDate || '');
      payload.data.meetingLink = String(message.meetingLink || '');
    }

    console.log(`Sending ${message.type} notification to ${tokens.length} users`);
    console.log(`Group: ${isGroupChat ? 'YES' : 'NO'}, Group Name: ${groupName}`);

    const result = await sendToTokens(tokens, payload);

    console.log('DEBUG: Send result:', {
      successCount: result.successCount,
      failureCount: result.failureCount,
      total: tokens.length
    });

    return {
      success: true,
      result,
      sentCount: result.successCount || 0
    };
  } catch (error) {
    console.error("sendChatNotification error:", error);
    return { success: false, error: error.message };
  }
}


// services/notificationService.js - UPDATED WITH VOIP PUSH
export async function sendIncomingCallNotification(receiverId, callData) {
  try {
    console.log('Sending incoming call push notification to:', receiverId);

    // Fetch both standard FCM tokens (Android) and VoIP tokens (iOS)
    const fcmTokens = await getTokensForUser(receiverId);
    const voipTokens = await getVoipTokensForUser(receiverId);

    if (fcmTokens.length === 0 && voipTokens.length === 0) {
      console.log("No tokens found for user:", receiverId);
      return { success: false, message: "No tokens found" };
    }

    let successCount = 0;

    // ─── 1. SEND TO iOS DEVICES (VIA APN / PUSHKIT) ───
    if (voipTokens.length > 0) {
      console.log(`🍏 Sending Apple VoIP Push to ${voipTokens.length} devices...`);
      const notification = new apn.Notification();
      
      // VoIP payload must strictly rely on custom payload, Apple ignores 'alert' for VoIP
      notification.topic = "com.squeako.mobileappchat.voip";
      notification.payload = {
        title: `Incoming ${callData.callType === 'VIDEO' ? 'Video' : 'Audio'} Call`,
        body: `From ${callData.callerName || 'Unknown'}`,
        type: "INCOMING_CALL",
        callId: String(callData.callId || ''),
        callerId: String(callData.callerId || ''),
        callerName: String(callData.callerName || 'Unknown'),
        callType: String(callData.callType || 'AUDIO'),
        roomName: String(callData.roomName || ''),
        timestamp: String(Date.now()),
        click_action: "INCOMING_CALL",
      };

      try {
        const apnResult = await apnProvider.send(notification, voipTokens);
        console.log("Apple APNs Response:", apnResult);
        successCount += apnResult.sent.length;
      } catch (err) {
        console.error("Apple VoIP Push Error:", err);
      }
    }

    // ─── 2. SEND TO ANDROID / WEB DEVICES (VIA FIREBASE FCM) ───
    if (fcmTokens.length > 0) {
      console.log(`🤖 Sending Firebase FCM Call Push to ${fcmTokens.length} Android/Web devices...`);
      const payload = {
        // Add minimal notification for reliability on some Android versions
        notification: {
          title: `Incoming ${callData.callType === 'VIDEO' ? 'Video' : 'Audio'} Call`,
          body: `From ${callData.callerName || 'Unknown'}`,
        },
        data: {
          title: `Incoming ${callData.callType === 'VIDEO' ? 'Video' : 'Audio'} Call`,
          body: `From ${callData.callerName || 'Unknown'}`,
          type: "INCOMING_CALL",
          callId: String(callData.callId || ''),
          callerId: String(callData.callerId || ''),
          callerName: String(callData.callerName || 'Unknown'),
          callType: String(callData.callType || 'AUDIO'),
          roomName: String(callData.roomName || ''),
          timestamp: String(Date.now()),
          click_action: "INCOMING_CALL",
          contentAvailable: 'true',
          priority: 'high',
        },
        android: {
          priority: 'high',
          ttl: 60000, 
          notification: {
            sound: 'ring_tone',
            channelId: 'incoming_calls',
            visibility: 'public',
            priority: 'high',
            icon: 'ic_launcher',
          },
        }
      };

      const fcmResult = await sendToTokens(fcmTokens, payload, {
        priority: 'high',
        timeToLive: 60
      });
      successCount += fcmResult.successCount || 0;
    }

    return {
      success: successCount > 0,
      sentCount: successCount
    };

  } catch (error) {
    console.error("sendIncomingCallNotification error:", error);
    return { success: false, error: error.message };
  }
}

// BULK NOTIFICATION FOR GROUPS
export async function sendBulkNotification(userIds, notification) {
  try {
    if (!userIds || userIds.length === 0) {
      console.log("No users provided for bulk notification");
      return { success: false, message: "No users provided" };
    }

    console.log(`👥 Sending bulk notification to ${userIds.length} users`);

    const tokens = await getTokensForUsers(userIds);

    if (tokens.length === 0) {
      console.log("No FCM tokens found for users:", userIds);
      return { success: false, message: "No tokens found" };
    }

    const payload = {
      notification: undefined, // Data-only message
      data: {
        title: notification.title || "Notification",
        body: notification.body || "You have a new notification",
        type: notification.type || "GENERAL",
        ...notification.data
      }
    };

    const result = await sendToTokens(tokens, payload);

    return {
      success: true,
      result,
      sentCount: result.successCount || 0,
      totalUsers: userIds.length
    };

  } catch (error) {
    console.error("sendBulkNotification error:", error);
    return { success: false, error: error.message };
  }
}

// ENHANCED sendToTokens WITH BATCH PROCESSING
export async function sendToTokensEnhanced(tokens = [], payload = {}, options = {}) {
  if (!tokens || tokens.length === 0) {
    console.log("No tokens provided for notification");
    return { successCount: 0, failureCount: 0 };
  }

  try {
    console.log(`📤 Sending notification to ${tokens.length} tokens`);

    // Split into batches of 500 (FCM limit)
    const batchSize = 500;
    const batches = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
      batches.push(tokens.slice(i, i + batchSize));
    }

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const batch of batches) {
      const message = {
        tokens: batch.filter(token => token && token.length > 0),
        notification: payload.notification,
        data: payload.data,
        ...NOTIFICATION_OPTIONS,
        ...options
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Log results for each batch
      response.responses.forEach((result, index) => {
        if (result.success) {
          console.log(`Token ${index}: Success - ${result.messageId}`);
        } else {
          console.log(`Token ${index}: Error -`, {
            errorCode: result.error?.code,
            errorMessage: result.error?.message
          });
        }
      });

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      // Clean up invalid tokens
      if (response.failureCount > 0) {
        await cleanupInvalidTokens(response.responses, batch);
      }
    }

    console.log(`📊 Total Notification delivery: ${totalSuccess} successful, ${totalFailure} failed`);
    return { successCount: totalSuccess, failureCount: totalFailure };

  } catch (err) {
    console.error("FCM sendToTokens error:", err);
    return { successCount: 0, failureCount: tokens.length };
  }
}



// SEND CALL END NOTIFICATION (FOR SYNCING UI WHEN SOCKET IS DEAD)
export async function sendCallEndNotification(userId, callData) {
  try {
    console.log(`🔕 Sending call-end push notification to user: ${userId}`);
    const tokens = await getTokensForUser(userId);
    if (!tokens || tokens.length === 0) return { success: false };

    const payload = {
      notification: undefined, // Data-only
      data: {
        type: callData.type || "CALL_ENDED", // CALL_ENDED or CALL_REJECTED
        callId: String(callData.callId || ''),
        timestamp: String(Date.now()),
      },
      android: {
        priority: 'high',
        ttl: 4000
      },
      apns: {
         headers: { 'apns-priority': '10' },
         payload: { aps: { 'content-available': 1 } }
      }
    };

    return await sendToTokens(tokens, payload);
  } catch (err) {
    console.error("sendCallEndNotification error:", err);
    return { success: false };
  }
}

// ==========================================
//  UNIVERSAL FUNCTION CALLED BY FRONTEND
// ==========================================
export async function sendPushNotification(userId, payload) {
  try {
    console.log("📨 sendPushNotification CALLED:", userId, payload);

    const tokens = await getTokensForUser(userId);

    if (!tokens || tokens.length === 0) {
      console.log("No FCM token found for user:", userId);
      return;
    }

    console.log("Sending push to tokens:", tokens.length);

    const dataPayload = {
      notification: {
        title: payload.title || "Notification",
        body: payload.body || "",
        image: payload.image || ""
      },
      data: {
        ...payload,
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      }
    };

    const result = await sendToTokens(tokens, dataPayload);

    console.log("Push result:", result);
    return result;

  } catch (err) {
    console.error("sendPushNotification ERROR:", err);
  }
}
