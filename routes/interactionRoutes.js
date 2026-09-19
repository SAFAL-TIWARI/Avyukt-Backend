import express from "express";
import { db } from "../config/firebase.js";
import { cache } from "../utils/cache.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

// Helper for interaction notifications
const createNotification = async ({ id: customId, userId, userEmail, type, title, message }) => {
  if (!db) return;
  try {
    const notifId = customId || ("NOTIF-" + Date.now() + "-" + Math.floor(Math.random() * 1000));
    const notifData = {
      id: notifId,
      userId: userId || "all",
      userEmail: (userEmail || "").trim().toLowerCase(),
      type: type || "order",
      title,
      message,
      read: false,
      createdAt: new Date().toISOString(),
    };
    await db.collection("notifications").doc(notifId).set(notifData);
  } catch (err) {
    console.warn("Could not save notification:", err.message);
  }
};

/* ==================== TABLE RESERVATIONS ==================== */

// Customer: Book Table
router.post("/reservation", async (req, res) => {
  try {
    const { name, phone, email, date, guests, time, notes, userId } = req.body;
    if (!name || !phone || !date || !guests) {
      return res.status(400).json({ success: false, message: "Name, phone, date, and guests count are required" });
    }

    // Enforce 10-digit phone number
    const cleanPhone = String(phone || "").replace(/\D/g, "").slice(-10);
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, message: "Please provide a valid 10-digit phone number" });
    }

    // Disallow past dates
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (date < todayStr) {
      return res.status(400).json({ success: false, message: "Reservation date cannot be in the past" });
    }

    let resolvedUserId = userId || "guest";
    const cleanEmail = (email || "").trim().toLowerCase();

    // If userId is missing or guest, lookup in users collection by email
    if (db && (!resolvedUserId || resolvedUserId === "guest" || resolvedUserId === "user")) {
      if (cleanEmail) {
        try {
          const uSnap = await db.collection("users").where("email", "==", cleanEmail).get();
          if (!uSnap.empty) {
            resolvedUserId = uSnap.docs[0].id;
          }
        } catch (e) {}
      }
    }

    const bookingId = `RES-${Date.now().toString().slice(-6)}`;
    const bookingData = {
      id: bookingId,
      userId: resolvedUserId,
      name,
      phone: cleanPhone,
      email: cleanEmail,
      date,
      time: time || "07:30 PM",
      guests: Number(guests) || 2,
      notes: notes || "",
      tableNo: "",
      status: "Pending", // Pending | Confirmed | Rejected
      createdAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection("tableBookings").doc(bookingId).set(bookingData);
    cache.del("admin_stats"); // res
    }

    return res.status(201).json({
      success: true,
      message: "Table reservation request submitted successfully",
      booking: bookingData,
    });
  } catch (error) {
    console.error("Error creating reservation:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Get All Reservations
router.get("/reservations", async (req, res) => {
  try {
    let bookings = [];
    if (db) {
      const snapshot = await db.collection("tableBookings").get();
      snapshot.forEach((doc) => bookings.push({ id: doc.id, ...doc.data() }));
    }
    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ success: true, bookings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Update Reservation Status & Allot Table No
router.patch("/reservation/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, tableNo, userEmail: clientEmail, userId: clientUserId } = req.body;
    const updateData = { updatedAt: new Date().toISOString() };
    if (status !== undefined) updateData.status = status;
    if (tableNo !== undefined) updateData.tableNo = tableNo;

    let targetUserId = clientUserId || null;
    let targetEmail = (clientEmail || "").trim().toLowerCase();
    let resDate = "";
    let resTime = "";
    let finalTableNo = tableNo;

    if (db) {
      const docRef = db.collection("tableBookings").doc(id);
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data();
        if (!targetUserId || targetUserId === "guest") targetUserId = data.userId;
        if (!targetEmail) targetEmail = (data.email || "").trim().toLowerCase();
        resDate = data.date || "";
        resTime = data.time || "";
        if (!finalTableNo && data.tableNo) finalTableNo = data.tableNo;
      }
      await docRef.update(updateData);

      // If targetUserId is still missing or guest, lookup in users by email or phone
      if (!targetUserId || targetUserId === "guest" || targetUserId === "anonymous" || targetUserId === "user") {
        if (targetEmail) {
          const uSnap = await db.collection("users").where("email", "==", targetEmail).get();
          if (!uSnap.empty) {
            targetUserId = uSnap.docs[0].id;
          }
        }
      }
    }

    // Always create notification for customer (only on final Confirmed or Rejected, with idempotent ID)
    if (status === "Confirmed") {
      const tableMsg = finalTableNo ? ` Your allotted table is: #${finalTableNo}.` : "";
      await createNotification({
        id: `NOTIF-RES-${id}-Confirmed`,
        userId: targetUserId,
        userEmail: targetEmail,
        type: "order",
        title: finalTableNo ? `Table #${finalTableNo} Confirmed` : "Table Booking Confirmed",
        message: `Your reservation for ${resDate}${resTime ? ` at ${resTime}` : ""} is CONFIRMED.${tableMsg} We look forward to hosting you at Avyukt!`,
      });
    } else if (status === "Rejected") {
      await createNotification({
        id: `NOTIF-RES-${id}-Rejected`,
        userId: targetUserId,
        userEmail: targetEmail,
        type: "order",
        title: "Table Booking Declined",
        message: `Your table reservation request for ${resDate}${resTime ? ` at ${resTime}` : ""} has been declined.`,
      });
    }
    // Note: Table allotment alone is an internal admin step and does not spam the customer with duplicate allotment notifications.

    return res.status(200).json({ success: true, message: "Reservation updated successfully", targetUserId });
  } catch (error) {
    console.error("Error updating reservation:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Delete Reservation
router.delete("/reservation/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (db) {
      await db.collection("tableBookings").doc(id).delete();
    }
    return res.status(200).json({ success: true, message: "Reservation deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ==================== CUSTOMER FEEDBACK ==================== */

// Customer: Submit Feedback
router.post("/feedback", async (req, res) => {
  try {
    const { userId, userName, userEmail, rating, tags, feedbackText, userAvatar } = req.body;
    if (!rating) {
      return res.status(400).json({ success: false, message: "Rating is required" });
    }
    if (!feedbackText || !feedbackText.trim()) {
      return res.status(400).json({ success: false, message: "Feedback description is mandatory" });
    }

    let resolvedAvatar = userAvatar || req.body.avatar || "";
    if (!resolvedAvatar && userId && userId !== "anonymous" && userId !== "guest" && db) {
      try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          resolvedAvatar = userDoc.data().avatar || userDoc.data().photoURL || "";
        }
      } catch (e) {}
    }

    const feedbackId = `FB-${Date.now().toString().slice(-6)}`;
    const feedbackData = {
      id: feedbackId,
      userId: userId || "anonymous",
      userName: userName || "Valued Customer",
      userEmail: userEmail || "",
      userAvatar: resolvedAvatar || "",
      rating: Number(rating),
      tags: tags || [],
      feedbackText: feedbackText.trim(),
      createdAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection("feedbacks").doc(feedbackId).set(feedbackData);
    cache.del("all_feedbacks");
    cache.del("admin_stats");
    }

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully. Thank you!",
      feedback: feedbackData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Get All Feedbacks
router.get("/feedbacks", async (req, res) => {
  try {
    let feedbacks = [];
    if (db) {
      const snapshot = await db.collection("feedbacks").get();
      snapshot.forEach((doc) => feedbacks.push({ id: doc.id, ...doc.data() }));
    }
    feedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Delete Feedback
router.delete("/feedback/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (db) {
      await db.collection("feedbacks").doc(id).delete();
      cache.del("all_feedbacks");
      cache.del("admin_stats");
    }
    return res.status(200).json({ success: true, message: "Feedback deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ==================== CONTACT INQUIRIES ==================== */

// Customer: Send Contact Message
router.post("/contact", async (req, res) => {
  try {
    const { name, email, phone, message, userId } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: "Name, email, and message are required" });
    }

    const messageId = `MSG-${Date.now().toString().slice(-6)}`;
    const contactData = {
      id: messageId,
      userId: userId || "guest",
      name,
      email,
      phone: phone || "",
      message,
      status: "New",
      createdAt: new Date().toISOString(),
    };

    if (db) {
      await db.collection("contactMessages").doc(messageId).set(contactData);
    }

    return res.status(201).json({
      success: true,
      message: "Message received. We will get back to you shortly!",
      contact: contactData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Get All Contact Messages
router.get("/contacts", async (req, res) => {
  try {
    let contacts = [];
    if (db) {
      const snapshot = await db.collection("contactMessages").get();
      snapshot.forEach((doc) => contacts.push({ id: doc.id, ...doc.data() }));
    }
    contacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ success: true, contacts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Delete Contact Message
router.delete("/contact/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (db) {
      await db.collection("contactMessages").doc(id).delete();
    }
    return res.status(200).json({ success: true, message: "Contact message deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});


// Admin: Reply to Contact Inquiry (in-app notification + structured email)
router.post("/contact/:id/reply", async (req, res) => {
  try {
    const { id } = req.params;
    const { replyMessage, adminName, subject } = req.body;

    if (!replyMessage || !replyMessage.trim()) {
      return res.status(400).json({ success: false, message: "Reply message is required" });
    }

    let contactData = null;
    const repliedAt = new Date().toISOString();

    if (db) {
      const docRef = db.collection("contactMessages").doc(id);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        return res.status(404).json({ success: false, message: "Inquiry not found" });
      }
      contactData = { id: docSnap.id, ...docSnap.data() };

      await docRef.update({
        status: "Replied",
        adminReply: replyMessage.trim(),
        repliedAt,
        adminName: adminName || "Avyukt Restaurant Management",
      });
      contactData.status = "Replied";
      contactData.adminReply = replyMessage.trim();
      contactData.repliedAt = repliedAt;
    }

    const targetEmail = (contactData?.email || req.body.email || "").trim().toLowerCase();
    let targetUserId = contactData?.userId;

    if (db && (!targetUserId || targetUserId === "guest" || targetUserId === "user" || targetUserId === "anonymous")) {
      if (targetEmail) {
        const uSnap = await db.collection("users").where("email", "==", targetEmail).get();
        if (!uSnap.empty) {
          targetUserId = uSnap.docs[0].id;
        }
      }
    }

    const originalQuery = (contactData?.message || "").trim();
    const queryExcerpt = originalQuery.length > 35 ? originalQuery.slice(0, 35) + "..." : originalQuery;
    const notifTitle = queryExcerpt ? `Reply to Inquiry: "${queryExcerpt}"` : "Response to Your Inquiry - Avyukt Restaurant";

    // 1. Send In-App Notification strictly to that user (NEVER broadcast as "all"!)
    const resolvedUserId = (targetUserId && targetUserId !== "guest" && targetUserId !== "user" && targetUserId !== "anonymous")
      ? targetUserId
      : (targetEmail ? `email_${targetEmail}` : null);

    if (resolvedUserId || targetEmail) {
      await createNotification({
        id: `NOTIF-REPLY-${id}`,
        userId: resolvedUserId || `email_${targetEmail}`,
        userEmail: targetEmail,
        type: "contact",
        title: notifTitle,
        message: `Dear ${contactData?.name || "Customer"},\n\n${replyMessage.trim()}`,
      });
    }

    // 2. Send structured Email to user
    let emailStatus = { sent: false };
    if (targetEmail) {
      const emailSubject = subject || `Response to Your Inquiry - Avyukt Restaurant`;
      const sanitizedName = (contactData?.name || "Valued Customer").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sanitizedOriginal = originalQuery.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const formattedReply = replyMessage.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${emailSubject}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #fcf9f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2d1810;">
          <div style="max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 4px 25px rgba(0,0,0,0.08); border: 1px solid #f3e8db;">
            
            <!-- Executive Luxury Header -->
            <div style="background: linear-gradient(135deg, #1c140e 0%, #2e1d13 100%); padding: 35px 30px; text-align: center; border-bottom: 3px solid #d97706;">
              <h1 style="color: #f59e0b; margin: 0 0 6px 0; font-size: 26px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">Avyukt Restaurant</h1>
              <p style="color: #e5d5c5; margin: 0; font-size: 13px; letter-spacing: 0.5px;">Authentic Dining &amp; Royal Hospitality</p>
            </div>

            <!-- Content Body -->
            <div style="padding: 35px 30px;">
              <p style="font-size: 16px; margin: 0 0 16px 0; color: #1c140e;">
                Dear <strong>${sanitizedName}</strong>,
              </p>
              
              <p style="font-size: 14px; line-height: 1.6; color: #5a4033; margin: 0 0 24px 0;">
                Thank you for contacting Avyukt Restaurant. We have reviewed your query and are pleased to provide you with the information below:
              </p>

              <!-- Original Inquiry Box -->
              <div style="background-color: #faf5ee; border-left: 4px solid #b45309; padding: 16px 20px; border-radius: 0 12px 12px 0; margin-bottom: 24px;">
                <p style="margin: 0 0 6px 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #b45309; letter-spacing: 0.5px;">
                  Your Original Inquiry
                </p>
                <p style="margin: 0; font-size: 14px; color: #43281c; font-style: italic; line-height: 1.5;">
                  &ldquo;${sanitizedOriginal}&rdquo;
                </p>
              </div>

              <!-- Admin's Structured Reply Box -->
              <div style="background-color: #fffdfa; border: 1.5px solid #fed7aa; padding: 20px; border-radius: 14px; margin-bottom: 28px; box-shadow: 0 2px 10px rgba(217,119,6,0.04);">
                <p style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; font-weight: 700; color: #d97706; letter-spacing: 0.5px;">
                  Response from Avyukt Management
                </p>
                <div style="margin: 0; font-size: 14px; color: #1c140e; line-height: 1.7;">
                  ${formattedReply}
                </div>
              </div>

              <p style="font-size: 13px; line-height: 1.6; color: #785a4a; margin: 0 0 25px 0;">
                If you have any questions or require special dining arrangements, please do not hesitate to contact us or visit our restaurant.
              </p>

              <div style="text-align: center; margin: 28px 0;">
                <a href="http://localhost:5173" style="display: inline-block; background-color: #d97706; color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 50px; font-weight: 700; font-size: 13px; letter-spacing: 0.5px;">
                  Explore Avyukt Restaurant
                </a>
              </div>

              <hr style="border: none; border-top: 1px solid #f3e8db; margin: 30px 0 20px 0;" />

              <div style="font-size: 12px; color: #8c7366; line-height: 1.6; text-align: center;">
                <p style="margin: 0 0 4px 0;"><strong>Avyukt Restaurant</strong></p>
                <p style="margin: 0 0 4px 0;">Hotel Grand Ashok, Vidisha - 464001, Madhya Pradesh, India</p>
                <p style="margin: 0;">Phone: +91 9039121277 &bull; Email: rahul.baghel76@gmail.com</p>
              </div>

            </div>

            <!-- Footer -->
            <div style="background-color: #f7ede2; padding: 16px 30px; text-align: center; border-top: 1px solid #eedcca;">
              <p style="margin: 0; font-size: 11px; color: #8c7366;">
                This response was sent regarding your query submitted on Avyukt Restaurant.
              </p>
            </div>

          </div>
        </body>
        </html>
      `;

      try {
        const mailRes = await sendEmail({
          to: targetEmail,
          subject: emailSubject,
          text: `Dear ${contactData?.name || "Customer"},\n\nIn response to your query:\n"${originalQuery}"\n\nAvyukt Restaurant Response:\n${replyMessage.trim()}\n\nAddress: Hotel Grand Ashok, Vidisha - 464001, Madhya Pradesh\nPhone: +91 9039121277`,
          html,
        });
        emailStatus = mailRes;
      } catch (mErr) {
        console.warn("Email dispatch error:", mErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Reply sent to customer notifications and email successfully!",
      contact: contactData,
      emailStatus,
    });
  } catch (error) {
    console.error("Error sending inquiry reply:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
