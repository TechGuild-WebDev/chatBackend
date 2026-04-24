import prisma from "../prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { OAuth2Client } from "google-auth-library";
import {
  genOTP,
  hash,
  compare,
  signResetToken,
  verifyResetToken,
} from "../utils/auth.util.js";
import { sendSignupOtpEmail } from "../utils/mail.service.js";
import { LOGO_URL, OTP_TTL_MINUTES } from "../config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  cloudinary,
  deleteOnCloudinary,
  uploadOnCloudinary,
} from "../utils/cloudinary.js";
// In updateProfile function, add this after updating user status to BUSY:
import { scheduleStatusReset } from "../services/statusScheduler.js";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_ANDROID);

function ttlToMs(s = "15m") {
  const m = String(s).match(/^(\d+)([mhd])$/);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  return m[2] === "m" ? n * 60e3 : m[2] === "h" ? n * 3600e3 : n * 86400e3;
}

// OTP verify (reset)
export const verifyResetPasswordOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) throw new ApiError(400, "Email and OTP are required");

  const record = await prisma.oTP.findUnique({ where: { email } });
  if (!record) throw new ApiError(401, "Invalid or expired OTP");

  if (new Date() > record.expiresAt)
    throw new ApiError(401, "OTP has expired");

  const valid = await bcrypt.compare(otp, record.code);
  if (!valid)
    throw new ApiError(401, "Invalid OTP");

  await prisma.oTP.delete({ where: { email } });

  const resetToken = signResetToken(email);
  return res
    .status(200)
    .json(new ApiResponse(200, { resetToken }, "OTP verified"));
});

// Register
export const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, username } = req.body;

  if ([name, email, password, phone, username].some((f) => f?.trim() === "")) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await prisma.user.findFirst({ where: { email } });
  if (existedUser)
    throw new ApiError(409, "User with email or phone already exist");

  let profileUrl = null;
  let publicId = null;
  // Accept either `profileImage` or `avatar` field name from the client
  const uploadedFile = req.file || req.files?.profileImage?.[0] || req.files?.avatar?.[0];
  if (uploadedFile?.path) {
    const uploadedImage = await uploadOnCloudinary(uploadedFile.path, "users");
    profileUrl = uploadedImage?.secure_url || null;
    publicId = uploadedImage?.public_id || null;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      username: username,
      name: name,
      phone: phone,
      avatarUrl: profileUrl, // FIX: actually persist the uploaded avatar URL
      publicId: publicId,
    },
    select: {
      id: true,
      username: true,
      email: true,
      phone: true,
      avatarUrl: true,
      name: true,
      createdAt: true,
      role: true,
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, user, "User Registered Successfully"));
});

// Update profile (avatar + basics)
// export const updateProfile = asyncHandler(async (req, res) => {
//   const userId = req.user.id;
//   const { username, email, status, phone, gender, birthDate } = req.body;

//   const data = {};
//   if (typeof username !== "undefined") data.username = username;
//   if (typeof email !== "undefined") data.email = email;
//   if (typeof status !== "undefined") data.status = status;
//   if (typeof phone !== "undefined") data.phone = phone;
//   if (typeof gender !== "undefined") data.gender = gender;
//   if (typeof birthDate !== "undefined") data.birthDate = birthDate;

//   if (req.file?.path) {
//     const uploadRes = await cloudinary.uploader.upload(req.file.path, {
//       folder: "avatars",
//       public_id: `user_${userId}`,
//       overwrite: true,
//       transformation: [
//         { width: 512, height: 512, crop: "fill", gravity: "auto" },
//       ],
//     });
//     data.avatarUrl = uploadRes.secure_url;
//     data.publicId = uploadRes.public_id;
//   }

//   const user = await prisma.user.update({
//     where: { id: userId },
//     data,
//     select: {
//       id: true,
//       username: true,
//       email: true,
//       status: true,
//       phone: true,
//       gender: true,
//       birthDate: true,
//       avatarUrl: true,
//     },
//   });

//   const io = req.app.get("io");
//   io?.emit("user-profile-updated", {
//     userId,
//     username: user.username,
//     status: user.status,
//     avatarUrl: user.avatarUrl,
//   });

//   return res
//     .status(200)
//     .json(new ApiResponse(200, user, "Profile updated successfully"));
// });


