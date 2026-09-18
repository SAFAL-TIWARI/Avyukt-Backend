# Avyukt Restaurant Backend 🛡️⚡

**Robust, Real-Time RESTful API for Avyukt Restaurant & Cafe.**  
Built with Node.js, Express, Firebase Cloud Firestore, Razorpay, and Nodemailer to handle high-concurrency food orders, table reservations, notifications, and administrative workflows.

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Firebase Firestore](https://img.shields.io/badge/Firestore-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/docs/firestore)
[![Razorpay](https://img.shields.io/badge/Razorpay_SDK-02042B?style=for-the-badge&logo=razorpay&logoColor=3395FF)](https://razorpay.com/)
[![JWT](https://img.shields.io/badge/JWT_Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)](https://jwt.io/)

---

## 🚀 Core Features

- 🔐 **Dual-Engine Authentication**: Supports password verification, tokenized sessions, and 6-digit email OTPs with 10-minute validity and automatic user provisioning.
- 💳 **Razorpay Payment Pipeline**: Server-side order creation and cryptographic signature verification (`HMAC-SHA256`) to ensure tamper-proof transactions.
- 📦 **Order & Kitchen Lifecycle**: Complete tracking system supporting Dine-in, Takeaway, and Delivery orders with live status management (`pending` → `preparing` → `ready` → `delivered`).
- 📅 **Table Booking & Inquiries**: Real-time table reservation handling and automated email reply dispatch for customer queries.
- 🔔 **Notification & Broadcast Service**: Targeted customer status alerts and sitewide promotional banners with promo codes.
- 👑 **Admin Command Center Support**: Aggregated statistics for total revenue, active orders, and dining feedback, paired with persistent admin profile storage.

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| **Runtime & Framework** | Node.js (ES Modules), Express.js |
| **Database** | Google Cloud Firestore (NoSQL) |
| **Authentication** | JSON Web Tokens (`jsonwebtoken`), `bcryptjs` |
| **Payment Gateway** | Razorpay Node SDK (`razorpay`), Node Crypto |
| **Email Service** | Nodemailer (Gmail App Passwords SMTP) |
| **CORS & Environment** | `cors`, `dotenv` |

---

## 📡 API Endpoints Reference

### 1. Authentication (`/api/auth`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/send-email-otp` | Generate and email a 6-digit verification code |
| `POST` | `/verify-email-otp` | Validate code and authenticate / register user |
| `POST` | `/admin-login` | Authenticate admin and return Firestore profile |
| `POST` | `/login-with-password` | Dual password authentication for users & admin |
| `POST` | `/sync-password` | Synchronize user password for cross-provider logins |
| `POST` | `/update-profile` | Direct update of user or admin profile in Firestore |
| `POST` | `/forgot-password` | Send password reset instructions via email |

### 2. Orders (`/api/orders`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/` | Create a new food order with items and delivery mode |
| `GET` | `/user/:userId` | Retrieve order history for a specific customer |
| `GET` | `/all` | Fetch all orders across the restaurant (Admin) |
| `PATCH`| `/:id/status` | Update kitchen status (`preparing`, `delivered`, etc.) |
| `PATCH`| `/:id/admin-confirm-amount` | Mark payment verified by restaurant admin |
| `DELETE`| `/:id` | Permanently remove order record |

### 3. Payments (`/api/payment`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/create-order` | Generate Razorpay order ID for amount in INR |
| `POST` | `/verify` | Validate HMAC-SHA256 signature and record payment |
| `GET` | `/user/:userId` | Fetch payment transaction log for a user |

### 4. Interactions (`/api/interactions`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/reservation` | Submit a table booking request |
| `GET` | `/reservations` | List all table bookings (Admin) |
| `PATCH`| `/reservation/:id/status` | Confirm or cancel reservation |
| `POST` | `/feedback` | Submit customer review & food rating |
| `GET` | `/feedbacks` | Fetch all reviews |
| `POST` | `/contact` | Submit contact message |
| `POST` | `/contact/:id/reply` | Send email reply to customer inquiry (Admin) |

### 5. Notifications & Admin Overview
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/notifications/:userId` | Get user notifications & broadcasts |
| `POST` | `/api/notifications/broadcast` | Send sitewide promo announcement |
| `PATCH`| `/api/notifications/:id/read` | Mark alert as read |
| `GET` | `/api/admin/stats` | Aggregated dashboard overview metrics |

---

## 📁 Directory Structure

```text
Avyukt Restro-Backend/
├── config/
│   ├── firebase.js     # Unified Cloud Firestore client connection
│   └── razorpay.js     # Razorpay SDK initialization
├── routes/
│   ├── adminRoutes.js        # Analytics & summary routes
│   ├── authRoutes.js         # Authentication, OTP, and profile routes
│   ├── interactionRoutes.js  # Bookings, reviews, and contact forms
│   ├── notificationRoutes.js # Broadcasts and user notifications
│   ├── orderRoutes.js        # Order creation and kitchen workflow
│   └── paymentRoutes.js      # Razorpay order creation and verification
├── utils/
│   └── mailer.js       # Nodemailer SMTP transporter and templates
├── server.js           # Server bootstrap and middleware stack
├── package.json        # Dependencies and scripts
└── .env.example        # Environment variable blueprint
```

---

## ⚙️ Environment Setup

Create a `.env` file in the root directory:

```env
PORT=5000
NODE_ENV=development

# Admin Authentication
ADMIN_EMAIL=admin_email
ADMIN_PASSWORD=admin_password

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key_2026

# Razorpay API Keys
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Frontend Allowed Origin
FRONTEND_URL=http://localhost:5173

# Firebase Cloud Project
FIREBASE_PROJECT_ID=avyukt-restaurant

# Email Service (For Real OTP Delivery & Inquiry Replies)
EMAIL_SERVICE=gmail
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_16_digit_gmail_app_password
```

---

## 🏁 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
```
The server will start on `http://localhost:5000` with hot-reload enabled.

### 3. Production Start
```bash
npm start
```

---

## 🔒 Security Best Practices
- Keep `.env` and any service account credentials out of version control (included in `.gitignore`).
- All Razorpay payments verify cryptographic signatures on the backend before updating database state.
- Sensitive admin endpoints enforce role-based authorization tokens.

---

<div align="center">
  <sub>Avyukt Restaurant & Cafe Backend Services • Production Ready</sub>
</div>
