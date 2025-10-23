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

export async function sendLoginEmail(email: string, link: string) {
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
      const mailOptions = {
        from: `"IntelliWatt Login" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Magic Link to IntelliWatt',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0077ff;">Welcome to IntelliWatt!</h2>
            <p>Click the button below to access your IntelliWatt dashboard:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${link}" style="background: #0077ff; color: #fff; padding: 15px 30px; border-radius: 5px; text-decoration: none; display: inline-block;">Access Dashboard</a>
            </div>
            <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes.</p>
            <p style="color: #666; font-size: 14px;">If you didn't request this link, you can safely ignore this email.</p>
          </div>
        `,
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