// Update user (name/phone/gender/password + avatar replace)
export const updateUser = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    username,
    phone,
    gender,
    password,
    status,
    birthDate,
    officeStartTime,
    officeEndTime
  } = req.body;

  // Detect uploaded file first so it counts as a valid "field to update"
  const uploadedFile =
    req.file ||
    req.files?.profileImage?.[0] ||
    req.files?.avatar?.[0] ||
    (Array.isArray(req.files) ? req.files[0] : null);

  const hasFile = Boolean(uploadedFile?.path);

  // Require at least one field OR a file
  if (!username && !phone && !gender && !password && !status && !birthDate && !officeStartTime && !officeEndTime && !hasFile)
    throw new ApiError(400, "No fields provided to update.");

  const updateData = {};

  if (username) {
    const existingUser = await prisma.user.findFirst({
      where: { username, id: { not: userId } }
    });
    if (existingUser) throw new ApiError(409, "Username already taken");
    updateData.username = username;
  }

  if (phone) updateData.phone = phone;
  if (gender) updateData.gender = gender;
  if (status) updateData.status = status;
  if (birthDate) updateData.birthDate = birthDate;
  if (officeStartTime) updateData.officeStartTime = officeStartTime;
  if (officeEndTime) updateData.officeEndTime = officeEndTime;
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    updateData.password = hashedPassword;
  }

  // ── Avatar upload ─────────────────────────────────────────────────────────
  if (hasFile) {
    const existedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true, publicId: true },
    });

    // Clean up previous asset (best-effort)
    if (existedUser?.publicId) {
      await deleteOnCloudinary(existedUser.publicId).catch((e) =>
        console.warn("Old avatar cleanup failed:", e?.message)
      );
    }

    let uploadedImage = await uploadOnCloudinary(uploadedFile.path, "users");

    // Last-resort fallback: save directly to public/uploads/users/ inside the controller
    if (!uploadedImage?.secure_url) {
      try {
        const fs   = await import("fs");
        const path = await import("path");
        const { fileURLToPath } = await import("url");
        const __dirname = path.default.dirname(fileURLToPath(import.meta.url));
        const destDir   = path.default.join(__dirname, "../../public/uploads/users");
        await fs.default.promises.mkdir(destDir, { recursive: true });

        const ext      = path.default.extname(uploadedFile.originalname || uploadedFile.path) || ".jpg";
        const fileName = `avatar_${userId}_${Date.now()}${ext}`;
        const destPath = path.default.join(destDir, fileName);

        // file may have already been moved — try copy, then rename as fallback
        try {
          await fs.default.promises.copyFile(uploadedFile.path, destPath);
        } catch {
          await fs.default.promises.rename(uploadedFile.path, destPath);
        }

        console.log("💾 Controller fallback — saved avatar locally:", fileName);
        uploadedImage = {
          secure_url: `/uploads/users/${fileName}`,
          public_id:  `local/users/${fileName}`,
        };
      } catch (fallbackErr) {
        console.error("❌ All upload methods failed:", fallbackErr?.message);
        return res.status(500).json({
          success: false,
          message: "Failed to save profile image. Please try again.",
        });
      }
    }

    updateData.avatarUrl = uploadedImage.secure_url;
    updateData.publicId  = uploadedImage.public_id;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      phone: true,
      gender: true,
      birthDate: true,
      avatarUrl: true,
      busyStartTime: true,
      busyDuration: true,
      isDND: true,
      officeStartTime: true,
      officeEndTime: true,
    },
  });

  // Broadcast the updated profile to EVERY connected client so that all users
  // (not just the one who made the change) see the new data in real time.
  const io = req.app.get("io");
  const socketPayload = {
    userId: updatedUser.id,
    username: updatedUser.username,
    email: updatedUser.email,
    status: updatedUser.status,
    phone: updatedUser.phone,
    gender: updatedUser.gender,
    birthDate: updatedUser.birthDate,
    avatarUrl: updatedUser.avatarUrl,
    busyStartTime: updatedUser.busyStartTime,
    busyDuration: updatedUser.busyDuration,
    isDND: updatedUser.isDND,
  };

  io?.emit("user-profile-updated", socketPayload);
  io?.emit("user-status-changed", {
    userId: updatedUser.id,
    status: updatedUser.status,
    busyStartTime: updatedUser.busyStartTime,
    busyDuration: updatedUser.busyDuration,
    isDND: updatedUser.isDND,
  });

  res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Profile updated successfully"));
});


