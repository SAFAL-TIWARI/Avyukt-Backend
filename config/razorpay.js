import Razorpay from "razorpay";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

let razorpayInstance = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  console.log(`✅ Razorpay initialized successfully with Key: ${process.env.RAZORPAY_KEY_ID}`);
} else {
  console.warn("⚠️ Razorpay keys missing in .env (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET). Running in sandbox mock mode.");
  razorpayInstance = {
    orders: {
      create: async (options) => ({
        id: "order_test_" + Date.now(),
        entity: "order",
        amount: options.amount,
        currency: options.currency || "INR",
        receipt: options.receipt,
        status: "created",
      }),
    },
  };
}

export default razorpayInstance;
