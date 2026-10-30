// Register a webhook on the sandbox app so payment events reach the hosted copilot.
// Usage: PAYPAL_CLIENT_ID=.. PAYPAL_CLIENT_SECRET=.. COPILOT_WEBHOOK_URL=https://<host>/api/paypal/webhook node scripts/setup-webhook.js
const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
async function token() {
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64'),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  return (await r.json()).access_token;
}
const t = await token();
const r = await fetch(`${BASE}/v1/notifications/webhooks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: process.env.COPILOT_WEBHOOK_URL,
    event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }, { name: 'PAYMENT.CAPTURE.DENIED' }, { name: 'CHECKOUT.ORDER.APPROVED' }]
  })
});
const j = await r.json();
console.log(r.status, JSON.stringify(j, null, 2));
console.log('Set PAYPAL_WEBHOOK_ID=' + (j.id || '<from above>'));
