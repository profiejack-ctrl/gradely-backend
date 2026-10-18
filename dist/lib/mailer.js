"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSmtpConfig = getSmtpConfig;
exports.sendOtpEmail = sendOtpEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
function getSmtpConfig() {
    const user = (process.env.SMTP_USER ||
        process.env.GMAIL_USER ||
        process.env.EMAIL_USER ||
        process.env.MAIL_USER ||
        process.env.GMAIL_EMAIL ||
        process.env.EMAIL ||
        '').trim();
    const rawPass = (process.env.SMTP_PASS ||
        process.env.SMTP_PASSWORD ||
        process.env.GMAIL_PASS ||
        process.env.GMAIL_PASSWORD ||
        process.env.GMAIL_APP_PASSWORD ||
        process.env.EMAIL_PASS ||
        process.env.EMAIL_PASSWORD ||
        process.env.PASSWORD ||
        '').trim();
    // Strip spaces if user pasted a Google App Password (e.g. "abcd efgh ijkl mnop")
    const pass = rawPass.replace(/\s+/g, '');
    const host = (process.env.SMTP_HOST ||
        (user.includes('@gmail.com') ? 'smtp.gmail.com' : 'smtp.gmail.com')).trim();
    const port = Number(process.env.SMTP_PORT) || 465;
    const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;
    const fromAddress = process.env.SMTP_FROM || `"Gradely SMS" <${user || 'no-reply@gradely.edu'}>`;
    const isConfigured = Boolean(user && pass);
    return {
        user,
        pass,
        host,
        port,
        isSecure,
        fromAddress,
        isConfigured,
    };
}
/**
 * Sends a 6-digit OTP verification code to a student's email address.
 * If SMTP credentials are configured in .env, sends via real SMTP (e.g. Gmail/SendGrid).
 * If SMTP is not yet configured, logs clearly to the backend console so local testing succeeds immediately.
 */
async function sendOtpEmail(toEmail, otpCode, studentName) {
    const config = getSmtpConfig();
    const subject = `Your Gradely Verification Code: ${otpCode}`;
    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; background-color: #f8fafc; color: #1e293b; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #1e3a8a; font-size: 24px; font-weight: 800; margin: 0 0 6px 0; letter-spacing: -0.5px;">Gradely</h1>
        <p style="color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin: 0;">Student Portal Verification</p>
      </div>

      <div style="background-color: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <h2 style="font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
          ${studentName ? `Hello, ${studentName}` : 'Verify Your Email Address'}
        </h2>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
          You are linking this email address to your official <strong>Gradely Student Account</strong>. Please enter the 6-digit verification code below to verify your email and activate your account:
        </p>

        <div style="text-align: center; margin: 28px 0; padding: 18px; background: #eff6ff; border: 1.5px dashed #93c5fd; border-radius: 12px;">
          <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #1d4ed8; display: inline-block;">
            ${otpCode}
          </span>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-bottom: 20px; line-height: 1.5;">
          ⏱️ This verification code is valid for <strong>10 minutes</strong>. If you did not initiate this request, you can safely ignore this email.
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />

        <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
          This is an automated security transmission from Gradely Student Management System.
        </p>
      </div>
    </div>
  `;
    const text = `Gradely Student Portal Verification Code: ${otpCode}\n\nHello ${studentName || 'Student'},\n\nUse this 6-digit code to verify your email address: ${otpCode}\n\nThis code expires in 10 minutes.`;
    if (config.isConfigured) {
        try {
            const isGmail = config.host.includes('gmail') || config.user.includes('@gmail.com');
            const transporter = isGmail
                ? nodemailer_1.default.createTransport({
                    service: 'gmail',
                    auth: {
                        user: config.user,
                        pass: config.pass,
                    },
                })
                : nodemailer_1.default.createTransport({
                    host: config.host,
                    port: config.port,
                    secure: config.isSecure,
                    auth: {
                        user: config.user,
                        pass: config.pass,
                    },
                });
            await transporter.sendMail({
                from: config.fromAddress,
                to: toEmail,
                subject,
                text,
                html,
            });
            console.log(`[mailer] OTP email successfully sent to ${toEmail} via ${isGmail ? 'Gmail' : config.host}`);
            return { delivered: true, mode: 'smtp' };
        }
        catch (err) {
            console.error(`[mailer] Failed to send via SMTP to ${toEmail}:`, err.message);
            // Fallback to simulated delivery in console so student isn't completely blocked
            console.log(`
======================================================================
📧  [OTP CODE SIMULATED - SMTP FAILED]
To: ${toEmail}
Code: ${otpCode}
Reason: ${err.message}
======================================================================
      `);
            return { delivered: true, mode: 'simulated', error: err.message };
        }
    }
    // Simulated delivery when SMTP is not configured
    console.log(`
======================================================================
📧  [OTP EMAIL SIMULATOR]
To:      ${toEmail}
Student: ${studentName || 'Student'}
Code:    ${otpCode} (Valid for 10 minutes)
Note:    Configure SMTP_USER & SMTP_PASS (or GMAIL_USER & GMAIL_PASS) in .env for live delivery
======================================================================
  `);
    return { delivered: true, mode: 'simulated' };
}
