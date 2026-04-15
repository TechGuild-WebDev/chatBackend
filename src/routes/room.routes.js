import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createOrGetChatRoom,
  getMyRooms,
  getRoomDetails,
} from "../controller/room.controller.js";

const router = Router();

router.use(authenticate);

router.post("/create-or-get-room", createOrGetChatRoom);
router.get("/my-rooms", getMyRooms);
router.get("/room/:roomId", getRoomDetails);

export default router;
