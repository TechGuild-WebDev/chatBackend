// adminAuth.middleware.js - FIXED VERSION
import jwt from "jsonwebtoken";
import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

// FIXED: Create SEPARATE token extraction for admin
function extractAdminToken(req) {
  let token = null;

  // Check admin-specific cookie FIRST
  if (req.cookies?.adminAccessToken) {
    token = req.cookies.adminAccessToken;
  }
  // Check Authorization header with admin prefix
  else if (req.headers.authorization || req.headers.Authorization) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (typeof authHeader === "string" && /^AdminBearer\s+/i.test(authHeader)) {
      token = authHeader.replace(/^AdminBearer\s+/i, "");
    }
    // DON'T accept regular Bearer tokens in admin routes
  }
  // Check admin-specific query parameter
  else if (req.query?.adminToken) {
    token = String(req.query.adminToken);
  }

  // Clean token
  if (token) {
    token = token.replace(/^['"]+|['"]+$/g, "").trim();
  }

  return token;
}

export const adminAuthenticate = asyncHandler(async (req, _res, next) => {
  // Use the FIXED admin token extraction
  const token = extractAdminToken(req);

  if (!token) {
    throw new ApiError(401, "Admin authentication required: Token is missing.");
  }

  try {
    // Use admin-specific secret with fallback
    const adminSecret = process.env.ADMIN_ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET + "_ADMIN";
    const payload = jwt.verify(token, adminSecret);

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        avatarUrl: true,
        publicId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new ApiError(401, "Admin user not found.");
    }

    // Additional check: user must be ADMIN or SUPER_ADMIN
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      throw new ApiError(403, "Access denied. Admin privileges required.");
    }

    req.user = user;
    req.adminToken = token; // Use different property name
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Admin token has expired.");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid or malformed admin token.");
    }
    console.error("Admin authentication error:", error);
    throw new ApiError(401, "Admin authentication failed.");
  }
});