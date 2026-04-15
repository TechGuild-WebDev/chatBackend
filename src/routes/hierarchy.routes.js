import express from "express";
import {
    getTeamHierarchy,
    getSimpleHierarchy,
    getTeamLeadsWithTeams,
    getUnassignedTeamMembers,
    getDepartments,
    autoAssignTeams,
    assignTeamMember,
    getDepartmentUsers,
    // ADD THESE NEW IMPORTS:
    getDesignationsByDepartment,
    getUsersByDesignation
} from "../controller/hierarchy.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Existing routes
router.get("/", authenticate, getTeamHierarchy);
router.get("/simple", authenticate, getSimpleHierarchy);
router.get("/team-leads", authenticate, getTeamLeadsWithTeams);
router.get("/unassigned", authenticate, getUnassignedTeamMembers);
router.get("/departments", authenticate, getDepartments);
router.post("/auto-assign", authenticate, autoAssignTeams);
router.post("/assign", authenticate, assignTeamMember);
router.get('/departments/:departmentName/users', authenticate, getDepartmentUsers);

// In your hierarchy routes
router.get("/departments/:departmentName/designations", authenticate, getDesignationsByDepartment);
router.get("/designations/:designationName/users", authenticate, getUsersByDesignation);

export default router;