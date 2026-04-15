import jwt from "jsonwebtoken";
import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";

// Extract token from headers, cookies, or query params// In your auth.middleware.js - UPDATE the extractToken function:
function extractToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let token = null;

  // Check for the 'Authorization' header with 'Bearer' token format
  if (
    authHeader &&
    typeof authHeader === "string" &&
    /^Bearer\s+/i.test(authHeader)
  ) {
    token = authHeader.replace(/^Bearer\s+/i, "");
  }
  // Check for REGULAR user cookie only (not admin)
  else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }
  // Check if the token is in query params (e.g., for testing)
  else if (req.query?.token) {
    token = String(req.query.token);
  }

  // Clean token to remove any extra quotes or spaces
  if (token) {
    token = token.replace(/^['"]+|['"]+$/g, "").trim();
  }

  return token;
}

// The rest of your authenticate middleware stays the same...

// Authentication middleware
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req); // Extract token from the request

  // If no token, throw an error
  if (!token) {
    throw new ApiError(401, "Not authenticated: Token is missing.");
  }

  try {
    // Verify the JWT token with the secret

    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Find the user in the database using the id from the token payload
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
        phone: true,
        createdAt: true,
        updatedAt: true,
        officeStartTime: true,
        officeEndTime: true
      },
    });

    // If the user doesn't exist, throw an error
    if (!user) {
      throw new ApiError(401, "User not found.");
    }

    // Attach user and token to the request object for use in subsequent middleware or routes
    req.user = user;
    req.token = token;

    // Continue to the next middleware or route handler
    next();
  } catch (error) {
    // Handle invalid token or expired token errors
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Token has expired.");
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "Invalid or malformed token.");
    }

    // Catch all other errors
    console.error("Authentication error:", error);
    throw new ApiError(401, "Authentication failed.");
  }
});