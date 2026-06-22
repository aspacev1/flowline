import nodemailer from "nodemailer";

export function isMailerConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
}

let cachedTransport = null;
function getDefaultTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return cachedTransport;
}

export async function sendMail({ to, subject, html }, transport = getDefaultTransport()) {
  if (!isMailerConfigured()) {
    throw new Error("Mailer is not configured");
  }
  return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
}
