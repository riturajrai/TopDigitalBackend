const express = require('express');
const mysql = require('mysql2/promise');
const formidable = require('formidable');
const axios = require('axios');
const cors = require('cors');
const nodemailer = require('nodemailer');
const config = require('./config');
require('dotenv').config();

const app = express();
// ✅ Define allowed frontend URLs
const allowedOrigins = [
  'http://localhost:5173',
  'https://topdigitalbackend.onrender.com',
  'https://rivetsking.com',
  'https://www.rivetsking.com',
  'https://intopdigital-adminpanel.netlify.app' // 👈 ADD THIS LINE
];

app.use(
  cors({
    origin: (origin, callback) => {
      console.log('Incoming origin:', origin); // Optional for debugging
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true, // set to true if you are using cookies or authentication
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
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
  debug: true,
  logger: true,
  pool: true,
  maxConnections: 1,
  rateLimit: 5,
  tls: {
    rejectUnauthorized: false,
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

    console.log('Form fields:', {
      name,
      email,
      company,
      phone,
      message,
      recaptcha_response: recaptcha_response ? recaptcha_response.substring(0, 10) + '...' : 'missing',
    });

    if (!name || !email || !company || !phone || !message || !recaptcha_response) {
      return res.status(400).json({ status: 'error', message: 'All fields are required' });
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
          'INSERT INTO submissions (name, email, company, phone, message, created_at, status) VALUES (?, ?, ?, ?, ?, NOW(), ?)',
          [name, email, company, phone, message, 'New']
        );
        console.log('Submission saved:', { id: result.insertId });

        // Send thank you email
        const mailOptions = {
          from: `"Top Digital" <${config.email.user}>`,
          to: email,
          replyTo: config.email.user,
          subject: `Hi ${name}, Thanks for Contacting Top Digital!`,
          html: `
            <h2>Hello ${name},</h2>
            <p>Thank you for reaching out to Top Digital! We’ve received your submission and will get back to you within 24 hours.</p>
            <p><strong>Your Details:</strong></p>
            <ul>
              <li><strong>Company:</strong> ${company}</li>
              <li><strong>Phone:</strong> ${phone}</li>
              <li><strong>Message:</strong> ${message}</li>
            </ul>
            <p>Please add <a href="mailto:${config.email.user}">${config.email.user}</a> to your contacts to receive our emails in your inbox.</p>
            <p>Questions? Just reply to this email!</p>
            <p>Best,<br>Top Digital Team</p>
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
            Thank you for reaching out to Top Digital! We’ve received your submission and will get back to you within 24 hours.\n\n
            Your Details:\n
            - Company: ${company}\n
            - Phone: ${phone}\n
            - Message: ${message}\n\n
            Please add ${config.email.user} to your contacts to receive our emails in your inbox.\n\n
            Questions? Just reply to this email!\n\n
            Best,\n
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
            'X-Entity-Ref-ID': `form-${result.insertId}`,
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
            console.error(`Form email attempt ${attempts} failed:`, emailError);
            if (attempts === maxAttempts) {
              console.error('Max form email attempts reached.');
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
      'INSERT INTO subscriptions (subscriber_id, status, created_at) VALUES (?, ?, NOW())',
      [subscriberId, 'active']
    );

    await connection.commit();

    // Send newsletter confirmation email
    const mailOptions = {
      from: `"Top Digital" <${config.email.user}>`,
      to: email,
      replyTo: config.email.user,
      subject: `Welcome to Top Digital’s Newsletter!`,
      html: `
        <h2>Welcome aboard!</h2>
        <p>Thank you for subscribing to Top Digital’s newsletter. You’ll receive the latest updates, tips, and offers straight to your inbox.</p>
        <p><strong>Your Email:</strong> ${email}</p>
        <p>To ensure our emails land in your primary inbox, please add <a href="mailto:${config.email.user}">${config.email.user}</a> to your contacts.</p>
        <p>Questions or feedback? Reply to this email!</p>
        <p>Best,<br>Top Digital Team</p>
        <hr>
        <p style="font-size: 12px; color: #777;">
          Top Digital | 123 Business Ave, Digital City<br>
          <a href="https://topdigital.netlify.app">Visit our website</a> | 
          <a href="mailto:support@topdigital.com">Contact Support</a><br>
          <a href="mailto:unsubscribe@${config.email.user}?subject=unsubscribe">Unsubscribe</a>
        </p>
      `,
      text: `
        Welcome aboard!\n\n
        Thank you for subscribing to Top Digital’s newsletter. You’ll receive the latest updates, tips, and offers straight to your inbox.\n\n
        Your Email: ${email}\n\n
        To ensure our emails land in your primary inbox, please add ${config.email.user} to your contacts.\n\n
        Questions or feedback? Reply to this email!\n\n
        Best,\n
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
        'X-Entity-Ref-ID': `newsletter-${subscriberId}`,
      },
    };

    // Retry logic for newsletter email
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        await transporter.sendMail(mailOptions);
        console.log('Newsletter confirmation sent to:', email);
        break;
      } catch (emailError) {
        attempts++;
        console.error(`Newsletter email attempt ${attempts} failed:`, emailError);
        if (attempts === maxAttempts) {
          console.error('Max newsletter email attempts reached.');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempts));
      }
    }

    res.status(200).json({ status: 'success', message: 'Subscribed successfully' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ status: 'error', message: 'Email already subscribed' });
    }
    console.error('Database or Email error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// GET endpoint to fetch all subscribers
app.get('/api/subscribers', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT s.id, s.email, sub.created_at, sub.status 
       FROM subscribers s 
       LEFT JOIN subscriptions sub ON s.id = sub.subscriber_id 
       ORDER BY COALESCE(sub.created_at, '2000-01-01') DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching subscribers:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch subscribers',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// GET endpoint to fetch all submissions
app.get('/api/submissions', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT id, name, email, company, phone, message, created_at, status FROM submissions ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching submissions:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch submissions',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// PUT endpoint to update submission status
app.put('/api/submissions/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['New', 'Contacted', 'Closed'].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid status value',
      });
    }

    connection = await pool.getConnection();
    const [result] = await connection.execute(
      'UPDATE submissions SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Submission not found',
      });
    }

    res.json({
      status: 'success',
      message: 'Status updated successfully',
    });
  } catch (error) {
    console.error('Error updating submission status:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      status: 'error',
      message: 'Failed to update status',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// DELETE endpoint to remove a submission
app.delete('/api/submissions/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await pool.getConnection();
    const [result] = await connection.execute(
      'DELETE FROM submissions WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Submission not found',
      });
    }

    res.json({
      status: 'success',
      message: 'Submission deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting submission:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete submission',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});



// DELETE endpoint to remove a subscriber
app.delete('/api/subscribers/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await pool.getConnection();
    const [result] = await connection.execute(
      'DELETE FROM subscribers WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Subscriber not found',
      });
    }

    res.json({
      status: 'success',
      message: 'Subscriber deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting subscriber:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete subscriber',
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', message: 'An unexpected error occurred' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
