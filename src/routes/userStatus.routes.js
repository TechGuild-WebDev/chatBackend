import express from "express";
import {
  updateUserStatus,
  getUserStatus,
  getUsersStatus,
} from "../controller/userStatus.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Update current user's status
router.post("/update-status", authenticate, updateUserStatus);

// Get specific user's status
router.get("/user/:userId", authenticate, getUserStatus);

// Get multiple users status
router.post("/users-status", authenticate, getUsersStatus);

export default router;
