require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER, // send to self
    subject: 'Test Email',
    text: 'This is a test email to debug nodemailer.'
};

console.log('Sending email with user:', process.env.EMAIL_USER);
console.log('Using pass (first 3 chars):', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.substring(0, 3) : 'undefined');

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error('Email error:', error);
    } else {
        console.log('Email sent:', info.response);
    }
});
