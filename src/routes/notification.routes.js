import express from "express";
import { registerToken, unregisterToken, getUserTokens } from "../controller/notification.controller.js";
import { authenticate } from "../middlewares/authenticate.js";

const router = express.Router();

router.post("/token", authenticate, registerToken);
router.delete("/token", authenticate, unregisterToken);
router.get("/tokens", authenticate, getUserTokens);

export default router;