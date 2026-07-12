const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

const app = express();
app.use(cors());
app.use(express.json());
// Trust proxy so req.ip returns the buyer's IP, not the Railway
// load-balancer's IP. Required for correct client_ip_address in
// the Meta CAPI Purchase event fired from circle.ku-no.com webhook.
app.set('trust proxy', true);

// Serve static files from public/
app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));

// Checkout session creation
app.post('/api/checkout/create-session', async (req, res) => {
  try {
    const config = req.body.config || req.body;
    const priceId = config.priceId;
    const mode = config.mode || 'payment';
    const rawSuccessUrl = config.successUrl || 'https://ku-no.com/thankyou';
    const cancelUrl = config.cancelUrl || 'https://ku-no.com';

    // Append ?session_id={CHECKOUT_SESSION_ID} to the success URL so
    // the thankyou page can read the Stripe session id and fire the
    // browser Pixel Purchase with eventID = that id. Our server-side
    // CAPI (in the circle.ku-no.com webhook) uses the same value —
    // Meta dedupes → one Purchase counted instead of two.
    const successUrl = rawSuccessUrl.includes('session_id=')
      ? rawSuccessUrl
      : rawSuccessUrl + (rawSuccessUrl.includes('?') ? '&' : '?')
          + 'session_id={CHECKOUT_SESSION_ID}';

    // Meta CAPI enrichment stashed in metadata. The circle.ku-no.com
    // webhook reads these back and forwards to Meta so match quality
    // rises from Fair to Good/Great without collecting extra fields
    // on the leadpage.
    const metadata = {
      // Where the Purchase conceptually fires (matches where the
      // browser Pixel Purchase fires) — the thankyou page.
      event_source_url: 'https://ku-no.com/thankyou',
    };
    // Buyer network fingerprint — Meta uses this for match quality.
    // req.ip is trustworthy because we set 'trust proxy' above.
    if (req.ip) metadata.buyer_ip = req.ip;
    const ua = req.get('user-agent');
    if (ua) metadata.buyer_ua = ua.slice(0, 500);
    // Facebook click id: comes from ?fbclid= on the ad landing URL.
    // Formatted as `fb.1.<ms>.<fbclid>` per Meta spec. Client sends
    // the raw fbclid; we format here.
    if (config.fbclid) {
      metadata.fbc = 'fb.1.' + Date.now() + '.' + String(config.fbclid).slice(0, 500);
    }
    // Facebook browser id: the _fbp cookie value from the client.
    // Already in fb.1.<ms>.<n> format when written by fbq('init').
    if (config.fbp) metadata.fbp = String(config.fbp).slice(0, 500);
    // Google click id (existing behavior).
    if (config.gclid) metadata.gclid = config.gclid;

    const sessionParams = {
      mode: mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('STRIPE ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Return buyer identity for a completed Stripe session — used by the
// thankyou page to fire the browser Pixel Purchase with Advanced
// Matching (hashed email + name) so match quality bumps to Good/Great.
// Stripe session ids are long random strings (cs_live_...) so
// enumeration attacks aren't practical, but this endpoint intentionally
// returns ONLY email + name — no address, card, or amount data.
app.get('/api/checkout/session-details', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id || typeof id !== 'string' || !id.startsWith('cs_')) {
      return res.status(400).json({ error: 'Invalid session id' });
    }
    const session = await stripe.checkout.sessions.retrieve(id);
    const email = session.customer_email
      || (session.customer_details && session.customer_details.email)
      || null;
    const name = (session.customer_details && session.customer_details.name) || null;
    res.json({ email: email, name: name });
  } catch (err) {
    console.error('SESSION DETAILS ERROR:', err.message);
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
