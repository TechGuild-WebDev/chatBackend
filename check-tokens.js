import { PrismaClient } from './prisma/generated/client/index.js';
const prisma = new PrismaClient();

async function checkTokens() {
    try {
        const tokens = await prisma.fcmToken.findMany({
            include: {
                user: {
                    select: {
                        username: true,
                        email: true
                    }
                }
            },
            orderBy: {
                addedAt: 'desc'
            }
        });

        console.log('--- Registered FCM Tokens ---');
        console.log(`Total tokens: ${tokens.length}`);
        tokens.forEach((t, i) => {
            console.log(`${i + 1}. User: ${t.user?.username || 'Unknown'} (${t.userId})`);
            console.log(`   Token: ${t.token.substring(0, 20)}...`);
            console.log(`   Platform: ${t.platform}`);
            console.log(`   Added: ${t.addedAt}`);
            console.log('---------------------------');
        });

    } catch (error) {
        console.error('Error fetching tokens:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkTokens();