export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    username,
    email,
    status,
    phone,
    gender,
    birthDate,
    busyStartTime,
    busyDuration,
    isDND,
    officeStartTime,
    officeEndTime
  } = req.body;

  // FIX: Only map status when the client actually sent one. Previously we
  // defaulted to 'AVAILABLE' and always wrote it, which meant a user who only
  // uploaded an avatar would have their DND/BUSY status silently reset.
  let statusEnum = null;
  if (typeof status === "string" && status.trim() !== "") {
    const statusLower = status.toLowerCase();
    if (statusLower.includes("busy")) statusEnum = "BUSY";
    else if (statusLower.includes("dnd") || statusLower.includes("do not disturb")) statusEnum = "DND";
    else if (statusLower.includes("available")) statusEnum = "AVAILABLE";
  }

  const data = {};
  if (typeof username !== "undefined") data.username = username;
  if (typeof email !== "undefined") data.email = email;
  if (statusEnum) data.status = statusEnum;
  if (typeof phone !== "undefined") data.phone = phone;
  if (typeof gender !== "undefined") data.gender = gender;
  if (typeof birthDate !== "undefined") data.birthDate = birthDate || null;
  if (typeof officeStartTime !== "undefined") data.officeStartTime = officeStartTime;
  if (typeof officeEndTime !== "undefined") data.officeEndTime = officeEndTime;

  // FIX: Handle file upload properly and accept either `avatar` or `profileImage`
  // field name so the frontend can't silently drop the file due to a naming mismatch.
  const uploadedFile =
    req.file ||
    req.files?.avatar?.[0] ||
    req.files?.profileImage?.[0] ||
    (Array.isArray(req.files) ? req.files[0] : null);

  if (uploadedFile?.path) {
    try {
      // Clean up the previous Cloudinary asset so we don't leak storage
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { publicId: true },
      });
      if (existing?.publicId) {
        cloudinary.uploader.destroy(existing.publicId).catch((e) =>
          console.warn("Old avatar cleanup failed:", e?.message)
        );
      }

      const uploadRes = await cloudinary.uploader.upload(uploadedFile.path, {
        folder: "avatars",
        public_id: `user_${userId}_${Date.now()}`,
        overwrite: true,
        transformation: [
          { width: 512, height: 512, crop: "fill", gravity: "auto" },
        ],
      });
      data.avatarUrl = uploadRes.secure_url;
      data.publicId = uploadRes.public_id;
    } catch (uploadError) {
      console.error("Cloudinary upload error:", uploadError);
      return res.status(500).json({
        success: false,
        message: "Failed to upload profile image",
      });
    }
  }

  if (statusEnum === 'BUSY' && busyStartTime && busyDuration) {
    data.busyStartTime = new Date(busyStartTime);
    data.busyDuration = busyDuration;
    data.isDND = false;

    // SCHEDULE AUTO-RESET
    const resetTime = new Date(
      new Date(busyStartTime).getTime() + busyDuration * 60 * 1000
    );
    await scheduleStatusReset(userId, resetTime);

    console.log(`Scheduled auto-reset for user ${userId} at ${resetTime}`);
  }

  if (statusEnum === 'DND') {
    data.busyStartTime = null;
    data.busyDuration = null;
    data.isDND = true;
  }

  // Only force-clear busy fields if the client explicitly set status=AVAILABLE
  if (statusEnum === 'AVAILABLE') {
    data.busyStartTime = null;
    data.busyDuration = null;
    data.isDND = false;
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        phone: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        busyStartTime: true,
        busyDuration: true,
        isDND: true
      },
    });

    // FIX: Emit consistent socket data
    const io = req.app.get("io");
    const socketPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      status: user.status, // Use database status
      phone: user.phone,
      gender: user.gender,
      birthDate: user.birthDate,
      avatarUrl: user.avatarUrl,
      busyStartTime: user.busyStartTime,
      busyDuration: user.busyDuration,
      isDND: user.isDND
    };

    io?.emit("user-profile-updated", socketPayload);
    io?.emit("user-status-changed", {
      userId: user.id,
      status: user.status,
      busyStartTime: user.busyStartTime,
      busyDuration: user.busyDuration,
      isDND: user.isDND
    });

    return res.status(200).json(new ApiResponse(200, user, "Profile updated successfully"));

  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({
      success: false,
      message: "Database update failed"
    });
  }
});


// Delete profile image
export const deleteProfileImage = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { publicId: true },
  });

  if (user?.publicId) {
    await cloudinary.uploader.destroy(user.publicId).catch(() => { });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null, publicId: null },
  });

  const io = req.app.get("io");
  io?.emit("user-profile-updated", { userId, avatarUrl: null });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Profile image deleted"));
});

// Patch basics (username/status/theme)
// export const patchMeBasics = asyncHandler(async (req, res) => {
//   const userId = req.user.id;
//   const { username, status, theme } = req.body;

