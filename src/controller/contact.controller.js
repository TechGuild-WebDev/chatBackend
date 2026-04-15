import prisma from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Submit contact form message
export const submitContactMessage = asyncHandler(async (req, res) => {
  const { subject, message } = req.body;
  const userId = req.user?.id; // From auth middleware

  // Validation
  if (!subject || !message) {
    throw new ApiError(400, "Subject and message are required");
  }

  try {
    // Get user details if logged in
    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          username: true,
          email: true
        }
      });
    }

    // Create contact message
    const contactMessage = await prisma.contactMessage.create({
      data: {
        name: user?.name || user?.username || "User",
        email: user?.email || "unknown@example.com",
        subject,
        message,
        userId: user?.id || null,
        status: "PENDING"
      },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true
      }
    });

    console.log(`📧 New contact message from ${contactMessage.name}: ${contactMessage.subject}`);

    res.status(201).json(
      new ApiResponse(
        201,
        contactMessage,
        "Message sent successfully! We'll get back to you soon."
      )
    );

  } catch (error) {
    console.error("Error submitting contact message:", error);
    throw new ApiError(500, "Failed to send message. Please try again.");
  }
});

export const deleteContactMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    // Check if message exists
    const existingMessage = await prisma.contactMessage.findUnique({
      where: { id }
    });

    if (!existingMessage) {
      throw new ApiError(404, "Message not found");
    }

    // Delete the message using Prisma
    const deletedMessage = await prisma.contactMessage.delete({
      where: { id }
    });

    console.log(`🗑️ Contact message deleted: ${deletedMessage.subject}`);

    res.status(200).json(
      new ApiResponse(
        200,
        { id: deletedMessage.id },
        "Message deleted successfully"
      )
    );

  } catch (error) {
    console.error("Error deleting contact message:", error);

    if (error.code === 'P2025') { // Prisma record not found error
      throw new ApiError(404, "Message not found");
    }

    throw new ApiError(500, "Failed to delete message");
  }
});

export const updateContactMessageStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Validation
  if (!status) {
    throw new ApiError(400, "Status is required");
  }

  // Validate status value
  const validStatuses = ["PENDING", "RESOLVED"];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, "Status must be either PENDING or RESOLVED");
  }

  try {
    // Check if message exists
    const existingMessage = await prisma.contactMessage.findUnique({
      where: { id }
    });

    if (!existingMessage) {
      throw new ApiError(404, "Message not found");
    }

    // Update the message status
    const updatedMessage = await prisma.contactMessage.update({
      where: { id },
      data: {
        status,
        updatedAt: new Date() // Optional: track when status was updated
      },
      select: {
        id: true,
        name: true,
        email: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });

    console.log(`📝 Contact message status updated: ${updatedMessage.subject} -> ${status}`);

    res.status(200).json(
      new ApiResponse(
        200,
        updatedMessage,
        `Message status updated to ${status.toLowerCase()}`
      )
    );

  } catch (error) {
    console.error("Error updating contact message status:", error);

    if (error.code === 'P2025') { // Prisma record not found error
      throw new ApiError(404, "Message not found");
    }

    throw new ApiError(500, "Failed to update message status");
  }
});
