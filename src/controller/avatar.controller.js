import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { cloudinary } from "../utils/cloudinary.js";

export const updateGroupAvatar = asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, { folder: "group_avatars" });

    // Update avatar in database
    const updatedGroup = await prisma.chatRoom.update({
      where: { id: groupId },
      data: { avatarUrl: result.secure_url },
    });

    res.status(200).json({
      success: true,
      data: { avatarUrl: updatedGroup.avatarUrl },
      message: "Group avatar updated successfully",
    });
  } catch (error) {
    console.error("updateGroupAvatar error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});
