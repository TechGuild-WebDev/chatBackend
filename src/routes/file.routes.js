import express from "express";
import { updateGroupAvatar } from "../controller/file.controller.js";
import { uploadAvatar } from "../middlewares/multerProduct.middleware.js";
// import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// If you want to secure it, uncomment authenticate above and add here
router.put("/group/:groupId", uploadAvatar.single("avatar"), updateGroupAvatar);

export default router;
