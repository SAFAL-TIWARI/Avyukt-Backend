import express from "express";
import { db } from "../config/firebase.js";
import { cache } from "../utils/cache.js";

const router = express.Router();

/**
 * Get Admin Dashboard Overview Statistics (Cached for 20 seconds)
 */
router.get("/stats", async (req, res) => {
  try {
    const cachedStats = cache.get("admin_stats");
    if (cachedStats) {
      return res.status(200).json({
        success: true,
        cached: true,
        stats: cachedStats,
      });
    }

    let totalRevenue = 0;
    let totalOrders = 0;
    let pendingOrders = 0;
    let activeKitchenOrders = 0;
    let deliveredOrders = 0;
    let totalBookings = 0;
    let totalFeedbacks = 0;
    let totalContacts = 0;

    if (db) {
      // Aggregate Orders
      const ordersSnapshot = await db.collection("orders").get();
      totalOrders = ordersSnapshot.size;

      ordersSnapshot.forEach((doc) => {
        const order = doc.data();
        if (order.paymentStatus === "paid" || order.amountReceivedByAdmin) {
          totalRevenue += Number(order.totalAmount) || 0;
        }

        if (order.orderStatus === "Placed") pendingOrders++;
        else if (["Accepted", "Preparing", "Ready", "Out for Delivery"].includes(order.orderStatus)) {
          activeKitchenOrders++;
        } else if (order.orderStatus === "Delivered") {
          deliveredOrders++;
        }
      });

      // Aggregate Bookings
      const bookingsSnapshot = await db.collection("tableBookings").get();
      totalBookings = bookingsSnapshot.size;

      // Aggregate Feedbacks
      const feedbacksSnapshot = await db.collection("feedbacks").get();
      totalFeedbacks = feedbacksSnapshot.size;

      // Aggregate Contacts
      const contactsSnapshot = await db.collection("contactMessages").get();
      totalContacts = contactsSnapshot.size;
    }

    const calculatedStats = {
      totalRevenue,
      totalOrders,
      pendingOrders,
      activeKitchenOrders,
      deliveredOrders,
      totalBookings,
      totalFeedbacks,
      totalContacts,
    };

    // Cache computed stats for 20 seconds
    cache.set("admin_stats", calculatedStats, 20);

    return res.status(200).json({
      success: true,
      cached: false,
      stats: calculatedStats,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
