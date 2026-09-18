import express from "express";
import { db } from "../config/firebase.js";

const router = express.Router();

const localNotifications = new Map();

/**
 * Get Notifications for User (Their own order notifications + Broadcasted "all" + email matched)
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const queryEmail = (req.query.email || "").trim().toLowerCase();
    let list = [];
    let userEmail = queryEmail;

    if (db) {
      try {
        // If email not provided in query, lookup user doc
        if (!userEmail && userId && userId !== "all" && userId !== "guest") {
          const uDoc = await db.collection("users").doc(userId).get();
          if (uDoc.exists && uDoc.data().email) {
            userEmail = uDoc.data().email.trim().toLowerCase();
          }
        }

        // 1. By userId
        if (userId && userId !== "guest") {
          const userNotes = await db.collection("notifications").where("userId", "==", userId).get();
          userNotes.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
        }

        // 2. By email if user has email
        if (userEmail) {
          const emailNotes = await db.collection("notifications").where("userEmail", "==", userEmail).get();
          emailNotes.forEach((doc) => {
            if (!list.some(n => n.id === doc.id)) {
              list.push({ id: doc.id, ...doc.data() });
            }
          });
        }

        // 3. Broadcast to all
        const allNotes = await db.collection("notifications").where("userId", "==", "all").get();
        allNotes.forEach((doc) => {
          if (!list.some(n => n.id === doc.id)) {
            list.push({ id: doc.id, ...doc.data() });
          }
        });
      } catch (err) {
        console.warn("Firestore notification query note:", err.message);
      }
    }

    // Merge local cache
    for (const note of localNotifications.values()) {
      if (
        note.userId === userId || 
        note.userId === "all" || 
        (userEmail && note.userEmail === userEmail)
      ) {
        if (!list.some(n => n.id === note.id)) {
          list.push(note);
        }
      }
    }

    // Sort descending by date
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, notifications: list });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin Broadcast Announcement / Special Offer to All Users
 */
router.post("/broadcast", async (req, res) => {
  try {
    const { title, message, type, promoCode } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const noteId = `NOTIF-${Date.now()}`;
    const notificationData = {
      id: noteId,
      userId: "all",
      type: type || "promo",
      title,
      message,
      promoCode: promoCode || "",
      read: false,
      createdAt: new Date().toISOString(),
    };

    localNotifications.set(noteId, notificationData);

    if (db) {
      try {
        await db.collection("notifications").doc(noteId).set(notificationData);
      } catch (dbErr) {
        console.warn("Firestore write skipped (saved in cache):", dbErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Notification broadcasted successfully to all customers",
      notification: notificationData,
    });
  } catch (error) {
    console.error("Error broadcasting notification:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Mark Notification as Read
 */
router.patch("/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    if (localNotifications.has(id)) {
      const item = localNotifications.get(id);
      item.read = true;
      item.updatedAt = new Date().toISOString();
      localNotifications.set(id, item);
    }
    if (db) {
      try {
        await db.collection("notifications").doc(id).update({
          read: true,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        // Ignored
      }
    }
    return res.status(200).json({ success: true, message: "Marked as read" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin: Delete Notification / Broadcast
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (localNotifications.has(id)) {
      localNotifications.delete(id);
    }
    if (db) {
      try {
        await db.collection("notifications").doc(id).delete();
      } catch (err) {
        console.warn("Firestore delete skipped:", err.message);
      }
    }
    return res.status(200).json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