//   const user = await prisma.user.update({
//     where: { id: userId },
//     data: {
//       username: typeof username === "string" ? username : undefined,
//       status: typeof status === "string" ? status : undefined,
//       theme: typeof theme === "string" ? theme.toUpperCase() : undefined,
//     },
//     select: {
//       id: true,
//       email: true,
//       username: true,
//       status: true,
//       theme: true,
//       avatarUrl: true,
//     },
//   });

//   const io = req.app.get("io");
//   io?.emit("user-profile-updated", {
//     userId,
//     username: user.username,
//     status: user.status,
//     avatarUrl: user.avatarUrl,
//   });

//   return res.status(200).json(new ApiResponse(200, user, "Basics updated"));
// });


// Patch basics (username/status/theme) - UPDATED VERSION
export const patchMeBasics = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    username,
    status,
    theme,
    busyStartTime,
    busyDuration,
    isDND
  } = req.body;

  // STATUS MAPPING
  let statusEnum;
  if (status) {
    if (status.includes('Busy') || status === 'BUSY') {
      statusEnum = 'BUSY';
    } else if (status === 'DND' || status === 'Do Not Disturb') {
      statusEnum = 'DND';
    } else if (status === 'Available' || status === 'AVAILABLE') {
      statusEnum = 'AVAILABLE';
    } else {
      statusEnum = 'AVAILABLE';
    }
  }

  const updateData = {};
  if (typeof username === "string") updateData.username = username;
  if (statusEnum) updateData.status = statusEnum; // Mapped enum value
  if (typeof theme === "string") updateData.theme = theme.toUpperCase();
  if (busyStartTime !== undefined) updateData.busyStartTime = busyStartTime;
  if (busyDuration !== undefined) updateData.busyDuration = busyDuration;
  if (isDND !== undefined) updateData.isDND = isDND;

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      email: true,
      username: true,
      status: true,
      theme: true,
      avatarUrl: true,
      busyStartTime: true,
      busyDuration: true,
      isDND: true
    },
  });

  const io = req.app.get("io");

  // Both events emit करें
  io?.emit("user-profile-updated", {
    userId,
    username: user.username,
    status: user.status,
    avatarUrl: user.avatarUrl,
  });

  io?.emit("user-status-changed", {
    userId: user.id,
    status: user.status,
    busyStartTime: user.busyStartTime,
    busyDuration: user.busyDuration,
    isDND: user.isDND,
    isBusy: user.status === 'BUSY'
  });

  return res.status(200).json(new ApiResponse(200, user, "Basics updated"));
});

// Login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, phone, password } = req.body;

  if (!(email || phone)) throw new ApiError(400, "Email or phone is required");
  if (!password) throw new ApiError(400, "Password is required");

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: email || undefined }, { phone: phone || undefined }],
    },
  });
  if (!user) throw new ApiError(404, "User does not exist");
  if (user.status === "DELETED" || !user.isActive) {
    throw new ApiError(403, "Account deleted. Please contact admin.");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new ApiError(401, "Incorrect Password");

  const accessToken = jwt.sign(
    { id: user.id },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );

  const { password: _, ...loggedInUser } = user;

  const options = { httpOnly: true, secure: true, sameSite: "none" };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken },
        "User logged in successfully"
      )
    );
});

