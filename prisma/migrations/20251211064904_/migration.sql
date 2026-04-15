/*
  Warnings:

  - You are about to drop the column `fcmToken` on the `User` table. All the data in the column will be lost.
  - You are about to alter the column `status` on the `User` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(1))`.

*/
-- AlterTable
ALTER TABLE `Message` ADD COLUMN `duration` INTEGER NULL,
    ADD COLUMN `fileType` VARCHAR(191) NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    MODIFY `type` ENUM('TEXT', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'SYSTEM', 'MEETING_INVITATION', 'MEETING_REMINDER') NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE `User` DROP COLUMN `fcmToken`,
    ADD COLUMN `busyDuration` INTEGER NULL,
    ADD COLUMN `busyStartTime` DATETIME(3) NULL,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedBy` VARCHAR(191) NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isDND` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `officeEndTime` VARCHAR(191) NULL DEFAULT '18:00',
    ADD COLUMN `officeStartTime` VARCHAR(191) NULL DEFAULT '09:00',
    MODIFY `lastSeen` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `status` ENUM('AVAILABLE', 'BUSY', 'DND', 'DELETED') NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE `feedback` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `feedback` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Call` (
    `id` VARCHAR(191) NOT NULL,
    `callId` VARCHAR(191) NOT NULL,
    `callerId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `roomName` VARCHAR(191) NOT NULL,
    `callType` ENUM('NORMAL', 'VIDEO') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('INITIATED', 'RINGING', 'ACCEPTED', 'REJECTED', 'MISSED', 'ENDED', 'BUSY') NOT NULL DEFAULT 'INITIATED',
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `duration` INTEGER NULL,
    `recordingUrl` VARCHAR(191) NULL,
    `recordingPublicId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Call_callId_key`(`callId`),
    INDEX `Call_callerId_idx`(`callerId`),
    INDEX `Call_receiverId_idx`(`receiverId`),
    INDEX `Call_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FcmToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FcmToken_token_key`(`token`),
    INDEX `FcmToken_userId_fkey`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Call` ADD CONSTRAINT `Call_callerId_fkey` FOREIGN KEY (`callerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Call` ADD CONSTRAINT `Call_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FcmToken` ADD CONSTRAINT `FcmToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
