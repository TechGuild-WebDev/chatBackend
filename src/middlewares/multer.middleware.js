import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";

const uploadDir = path.join(os.tmpdir(), "chat-uploads");

// Ensure temp dir exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// File storage (write to temp, Cloudinary will get this path)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `upload_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

// Optional: filter by mime (allow common images, videos, and docs). Return cb(null, true) to allow all.
const ACCEPTED = [
  /^image\//,
  /^video\//,
  /^audio\//,
  /pdf$/,
  /zip$/,
  /msword$/,
  /officedocument/,
  /excel/,
  /spreadsheetml/,
  /text\/plain/,
];
const fileFilter = (req, file, cb) => {
  const ok = ACCEPTED.some((re) => re.test(file.mimetype));
  if (!ok) {
    // allow everything? then just `cb(null, true);`
    return cb(new Error("Unsupported file type"));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter, // or remove to accept all
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB file size limit
});