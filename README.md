# Payment Review Copilot

An AI review copilot for PayPal sandbox payments. It watches incoming sandbox
payments, explains observable signals worth a seller's attention, and keeps a
human review queue. It never holds, blocks, approves or moves money - every
action is an internal flag for the seller's own review.

Built for the PayPal AI Hackathon ("Build What's Next with PayPal and AI").

## What it does

- Ingests PayPal **sandbox** payment events (Orders v2 + verified webhooks).
- An AI layer reads payment metadata and produces **explainable flags**:
  what the signal is, why it appears in the data, and a suggested manual check.
- A clean review queue (phone + desktop) where the seller marks items for
  review or clears flags. No automated money actions, no fraud-score claims.

## Stack

- Node.js (no framework) backend: JSON store, webhook intake, static UI.
- PayPal sandbox REST APIs (Orders v2, webhook signature verification).
- AI: Meta Model API (Llama) for the review notes; `AI_PROVIDER=mock` runs the
  full pipeline locally with no API calls.

## Run

```bash
# mock mode (no external calls)
AI_PROVIDER=mock node src/server.js    # http://localhost:8787

# against PayPal sandbox
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=... \
META_API_KEY=... AI_PROVIDER=meta node src/server.js
```

Dev intake for local testing: `POST /api/ingest` with a normalized payment JSON.

## Status

Work in progress. Sandbox wiring in progress; hosted demo link will be added.
