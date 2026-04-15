-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `publicId` VARCHAR(191) NULL,
    `role` ENUM('USER', 'ADMIN', 'MODERATOR') NOT NULL DEFAULT 'USER',
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `lastSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NULL,
    `fcmToken` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `phone` VARCHAR(191) NULL,
    `gender` VARCHAR(191) NULL,
    `birthDate` VARCHAR(191) NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BlockedUser` (
    `id` VARCHAR(191) NOT NULL,
    `blockerId` VARCHAR(191) NOT NULL,
    `blockedId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BlockedUser_blockedId_fkey`(`blockedId`),
    UNIQUE INDEX `BlockedUser_blockerId_blockedId_key`(`blockerId`, `blockedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatRoom` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `isGroup` BOOLEAN NOT NULL DEFAULT false,
    `roomType` ENUM('DIRECT', 'GROUP', 'CHANNEL') NOT NULL DEFAULT 'DIRECT',
    `avatarUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMember` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `role` ENUM('MEMBER', 'ADMIN', 'OWNER') NOT NULL DEFAULT 'MEMBER',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastReadAt` DATETIME(3) NULL,
    `mutedUntil` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `ChatMember_roomId_fkey`(`roomId`),
    UNIQUE INDEX `ChatMember_userId_roomId_key`(`userId`, `roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `type` ENUM('TEXT', 'IMAGE', 'VIDEO', 'FILE', 'SYSTEM', 'MEETING_INVITATION', 'MEETING_REMINDER') NOT NULL DEFAULT 'TEXT',
    `content` TEXT NOT NULL,
    `mediaUrl` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NULL,
    `fileSize` INTEGER NULL,
    `replyToId` VARCHAR(191) NULL,
    `edited` BOOLEAN NOT NULL DEFAULT false,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `publicId` VARCHAR(191) NULL,
    `meetingId` VARCHAR(191) NULL,

    INDEX `Message_replyToId_fkey`(`replyToId`),
    INDEX `Message_roomId_fkey`(`roomId`),
    INDEX `Message_senderId_fkey`(`senderId`),
    INDEX `Message_meetingId_fkey`(`meetingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageStatus` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('SENT', 'DELIVERED', 'READ') NOT NULL DEFAULT 'SENT',
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,

    INDEX `MessageStatus_userId_fkey`(`userId`),
    UNIQUE INDEX `MessageStatus_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TypingIndicator` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `isTyping` BOOLEAN NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TypingIndicator_userId_fkey`(`userId`),
    UNIQUE INDEX `TypingIndicator_roomId_userId_key`(`roomId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reaction` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Reaction_userId_fkey`(`userId`),
    UNIQUE INDEX `Reaction_messageId_userId_emoji_key`(`messageId`, `userId`, `emoji`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Meeting` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `agenda` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `time` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `reminder` VARCHAR(191) NULL,
    `recurring` VARCHAR(191) NULL,
    `inviteLink` VARCHAR(191) NULL,
    `attachfile` VARCHAR(191) NULL,
    `chatRoomId` VARCHAR(191) NULL,
    `creatorId` VARCHAR(191) NULL,
    `groupId` VARCHAR(191) NULL,
    `reminderSent` BOOLEAN NOT NULL DEFAULT false,
    `reminderTime` DATETIME(3) NULL,

    INDEX `Meeting_chatRoomId_fkey`(`chatRoomId`),
    INDEX `Meeting_createdBy_fkey`(`createdBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MeetingReminder` (
    `id` VARCHAR(191) NOT NULL,
    `meetingId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'SENT',

    INDEX `MeetingReminder_userId_fkey`(`userId`),
    UNIQUE INDEX `MeetingReminder_meetingId_userId_key`(`meetingId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OTP` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OTP_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_MeetingGroup` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_MeetingGroup_AB_unique`(`A`, `B`),
    INDEX `_MeetingGroup_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_MeetingParticipants` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_MeetingParticipants_AB_unique`(`A`, `B`),
    INDEX `_MeetingParticipants_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BlockedUser` ADD CONSTRAINT `BlockedUser_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BlockedUser` ADD CONSTRAINT `BlockedUser_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMember` ADD CONSTRAINT `ChatMember_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `ChatRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMember` ADD CONSTRAINT `ChatMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `ChatRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageStatus` ADD CONSTRAINT `MessageStatus_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageStatus` ADD CONSTRAINT `MessageStatus_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TypingIndicator` ADD CONSTRAINT `TypingIndicator_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `ChatRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TypingIndicator` ADD CONSTRAINT `TypingIndicator_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_chatRoomId_fkey` FOREIGN KEY (`chatRoomId`) REFERENCES `ChatRoom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Meeting` ADD CONSTRAINT `Meeting_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeetingReminder` ADD CONSTRAINT `MeetingReminder_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MeetingReminder` ADD CONSTRAINT `MeetingReminder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MeetingGroup` ADD CONSTRAINT `_MeetingGroup_A_fkey` FOREIGN KEY (`A`) REFERENCES `ChatRoom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MeetingGroup` ADD CONSTRAINT `_MeetingGroup_B_fkey` FOREIGN KEY (`B`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MeetingParticipants` ADD CONSTRAINT `_MeetingParticipants_A_fkey` FOREIGN KEY (`A`) REFERENCES `Meeting`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MeetingParticipants` ADD CONSTRAINT `_MeetingParticipants_B_fkey` FOREIGN KEY (`B`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