// Google login
export const googleLogin = asyncHandler(async (req, res) => {
  const { idToken, id_token, token: tokenFromBody } = req.body || {};
  const incomingIdToken = idToken || id_token || tokenFromBody;
  if (!incomingIdToken || typeof incomingIdToken !== "string") {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "idToken is required"));
  }

  const allowedAudiences = [
    process.env.GOOGLE_CLIENT_ID_ANDROID,
    process.env.GOOGLE_CLIENT_ID_WEB,
    process.env.GOOGLE_CLIENT_ID_IOS,
  ].filter(Boolean);
  if (allowedAudiences.length === 0)
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Server misconfiguration"));

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: incomingIdToken,
      audience: allowedAudiences,
    });
    payload = ticket.getPayload();
  } catch (e) {
    console.error("google verifyIdToken error:", e?.message || e);
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Google verification failed"));
  }

  const {
    email,
    name,
    picture,
    sub: googleId,
    iss,
    aud,
    exp,
    email_verified,
  } = payload || {};
  if (!email)
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Invalid Google token payload"));
  if (
    iss &&
    !(iss === "accounts.google.com" || iss === "https://accounts.google.com")
  )
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Invalid token issuer"));
  if (aud && !allowedAudiences.includes(aud))
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Audience mismatch"));
  const now = Math.floor(Date.now() / 1000);
  if (typeof exp === "number" && exp < now)
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Google token expired"));
  if (email_verified === false)
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Email not verified by Google"));

  const baseUsername = email.split("@")[0];
  let user;
  try {
    user = await prisma.user.upsert({
      where: { email },
      update: { name: name ?? undefined, profileImage: picture ?? undefined },
      create: {
        email,
        username: baseUsername,
        name: name ?? null,
        profileImage: picture ?? null,
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        profileImage: true,
        isActive: true, // Added
        status: true    // Added
      },
    });
  } catch (err) {
    if (err?.code === "P2002" && err?.meta?.target?.includes("username")) {
      const uniqueUsername = `${baseUsername}${Math.floor(
        Math.random() * 10000
      )}`;
      user = await prisma.user.upsert({
        where: { email },
        update: { name: name ?? undefined, profileImage: picture ?? undefined },
        create: {
          email,
          username: uniqueUsername,
          name: name ?? null,
          profileImage: picture ?? null,
        },
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          profileImage: true,
          isActive: true, // Added
          status: true    // Added
        },
      });
    } else {
      throw err;
    }
  }

  if (user.status === "DELETED" || !user.isActive) {
    return res
      .status(403)
      .json(new ApiResponse(403, null, "Account deleted. Please contact admin."));
  }

  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret)
    return res
      .status(500)
      .json(new ApiResponse(500, null, "Server misconfiguration"));
  const expCfg = process.env.ACCESS_TOKEN_EXPIRY || "15m";
  const accessToken = jwt.sign({ id: user.id }, secret, { expiresIn: expCfg });

  const isProd = process.env.NODE_ENV === "production";
  res
    .cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: ttlToMs(expCfg),
    })
    .status(200)
    .json(
      new ApiResponse(200, { user, accessToken }, "User logged in successfully")
    );
});

// Logout
export const logoutUser = asyncHandler(async (req, res) => {
  res.clearCookie("accessToken", { httpOnly: true, secure: true });
  return res
    .status(200)
    .json(new ApiResponse(200, null, "User logged out successfully"));
});

// Get current user
export const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "current user fetched successfully"));
});

// CORRECTED getUsers function
export const getUsers = asyncHandler(async (req, res) => {
  const currentUser = req.user;

  const users = await prisma.user.findMany({
    where: {
      // ADD THIS FILTER to exclude soft-deleted users
      isActive: true,
      // OR use status filter if you prefer:
      // status: { not: 'DELETED' }
    },
    select: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      status: true,
      busyStartTime: true,
      busyDuration: true,
      isDND: true,
      isOnline: true,
      lastSeen: true,
      phone: true,
      gender: true,
      birthDate: true,
      officeStartTime: true,
      officeEndTime: true
      // isActive: true,
    },
  });

  // Add real-time status calculation
  const usersWithRealTimeStatus = users.map(user => {
    let realTimeStatus = user.status;
    let busyUntil = null;
    let remainingMinutes = 0;

    if (user.status === 'BUSY' && user.busyStartTime && user.busyDuration) {
      const startTime = new Date(user.busyStartTime);
      busyUntil = new Date(startTime.getTime() + user.busyDuration * 60 * 1000);
      const now = new Date();
      const timeDiff = busyUntil.getTime() - now.getTime();
      remainingMinutes = Math.max(0, Math.ceil(timeDiff / (1000 * 60)));

      if (timeDiff <= 0) {
        realTimeStatus = 'AVAILABLE';
      } else {
        realTimeStatus = `Busy (${remainingMinutes} min)`;
      }
    }

    return {
      ...user,
      realTimeStatus,
      busyUntil,
      remainingMinutes,
      isBusy: user.status === 'BUSY',
      isAvailable: realTimeStatus === 'AVAILABLE'
    };
  });

  res.status(200).json(new ApiResponse(200, usersWithRealTimeStatus, "Users retrieved successfully"));
});

// Get users whose birthday is today
export const getTodayBirthdays = asyncHandler(async (req, res) => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const monthDay = `${month}-${day}`;

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      birthDate: {
        endsWith: `-${monthDay}`,
      },
      id: {
        not: req.user.id,
      },
    },
    select: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
      birthDate: true,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, users, "Today's birthdays fetched successfully"));
});

// Get user by id
export const getUserById = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      isOnline: true,
      email: true,
      phone: true,
      gender: true,
      birthDate: true,
      role: true,
      createdAt: true,
      avatarUrl: true,
      publicId: true,
      status: true,
      busyStartTime: true,
      busyDuration: true,
      isDND: true,
      lastSeen: true,
      officeStartTime: true,
      officeEndTime: true
    },
  });

  if (!user) throw new ApiError(404, "User not found");
  res
    .status(200)
    .json(new ApiResponse(200, user, "User retrieved successfully"));
});

