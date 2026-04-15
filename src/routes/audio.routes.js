import express from "express";
import {
  uploadAudioMessage,
  getUserAudioFiles,
  deleteAudioMessage
} from "../controller/audio.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = express.Router();

// Upload audio message
router.route("/upload").post(
  authenticate,
  upload.single("audio"), // Specific for audio files
  uploadAudioMessage
);

// Delete audio message
router.route("/:messageId").delete(
  authenticate,
  deleteAudioMessage
);

// Get user's audio files (Admin/Sub-admin only)
router.route("/user/:userId").get(
  authenticate,
  authorizeRoles("ADMIN", "SUB_ADMIN"),
  getUserAudioFiles
);

export default router;