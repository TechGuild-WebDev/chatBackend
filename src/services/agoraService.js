// Fix: Use default import for CommonJS module
import pkg from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = pkg;

export class AgoraService {
  constructor() {
    this.appId = (process.env.AGORA_APP_ID || "").trim();
    this.appCertificate = (process.env.AGORA_APP_CERTIFICATE || "").trim();

    if (!this.appId || !this.appCertificate) {
      console.warn("Agora credentials not found. Check environment variables.");
    } else {
      console.log(`[AgoraService] LOADED: AppID=${this.appId.substring(0, 5)}... Cert=${this.appCertificate.substring(0, 5)}...`);
    }
  }

  generateToken(channelName, uid) {
    try {
      if (!this.appId || !this.appCertificate) {
        throw new Error("Agora credentials not configured");
      }

      const role = RtcRole.PUBLISHER;
      const expirationTimeInSeconds = 3600; // 1 hour
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

      console.log("Generating Agora token:", {
        appId: this.appId,
        channelName,
        uid,
        expirationTimeInSeconds,
      });

      // ULTIMATE FIX: Use UID 0 (Wildcard) for token generation.
      const numericUid = Number(uid); // Forced conversion to clear BigInts
      const token = RtcTokenBuilder.buildTokenWithUid(
        this.appId,
        this.appCertificate,
        channelName.trim(), 
        0,   // 0 = Wildcard UID (Works for any UID)
        role,
        privilegeExpiredTs
      );

      console.log(`[AgoraService] GENERATED TOKEN: channel=${channelName.trim()}, uid_target=${numericUid}`);

      return {
        token,
        appId: this.appId,
        channelName: channelName.trim(),
        uid: numericUid
      };
    } catch (error) {
      console.error("Error generating Agora token:", error);
      throw new Error("Failed to generate call token: " + error.message);
    }
  }

  generateRandomChannelName() {
    return `call_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const agoraService = new AgoraService();