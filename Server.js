const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const cors = require('cors');
const formidable = require('formidable');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['http://localhost:5175'],
  methods: ['POST'],
  credentials: false,
}));
app.use(express.json());

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Successfully connected to MySQL database:', process.env.DB_NAME);
});

// Route to handle form submission
app.post('/api/submit', (req, res) => {
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Error parsing form:', err);
      return res.status(500).json({ status: 'error', message: 'Form parsing failed' });
    }

    // Log raw fields for debugging
    console.log('Raw fields:', fields);

    // Extract fields, handling arrays from formidable
    const name = Array.isArray(fields.name) ? fields.name[0] : fields.name || '';
    const email = Array.isArray(fields.email) ? fields.email[0] : fields.email || '';
    const company = Array.isArray(fields.company) ? fields.company[0] : fields.company || '';
    const phone = Array.isArray(fields.phone) ? fields.phone[0] : fields.phone || '';
    const message = Array.isArray(fields.message) ? fields.message[0] : fields.message || '';
    const recaptcha_response = Array.isArray(fields.recaptcha_response) ? fields.recaptcha_response[0] : fields.recaptcha_response || '';
    const agreement = Array.isArray(fields.agreement) ? fields.agreement[0] : fields.agreement || 'false';

    // Log extracted fields
    console.log('Extracted fields:', {
      name,
      email,
      company,
      phone,
      message,
      recaptcha_response: recaptcha_response.substring(0, 10) + '...',
      agreement,
    });

    // Validate required fields
    if (!name || !email || !company || !phone || !message || !recaptcha_response) {
      return res.status(400).json({ status: 'error', message: 'All fields are required' });
    }

    // Validate agreement
    if (agreement !== 'true') {
      return res.status(400).json({ status: 'error', message: 'You must agree to the terms' });
    }

    // Verify reCAPTCHA v2 Checkbox
    try {
      const recaptchaResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        null,
        {
          params: {
            secret: process.env.RECAPTCHA_SECRET_KEY,
            response: recaptcha_response,
          },
        }
      );

      console.log('reCAPTCHA response:', recaptchaResponse.data);

      if (!recaptchaResponse.data.success) {
        const errors = recaptchaResponse.data['error-codes'] || ['Unknown error'];
        console.log('reCAPTCHA verification failed:', errors);
        if (errors.includes('timeout-or-duplicate')) {
          return res.status(400).json({
            status: 'error',
            message: 'reCAPTCHA token has expired or was already used. Please try again.',
          });
        }
        return res.status(400).json({
          status: 'error',
          message: 'reCAPTCHA verification failed',
          errors,
        });
      }

      // Insert into MySQL
      const query =
        'INSERT INTO submissions (name, email, company, phone, message, agreement, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())';
      db.query(query, [name, email, company, phone, message, agreement === 'true'], (err, result) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ status: 'error', message: `Database error: ${err.message}` });
        }

        console.log('Form submission saved to database:', { id: result.insertId });
        res.json({ status: 'success', message: 'Form submitted successfully' });
      });
    } catch (error) {
      console.error('reCAPTCHA verification error:', error.response?.data || error.message);
      return res.status(500).json({ status: 'error', message: 'reCAPTCHA verification failed' });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', message: 'An unexpected error occurred' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});