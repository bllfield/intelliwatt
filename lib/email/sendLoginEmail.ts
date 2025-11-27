import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendLoginEmail(email: string, link: string, subject?: string) {
  // For testing: log the magic link to console
  console.log('=== MAGIC LINK FOR TESTING ===');
  console.log(`Email: ${email}`);
  console.log(`Magic Link: ${link}`);
  console.log('==============================');

  // Check if email configuration is available
  console.log('Email configuration check:');
  console.log(`EMAIL_HOST: ${process.env.EMAIL_HOST ? 'SET' : 'NOT SET'}`);
  console.log(`EMAIL_PORT: ${process.env.EMAIL_PORT ? 'SET' : 'NOT SET'}`);
  console.log(`EMAIL_USER: ${process.env.EMAIL_USER ? 'SET' : 'NOT SET'}`);
  console.log(`EMAIL_PASS: ${process.env.EMAIL_PASS ? 'SET' : 'NOT SET'}`);

  // Try to send email if email configuration is available
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      console.log('Attempting to send email...');
      const isAdmin = subject?.includes('Admin') || false;
      const fromEmail = process.env.EMAIL_USER;
      const fromName = isAdmin ? 'IntelliWatt Admin' : 'HitTheJackWatt • Powered by IntelliWatt';
      const resolvedSubject =
        subject ||
        (isAdmin
          ? 'Your IntelliWatt admin access link'
          : 'Your HitTheJackWatt (powered by IntelliWatt) magic link');
      const heading = isAdmin ? 'IntelliWatt Admin Access' : 'Open Your HitTheJackWatt Dashboard';
      const intro = isAdmin
        ? 'Here is your secure link to access the IntelliWatt admin panel.'
        : 'Here is your secure magic link to open your HitTheJackWatt energy dashboard powered by IntelliWatt.';
      const actionCopy = isAdmin ? 'Open Admin Panel' : 'Open My HitTheJackWatt Dashboard';
      const html = `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 22px; margin-bottom: 16px; color: #0f172a;">${heading}</h1>
          <p style="margin-bottom: 16px;">${intro}</p>
          ${
            isAdmin
              ? ''
              : "<p style=\"margin-bottom: 16px; color: #1e293b; font-weight: 600;\">HitTheJackWatt™ is powered by IntelliWatt — your free energy dashboard.</p>"
          }
          <p style="margin-bottom: 16px;">Click the button below to continue:</p>
          <p style="margin: 24px 0;">
            <a
              href="${link}"
              style="display: inline-block; padding: 12px 24px; border-radius: 9999px; background: #0f172a; color: #ffffff; text-decoration: none; font-weight: 600;"
            >
              ${actionCopy}
            </a>
          </p>
          <p style="margin-bottom: 16px;">
            If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="word-break: break-all; font-size: 13px; color: #475569; margin-bottom: 24px;">${link}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 13px; color: #475569;">
            This link will expire in 15 minutes. If you did not request this email, you can safely ignore it.
          </p>
        </div>
      `;

      const text = `
${heading}

${intro}

${isAdmin ? '' : 'HitTheJackWatt is powered by IntelliWatt — your free energy dashboard.\n\n'}
${link}

This link will expire in 15 minutes. If you did not request this email, you can safely ignore it.
      `.trim();

      const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: resolvedSubject,
        html,
        text,
      };

      await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully to ${email}`);
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
      console.error('Error details:', (emailError as Error).message);
      // Don't throw - we'll still log the magic link for testing
    }
  } else {
    console.log('⚠️ Email configuration not available - magic link logged to console only');
  }
}
