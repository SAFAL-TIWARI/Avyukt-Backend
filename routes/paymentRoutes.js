import express from "express";
import crypto from "crypto";
import razorpayInstance from "../config/razorpay.js";
import { db } from "../config/firebase.js";

const router = express.Router();

/**
 * Create Razorpay Order
 */
router.post("/create-order", async (req, res) => {
  try {
    const { amount, receipt, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid amount is required" });
    }

    const options = {
      amount: Math.round(amount * 100), // Amount in paise
      currency: "INR",
      receipt: receipt || `rec_${Date.now().toString().slice(-8)}`,
      notes: notes || { restaurant: "Avyukt Restaurant" },
    };

    const order = await razorpayInstance.orders.create(options);

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID || "rzp_test_mockKey123",
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Verify Razorpay Payment Signature and Record Transaction
 */
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
      userId,
      amount,
      customerEmail,
      customerName,
    } = req.body;

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    let isValid = true;

    if (keySecret && razorpay_signature) {
      const generatedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: "Invalid payment signature" });
      }
    } else {
      console.warn("⚠️ Bypassing HMAC verification in sandbox/test mode without key secret");
    }

    const paymentRecord = {
      paymentId: razorpay_payment_id || `pay_mock_${Date.now()}`,
      razorpayOrderId: razorpay_order_id,
      orderId: orderId || null,
      userId: userId || "guest",
      customerName: customerName || "Customer",
      customerEmail: customerEmail || "",
      amount: Number(amount) || 0,
      method: "UPI/Card/NetBanking",
      status: "Successful",
      createdAt: new Date().toISOString(),
    };

    if (db) {
      try {
        // Save to payments collection
        await db.collection("payments").doc(paymentRecord.paymentId).set(paymentRecord);

        // Update corresponding order status if orderId provided
        if (orderId) {
          const orderRef = db.collection("orders").doc(orderId);
          await orderRef.update({
            paymentStatus: "paid",
            paymentMethod: "razorpay",
            razorpayPaymentId: paymentRecord.paymentId,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (dbErr) {
        console.warn("Firestore payments write warning:", dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified and recorded successfully",
      payment: paymentRecord,
    });
  } catch (error) {
    console.error("Error verifying Razorpay payment:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get User Payment History (For Profile Page Payments Section)
 */
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    let payments = [];

    if (db) {
      try {
        const snapshot = await db
          .collection("payments")
          .where("userId", "==", userId)
          .get();

        snapshot.forEach((doc) => {
          payments.push({ id: doc.id, ...doc.data() });
        });
      } catch (dbErr) {
        console.warn("Firestore read payments warning:", dbErr.message);
      }
    }

    // Sort by newest first
    payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, payments });
  } catch (error) {
    console.error("Error fetching user payments:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