export const getUserGroups = asyncHandler(async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * parseInt(limit);

    // Verify user exists (like your pattern)
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true
      }
    });

    if (!targetUser) {
      throw new ApiError(404, "User not found");
    }

    // Get group memberships (like getMyGroups but for target user)
    const [groupMemberships, totalCount] = await Promise.all([
      prisma.chatMember.findMany({
        where: {
          userId: userId,
          room: { isGroup: true }
        },
        include: {
          room: {
            include: {
              members: {
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                      name: true,
                      avatarUrl: true,
                    },
                  },
                },
              },
              messages: {
                take: 10,
                orderBy: { createdAt: "desc" },
                include: {
                  sender: {
                    select: {
                      id: true,
                      username: true,
                      name: true,
                      avatarUrl: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { room: { updatedAt: "desc" } },
        skip,
        take: parseInt(limit),
      }),
      prisma.chatMember.count({
        where: {
          userId: userId,
          room: { isGroup: true }
        },
      }),
    ]);

    // Format groups (identical to getMyGroups pattern)
    const formattedGroups = await Promise.all(
      groupMemberships.map(async (membership) => {
        const room = membership.room;

        // FUNCTION: Check if message is a system message (SAME as getMyGroups)
        const isSystemMessage = (message) => {
          const content = message.content || '';
          return (
            message.type === "SYSTEM" ||
            (/added.*to the group/i.test(content) && /by.*/i.test(content)) ||
            (/removed.*from the group/i.test(content) && /by.*/i.test(content)) ||
            /renamed the group to/i.test(content) ||
            /Group renamed to.*by/i.test(content) ||
            /left the group/i.test(content) ||
            /joined the group/i.test(content) ||
            /created the group/i.test(content) ||
            (/added by/i.test(content) && !content.includes('"') && content.split(' ').length <= 5)
          );
        };

        // FILTER OUT system messages and get the last actual message
        const nonSystemMessages = room.messages.filter(msg => !isSystemMessage(msg));
        const lastActualMessage = nonSystemMessages[0] || room.messages[0] || null;

        const members = room.members.map((m) => ({
          id: m.user.id,
          username: m.user.username || m.user.name || "Unknown",
          avatarUrl: m.user.avatarUrl || null,
          role: m.role,
          mutedUntil: m.mutedUntil,
        }));

        // Calculate unread count for THE TARGET USER
        const unreadCount = await prisma.messageStatus.count({
          where: {
            message: { 
              roomId: room.id,
              type: { not: "SYSTEM" }
            },
            userId: userId,  // Use the target user's ID
            status: { not: "READ" },
          },
        });

        // FORMAT last message content (SAME as getMyGroups)
        const formatLastMessageContent = (message) => {
          if (!message) return null;

          switch (message.type) {
            case 'IMAGE':
              return '📷 Image';
            case 'FILE':
              return '📄 File';
            case 'AUDIO':
              return '🎵 Audio';
            case 'VIDEO':
              return '🎬 Video';
            case 'TEXT':
            default:
              return message.content || 'Message';
          }
        };

        const formattedLastMessage = lastActualMessage
          ? {
            id: lastActualMessage.id,
            content: formatLastMessageContent(lastActualMessage),
            type: lastActualMessage.type,
            sender: lastActualMessage.sender
              ? {
                id: lastActualMessage.sender.id,
                username:
                  lastActualMessage.sender.username ||
                  lastActualMessage.sender.name ||
                  "Unknown",
                avatarUrl: lastActualMessage.sender.avatarUrl || null,
              }
              : null,
            createdAt: lastActualMessage.createdAt,
            rawContent: lastActualMessage.content,
            isSystem: isSystemMessage(lastActualMessage),
          }
          : null;

        // safer lastMessageTime fallback
        const lastMessageTime = lastActualMessage?.createdAt || room.updatedAt || room.createdAt;

        return {
          id: room.id,
          name: room.name || "Unnamed Group",
          avatarUrl: room.avatarUrl || null,
          lastMessage: formattedLastMessage,
          lastMessageTime,
          unreadCount,
          members,
          isPinned: membership.isPinned || false,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
          _debug: {
            totalMessages: room.messages.length,
            nonSystemMessages: nonSystemMessages.length,
            lastMessageIsSystem: lastActualMessage ? isSystemMessage(lastActualMessage) : false
          }
        };
      })
    );

    // SAME sorting logic as getMyGroups
    formattedGroups.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
    });

    // Return EXACT same format as getMyGroups
    return res.status(200).json({
      success: true,
      data: {
        groups: formattedGroups,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      },
      message: "User groups fetched successfully",
    });

  } catch (error) {
    console.error("getUserGroups error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching user groups",
      error: error.message,
    });
  }
});



