import express from "express";
import { db } from "../config/firebase.js";
import { cache } from "../utils/cache.js";

const router = express.Router();

const generateOrderId = () => {
  const year = new Date().getFullYear();
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${year}-${randomNum}`;
};

/**
 * Helper to record in-app notifications
 */
const createNotification = async ({ userId, type, title, message, orderId }) => {
  if (!db || !userId || userId === "guest") return;
  try {
    const notifId = `NOTIF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await db.collection("notifications").doc(notifId).set({
      id: notifId,
      userId,
      type: type || "order",
      title,
      message,
      orderId: orderId || null,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("Could not save notification:", err.message);
  }
};

/**
 * Create New Order
 */
router.post("/", async (req, res) => {
  try {
    const {
      userId,
      customerName,
      customerEmail,
      customerPhone,
      items,
      subtotal,
      deliveryFee,
      tax,
      totalAmount,
      deliveryAddress,
      paymentMethod,
      paymentStatus,
      razorpayPaymentId,
      specialInstructions,
    } = req.body;

    if (!items || items.length === 0 || !totalAmount) {
      return res.status(400).json({ success: false, message: "Cart items and total amount are required" });
    }

    const orderId = generateOrderId();
    const orderData = {
      id: orderId,
      userId: userId || "guest",
      customerName: customerName || "Customer",
      customerEmail: customerEmail || "",
      customerPhone: customerPhone || "",
      items,
      itemsCount: items.reduce((acc, item) => acc + (item.quantity || 1), 0),
      subtotal: Number(subtotal) || 0,
      deliveryFee: Number(deliveryFee) || 40,
      tax: Number(tax) || Math.round(subtotal * 0.05),
      totalAmount: Number(totalAmount),
      deliveryAddress: deliveryAddress || "Dine-in / Pickup",
      paymentMethod: paymentMethod || "cash",
      paymentStatus: paymentStatus || (paymentMethod === "razorpay" ? "paid" : "pending"),
      razorpayPaymentId: razorpayPaymentId || null,
      orderStatus: "Placed",
      amountReceivedByAdmin: paymentStatus === "paid",
      orderReceivedByCustomer: false,
      specialInstructions: specialInstructions || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection("orders").doc(orderId).set(orderData);
    }

    // Trigger Notification for User
    cache.del("admin_stats");
    await createNotification({
      userId: orderData.userId,
      type: "order",
      orderId: orderId,
      title: "Order Placed Successfully! 🍲",
      message: `Your order #${orderId} (₹${orderData.totalAmount}) has been received and sent to our kitchen.`,
    });

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: orderData,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get Orders for Specific User
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    let orders = [];

    if (db) {
      const snapshot = await db.collection("orders").where("userId", "==", userId).get();
      snapshot.forEach((doc) => {
        orders.push({ id: doc.id, ...doc.data() });
      });
    }

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);
    if (page && limit) {
      const startIndex = (page - 1) * limit;
      return res.status(200).json({
        success: true,
        orders: orders.slice(startIndex, startIndex + limit),
        total: orders.length,
        page,
        totalPages: Math.ceil(orders.length / limit)
      });
    }
    return res.status(200).json({ success: true, orders, total: orders.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin: Get All Orders
 */
router.get("/all", async (req, res) => {
  try {
    let orders = [];
    if (db) {
      const snapshot = await db.collection("orders").get();
      snapshot.forEach((doc) => {
        orders.push({ id: doc.id, ...doc.data() });
      });
    }
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const page = parseInt(req.query.page);
    const limit = parseInt(req.query.limit);
    if (page && limit) {
      const startIndex = (page - 1) * limit;
      return res.status(200).json({
        success: true,
        orders: orders.slice(startIndex, startIndex + limit),
        total: orders.length,
        page,
        totalPages: Math.ceil(orders.length / limit)
      });
    }
    return res.status(200).json({ success: true, orders, total: orders.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin: Update Order Status
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!orderStatus) {
      return res.status(400).json({ success: false, message: "Order status is required" });
    }

    let targetUserId = null;
    if (db) {
      const orderRef = db.collection("orders").doc(id);
      const doc = await orderRef.get();
      if (doc.exists) {
        targetUserId = doc.data().userId;
      }
      cache.del("admin_stats");
      await orderRef.update({
        orderStatus,
        updatedAt: new Date().toISOString(),
      });
    }

    // Trigger Notification for User based on stage
    if (targetUserId) {
      const stageMessages = {
        Accepted: "Our head chef has accepted your order and preparation has begun! 👨‍🍳",
        Preparing: "Your delicious food is sizzling fresh in the kitchen! 🔥",
        Ready: "Your food is packed fresh, hot, and ready for dispatch! 📦",
        "Out for Delivery": "Your meal is on the way with our delivery partner! 🛵",
        Delivered: "Your order has been marked as delivered. Enjoy your royal meal! ✨",
      };

      await createNotification({
        userId: targetUserId,
        type: "order",
        orderId: id,
        title: `Order #${id} - ${orderStatus}`,
        message: stageMessages[orderStatus] || `Your order status has been updated to ${orderStatus}.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${orderStatus}`,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin: Confirm Amount Received
 */
router.patch("/:id/admin-confirm-amount", async (req, res) => {
  try {
    const { id } = req.params;

    if (db) {
      const orderRef = db.collection("orders").doc(id);
      await orderRef.update({
        amountReceivedByAdmin: true,
        paymentStatus: "paid",
        updatedAt: new Date().toISOString(),
      });

      const doc = await orderRef.get();
      if (doc.exists) {
        const data = doc.data();
        const payId = `pay_cash_${Date.now()}`;
        await db.collection("payments").doc(payId).set({
          paymentId: payId,
          orderId: id,
          userId: data.userId || "guest",
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          amount: data.totalAmount,
          method: data.paymentMethod === "upi" ? "UPI (Manual Verification)" : "Cash on Delivery",
          status: "Verified by Admin",
          createdAt: new Date().toISOString(),
        });

        // Trigger Notification
        await createNotification({
          userId: data.userId,
          type: "order",
          orderId: id,
          title: "Payment Received & Confirmed! 💳",
          message: `Admin has verified your payment of ₹${data.totalAmount} for Order #${id}.`,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Admin verified amount received successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Customer: Confirm Order Received
 */
router.patch("/:id/customer-confirm-received", async (req, res) => {
  try {
    const { id } = req.params;

    if (db) {
      const orderRef = db.collection("orders").doc(id);
      await orderRef.update({
        orderReceivedByCustomer: true,
        orderStatus: "Delivered",
        updatedAt: new Date().toISOString(),
      });

      const doc = await orderRef.get();
      if (doc.exists) {
        await createNotification({
          userId: doc.data().userId,
          type: "order",
          orderId: id,
          title: "Delivery Confirmed! 🎉",
          message: `Thank you for confirming receipt of Order #${id}. We hope you enjoy your feast!`,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Order marked as received by customer",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin: Delete Order
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (db) {
      await db.collection("orders").doc(id).delete();
    }
    return res.status(200).json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
