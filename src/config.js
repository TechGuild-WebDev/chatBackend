// src/config.js
import dotenv from "dotenv";
dotenv.config();

// used by your controller
export const LOGO_URL = process.env.MAIL_LOGO_URL || "";
export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

// optional: centralize mail creds if you want to import them elsewhere
export const EMAIL = process.env.EMAIL || "";
export const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || "";
