import nodemailer from "nodemailer";

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  const user = (process.env.EMAIL_USER || process.env.SMTP_USER || "").trim();
  const pass = (process.env.EMAIL_PASS || process.env.SMTP_PASS || "").trim();
  const service = process.env.EMAIL_SERVICE || "gmail";

  if (user && pass) {
    transporter = nodemailer.createTransport({
      service,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, html, text }) => {
  const mailClient = getTransporter();
  if (mailClient) {
    try {
      const sender = (process.env.EMAIL_USER || process.env.SMTP_USER || "").trim();
      const info = await mailClient.sendMail({
        from: '"Avyukt Restaurant" <' + sender + '>',
        to,
        subject,
        text,
        html,
      });
      return { success: true, messageId: info.messageId, delivered: true };
    } catch (err) {
      console.error("Live email delivery error:", err.message);
      throw new Error("Email delivery failed: " + err.message);
    }
  } else {
    console.warn("⚠️ Real email delivery: configure EMAIL_USER and EMAIL_PASS in backend .env");
    return { success: true, simulated: true, delivered: false };
  }
};
