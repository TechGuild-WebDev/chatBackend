// test-fcm.cjs
const admin = require('firebase-admin');

const serviceAccount = {
  "type": "service_account",
  "project_id": "squeakopushnotification",
  "private_key_id": "f9ee508e8a2d4da48f550a7669e9fc9427d2325a",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD4a6BATn/TJj2+\n+kJSMXiZmQEhljEuYigHyKN7YkqN3fFDRkN43tlcLphFs2Ts1M9vwtfRsRyBjnF+\nfrcZdtIdOSApuK6VH1KFNbo/zJ+sv5hqE3WMNijDw7xIFLGz4qfuhAgq9w/rsn54\npCNOCsXrbfavYPMnOFu58RbniYPqjy2aK+MpuAuwsE9YMuI3LnIms9RGoOxb+a8y\nc3vupJnzCZGGJLID43Y9hUVEcMUUYKzTXg97f+rGFU184DxwGXWpcpw+fGB0AK1G\nteTXGdvRxMLDtHWW/MaaSUDo9FgkhwimZS/AAS64x2JMH2QL/NYbaTyQdIV2lM0s\nVjIi7D8LAgMBAAECggEAdxZZDxrSii1F4lxkGLTghHllom02jG6/k+OqA0b+SH4B\n32c6hyIFfvxTQO6bzjDCdGgqP7qw2KapX6NtMQbV+O5ercF7577JN1SnQVhdn1mF\nviwv6JQ5/IbDpqZM/dgE+wFOTRJ9DldV64174zik4pSncjF+vul0h3G8sigpFfK1\ncmOz0NRYoyzbpQRBEo2h1znnsHgdrcRnDDL8VMijetVtUJW//uSyZ0gFYs55ivN8\nWvc3HFt7fWbSVKKvVMDlz7oNtvrtPEZ0CPQyeWqONDIsWOidiGnz1LzBw976jmNT\npNrdCpW6pKPOzTxuTkKXs1AugqXEhrsRAU09cF7SCQKBgQD/kUmaZXghDWes8H/e\n9hFqUzJVcda7DLCOedva26AYH3Q8wZWLsnQSZwqrYX0xQhkxFzdmSDuE9kOZgQ+r\nu9VFgy/B82BF/YW52UmnnBU1lY3AAfi9XHO0CgAN2nasdgHiYXKc4OFAf/1PvNXn\nhhDm2wi8Q6wiCZG3J89Q19YHVwKBgQD41z4Iv31aIxR+cFZjdOIIVSIvA5ibqg8M\nEWbr63LuzugosVYhVYtgpM+E1RNnBp/qgFpe0xxO/Smq9aeDe9pNbg7rRC+/Xp2x\ngMxF/DF+T0/RgcB9tMp4UvS0OpvVLcaGN0UzLCdossByEUDFdE40i/RwE+d/bZHI\nrX3BgmV5bQKBgQCxt1FMeUUJDu5KV09ENy6zFjmJK0lb9x4LZXfaACGaxLyqxx77\n7tNCPL8xn/BTwZgNCAzxJkelVS5630GLdWmAFhKut1P6N6q3Kv9J+4LQKThSDczv\nuQuIZe/VslYV5VW4G3V82/AnTxlSSokgn5y/PA8eA5z+alMW3ysOF5jwrwKBgQDL\nEJM9/k4kBWaO+8tzpAlkdVzM8ulRdoiK95R+x4fmG5DWzEiWMUHpHvV914fa1kwf\nyJh2s15xkySyr38AzExMTZj9IOq4Z1TWal3IatJU2hIvzOuxaZykbkXk4cMTRySv\nmGDvLoQGa4CiVTP/Ljc3qFJUN9n9YgPKuNFb3bZDTQKBgAv2qZNO54ax3ogIvVrc\nlqnvaMri5vT12dvChxcEAEyrlcz/c/z+txP47gEhCmj0b1y6MTX7947uKHx3k3/b\nj6HGYL84MgoUPJoEIKXWWUNi/+DyPJ8BQy6zHYVC0drKpCD13p+P9nykfsmVN4Os\nd0Qef1U7E7n5dd+vNa7oQKUn\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@squeakopushnotification.iam.gserviceaccount.com",
  "client_id": "110969354115094866402",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function sendTest() {
  try {
    // YAHAN APNA COMPLETE TOKEN PASTE KAREN
    const message = {
      token: "fOrIfPEnSRSZrj61mfraLp:APA91bHUpyBZLdIRaSHqws-nIin6gtYcYdwhbVzRxvtzwPIQ0NgwbZ1fgkBMXCVFVfqj6_gFNAqEy--8mXAW9y647SWs9XHC_GzV12EMohti0sFV6tGip4A",
      notification: {
        title: 'Final Test ',
        body: 'This should work now! 🚀'
      },
      data: {
        type: 'TEST',
        timestamp: new Date().toISOString()
      }
    };

    console.log('Sending notification...');
    console.log('Token length:', message.token.length);

    const response = await admin.messaging().send(message);
    console.log('🎉 SUCCESS! Notification sent!');
    console.log('Message ID:', response);

  } catch (error) {
    console.log('ERROR:', error.message);
    console.log('Error details:', error);
  }
}

sendTest();