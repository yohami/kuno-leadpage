require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public/
app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));

// Checkout session creation
app.post('/api/checkout/create-session', async (req, res) => {
  try {
    const config = req.body.config || req.body;
    const priceId = config.priceId;
    const mode = config.mode || 'payment';
    const successUrl = config.successUrl || 'https://ku-no.com/thankyou';
    const cancelUrl = config.cancelUrl || 'https://ku-no.com';

    const sessionParams = {
      mode: mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    };
    if (config.gclid) sessionParams.metadata = { gclid: config.gclid };

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('STRIPE ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Subscribe
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const response = await fetch('https://api.resend.com/audiences/' + RESEND_AUDIENCE_ID + '/contacts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, unsubscribed: false })
    });
    const data = await response.json();
    if (!response.ok) return res.status(400).json({ error: data.message || 'Failed to subscribe' });
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));