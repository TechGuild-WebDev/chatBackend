import { PrismaClient } from "../prisma/generated/client/index.js";

const prisma = new PrismaClient();

console.log("Prisma Client initialized from local path.");

export default prisma;
