import { Worker } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { attributionMiddleware } from "./middlewares/attribution.middleware";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
connection.on("error", (err) => console.error("Redis connection error:", err));

const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;

if (process.env.NODE_ENV === "production" && (!emailUser || !emailPass)) {
  console.warn(
    "⚠️ EMAIL_USER and EMAIL_PASS are not set. Service will use fallback credentials.",
  );
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: emailUser || "noreplycampusschield@gmail.com",
    pass: emailPass || "acix rfbi kujh xwtj",
  },
});

const emailTemplate = (title: string, content: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 24px;">🎓 UniZ Campus</h1>
    </div>
    <div style="padding: 30px;">
      <h2 style="color: #1f2937; margin-top: 0;">${title}</h2>
      <div style="color: #4b5563; line-height: 1.6;">
        ${content}
      </div>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">
        This is an automated email from UniZ Campus Management System.<br>
        Please do not reply to this email.
      </p>
    </div>
  </div>
`;

const worker = new Worker(
  "notification-queue",
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.name}`);
    const { type, recipient, subject, body, html } = job.data;

    if (type === "EMAIL") {
      await transporter.sendMail({
        from: '"UniZ Campus" <noreplycampusschield@gmail.com>',
        to: recipient,
        subject: subject,
        html: html || emailTemplate(subject, `<p>${body}</p>`),
      });
      console.log(`Email sent to ${recipient}`);
    }
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log(`${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
  console.log(`${job?.id} has failed with ${err.message}`);
});

const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors());

if (attributionMiddleware) app.use(attributionMiddleware);

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "uniz-notification-service" });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(3007, () => {
    console.log("Notification Service Worker & Health Server Started on 3007");
  });
}

console.log("Notification Service Worker Started");

export default app;
