import { Router } from "express";
import {

  getCurrentUser,
  getUserById,
  getUsers,
  loginUser,

  logoutUser,
  registerUser,
  sendSignupOTP,
  updateUser,
  verifySignupOTP,
  sendResetPasswordOTP,
  verifyResetPasswordOTP,
  resetPassword,
  googleLogin,
  updateProfile,
  deleteProfileImage,
  patchMeBasics,
  resetToAvailable,
  addToFavorites,
  removeFromFavorites,
  getFavoriteMessages,
  checkIsFavorited,
  getMessageFavoritesCount,
  getUserGroups,
  deleteAccount,
  getTodayBirthdays,
  createSignupRequest
} from "../controller/user.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

// Public
router.post(
  "/register",
  upload.fields([{ name: "profileImage", maxCount: 1 }, { name: "avatar", maxCount: 1 }]),
  registerUser
);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.post("/google", googleLogin);
router.post("/signup-request", createSignupRequest);

// OTP
router.post("/send-signup-otp", sendSignupOTP);
router.post("/verify-signup-otp", verifySignupOTP);
router.post("/reset-password-otp", sendResetPasswordOTP);
router.post("/verify-reset-password-otp", verifyResetPasswordOTP);
router.post("/reset-password", resetPassword);

// Secured - All authenticated users
router.get("/current-user", authenticate, getCurrentUser);
router.get("/all-users", authenticate, getUsers);
router.get("/birthdays/today", authenticate, getTodayBirthdays);
router.get("/user/:userId", authenticate, getUserById);
router.get("/user/:userId/groups", authenticate, getUserGroups);
// Accept either `profileImage` or `avatar` field name so the client can't
// silently drop the file via a naming mismatch. Both endpoints normalize
// the uploaded file inside the controller.
router.put(
  "/update",
  authenticate,
  upload.fields([{ name: "profileImage", maxCount: 1 }, { name: "avatar", maxCount: 1 }]),
  updateUser
);
router.delete("/me/avatar", authenticate, deleteProfileImage);
router.put(
  "/me",
  authenticate,
  upload.fields([{ name: "avatar", maxCount: 1 }, { name: "profileImage", maxCount: 1 }]),
  updateProfile
);
router.patch("/me/basics", authenticate, patchMeBasics);
router.delete("/delete-account", authenticate, deleteAccount);

router.post("/reset-status", authenticate, resetToAvailable);

router.post("/messages/:messageId/favorite", authenticate, addToFavorites);
router.delete("/messages/:messageId/favorite", authenticate, removeFromFavorites);
router.get("/favorites", authenticate, getFavoriteMessages);
router.get("/messages/:messageId/favorite", authenticate, checkIsFavorited);
router.get("/messages/:messageId/favorites/count", authenticate, getMessageFavoritesCount);

export default router;