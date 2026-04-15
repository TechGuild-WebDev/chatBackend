import prisma from "../prisma.js";

export const sendReminderMessage = async ({
  meeting,
  participant,
  creator,
  message,
}) => {
  try {
    // Find or create direct message room
    let directRoom = await prisma.chatRoom.findFirst({
      where: {
        roomType: "DIRECT",
        members: {
          every: {
            userId: { in: [creator.id, participant.id] },
          },
        },
      },
      include: { members: true },
    });

    if (!directRoom) {
      directRoom = await prisma.chatRoom.create({
        data: {
          name: `Direct-${creator.id}-${participant.id}`,
          roomType: "DIRECT",
          members: {
            create: [
              { userId: creator.id, role: "MEMBER" },
              { userId: participant.id, role: "MEMBER" },
            ],
          },
        },
        include: { members: true },
      });
    }

    // Create reminder message
    const reminderMsg = await prisma.message.create({
      data: {
        roomId: directRoom.id,
        senderId: creator.id,
        content: message,
        type: "MEETING_INVITATION",
        meetingId: meeting.id,
        createdAt: new Date(),
      },
      include: {
        sender: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    // Create message status
    await prisma.messageStatus.create({
      data: {
        messageId: reminderMsg.id,
        userId: participant.id,
        status: "SENT",
      },
    });

    return reminderMsg;
  } catch (error) {
    console.error("Error sending reminder message:", error);
    throw error;
  }
};
