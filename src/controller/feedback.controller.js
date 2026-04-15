import prisma from "../prisma.js";

// Submit Feedback
export const submitFeedback = async (req, res) => {
  try {
    const { name, email, feedback } = req.body;

    // Validation
    if (!name || !email || !feedback) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Save to database
    const newFeedback = await prisma.feedback.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        feedback: feedback.trim()
      }
    });

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: newFeedback.id,
        name: newFeedback.name,
        email: newFeedback.email,
        createdAt: newFeedback.createdAt
      }
    });

  } catch (error) {
    console.error('Feedback submission error:', error);

    // Handle Prisma errors
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Feedback with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get All Feedbacks (Admin ke liye)
export const getAllFeedbacks = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    // Build where condition for search
    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { feedback: { contains: search, mode: 'insensitive' } }
      ]
    } : {};

    const [feedbacks, totalCount] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        skip: parseInt(skip),
        take: parseInt(limit),
        select: {
          id: true,
          name: true,
          email: true,
          feedback: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.feedback.count({ where })
    ]);

    res.status(200).json({
      success: true,
      data: feedbacks,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCount,
        hasNext: page * limit < totalCount,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get feedbacks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get Feedback by ID
export const getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params;

    const feedback = await prisma.feedback.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        feedback: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.status(200).json({
      success: true,
      data: feedback
    });

  } catch (error) {
    console.error('Get feedback by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete Feedback (Admin ke liye)
export const deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if feedback exists
    const existingFeedback = await prisma.feedback.findUnique({
      where: { id }
    });

    if (!existingFeedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    // Delete feedback
    await prisma.feedback.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Feedback deleted successfully'
    });

  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get Feedback Statistics (Admin dashboard ke liye)
export const getFeedbackStats = async (req, res) => {
  try {
    const totalFeedbacks = await prisma.feedback.count();

    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const todaysFeedbacks = await prisma.feedback.count({
      where: {
        createdAt: {
          gte: startOfToday
        }
      }
    });

    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);
    const lastWeekFeedbacks = await prisma.feedback.count({
      where: {
        createdAt: {
          gte: last7Days
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalFeedbacks,
        todaysFeedbacks,
        lastWeekFeedbacks
      }
    });

  } catch (error) {
    console.error('Get feedback stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

