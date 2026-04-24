// src/routes/chat.routes.js
import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

import {
  sendMessage,
  getMessages,
  markMessageRead,
  replyMessage,
  searchUsers,
  getChats,
  deleteRoom,
} from "../controller/chat.controller.js";

import { sendFile } from "../controller/file.controller.js";
import { getRoomCalls } from "../controller/callChat.controller.js";

// Import group & room controllers for legacy aliases
import { getMyGroups } from "../controller/group.controller.js";
import { createOrGetChatRoom } from "../controller/room.controller.js";

const router = Router();

// all chat routes secured
router.use(authenticate);

// ---------- core chat endpoints ----------
router.get("/messages/:roomId", getMessages);
router.post("/send-message", sendMessage);
router.post("/send-file", upload.single("file"), sendFile);

router.post("/mark-read/:roomId", markMessageRead);

router.get("/search", searchUsers);

router.get("/", getChats);

router.post("/message/reply", replyMessage);

// Get call history for a room
router.get("/calls/:roomId", getRoomCalls);

router.get("/my-groups", getMyGroups);

router.post("/create-or-get-room", createOrGetChatRoom);

router.delete("/rooms/:roomId", deleteRoom);


export default router;
