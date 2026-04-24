// src/utils/cloudinary.js
import "dotenv/config"; // ensures .env is read even if import order is wrong
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";

// Absolute path to public/uploads — resolved relative to THIS file so it
// works regardless of which directory the server process is started from.
import { fileURLToPath } from "url";
const PUBLIC_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/uploads"
);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const isCloudinaryReady = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (!isCloudinaryReady) {
  console.warn(
    "Cloudinary env missing: " +
    ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
      .filter((k) => !process.env[k])
      .join(", ")
  );
}

/** Safely remove a local file if it exists */
const safeUnlink = async (localFilePath) => {
  if (!localFilePath) return;
  try {
    await fs.promises.unlink(localFilePath);
  } catch {
    /* ignore */
  }
};

/**
 * Save file locally to public/uploads/<subfolder>/ and return a fake
 * "Cloudinary-shaped" result so the caller doesn't need to change.
 * The returned secure_url is a relative path like /uploads/avatars/xyz.jpg
 * which the backend serves via express.static.
 */
const saveLocally = async (localFilePath, subfolder = "misc") => {
  const destDir = path.join(PUBLIC_UPLOADS_DIR, subfolder);
  await fs.promises.mkdir(destDir, { recursive: true });

  const ext      = path.extname(localFilePath) || ".jpg";
  const fileName = `local_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`;
  const destPath = path.join(destDir, fileName);

  await fs.promises.copyFile(localFilePath, destPath);

  // Get file size BEFORE deleting the source
  let fileBytes = 0;
  try {
    const stat = await fs.promises.stat(destPath);
    fileBytes = stat.size;
  } catch { /* ignore */ }

  await safeUnlink(localFilePath);

  const secure_url = `/uploads/${subfolder}/${fileName}`;
  console.log("💾 Saved locally (Cloudinary unreachable):", secure_url, `(${fileBytes} bytes)`);

  // Return same shape as Cloudinary response (including bytes so callers get real file size)
  return { secure_url, public_id: `local/${subfolder}/${fileName}`, bytes: fileBytes };
};

/**
 * Upload a local file to Cloudinary.
 * Falls back to local disk storage automatically when Cloudinary is
 * unreachable (e.g. DNS failure in dev / no internet).
 *
 * @param {string} localFilePath - Absolute path from Multer
 * @param {string} folder        - Subfolder inside "Chat/" (Cloudinary) or public/uploads/ (local)
 * @param {object} options       - Extra Cloudinary options
 * @returns {Promise<{secure_url: string, public_id: string}|null>}
 */
const uploadOnCloudinary = async (localFilePath, folder = "", options = {}) => {
  if (!localFilePath) return null;

  const base = "Chat";
  const folderPath =
    folder && String(folder).trim()
      ? `${base}/${folder.replace(/^\/+|\/+$/g, "")}`
      : base;

  // Local subfolder mirrors the Cloudinary folder name (e.g. "users" → "users")
  const localSubfolder = folder || "misc";

  if (!isCloudinaryReady) {
    console.warn("⚠️  Cloudinary not configured — saving locally.");
    try {
      return await saveLocally(localFilePath, localSubfolder);
    } catch (e) {
      console.error("Local save failed:", e?.message);
      await safeUnlink(localFilePath);
      return null;
    }
  }

  try {
    const response = await cloudinary.uploader.upload(localFilePath, {
      folder: folderPath,
      resource_type: "auto",
      ...options,
    });
    await safeUnlink(localFilePath);
    console.log("✅ Cloudinary upload success:", response?.secure_url);
    return response;
  } catch (error) {
    console.error("⚠️  Cloudinary upload failed:", error?.message || error);
    console.warn("⚠️  Falling back to local storage...");

    // Fall back to local disk for ANY Cloudinary error (network, auth, quota, etc.)
    try {
      return await saveLocally(localFilePath, localSubfolder);
    } catch (localErr) {
      console.error("❌ Local save also failed:", localErr?.message);
      await safeUnlink(localFilePath);
      return null;
    }
  }
};

/**
 * Delete an uploaded asset from Cloudinary and invalidate CDN.
 * Skips silently for local files (public_id starts with "local/").
 */
const deleteOnCloudinary = async (public_id, resource_type = "image") => {
  if (!public_id) return null;

  // Local files: delete from disk instead of Cloudinary
  if (public_id.startsWith("local/")) {
    const filePath = path.join(PUBLIC_UPLOADS_DIR, public_id.replace("local/", ""));
    try {
      await fs.promises.unlink(filePath);
    } catch {
      /* file already gone — fine */
    }
    return { result: "ok" };
  }

  try {
    if (!isCloudinaryReady) {
      console.warn("Cloudinary not configured; skipping delete.");
      return null;
    }
    const result = await cloudinary.uploader.destroy(public_id, {
      resource_type,
      invalidate: true,
    });
    return result;
  } catch (error) {
    console.error("Cloudinary delete error:", error?.message || error);
    return null;
  }
};

/**
 * Generate a thumbnail URL.
 * For local URLs (/uploads/...) returns the URL as-is.
 */
const generateThumbnailUrl = (secure_url, resource_type = "image") => {
  if (!secure_url) return null;

  // Local file — no transformations possible, return as-is
  if (secure_url.startsWith("/uploads/")) return secure_url;

  if (resource_type === "video") {
    return secure_url
      .replace(/\.[^/.]+$/, ".jpg")
      .replace("/upload/", "/upload/so_auto,w_400,c_fill,g_auto/");
  }

  return secure_url.replace(
    "/upload/",
    "/upload/w_400,c_fill,g_auto,q_auto,f_auto/"
  );
};

export { cloudinary, uploadOnCloudinary, deleteOnCloudinary, generateThumbnailUrl };
