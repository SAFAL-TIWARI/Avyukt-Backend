import express from "express";
import jwt from "jsonwebtoken";
import { db, auth } from "../config/firebase.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

// In-memory OTP cache with 10-minute expiry
const otpStore = new Map();

// Helper to check if a user account already exists in database
const checkUserExists = async (sanitizedEmail) => {
  const adminEmail = (process.env.ADMIN_EMAIL ).toLowerCase();
  if (sanitizedEmail === adminEmail || sanitizedEmail === "") {
    return true;
  }

  if (db) {
    try {
      const emailSnap = await db.collection("users")
        .where("email", "==", sanitizedEmail)
        .limit(1)
        .get();
      if (!emailSnap.empty) return true;

      const directUid = "user_" + Buffer.from(sanitizedEmail).toString("hex").slice(0, 20);
      const directDoc = await db.collection("users").doc(directUid).get();
      if (directDoc.exists) return true;

      // Fallback: check all docs to see if any has matching lowercase email
      const allUsers = await db.collection("users").get();
      let found = false;
      allUsers.forEach(d => {
        const uEmail = (d.data()?.email || "").toLowerCase().trim();
        if (uEmail && uEmail === sanitizedEmail) {
          found = true;
        }
      });
      if (found) return true;
    } catch (e) {
      console.warn("User existence lookup note:", e.message);
    }
  }
  return false;
};

/**
 * Send 6-digit OTP to User's Email
 */