// Send signup OTP
export const sendSignupOTP = asyncHandler(async (req, res) => {
  const { email, name } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const existedUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existedUser) throw new ApiError(409, "Email already in use");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const ttl = Number(OTP_TTL_MINUTES || 10);
  const otpExpiry = new Date(Date.now() + ttl * 60 * 1000);

  await prisma.oTP.upsert({
    where: { email },
    update: { code: hashedOtp, expiresAt: otpExpiry },
    create: { email, code: hashedOtp, expiresAt: otpExpiry },
  });

  await sendSignupOtpEmail({ to: email, otp, name, logoUrl: LOGO_URL });
  return res.status(200).json(new ApiResponse(200, null, "OTP sent to email"));
});

// Verify signup OTP
export const verifySignupOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) throw new ApiError(400, "Email and OTP required");

  const record = await prisma.oTP.findUnique({ where: { email } });
  if (!record) throw new ApiError(401, "Invalid or expired OTP");

  if (new Date() > record.expiresAt)
    throw new ApiError(401, "OTP has expired");

  const valid = await bcrypt.compare(otp, record.code);
  if (!valid) throw new ApiError(401, "Invalid OTP");

  await prisma.oTP.delete({ where: { email } });
  return res.status(200).json(new ApiResponse(200, null, "OTP verified"));
});

// Reset password OTP (via email)
export const sendResetPasswordOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (!user) throw new ApiError(404, "User not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const ttl = Number(OTP_TTL_MINUTES || 10);
  const otpExpiry = new Date(Date.now() + ttl * 60 * 1000);

  await prisma.oTP.upsert({
    where: { email },
    update: { code: hashedOtp, expiresAt: otpExpiry },
    create: { email, code: hashedOtp, expiresAt: otpExpiry },
  });

  await sendSignupOtpEmail({
    to: email,
    otp,
    name: user.name,
    logoUrl: LOGO_URL,
  });
  return res.status(200).json(new ApiResponse(200, null, "OTP sent to email"));
});

// Signup Request
export const createSignupRequest = asyncHandler(async (req, res) => {
  const { name, email, mobile, companyName } = req.body;

  if (!name || !email || !mobile || !companyName)
    throw new ApiError(400, "All fields are required");

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    throw new ApiError(400, "Please enter a valid email address");

  // Check if already registered as a user
  const existedUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existedUser)
    throw new ApiError(409, "Email is already associated with an account");

  // Check if request already exists
  const existedRequest = await prisma.signupRequest.findUnique({
    where: { email },
  });
  if (existedRequest)
    throw new ApiError(409, "A registration request has already been sent for this email");

  // Create the request
  const signupRequest = await prisma.signupRequest.create({
    data: {
      name,
      email,
      mobile,
      companyName,
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, signupRequest, "Signup request submitted successfully"));
});

// Reset password
export const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;

  if (!resetToken || !newPassword)
    throw new ApiError(400, "Reset token and new password are required");

  // If confirmPassword is provided, validate match
  if (confirmPassword && newPassword !== confirmPassword)
    throw new ApiError(400, "Passwords do not match");

  if (newPassword.length < 6)
    throw new ApiError(400, "Password must be at least 6 characters long");

  // Verify reset token to extract email
  let email;
  try {
    const decoded = verifyResetToken(resetToken);
    email = decoded?.email;
  } catch (err) {
    throw new ApiError(401, "Invalid or expired reset token");
  }

  if (!email) throw new ApiError(401, "Invalid reset token");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  });
  if (!user) throw new ApiError(404, "User not found");

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword)
    throw new ApiError(400, "New password cannot be the same as current password");

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { email },
    data: { password: hashedPassword, updatedAt: new Date() },
  });
  return res
    .status(200)
    .json(new ApiResponse(200, null, "Password reset successfully"));
});



