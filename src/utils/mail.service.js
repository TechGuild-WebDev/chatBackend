// src/utils/mail.service.js
import nodemailer from "nodemailer";
import { config as dotenvConfig } from "dotenv";
import { emailTemplates } from "./emailTemplates.js";

dotenvConfig();

// minimal env (as you wanted)
const EMAIL = process.env.EMAIL;
const APP_PASS = process.env.EMAIL_APP_PASSWORD; // 16-char Gmail App Password

if (!EMAIL || !APP_PASS) {
  throw new Error("EMAIL and EMAIL_APP_PASSWORD must be set in .env");
}

// Single pooled transporter (Gmail + App Password)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // SSL
  auth: { user: EMAIL, pass: APP_PASS },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

// verify once (non-fatal if it fails)
transporter.verify().then(
  () => console.log("[mail] SMTP verified"),
  (err) => console.warn("[mail] SMTP verify failed:", err?.message || err)
);

const stripHtml = (html = "") =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sendEmail = async ({
  to,
  subject,
  template,
  data = {},
  text,
  cc,
  bcc,
  attachments,
} = {}) => {
  if (!to) throw new Error('Missing "to"');
  if (!subject) throw new Error('Missing "subject"');
  if (!template) throw new Error('Missing "template"');
  if (!emailTemplates?.[template]) throw new Error(`Template '${template}' not found`);

  const html = emailTemplates[template](data);

  const info = await transporter.sendMail({
    from: EMAIL, // must match authenticated Gmail unless "Send mail as" is configured
    to,
    cc,
    bcc,
    subject,
    html,
    text: text || stripHtml(html),
    attachments,
  });

  console.log("[mail] sent:", info.messageId);
  return info;
};

// ➕ provide the wrapper your controller expects
export const sendSignupOtpEmail = async ({ to, otp, name, logoUrl }) => {
  const ttl = process.env.OTP_TTL_MINUTES || 10;
  return sendEmail({
    to,
    subject: "Your verification code",
    template: "emailVerification", // make sure this exists in emailTemplates.js
    data: { otp, name, logoUrl, ttlMinutes: ttl },
  });
};

export const sendApprovalEmail = async ({ to, name, password }) => {
  return sendEmail({
    to,
    subject: "Your Account is Ready - Probey Services",
    template: "approvedRequest",
    data: { name, email: to, password },
  });
};
