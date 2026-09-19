import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

import authRoutes from "./routes/authRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import interactionRoutes from "./routes/interactionRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Enable HTTP ETag generation for conditional requests (304 Not Modified)
app.set("etag", "strong");

// Compress all response payloads larger than 1KB (Gzip / Deflate)
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      process.env.FRONTEND_URL || "https://avyukt-restaurant.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "If-None-Match"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cache-Control headers for standard REST responses
app.use((req, res, next) => {
  const url = req.url.toLowerCase();
  const isAdminOrRealtime = 
    url.startsWith("/api/interactions/reservation") ||
    url.startsWith("/api/admin") ||
    url.startsWith("/api/orders") ||
    url.startsWith("/api/notifications");

  if (req.method === "GET" && !isAdminOrRealtime) {
    // 5-second public cache with stale-while-revalidate for public static endpoints
    res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
  } else {
    // Live admin pipelines, reservations, and mutations must never be cached by browser
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/interactions", interactionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    restaurant: "Avyukt Restaurant & Cafe",
    compression: "enabled",
    caching: "enabled",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send("Avyukt Restaurant Backend API is running smoothly 🚀");
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Global server error:", err);
  res.status(500).json({ success: false, message: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Avyukt Restaurant Backend is listening on PORT: ${PORT}`);
  console.log(`🚀 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`==================================================\n`);
});
