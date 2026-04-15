import cron from "node-cron";
import prisma from "../prismaClient.js"; // Import your Prisma client

// Function to delete pending orders older than 10 minutes
const cleanupAbandonedOrders = async () => {
  const cutoffTime = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

  try {
    // Find abandoned orders
    const abandonedOrders = await prisma.order.findMany({
      where: {
        status: "PENDING", // Only delete orders with this status
        createdAt: { lt: cutoffTime },
      },
      include: {
        Payment: true, // Include related Payment records
        items: true, // Include related OrderItem records
      },
    });

    // Delete related records and then the orders
    for (const order of abandonedOrders) {
      // Delete related Payment records
      await prisma.payment.deleteMany({
        where: { orderId: order.id },
      });

      // Delete related OrderItem records
      await prisma.orderItem.deleteMany({
        where: { orderId: order.id },
      });

      // Delete the Order
      await prisma.order.delete({
        where: { id: order.id },
      });

      console.log(`Deleted abandoned order: ${order.id}`);
    }

    console.log(`Deleted ${abandonedOrders.length} abandoned orders.`);
  } catch (error) {
    console.error("Error cleaning up abandoned orders:", error);
  }
};

// Schedule the cleanup task to run every 10 minutes
cron.schedule("0 */3 * * *", cleanupAbandonedOrders);

console.log("Cron job started: Cleaning up abandoned orders every 3 hrs.");