// ADD TO YOUR user.controller.js
export const resetToAvailable = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        username: true
      }
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    console.log(`Manual status reset requested for user: ${user.username}, current status: ${user.status}`);

    // Reset to available regardless of current status
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'AVAILABLE',
        busyStartTime: null,
        busyDuration: null,
        isDND: false
      },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        phone: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        busyStartTime: true,
        busyDuration: true,
        isDND: true,
        isOnline: true
      }
    });

    console.log(`Status reset to Available for user: ${updatedUser.username}`);

    // Emit socket events
    const io = req.app.get("io");

    // Emit to all clients
    io?.emit("user-profile-updated", {
      userId: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      status: updatedUser.status,
      phone: updatedUser.phone,
      gender: updatedUser.gender,
      birthDate: updatedUser.birthDate,
      avatarUrl: updatedUser.avatarUrl,
      busyStartTime: updatedUser.busyStartTime,
      busyDuration: updatedUser.busyDuration,
      isDND: updatedUser.isDND
    });

    io?.emit("user-status-changed", {
      userId: updatedUser.id,
      status: updatedUser.status,
      busyStartTime: updatedUser.busyStartTime,
      busyDuration: updatedUser.busyDuration,
      isDND: updatedUser.isDND,
      isOnline: updatedUser.isOnline,
      lastSeen: null
    });

    // Emit specific event for auto-reset
    io?.emit("status-auto-reset", {
      userId: updatedUser.id,
      message: 'Status reset to Available',
      newStatus: 'AVAILABLE',
      timestamp: new Date()
    });

    return res.status(200).json(
      new ApiResponse(200, updatedUser, "Status reset to Available successfully")
    );

  } catch (error) {
    console.error("Reset status error:", error);
    throw new ApiError(500, "Failed to reset status");
  }
});


// 🟢 ADD TO user.controller.js

// Add message to favorites
export const addToFavorites = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  // Check if message exists
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          avatarUrl: true
        }
      },
      room: {
        select: {
          id: true,
          name: true,
          roomType: true
        }
      }
    }
  });

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  // Check if already favorited
  const existingFavorite = await prisma.favoriteMessage.findUnique({
    where: {
      userId_messageId: {
        userId,
        messageId
      }
    }
  });

  if (existingFavorite) {
    throw new ApiError(400, "Message already in favorites");
  }

  // Add to favorites
  const favorite = await prisma.favoriteMessage.create({
    data: {
      userId,
      messageId
    },
    include: {
      message: {
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatarUrl: true
            }
          },
          room: {
            select: {
              id: true,
              name: true,
              roomType: true
            }
          }
        }
      }
    }
  });

  return res.status(201).json(
    new ApiResponse(201, favorite, "Message added to favorites successfully")
  );
});

// Remove message from favorites
export const removeFromFavorites = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const favorite = await prisma.favoriteMessage.findUnique({
    where: {
      userId_messageId: {
        userId,
        messageId
      }
    }
  });

  if (!favorite) {
    throw new ApiError(404, "Favorite not found");
  }

  await prisma.favoriteMessage.delete({
    where: {
      userId_messageId: {
        userId,
        messageId
      }
    }
  });

  return res.status(200).json(
    new ApiResponse(200, null, "Message removed from favorites successfully")
  );
});

// Get user's favorite messages
export const getFavoriteMessages = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;

  const skip = (page - 1) * limit;

  const favorites = await prisma.favoriteMessage.findMany({
    where: { userId },
    include: {
      message: {
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              status: true
            }
          },
          room: {
            select: {
              id: true,
              name: true,
              roomType: true,
              avatarUrl: true
            }
          },
          replies: {
            take: 1,
            include: {
              sender: {
                select: {
                  id: true,
                  username: true
                }
              }
            }
          },
          reactions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true
                }
              }
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    skip: parseInt(skip),
    take: parseInt(limit)
  });

  const totalFavorites = await prisma.favoriteMessage.count({
    where: { userId }
  });

  return res.status(200).json(
    new ApiResponse(200, {
      favorites,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalFavorites,
        pages: Math.ceil(totalFavorites / limit)
      }
    }, "Favorite messages retrieved successfully")
  );
});

// Check if message is favorited by user
export const checkIsFavorited = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  const favorite = await prisma.favoriteMessage.findUnique({
    where: {
      userId_messageId: {
        userId,
        messageId
      }
    }
  });

  return res.status(200).json(
    new ApiResponse(200, { isFavorited: !!favorite }, "Favorite status checked successfully")
  );
});

// Get favorites count for a message
export const getMessageFavoritesCount = asyncHandler(async (req, res) => {
  const { messageId } = req.params;

  const favoritesCount = await prisma.favoriteMessage.count({
    where: { messageId }
  });

  // Get users who favorited this message
  const favoritedBy = await prisma.favoriteMessage.findMany({
    where: { messageId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          avatarUrl: true
        }
      }
    },
    take: 10 // Limit to first 10 users
  });

  return res.status(200).json(
    new ApiResponse(200, {
      count: favoritesCount,
      favoritedBy
    }, "Favorites count retrieved successfully")
  );
});
// Delete Account (Soft Delete)
export const deleteAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      status: "DELETED",
      deletedAt: new Date(),
    },
  });

  res.clearCookie("accessToken", { httpOnly: true, secure: true });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Account deleted successfully"));
});
