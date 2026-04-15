// routes/feedback.js
import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middlewares/auth.middleware.js";

import {
  submitFeedback,
  getAllFeedbacks,
  getFeedbackById,
  deleteFeedback,
  getFeedbackStats
} from '../controller/feedback.controller.js'
const router = Router();

// Public routes
router.post('/submit', submitFeedback);

// Admin routes (agar authentication chahiye toh middleware add karo)
router.get('/all', getAllFeedbacks);
router.get('/stats', getFeedbackStats);
router.get('/:id', getFeedbackById);
router.delete('/:id', deleteFeedback);

export default router