import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  createGroup,
  getMyGroups,
  getGroupDetails,
  addMembers,
  toggleFavorite,
  removeMember,
  renameGroup,
} from "../controller/group.controller.js";
import { authorizeRoles } from "../middlewares/authorizeRoles.middleware.js";
import { uploadAvatar } from "../middlewares/multerProduct.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/create-group", uploadAvatar.single("avatar"), createGroup);
router.get("/my-groups", getMyGroups);
router.put("/add-members/:groupId", addMembers);
router.post("/toggle-favorite/:groupId", toggleFavorite);
router.delete("/remove-member/:groupId/:userId", removeMember);


// keep same endpoint pattern you used
router.get("/group/:id", getGroupDetails);
router.put("/rename/:groupId", renameGroup);


export default router;