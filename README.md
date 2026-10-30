# Payment Review Copilot

A payment review workspace for PayPal sellers. It ingests sandbox payments, flags the ones that deviate from **your own configured baseline**, explains each flag in plain language, and leaves every decision to a human. It never holds, approves, or moves money.

Built for the PayPal AI Hackathon.

## What it does

- Pulls completed payments from a PayPal **sandbox** account (or receives them via webhook).
- An AI reviewer compares each payment against the baseline **you** set in Settings: max ticket, expected ticket range, active hours, expected countries/currencies, new-buyer threshold.
- Every flag is explainable: it names the rule in your baseline that the payment deviates from. Nothing is flagged from country, name, or provider alone.
- Human-only actions: mark for review, clear flags, re-run the reviewer. Reviewed items clear automatically when you widen your baseline to cover them.
- AI-powered payment descriptions in plain English (mock provider by default so it runs with no keys).

## What it never does

- No real payments. Sandbox only.
- No autonomous holds, approvals, refunds, or money movement. Humans decide; this advises.
- No fraud scores or predictions. Flags mean "differs from your settings", not "is fraud".

## Stack

Node.js (no external deps), PayPal Orders API v2 (sandbox), provider-agnostic AI review module (mock provider ships in the box; Meta Llama 3.3 70B endpoint supported via env config).

## Run it

```bash
git clone <repo>
cd paypal-payment-review-copilot
npm start          # serves on :3000, mock AI, demo seed data
```

Sandbox mode with real PayPal test payments:

```bash
export PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=...
export PAYPAL_ENV=sandbox
node scripts/sandbox-flow.js   # creates + captures a sandbox order, feeds it to the queue
npm start
```

Optional webhook intake: `node scripts/setup-webhook.js` (needs a public URL, e.g. tunnel).

## Config

All env vars optional; see `.env.example`. The review baseline lives in Settings in the UI (stored in `data/config.json`).

## License

MIT
