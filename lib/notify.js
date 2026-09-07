"use strict";

/**
 * Outbound SMS / email providers. Isolated so Twilio/SMTP stay out of route files.
 * Missing credentials → no-op (false), never throw into HTTP handlers.
 */

const nodemailer = require("nodemailer");
const { warn } = require("./log");

let transporter;

function mailer() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.example.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporter;
}

async function sendMail(to, subject, text) {
  if (!to || !process.env.SMTP_USER) return false;
  try {
    await mailer().sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER || "no-reply@gps-familia.local",
      to,
      subject,
      text
    });
    return true;
  } catch (err) {
    warn("email-fail", { error: String(err && err.message || err) });
    return false;
  }
}

async function sendSms(to, text) {
  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !to) return false;
  try {
    const url = "https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json";
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!res.ok) {
      const t = await res.text();
      warn("sms-fail", { status: res.status, error: String(t).slice(0, 200) });
      return false;
    }
    return true;
  } catch (e) {
    warn("sms-fail", { error: String(e && e.message || e) });
    return false;
  }
}

module.exports = { sendMail, sendSms };
