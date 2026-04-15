import { Router } from "express";
import { sendSignupOTP } from "../controller/user.controller.js"; // keep the .js extension

const router = Router();

// POST /api/v1/auth/send-signup-otp
router.post("/send-signup-otp", sendSignupOTP);

export default router;
