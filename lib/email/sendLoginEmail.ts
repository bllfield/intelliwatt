import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendLoginEmail(email: string, link: string) {
  // For testing: log the magic link to console instead of sending email
  console.log('=== MAGIC LINK FOR TESTING ===');
  console.log(`Email: ${email}`);
  console.log(`Magic Link: ${link}`);
  console.log('==============================');
  
  // Uncomment the code below when you have proper email configuration
  /*
  const mailOptions = {
    from: `"IntelliWatt Login" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your Magic Link to IntelliWatt',
    html: `
      <p>Click below to access your IntelliWatt dashboard:</p>
      <p><a href="${link}" style="background:#0077ff;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;">Access Dashboard</a></p>
      <p>This link will expire in 15 minutes.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
  */
}
