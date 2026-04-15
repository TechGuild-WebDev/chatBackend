import prisma from "../prisma.js";

// fcmController.js - registerToken function update karo
export async function registerToken(req, res, next) {
  try {
    const { token, platform = 'unknown' } = req.body;

    console.log('DEBUG: registerToken called with body:', req.body);

    // Better error handling
    if (!token || token === 'undefined' || token === 'null') {
      console.log('Token is missing or invalid:', token);
      return res.status(400).json({
        ok: false,
        message: "Token is required and must be valid"
      });
    }

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    // Validate token format (basic check)
    if (token.length < 10) {
      return res.status(400).json({ ok: false, message: "Invalid token format" });
    }

    await prisma.fcmToken.upsert({
      where: { token },
      update: {
        userId,
        platform,
        lastUsed: new Date()
      },
      create: {
        token,
        userId,
        platform
      },
    });

    console.log(`FCM token registered for user ${userId}`);
    return res.json({
      ok: true,
      message: "Token registered successfully"
    });
  } catch (err) {
    console.error("registerToken error:", err);
    return next(err);
  }
}

export async function unregisterToken(req, res, next) {
  try {
    const userId = req.user?.id;
    const { token } = req.body;

    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const result = await prisma.fcmToken.deleteMany({
      where: { token, userId }
    });

    if (result.count > 0) {
      console.log(`🗑️ FCM token unregistered for user ${userId}`);
      return res.json({
        ok: true,
        message: "Token unregistered successfully"
      });
    } else {
      return res.status(404).json({
        ok: false,
        message: "Token not found"
      });
    }
  } catch (err) {
    console.error("unregisterToken error:", err);
    return next(err);
  }
}

export async function getUserTokens(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const tokens = await prisma.fcmToken.findMany({
      where: { userId },
      select: {
        token: true,
        platform: true,
        addedAt: true,
        lastUsed: true
      }
    });

    return res.json({
      ok: true,
      tokens,
      count: tokens.length
    });
  } catch (err) {
    console.error("getUserTokens error:", err);
    return next(err);
  }
}