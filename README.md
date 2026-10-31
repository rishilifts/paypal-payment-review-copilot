# Payment Review Copilot

A review queue for PayPal sellers. Sandbox payments come in, each one is checked against the seller's own review settings, and anything off-baseline is shown in plain language with the reason. A human always decides - the app never holds, blocks, approves, or moves money.

Built for the PayPal AI Hackathon.

## What a seller sees

- **Home:** any order that needs eyes appears first with the amount, the buyer, a plain reason ("It is over your 500 USD review setting") and one clear "Check this order" button. Everything else sits quietly below as "No rule flags".
- **Check page:** why you are seeing it, then a short checklist - look at what was ordered, confirm the buyer details, open the payment in your PayPal account and check it is really there. "Everything checks out" stays disabled until all three are ticked. "Mark it for a closer look" parks the order.
- Settings and the AI helper stay tucked away behind disclosures.

## What it does

- Ingests completed payments from a PayPal **sandbox** account (poller script) or a webhook intake endpoint.
- Rules review: each payment is checked against the configured review settings (typical order size, markets). Every flag names the exact setting the payment deviates from - nothing is flagged from country, name, or provider alone.
- On-demand AI review (Meta Muse Spark, `muse-spark-1.2` via `api.meta.ai`): explains a flagged payment in plain language. It runs only when explicitly asked, and the result (success or failure) is cached per payment + settings, so repeats never silently re-call the API.
- Internal-only review states: needs review, marked for review, cleared by the seller. These never touch the actual PayPal payment.

## What it never does

- No real payments. Sandbox test money only.
- No autonomous holds, approvals, refunds, or money movement. Humans decide; this advises.
- No fraud scores or predictions. A flag means "differs from your settings", not "is fraud".

## Stack

Node.js (no external dependencies), PayPal Orders API v2 (sandbox), Meta Muse Spark for the on-demand review, vanilla JS/CSS UI.

## Run it

```bash
git clone <repo>
cd paypal-payment-review-copilot
npm start          # serves on :8787, empty queue on first run, rules-only review
```

With real PayPal sandbox test payments:

```bash
export PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=...   # sandbox app credentials
npm start
node scripts/sandbox-flow.js create 25.00    # create a sandbox order (approve it as the sandbox buyer)
node scripts/sandbox-flow.js capture ORDER_ID
```

Optional: the AI helper needs `META_API_KEY` (see `.env.example`). Webhook intake: `node scripts/setup-webhook.js` (needs a public URL). Webhook signature verification is implemented and covered by unit tests with a mocked verifier; live end-to-end webhook delivery has not been verified.

## Tests

```bash
node test/run-tests.mjs   # 5 offline tests, zero network calls
```

## Demo video

`scripts/demo-shoot.mjs` records the real app walkthrough (intro card, queue, checklist, cached AI replay) used for the hackathon demo video.

## License

MIT
