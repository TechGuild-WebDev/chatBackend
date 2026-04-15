-- DropIndex
DROP INDEX `User_username_key` ON `User`;

-- AlterTable
ALTER TABLE `Call` ADD COLUMN `callerUid` BIGINT NULL,
    ADD COLUMN `receiverUid` BIGINT NULL;

-- AlterTable
ALTER TABLE `ChatRoom` ADD COLUMN `publicId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Message` ADD COLUMN `callRefId` VARCHAR(191) NULL,
    ADD COLUMN `callStatus` VARCHAR(191) NULL,
    ADD COLUMN `callType` VARCHAR(191) NULL,
    ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `forwardedFromId` VARCHAR(191) NULL,
    ADD COLUMN `isForwarded` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mediaFiles` JSON NULL,
    ADD COLUMN `pinnedAt` DATETIME(3) NULL,
    ADD COLUMN `pinnedById` VARCHAR(191) NULL,
    ADD COLUMN `pinnedExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `thumbnailUrl` VARCHAR(191) NULL,
    MODIFY `type` ENUM('TEXT', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'SYSTEM', 'MEETING_INVITATION', 'MEETING_REMINDER', 'IMAGE_GROUP', 'CALL_LOG') NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE `User` ADD COLUMN `department` VARCHAR(191) NULL,
    ADD COLUMN `designation` VARCHAR(191) NULL,
    ADD COLUMN `parentId` VARCHAR(191) NULL,
    MODIFY `role` ENUM('USER', 'ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'CLIENT') NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE `MessageHiddenFor` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MessageHiddenFor_userId_idx`(`userId`),
    UNIQUE INDEX `MessageHiddenFor_messageId_userId_key`(`messageId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_messages` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `starred_messages` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `starred_messages_userId_idx`(`userId`),
    INDEX `starred_messages_messageId_idx`(`messageId`),
    UNIQUE INDEX `starred_messages_userId_messageId_key`(`userId`, `messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Message_forwardedFromId_idx` ON `Message`(`forwardedFromId`);

-- CreateIndex
CREATE INDEX `Message_pinnedById_idx` ON `Message`(`pinnedById`);

-- CreateIndex
CREATE INDEX `User_parentId_idx` ON `User`(`parentId`);

-- CreateIndex
CREATE INDEX `User_designation_idx` ON `User`(`designation`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_pinnedById_fkey` FOREIGN KEY (`pinnedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_forwardedFromId_fkey` FOREIGN KEY (`forwardedFromId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageHiddenFor` ADD CONSTRAINT `MessageHiddenFor_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_messages` ADD CONSTRAINT `contact_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `starred_messages` ADD CONSTRAINT `starred_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `starred_messages` ADD CONSTRAINT `starred_messages_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
