import { Worker } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { attributionMiddleware } from "./middlewares/attribution.middleware";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fs from "fs";

// --- PDF UTILS ---
const getExecutablePath = async () => {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) return await chromium.executablePath();

  if (process.env.PUPPETEER_EXECUTABLE_PATH)
    return process.env.PUPPETEER_EXECUTABLE_PATH;

  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
  ];

  for (const path of paths) {
    if (fs.existsSync(path)) return path;
  }

  throw new Error(
    "Could not find a suitable browser for Puppeteer. Please install Google Chrome or Brave Browser.",
  );
};

const baseLaunchBrowser = async (retries = 3) => {
  const isProduction = process.env.NODE_ENV === "production";
  const execPath = await getExecutablePath();

  for (let i = 0; i < retries; i++) {
    try {
      // @ts-ignore
      return await puppeteer.launch({
        args: isProduction ? chromium.args : [],
        // @ts-ignore
        defaultViewport: isProduction
          ? // @ts-ignore
            chromium.defaultViewport
          : { width: 1200, height: 800 },
        executablePath: execPath,
        // @ts-ignore
        headless: isProduction ? chromium.headless : true,
      });
    } catch (err: any) {
      if (
        i < retries - 1 &&
        (err.code === "ETXTBSY" || err.message.includes("ETXTBSY"))
      ) {
        console.warn(`Launch failed (attempt ${i + 1}), retrying in 200ms...`);
        await new Promise((r) => setTimeout(r, 200));
      } else {
        throw err;
      }
    }
  }
};

