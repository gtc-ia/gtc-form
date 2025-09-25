import nodemailer from 'nodemailer';

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +process.env.SMTP_PORT,
  secure: String(process.env.SMTP_SECURE) === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

export async function sendVerificationEmail(toEmail, token) {
  const base = process.env.APP_BASE_URL || 'https://app.gtstor.com';
  const path = process.env.VERIFY_PATH || '/verify';
  const url = `${base}${path}?token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Confirm your email</h2>
      <p>Thanks for creating an account at GTC. Please confirm your email address to continue.</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Verify email</a></p>
      <p>If the button doesn’t work, copy and paste this link:</p>
      <p><a href="${url}">${url}</a></p>
      <p style="color:#6b7280">This link expires in 60 minutes.</p>
    </div>`;

  await mailer.sendMail({
    from: process.env.MAIL_FROM,
    to: toEmail,
    subject: 'Confirm your email — GTC',
    html
  });
}
