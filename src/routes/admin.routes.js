// routes/admin.routes.js
import { Router } from "express";
import { adminAuthenticate } from "../middlewares/adminAuth.middleware.js";

import { authorizeRoles } from "../middlewares/authorizeRoles.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
  adminLogin,
  adminLogout,
  getUserById,
  removeMemberFromRoom,
  addMembersToRoom,
  getGroupMessagesAsAdmin,
  deleteGroup,
  renameGroup,
  deleteUser,
  getAllUsersForAdmin,
  restoreUser,
  createUserByAdmin,
  updateUserByAdmin,
  getUserMessages,
  getUserMedia,
  getUserFiles,
  getUserAudioFiles,
  getUserGroups,
  getCurrentUser,
  getAllAdminsAndSuperAdmins,
  getAllContactMessages,
  getAllGroupsForAdmin,
  getAllMeetingsForAdmin,
  getMessageAnalytics,
  getMediaDistribution,
  getDirectConversation,
  getDepartments,
  getUsers,
  createGroup,
  getSignupRequests,
  getAllCalls,
} from "../controller/admin.controller.js";

const router = Router();

// 🔴 ADMIN PANEL ROUTES ONLY

// Admin Auth
router.post("/admin-login", adminLogin);
router.post("/admin-logout", adminLogout);
router.get("/current-user", adminAuthenticate, getCurrentUser);
router.get("/all-users", adminAuthenticate, getUsers);
router.get("/user/:userId", adminAuthenticate, getUserById);

router.get("/admin-team", adminAuthenticate, getAllAdminsAndSuperAdmins);

router.get("/analytics/messages", adminAuthenticate, getMessageAnalytics);
// In your admin.routes.js
router.get(
  "/analytics/media-distribution",
  adminAuthenticate,
  getMediaDistribution,
);

router.delete(
  "/delete-user/:userId",
  adminAuthenticate,
  authorizeRoles("SUPER_ADMIN"),
  deleteUser,
);

router.get(
  "/all",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getAllUsersForAdmin,
);

router.get(
  "/all-meetings",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getAllMeetingsForAdmin,
);

router.patch(
  "/restore/:userId",
  adminAuthenticate,
  authorizeRoles("SUPER_ADMIN"),
  restoreUser,
);

router.post(
  "/admin/users",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  upload.single("profileImage"),
  createUserByAdmin,
);
router.put(
  "/users/:userId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  upload.single("profileImage"),
  updateUserByAdmin,
);

// 🔐 User Analytics - ADMIN + SUPER_ADMIN
router.get(
  "/:userId/messages",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getUserMessages,
);
router.get(
  "/:userId/media",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getUserMedia,
);
router.get(
  "/:userId/groups",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getUserGroups,
);
router.get(
  "/:userId/files",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getUserFiles,
);
router.get(
  "/:userId/audio",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getUserAudioFiles,
);

// Add this new route for renaming groups

router.get(
  "/all-groups",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getAllGroupsForAdmin,
);

router.post(
  "/create-group",
  upload.single("avatar"),
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  createGroup,
);

router.put(
  "/rename/:groupId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  renameGroup,
);

router.delete(
  "/:groupId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  deleteGroup,
);

router.get(
  "/admin/group-chat/:roomId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getGroupMessagesAsAdmin,
);

router.put(
  "/add-members/:roomId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  addMembersToRoom,
);

router.delete(
  "/remove-member/:roomId/:userId",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  removeMemberFromRoom,
);

router.get("/messages", adminAuthenticate, getAllContactMessages);

router.get("/conversation/:userId/:otherUserId", getDirectConversation);

router.get("/departments", adminAuthenticate, getDepartments);

// Signup Requests Management
router.get(
  "/signup-requests",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getSignupRequests
);

// Get all calls (audio/video) for analytics
router.get(
  "/calls",
  adminAuthenticate,
  authorizeRoles("ADMIN", "SUPER_ADMIN"),
  getAllCalls
);

export default router;
