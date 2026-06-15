# KU/NO Site

## Structure
- `public/` — static files (HTML, CSS, JS, assets)
- `server/index.js` — Express server (API + static serving)

## Environment Variables (set in Railway)
- `STRIPE_WEBHOOK_SECRET` — from Stripe Dashboard → Webhooks

## Deploy
1. Push to GitHub
2. Connect repo in Railway
3. Set environment variables
4. Point ku-no.com DNS to Railway
