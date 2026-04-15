// src/utils/cloudinary.js
import "dotenv/config"; // ensures .env is read even if import order is wrong
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

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

// In dev, warn instead of throwing; in prod you may want to throw.
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
 * Upload a local file to Cloudinary.
 * @param {string} localFilePath - Absolute path from Multer
 * @param {string} folder - Subfolder inside "Chat/"
 * @param {object} options - Extra Cloudinary options
 * @returns {Promise<object|null>}
 */
const uploadOnCloudinary = async (localFilePath, folder = "", options = {}) => {
  if (!localFilePath) return null;

  const base = "Chat";
  const folderPath =
    folder && String(folder).trim()
      ? `${base}/${folder.replace(/^\/+|\/+$/g, "")}`
      : base;

  try {
    if (!isCloudinaryReady) {
      console.warn("Cloudinary not configured; skipping upload.");
      await safeUnlink(localFilePath);
      return null;
    }

    const response = await cloudinary.uploader.upload(localFilePath, {
      folder: folderPath,
      resource_type: "auto",
      ...options,
    });
    await safeUnlink(localFilePath);
    return response; // { secure_url, public_id, ... }
  } catch (error) {
    console.error("Cloudinary upload error:", error?.message || error);
    await safeUnlink(localFilePath);
    return null;
  }
};

/**
 * Delete an uploaded asset from Cloudinary and invalidate CDN.
 * @param {string} public_id
 * @param {"image"|"video"|"raw"} resource_type
 * @returns {Promise<object|null>}
 */
const deleteOnCloudinary = async (public_id, resource_type = "image") => {
  if (!public_id) return null;
  try {
    if (!isCloudinaryReady) {
      console.warn("Cloudinary not configured; skipping delete.");
      return null;
    }
    const result = await cloudinary.uploader.destroy(public_id, {
      resource_type,
      invalidate: true,
    });
    return result; // { result: "ok" | "not found" | ... }
  } catch (error) {
    console.error("Cloudinary delete error:", error?.message || error);
    return null;
  }
};

/**
 * Generate a thumbnail URL based on the original secure_url.
 * For images: applies optimization and cropping.
 * For videos: changes extension to .jpg and pulls a frame.
 * @param {string} secure_url
 * @param {string} resource_type - "image" or "video"
 * @returns {string|null}
 */
const generateThumbnailUrl = (secure_url, resource_type = "image") => {
  if (!secure_url) return null;

  if (resource_type === "video") {
    // For videos, replace extension with .jpg and add thumbnail transformations
    // Transformation: so_auto (start at interesting frame), w_400,h_400,c_fill
    return secure_url.replace(/\.[^/.]+$/, ".jpg").replace("/upload/", "/upload/so_auto,w_400,c_fill,g_auto/");
  }

  // For images, apply optimization and cropping
  // Transformation: w_400,h_400,c_fill,g_auto,q_auto,f_auto
  return secure_url.replace("/upload/", "/upload/w_400,c_fill,g_auto,q_auto,f_auto/");
};

export { cloudinary, uploadOnCloudinary, deleteOnCloudinary, generateThumbnailUrl };