const generateResultPdf = async (data: any): Promise<Buffer> => {
  const { name, username, branch, semesterId, grades, campus } = data;

  // Calculate GPA/Credits
  let totalCredits = 0;
  let earnedPoints = 0;
  grades.forEach((g: any) => {
    const credit = Number(g.subject.credits);
    const gradePoint = Number(g.grade);
    totalCredits += credit;
    if (credit > 0) {
      earnedPoints += credit * (gradePoint > 0 ? gradePoint : 0);
    }
  });

  const sgpa =
    totalCredits > 0 ? (earnedPoints / totalCredits).toFixed(2) : "0.00";

  let titleText = `${semesterId.toUpperCase()} RESULTS`;

  /* 
    Title Logic:
    1. Try to parse E#S# or P#S# from semesterId (e.g., "E2S1", "AY24-E3-S2")
    2. Try to extract Semester (S1-S3)
    3. Fallback: Infer Year from Subject Code if missing
  */

  let yearStr = "";
  let semStr = "";

  const yearMatch = semesterId.match(/([EP])[-_ ]?([1-4])/i);
  if (yearMatch) yearStr = `${yearMatch[1].toUpperCase()}${yearMatch[2]}`;

  const semMatch = semesterId.match(/S(?:em(?:ester)?)?[-_ ]?([1-3])/i);
  if (semMatch) semStr = semMatch[1];

  if (
    !yearStr &&
    grades.length > 0 &&
    grades[0].subject &&
    grades[0].subject.code
  ) {
    const codeMatch = grades[0].subject.code.match(/^[a-zA-Z]+[-_ ]?([1-4])/);
    if (codeMatch) yearStr = `E${codeMatch[1]}`;
  }

  if (yearStr && semStr) {
    titleText = `${yearStr} SEMESTER-${semStr} RESULTS`;
  } else {
    titleText = `${semesterId.toUpperCase()} RESULTS`.replace(
      " RESULTS RESULTS",
      " RESULTS",
    );
  }

  const getGradeLetter = (point: number) => {
    if (point >= 10) return "EX";
    if (point >= 9) return "A";
    if (point >= 8) return "B";
    if (point >= 7) return "C";
    if (point >= 6) return "D";
    if (point >= 5) return "E";
    return "R";
  };

  const rows = grades
    .map(
      (g: any) => `
      <tr>
          <td>${g.subject.name}</td>
          <td class="center">${Number(g.subject.credits).toFixed(1)}</td>
          <td class="center">${getGradeLetter(g.grade)}</td>
      </tr>
  `,
    )
    .join("");

  const LOGO_URL =
    "https://res.cloudinary.com/dy2fjgt46/image/upload/v1770094547/rguktongole_logo_tzdkrc.jpg";

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
  <style>
      @import url('https://fonts.googleapis.com/css2?family=Times+New+Roman&display=swap');
      body { font-family: 'Times New Roman', serif; padding: 40px; color: #000; -webkit-print-color-adjust: exact; }
      
      .header-container { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #ff9900; padding-bottom: 10px; position: relative; }
      .logo { width: 80px; position: absolute; left: 0; top: 0; }
      .uni-name { color: #cc0000; font-size: 24px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; padding-left: 90px; }
      .sub-name { color: #cc0000; font-size: 11px; font-weight: bold; padding-left: 90px; }
      .student-info { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 14px; }
      .student-info td { border: 1px solid #ddd; padding: 8px 12px; }
      .info-label { font-weight: bold; width: 15%; background-color: #fafafa; }
      .info-val { width: 35%; font-weight: bold; }
      .results-title { text-align: center; font-weight: bold; font-size: 18px; margin: 20px 0; text-transform: uppercase; letter-spacing: 0.5px; }
      .results-table { width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 14px; }
      .results-table th { border: 1px solid #000; padding: 10px; text-align: left; font-weight: bold; color: #000; }
      .green-header th { border-top: 2px solid #008000; border-bottom: 2px solid #008000; }
      .results-table td { border: 1px solid #000; padding: 8px 10px; }
      .center { text-align: center; }
      .footer-row td { background-color: #fff; font-weight: bold; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 100px; color: rgba(0, 0, 0, 0.05); z-index: -1; white-space: nowrap; pointer-events: none; }
  </style>
  </head>
  <body>
      <div class="watermark">RGUKT ${campus.toUpperCase()}</div>
      <div class="header-container">
          <img src="${LOGO_URL}" class="logo" alt="RGUKT Logo" />
          <div class="uni-name">Rajiv Gandhi University of Knowledge Technologies - Andhra Pradesh</div>
          <div class="sub-name">(Established by the Govt. of Andhra Pradesh and recognized as per Section 2(f), 12(B) of UGC Act, 1956)</div>
      </div>
      <table class="student-info">
          <tr><td class="info-label">ID</td><td class="info-val">${username}</td><td class="info-label">Branch:</td><td class="info-val">${branch}</td></tr>
          <tr><td class="info-label">Name:</td><td class="info-val">${name}</td><td class="info-label">Campus:</td><td class="info-val">${campus}</td></tr>
      </table>
      <div class="results-title">${titleText}</div>
      <table class="results-table">
          <thead class="green-header">
              <tr><th style="border-left: 2px solid #008000;">COURSE TITLE</th><th class="center">Credits</th><th class="center" style="border-right: 2px solid #008000;">Grade</th></tr>
          </thead>
          <tbody>
              ${rows}
              <tr class="footer-row">
                  <td style="text-align: right; padding-right: 20px;">Total</td>
                  <td class="center">${totalCredits.toFixed(0)}</td>
                  <td class="center">${earnedPoints.toFixed(1)}</td>
              </tr>
              <tr class="footer-row">
                  <td colspan="2" style="text-align: right; padding-right: 20px;">SGPA</td>
                  <td class="center">${sgpa}</td>
              </tr>
          </tbody>
      </table>
  </body>
  </html>
  `;

  let browser;
  try {
    browser = await baseLaunchBrowser();
    if (!browser) throw new Error("Failed to launch browser");

    const page = await browser.newPage();
    await page.setContent(html);
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });
    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("Puppeteer Launch Error:", error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};

const generateAttendancePdf = async (data: any): Promise<Buffer> => {
  const { name, username, branch, semesterId, records, campus } = data;

  let totalAttended = 0;
  let totalClasses = 0;
  records.forEach((r: any) => {
    totalAttended += r.attendedClasses;
    totalClasses += r.totalClasses;
  });

  const overallPercent =
    totalClasses > 0
      ? ((totalAttended / totalClasses) * 100).toFixed(2)
      : "0.00";

  const rows = records
    .map((r: any) => {
      const percent =
        r.totalClasses > 0
          ? ((r.attendedClasses / r.totalClasses) * 100).toFixed(1)
          : "0.0";
      return `
      <tr>
          <td>${r.subject.name} <br><small style="color:#666">${r.subject.code}</small></td>
          <td class="center">${r.attendedClasses} / ${r.totalClasses}</td>
          <td class="center">${percent}%</td>
      </tr>
    `;
    })
    .join("");

  const LOGO_URL =
    "https://res.cloudinary.com/dy2fjgt46/image/upload/v1770094547/rguktongole_logo_tzdkrc.jpg";

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
  <style>
      @import url('https://fonts.googleapis.com/css2?family=Times+New+Roman&display=swap');
      body { font-family: 'Times New Roman', serif; padding: 40px; color: #000; -webkit-print-color-adjust: exact; }
      .header-container { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #ff9900; padding-bottom: 10px; position: relative; }
      .logo { width: 80px; position: absolute; left: 0; top: 0; }
      .uni-name { color: #cc0000; font-size: 24px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; padding-left: 90px; }
      .sub-name { color: #cc0000; font-size: 11px; font-weight: bold; padding-left: 90px; }
      .student-info { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 14px; }
      .student-info td { border: 1px solid #ddd; padding: 8px 12px; }
      .info-label { font-weight: bold; width: 15%; background-color: #fafafa; }
      .info-val { width: 35%; font-weight: bold; }
      .results-title { text-align: center; font-weight: bold; font-size: 18px; margin: 20px 0; text-transform: uppercase; letter-spacing: 0.5px; }
      .results-table { width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 14px; }
      .results-table th { border: 1px solid #000; padding: 10px; text-align: left; font-weight: bold; color: #000; background-color: #f2f2f2; }
      .results-table td { border: 1px solid #000; padding: 8px 10px; }
      .center { text-align: center; }
      .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 100px; color: rgba(0, 0, 0, 0.05); z-index: -1; white-space: nowrap; pointer-events: none; }
  </style>
  </head>
  <body>
      <div class="watermark">RGUKT ${campus.toUpperCase()}</div>
      <div class="header-container">
          <img src="${LOGO_URL}" class="logo" alt="RGUKT Logo" />
          <div class="uni-name">Rajiv Gandhi University of Knowledge Technologies - Andhra Pradesh</div>
          <div class="sub-name">(Established by the Govt. of Andhra Pradesh and recognized as per Section 2(f), 12(B) of UGC Act, 1956)</div>
      </div>
      <table class="student-info">
          <tr><td class="info-label">ID</td><td class="info-val">${username}</td><td class="info-label">Branch:</td><td class="info-val">${branch}</td></tr>
          <tr><td class="info-label">Name:</td><td class="info-val">${name}</td><td class="info-label">Campus:</td><td class="info-val">${campus}</td></tr>
      </table>
      <div class="results-title">ATTENDANCE REPORT: ${semesterId.toUpperCase()}</div>
      <table class="results-table">
          <thead>
              <tr><th>Course Title</th><th class="center">Attended / Total</th><th class="center">Percentage</th></tr>
          </thead>
          <tbody>
              ${rows}
              <tr style="background-color: #f9f9f9; font-weight: bold;">
                  <td style="text-align: right;">OVERALL TOTAL</td>
                  <td class="center">${totalAttended} / ${totalClasses}</td>
                  <td class="center">${overallPercent}%</td>
              </tr>
          </tbody>
      </table>
      <div style="margin-top: 30px; font-size: 12px; color: #666;">
          * Mandatory 75% attendance is required to appear for examinations.
          <br>Generated on: ${new Date().toLocaleString()}
      </div>
  </body>
  </html>
  `;

  let browser;
  try {
    browser = await baseLaunchBrowser();
    if (!browser) throw new Error("Failed to launch browser");
    const page = await browser!.newPage();
    await page.setContent(html);
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
    });
    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error("Puppeteer Launch Error (Attendance):", error);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};
// --- END PDF UTILS ---

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
    } else if (type === "RESULTS") {
      try {
        const { semesterId } = job.data;
        const pdfBuffer = await generateResultPdf(job.data);

        await transporter.sendMail({
          from: '"UniZ Academics" <noreplycampusschield@gmail.com>',
          to: recipient,
          subject: `Result Declaration: ${semesterId}`,
          html: emailTemplate(
            `Result Declaration: ${semesterId}`,
            `<p>Dear Student,<br><br>The results for <strong>${semesterId}</strong> have been published.<br>Please find the detailed grade report attached.</p>`,
          ),
          attachments: [
            {
              filename: `ACADEMIC_REPORT_${job.data.username}_${semesterId}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
        console.log(`Result Email with PDF sent to ${recipient}`);
      } catch (e: any) {
        console.error(
          `Failed to generate/send Result PDF for ${recipient}: ${e.message}`,
        );
        throw e; // Retry job
      }
    } else if (type === "ATTENDANCE_REPORT") {
      try {
        const { semesterId } = job.data;
        const pdfBuffer = await generateAttendancePdf(job.data);

        await transporter.sendMail({
          from: '"UniZ Academics" <noreplycampusschield@gmail.com>',
          to: recipient,
          subject: `Attendance Report: ${semesterId}`,
          html: emailTemplate(
            `Attendance Report: ${semesterId}`,
            `<p>Dear Student,<br><br>The attendance report for <strong>${semesterId}</strong> is now available.<br>Please find your detailed attendance record attached.</p>`,
          ),
          attachments: [
            {
              filename: `${job.data.username}_Attendance_${semesterId}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
        console.log(`Attendance Email with PDF sent to ${recipient}`);
      } catch (e: any) {
        console.error(
          `Failed to generate/send Attendance PDF for ${recipient}: ${e.message}`,
        );
        throw e; // Retry job
      }
    }
  },
  { connection, concurrency: 5 }, // Process 5 jobs at once for throughput
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
