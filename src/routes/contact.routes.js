import express from "express";
import {
    submitContactMessage,
    deleteContactMessage,
    updateContactMessageStatus

} from "../controller/contact.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Submit contact form - requires user to be logged in
router.post("/submit", authenticate, submitContactMessage);

// Delete contact message - requires admin authentication
router.delete("/messages/:id", authenticate, deleteContactMessage);
router.patch("/messages/:id/status", updateContactMessageStatus);



export default router;