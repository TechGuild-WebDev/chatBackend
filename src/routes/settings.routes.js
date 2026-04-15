import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  togglePinChat,
  toggleMuteChat,
  toggleFavoriteChat,
} from "../controller/settings.controller.js";

const router = Router();

router.use(authenticate);

router.post("/pin", togglePinChat);
router.post("/mute", toggleMuteChat);
router.post("/favorite", toggleFavoriteChat);

export default router;
