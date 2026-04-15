import jwt from "jsonwebtoken";
import prisma from "../prisma.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.accessToken;

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    console.log("Authorization Header:", `Bearer ${token}`); // Log token to debug

    // Verify the token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    console.log("Decoded Token:", decoded);

    // Ensure user ID is properly set
    if (!decoded.id) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid token payload" });
    }

    // Attach user data to the request object
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, email: true },
    });

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }

    req.user = user; // Attach user data to the request
    console.log(
      `Authenticated user ID: ${user.id}, Username: ${user.username}`
    );
    next(); // Proceed to the next middleware/route handler
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token" });
  }
};

export default authMiddleware;