router.post("/send-email-otp", async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const sanitizedEmail = email.toLowerCase().trim();

    // If user is trying to log in, verify that their account actually exists first!
    if (type === "login") {
      const exists = await checkUserExists(sanitizedEmail);
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: "User does not exist with this email. Please sign up to create an account."
        });
      }
    }

    // If user is trying to sign up, verify that account does not already exist
    if (type === "signup") {
      const exists = await checkUserExists(sanitizedEmail);
      if (exists) {
        return res.status(409).json({
          success: false,
          message: "An account with this email already exists. Please sign in instead."
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(sanitizedEmail, { otp, expiresAt });
    console.log('[AUTH OTP] Code for ' + sanitizedEmail + ': ' + otp);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 25px; border-radius: 16px; border: 1px solid #eaeaea; background: #fafafa;">
        <h2 style="color: #991b1b; text-align: center; margin-bottom: 20px;">Avyukt Restaurant</h2>
        <p style="font-size: 15px; color: #444;">Hello,</p>
        <p style="font-size: 15px; color: #444;">Your One-Time Password (OTP) for authentication at Avyukt Restaurant is:</p>
        <div style="background: #991b1b; color: #fff; font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 14px; border-radius: 12px; margin: 25px 0;">
          ${otp}
        </div>
        <p style="font-size: 13px; color: #777; text-align: center;">This code will expire in 10 minutes. Please do not share it with anyone.</p>
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
        <p style="font-size: 11px; color: #aaa; text-align: center;">Avyukt Restaurant & Cafe • Hotel Grand Ashok, Vidisha</p>
      </div>
    `;

    const mailResult = await sendEmail({
      to: sanitizedEmail,
      subject: `Your Avyukt Restaurant Login OTP: ${otp}`,
      text: `Your login OTP is ${otp}. Valid for 10 minutes.`,
      html,
    });

    return res.status(200).json({
      success: true,
      delivered: mailResult && mailResult.delivered === true,
      message: mailResult && mailResult.delivered === true
        ? "OTP sent successfully to " + sanitizedEmail
        : "OTP generated for " + sanitizedEmail + ". Note: configure EMAIL_USER and EMAIL_PASS in backend .env to send real emails to customer inboxes.",
    });
  } catch (error) {
    console.error("Error in /send-email-otp:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Verify Email OTP and Return/Create User Profile
 */
router.post("/verify-email-otp", async (req, res) => {
  try {
    const { email, otp, name, type, password } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const sanitizedEmail = email.toLowerCase().trim();
    const cached = otpStore.get(sanitizedEmail);
    if (!cached || cached.otp !== otp.trim()) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    if (Date.now() > cached.expiresAt) {
      otpStore.delete(sanitizedEmail);
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    const adminEmail = (process.env.ADMIN_EMAIL ).toLowerCase();
    const isAdmin = sanitizedEmail === adminEmail || sanitizedEmail === "";

    let existingDoc = null;
    let existingData = null;
    let uid = "user_" + Buffer.from(sanitizedEmail).toString("hex").slice(0, 20);

    if (db) {
      try {
        const emailSnap = await db.collection("users")
          .where("email", "==", sanitizedEmail)
          .limit(1)
          .get();

        if (!emailSnap.empty) {
          existingDoc = emailSnap.docs[0];
          existingData = existingDoc.data();
          uid = existingDoc.id; // Preserve original account UID
        } else {
          const directDoc = await db.collection("users").doc(uid).get();
          if (directDoc.exists) {
            existingDoc = directDoc;
            existingData = directDoc.data();
          }
        }
      } catch (dbErr) {
        console.warn("Firestore access warning:", dbErr.message);
      }
    }

    // CRITICAL: If user is trying to log in, do NOT create an account if they do not exist!
    if (type === "login" && !existingData && !isAdmin) {
      otpStore.delete(sanitizedEmail);
      return res.status(404).json({
        success: false,
        message: "User does not exist with this email. Please sign up to create an account."
      });
    }

    // OTP is valid - remove from cache
    otpStore.delete(sanitizedEmail);

    const avatarUrl = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || (existingData && existingData.name) || sanitizedEmail.split('@')[0]) + '&background=800000&color=ffffff&bold=true&size=128&rounded=true';

    let userData = {
      uid,
      email: sanitizedEmail,
      name: (existingData && existingData.name) || name || sanitizedEmail.split("@")[0],
      avatar: (existingData && existingData.avatar) || avatarUrl,
      role: (existingData && existingData.role) || (isAdmin ? "admin" : "customer"),
      phone: (existingData && existingData.phone) || "",
      location: (existingData && existingData.location) || "",
      savedAddresses: (existingData && existingData.savedAddresses) || [],
      updatedAt: new Date().toISOString(),
    };

    if (password) {
      userData.password = password;
    } else if (existingData && existingData.password) {
      userData.password = existingData.password;
    }

    if (db) {
      try {
        if (existingDoc) {
          await existingDoc.ref.set(userData, { merge: true });
        } else {
          userData.createdAt = new Date().toISOString();
          await db.collection("users").doc(uid).set(userData);
        }
      } catch (dbErr) {
        console.warn("Firestore access warning:", dbErr.message);
      }
    }

    // Generate JWT session token
    const token = jwt.sign(
      { uid: userData.uid, email: userData.email, role: userData.role },
      process.env.JWT_SECRET || "avyukt_jwt_super_secret_key_2026",
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      success: true,
      message: "Authentication successful",
      token,
      user: userData,
    });
  } catch (error) {
    console.error("Error in /verify-email-otp:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Admin Login Endpoint (Verifies against .env or Firestore admin)
 */
router.post("/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminEmail = (process.env.ADMIN_EMAIL ).toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const inputEmail = email.toLowerCase().trim();
    const isEmailMatch = inputEmail === adminEmail;
    const isPassMatch = password === adminPass;

    if (isEmailMatch && isPassMatch) {
      const adminToken = jwt.sign(
        { email: adminEmail, role: "admin" },
        process.env.JWT_SECRET || "avyukt_jwt_super_secret_key_2026",
        { expiresIn: "7d" }
      );

      // Fetch live consolidated admin profile from Firestore
      let adminProfile = {
        uid: "admin_avyukt_master",
        name: "Avyukt Restaurant Admin",
        email: adminEmail,
        role: "admin",
        phone: "9876543210",
        location: "Hotel Grand Ashok, 3rd Floor, Kundan Complex Shehnai Garden, Vidisha - 464001",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin_avyukt",
        savedAddresses: [],
      };

      if (db) {
        try {
          const docSnap = await db.collection("users").doc("admin_avyukt_master").get();
          if (docSnap.exists) {
            const data = docSnap.data();
            adminProfile = {
              ...adminProfile,
              ...data,
              uid: "admin_avyukt_master",
              role: "admin",
              email: data.email || adminEmail,
            };
          }
        } catch (dbErr) {
          console.warn("Could not fetch admin document from Firestore:", dbErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Admin authentication successful",
        token: adminToken,
        user: adminProfile,
      });
    }

    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  } catch (error) {
    console.error("Error in /admin-login:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Forgot Password Request (Sends Reset Link or Instructions)
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const resetToken = jwt.sign(
      { email: email.toLowerCase() },
      process.env.JWT_SECRET || "avyukt_jwt_super_secret_key_2026",
      { expiresIn: "1h" }
    );

    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/login?resetToken=${resetToken}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 25px; border-radius: 16px; border: 1px solid #eaeaea;">
        <h2 style="color: #991b1b; text-align: center;">Reset Your Password</h2>
        <p>You requested a password reset for your Avyukt Restaurant account.</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${resetLink}" style="background: #991b1b; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 12px; color: #888;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: "Password Reset Request - Avyukt Restaurant",
      text: `Reset your password at: ${resetLink}`,
      html,
    });

    return res.status(200).json({
      success: true,
      message: "Password reset instructions sent to your email.",
    });
  } catch (error) {
    console.error("Error in /forgot-password:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});


/**
 * Customer / Admin Password Login (Dual engine authentication)
 */
router.post("/login-with-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const sanitizedEmail = email.toLowerCase().trim();
    const adminEmail = (process.env.ADMIN_EMAIL ).toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD;

    // 1. Admin account check
    const isEmailAdmin = sanitizedEmail === adminEmail ;
    const isPassAdmin = password === adminPass;

    if (isEmailAdmin && isPassAdmin) {
      const adminToken = jwt.sign(
        { email: sanitizedEmail, role: "admin" },
        process.env.JWT_SECRET || "avyukt_jwt_super_secret_key_2026",
        { expiresIn: "7d" }
      );

      let adminProfile = {
        uid: "admin_avyukt_master",
        name: "Avyukt Restaurant Admin",
        email: sanitizedEmail,
        role: "admin",
        phone: "9876543210",
        location: "Hotel Grand Ashok, 3rd Floor, Kundan Complex Shehnai Garden, Vidisha - 464001",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=admin_avyukt",
        savedAddresses: [],
      };

      if (db) {
        try {
          const docSnap = await db.collection("users").doc("admin_avyukt_master").get();
          if (docSnap.exists) {
            const data = docSnap.data();
            adminProfile = {
              ...adminProfile,
              ...data,
              uid: "admin_avyukt_master",
              role: "admin",
              email: data.email || sanitizedEmail,
            };
          }
        } catch (dbErr) {
          console.warn("Could not fetch admin document from Firestore:", dbErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Admin authentication successful",
        token: adminToken,
        user: adminProfile,
      });
    }

    // 2. Customer account check in Firestore
    if (db) {
      const emailSnap = await db.collection("users")
        .where("email", "==", sanitizedEmail)
        .get();

      let userDoc = null;
      let userData = null;

      if (!emailSnap.empty) {
        userDoc = emailSnap.docs[0];
        userData = userDoc.data();
      } else {
        const directUid = "user_" + Buffer.from(sanitizedEmail).toString("hex").slice(0, 20);
        const directDoc = await db.collection("users").doc(directUid).get();
        if (directDoc.exists) {
          userDoc = directDoc;
          userData = directDoc.data();
        }
      }

      // Check all docs fallback
      if (!userData) {
        const allUsers = await db.collection("users").get();
        allUsers.forEach(d => {
          const dData = d.data();
          if ((dData?.email || "").toLowerCase().trim() === sanitizedEmail) {
            userDoc = d;
            userData = dData;
          }
        });
      }

      if (userData) {
        if (userData.password && userData.password === password) {
          const token = jwt.sign(
            { uid: userDoc.id, email: sanitizedEmail, role: userData.role || "customer" },
            process.env.JWT_SECRET || "avyukt_jwt_super_secret_key_2026",
            { expiresIn: "30d" }
          );

          const safeUser = { ...userData, uid: userDoc.id };
          return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: safeUser,
          });
        }
      } else {
        return res.status(404).json({
          success: false,
          message: "User does not exist with this email. Please sign up to create an account."
        });
      }
    }

    return res.status(401).json({
      success: false,
      message: "Incorrect email or password. Please verify your credentials."
    });
  } catch (error) {
    console.error("Error in /login-with-password:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Sync / Save User Password
 */
router.post("/sync-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    const sanitizedEmail = email.toLowerCase().trim();
    if (db) {
      const emailSnap = await db.collection("users").where("email", "==", sanitizedEmail).get();
      if (!emailSnap.empty) {
        for (const doc of emailSnap.docs) {
          await db.collection("users").doc(doc.id).set({ password, updatedAt: new Date().toISOString() }, { merge: true });
        }
      }
      const directUid = "user_" + Buffer.from(sanitizedEmail).toString("hex").slice(0, 20);
      const directDoc = await db.collection("users").doc(directUid).get();
      if (directDoc.exists) {
        await directDoc.ref.set({ password, updatedAt: new Date().toISOString() }, { merge: true });
      }
    }
    return res.status(200).json({ success: true, message: "Password synchronized" });
  } catch (err) {
    console.warn("Sync password note:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Update Profile Endpoint (Directly updates Firestore user / admin doc)
 */
router.post("/update-profile", async (req, res) => {
  try {
    const { uid, email, name, phone, location, avatar, savedAddresses } = req.body;
    const adminEmail = (process.env.ADMIN_EMAIL).toLowerCase();
    
    const isAdmin = uid === "admin_avyukt_master" || 
      uid === "admin_avyuktadmin" || 
      (email && (email.toLowerCase() === adminEmail || email.toLowerCase() === ""));

    const targetUid = isAdmin ? "admin_avyukt_master" : uid;

    if (!targetUid) {
      return res.status(400).json({ success: false, message: "User UID is required" });
    }

    const updates = {
      updatedAt: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (location !== undefined) updates.location = location;
    if (avatar !== undefined) updates.avatar = avatar;
    if (savedAddresses !== undefined) updates.savedAddresses = savedAddresses;

    if (db) {
      const userRef = db.collection("users").doc(targetUid);
      const existing = await userRef.get();
      if (existing.exists) {
        await userRef.set({ ...existing.data(), ...updates, uid: targetUid }, { merge: true });
      } else {
        await userRef.set({
          uid: targetUid,
          email: email || (isAdmin ? adminEmail : ""),
          role: isAdmin ? "admin" : "customer",
          ...updates,
        });
      }

      const updatedSnap = await userRef.get();
      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: { ...updatedSnap.data(), uid: targetUid },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated",
      user: { uid: targetUid, ...updates },
    });
  } catch (error) {
    console.error("Error in /update-profile:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

