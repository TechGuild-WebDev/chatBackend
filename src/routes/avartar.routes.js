import express from "express";
import { updateGroupAvatar } from "../controller/avatar.controller.js";
// import { authMiddleware } from "../middleware/auth.js";
import { uploadAvatar } from "../middlewares/multerProduct.middleware.js";

const router = express.Router();

router.put("/group/:groupId", uploadAvatar.single("avatar"), updateGroupAvatar);

export default router;
