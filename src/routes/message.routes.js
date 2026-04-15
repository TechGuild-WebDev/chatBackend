// message.routes.js
import express from "express";
import {
  sendFileMessage,
  getMessages,
  getMessageStatus,
  deleteMessage,
  deleteForMe,
  editMessage,
  forwardMessages,
  togglePinMessage,
  getPinnedMessages,
  getPinLimits,
  autoUnpinExpiredMessages,
  getMessageWithPinInfo,
  toggleStarMessage,
  getStarredMessages,
  unstarAllMessages,
  searchMessages
} from "../controller/message.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

const multerUpload = upload.fields([{ name: "file", maxCount: 1 }, { name: "files", maxCount: 10 }]);

router.post("/send-file", authenticate, (req, res, next) => {
  multerUpload(req, res, function (err) {
    if (err) {
      console.error("Multer error:", err.message, err.field);
      return res.status(500).json({ success: false, message: err.message, field: err.field });
    }
    next();
  });
}, sendFileMessage);

// Forward messages
router.post("/forward", authenticate, forwardMessages);

// Pin/Unpin message - SINGLE ROUTE
router.post("/:messageId/pin", authenticate, togglePinMessage);

// Pinned messages for a room
router.get("/:roomId/pinned", authenticate, getPinnedMessages);

// Pin limits for a room
router.get("/:roomId/pin-limits", authenticate, getPinLimits);

// Auto-unpin expired (cron job - optional auth)
router.post("/cron/unpin-expired", autoUnpinExpiredMessages);

// Get pin info for specific message
router.get("/:messageId/pin-info", authenticate, getMessageWithPinInfo);

// Get status (seen/delivered) for a specific message
router.get("/:messageId/status", authenticate, getMessageStatus);

// Get all starred messages globably
router.get("/starred", authenticate, getStarredMessages);

// Star/Unstar message
router.post("/:messageId/star", authenticate, toggleStarMessage);

// Unstar all messages
router.post("/unstar-all", authenticate, unstarAllMessages);

// Search messages in a room
router.get("/:roomId/search", authenticate, searchMessages);

// Get messages for a room
router.get("/:roomId", authenticate, getMessages);

// Delete for me (already soft-deleted messages)
router.delete("/:messageId/delete-for-me", authenticate, deleteForMe);

// Delete message (for everyone)
router.delete("/:messageId", authenticate, deleteMessage);

// Edit message  
router.patch("/:messageId", authenticate, editMessage);

export default router;