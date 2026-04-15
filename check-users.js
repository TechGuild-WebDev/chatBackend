import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkUsers() {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true
            },
            take: 10
        });

        console.log('--- Users ---');
        users.forEach(u => {
            console.log(`ID: ${u.id}, Username: ${u.username}, Email: ${u.email}`);
        });

    } catch (error) {
        console.error('Error fetching users:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
