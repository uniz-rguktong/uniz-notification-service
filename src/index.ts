import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const transporter = nodemailer.createTransport({
    // Mock transport or use Env vars
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: 587,
    auth: {
        user: process.env.SMTP_USER || 'user',
        pass: process.env.SMTP_PASS || 'pass'
    }
});

const worker = new Worker('notification-queue', async job => {
  console.log(`Processing job ${job.id}: ${job.name}`);
  const { type, recipient, subject, body } = job.data;

  if (type === 'EMAIL') {
      await transporter.sendMail({
          from: '"UniZ System" <no-reply@uniz.edu>',
          to: recipient,
          subject: subject,
          text: body,
      });
      console.log(`Email sent to ${recipient}`);
  }
}, { connection });

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job?.id} has failed with ${err.message}`);
});

console.log('Notification Service Worker Started');
