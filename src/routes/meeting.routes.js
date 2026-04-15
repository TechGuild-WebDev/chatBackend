import express from "express";
import {
  createMeeting,
  getMeeting,
  getMeetings,
  getMeetingReminders,
  triggerTestReminder,
} from "../controller/meeting.controller.js";
import authMiddleware from "../utils/authMiddleware.js";

const router = express.Router();

// Apply the middleware to secure the routes
router.post("/schedule-meeting", authMiddleware, createMeeting);
router.get("/", authMiddleware, getMeetings);
router.get("/:id", authMiddleware, getMeeting);
router.get("/reminders/list", authMiddleware, getMeetingReminders);
router.get("/test-reminder/:meetingId", authMiddleware, triggerTestReminder);

export default router;
