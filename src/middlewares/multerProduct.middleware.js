import multer from "multer";
import fs from "fs";
import path from "path";

// ---------- Product Storage ----------
const productFolder = path.join(process.cwd(), "public/temp/products");
if (!fs.existsSync(productFolder)) fs.mkdirSync(productFolder, { recursive: true });

const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, productFolder),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const productFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];
  allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error("Only JPG, PNG, WebP allowed!"), false);
};

export const uploadProduct = multer({
  storage: productStorage,
  fileFilter: productFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---------- Avatar Storage ----------
const avatarFolder = path.join(process.cwd(), "public/temp/avatars");
if (!fs.existsSync(avatarFolder)) fs.mkdirSync(avatarFolder, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarFolder),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

export const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: productFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max for avatar
});
