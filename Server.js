const express = require('express');
const mysql = require('mysql2/promise');
const formidable = require('formidable');
const axios = require('axios');
const cors = require('cors');
const nodemailer = require('nodemailer');
const config = require('./config');
require('dotenv').config();

const app = express();

// CORS configuration
const allowedOrigins = [
  'http://localhost:5175',
  'https://topdigital.netlify.app',
];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['POST'],
    credentials: false,
  })
);
app.use(express.json());

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test MySQL connection
pool
  .getConnection()
  .then((conn) => {
    console.log('Connected to MySQL:', process.env.DB_NAME);
    conn.release();
  })
  .catch((err) => console.error('MySQL connection error:', err));

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail', // Ensures port 587 and proper TLS
  auth: {
    user: config.email.user, // intopdigital.com@gmail.com
    pass: config.email.pass, // ivhd ciju xydc mwef
  },
  debug: true, // Keep for debugging
  logger: true,
  pool: true, // Reuse connections
  maxConnections: 1, // Avoid rate limits
  rateLimit: 5, // Max 5 messages per second
  tls: {
    rejectUnauthorized: false, // Temporary bypass for certificate issue
  },
});

// Verify email transporter
transporter.verify(function (error, success) {
  if (error) {
    console.error('Email transporter error:', error);
  } else {
    console.log('Email transporter ready');
  }
});

// /api/submit
app.post('/api/submit', async (req, res) => {
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parsing error:', err);
      return res.status(500).json({ status: 'error', message: 'Form parsing failed' });
    }

    const name = Array.isArray(fields.name) ? fields.name[0] : fields.name || '';
    const email = Array.isArray(fields.email) ? fields.email[0] : fields.email || '';
    const company = Array.isArray(fields.company) ? fields.company[0] : fields.company || '';
    const phone = Array.isArray(fields.phone) ? fields.phone[0] : fields.phone || '';
    const message = Array.isArray(fields.message) ? fields.message[0] : fields.message || '';
    const recaptcha_response = Array.isArray(fields.recaptcha_response)
      ? fields.recaptcha_response[0]
      : fields.recaptcha_response || '';
    const agreement = Array.isArray(fields.agreement) ? fields.agreement[0] : fields.agreement || 'false';

    console.log('Form fields:', {
      name,
      email,
      company,
      phone,
      message,
      recaptcha_response: recaptcha_response ? recaptcha_response.substring(0, 10) + '...' : 'missing',
      agreement,
    });

    if (!name || !email || !company || !phone || !message || !recaptcha_response) {
      return res.status(400).json({ status: 'error', message: 'All fields are required' });
    }

    if (agreement !== 'true') {
      return res.status(400).json({ status: 'error', message: 'You must agree to the terms' });
    }

    try {
      const recaptchaResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        null,
        {
          params: {
            secret: process.env.RECAPTCHA_SECRET_KEY,
            response: recaptcha_response,
          },
          timeout: 5000,
        }
      );

      const { success, score, action, 'error-codes': errorCodes } = recaptchaResponse.data;
      console.log('reCAPTCHA v3 response:', { success, score, action, errorCodes });

      if (!success || score < 0.5 || action !== 'submit_form') {
        return res.status(400).json({
          status: 'error',
          message: `reCAPTCHA verification failed${score ? ` (score: ${score})` : ''}${
            action !== 'submit_form' ? ' (invalid action)' : ''
          }`,
          errors: errorCodes || ['Unknown error'],
        });
      }

      const connection = await pool.getConnection();
      try {
        const [result] = await connection.execute(
          'INSERT INTO submissions (name, email, company, phone, message, agreement, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [name, email, company, phone, message, agreement === 'true']
        );
        console.log('Submission saved:', { id: result.insertId });

        // Send thank you email
        const mailOptions = {
          from: `"Top Digital" <${config.email.user}>`,
          to: email,
          replyTo: config.email.user,
          subject: `Thank You, ${name}, for Reaching Out!`, // Personalized for inbox
          html: `
            <h2>Hello ${name},</h2>
            <p>Thank you for contacting Top Digital! We’ve received your submission and will respond within 24-48 hours.</p>
            <p><strong>Your Submission:</strong></p>
            <ul>
              <li><strong>Company:</strong> ${company}</li>
              <li><strong>Phone:</strong> ${phone}</li>
              <li><strong>Message:</strong> ${message}</li>
            </ul>
            <p>To ensure our emails reach your inbox, please add <a href="mailto:${config.email.user}">${config.email.user}</a> to your contacts.</p>
            <p>Have questions? Reply to this email!</p>
            <p>Best regards,<br>Top Digital Team</p>
            <hr>
            <p style="font-size: 12px; color: #777;">
              Top Digital | 123 Business Ave, Digital City<br>
              <a href="https://topdigital.netlify.app">Visit our website</a> | 
              <a href="mailto:support@topdigital.com">Contact Support</a><br>
              <a href="mailto:unsubscribe@${config.email.user}?subject=unsubscribe">Unsubscribe</a>
            </p>
          `,
          text: `
            Hello ${name},\n\n
            Thank you for contacting Top Digital! We’ve received your submission and will respond within 24-48 hours.\n\n
            Your Submission:\n
            - Company: ${company}\n
            - Phone: ${phone}\n
            - Message: ${message}\n\n
            To ensure our emails reach your inbox, please add ${config.email.user} to your contacts.\n\n
            Have questions? Reply to this email!\n\n
            Best regards,\n
            Top Digital Team\n\n
            ---
            Top Digital | 123 Business Ave, Digital City
            Visit: https://topdigital.netlify.app | Support: support@topdigital.com
            Unsubscribe: mailto:unsubscribe@${config.email.user}?subject=unsubscribe
          `,
          headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal',
            'List-Unsubscribe': `<mailto:unsubscribe@${config.email.user}?subject=unsubscribe>`,
            'Precedence': 'bulk',
          },
        };

        // Retry logic
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            await transporter.sendMail(mailOptions);
            console.log('Thank you email sent to:', email);
            break;
          } catch (emailError) {
            attempts++;
            console.error(`Email attempt ${attempts} failed:`, emailError);
            if (attempts === maxAttempts) {
              console.error('Max email attempts reached.');
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
          }
        }

        res.json({ status: 'success', message: 'Form submitted successfully' });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('reCAPTCHA, DB, or Email error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      res.status(400).json({
        status: 'error',
        message: `Operation failed: ${error.message}`,
      });
    }
  });
});

// /api/newsletter
app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ status: 'error', message: 'Invalid email address' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let [result] = await connection.execute(
      'INSERT INTO subscribers (email) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
      [email]
    );

    const subscriberId =
      result.insertId ||
      (await connection.execute('SELECT id FROM subscribers WHERE email = ?', [email]))[0][0].id;

    const [activeSub] = await connection.execute(
      'SELECT id FROM subscriptions WHERE subscriber_id = ? AND status = ?',
      [subscriberId, 'active']
    );

    if (activeSub.length > 0) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Email already subscribed' });
    }

    await connection.execute(
      'INSERT INTO subscriptions (subscriber_id, status) VALUES (?, ?)',
      [subscriberId, 'active']
    );

    await connection.commit();
    res.status(200).json({ status: 'success', message: 'Subscribed successfully' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ status: 'error', message: 'Email already subscribed' });
    }
    console.error('Database error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', message: 'An unexpected error occurred' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));