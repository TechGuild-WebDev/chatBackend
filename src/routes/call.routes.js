import express from "express";
import { callController } from "../controller/call.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Call management routes
router.post("/initiate", callController.initiateCall);
router.post("/accept", callController.acceptCall);
router.post("/reject", callController.rejectCall);
router.post("/end", callController.endCall);
router.post("/missed", callController.markCallAsMissed);
router.get("/history", callController.getCallHistory);
router.get("/status/:callId", callController.getCallStatus);
router.get("/missed-count", callController.getMissedCallsCount);
router.get("/refresh-token/:callId", callController.refreshToken);
router.get("/users", callController.listUsers); // Helper endpoint for debugging
router.get("/callable-users", callController.getCallableUsers); // Get users available for calling
router.get("/check-user/:userId", callController.checkUserExists); // Helper endpoint for debugging
router.post("/validate-user-mapping", callController.validateUserMapping); // Validate user ID mapping
router.post("/create-test-user", callController.createTestUser); // Helper endpoint for debugging

export default router;
