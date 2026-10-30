// End-to-end SANDBOX payment flow for the copilot demo.
// Creates a sandbox order, prints the buyer approval link, captures after
// approval, then posts the normalized payment to the local copilot intake.
// Test money only - this never touches live PayPal.
//
// Usage:
//   PAYPAL_CLIENT_ID=.. PAYPAL_CLIENT_SECRET=.. node scripts/sandbox-flow.js create 10.00
//   (buyer approves at the printed link with a SANDBOX buyer login)
//   PAYPAL_CLIENT_ID=.. PAYPAL_CLIENT_SECRET=.. node scripts/sandbox-flow.js capture ORDER_ID

const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
const INTAKE = process.env.COPILOT_INTAKE || 'http://localhost:8787/api/ingest';

async function token() {
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64'),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function create(amount) {
  const t = await token();
  const r = await fetch(`${BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: String(amount) } }]
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`create ${r.status}: ${JSON.stringify(j)}`);
  const approve = j.links?.find(l => l.rel === 'approve')?.href;
  console.log(`ORDER_ID=${j.id}`);
  console.log(`BUYER_APPROVAL_LINK=${approve}`);
  console.log('Approve with a sandbox BUYER account, then run: capture ' + j.id);
}

async function capture(orderId) {
  const t = await token();
  const r = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`capture ${r.status}: ${JSON.stringify(j)}`);
  const { normalizePayment } = await import('../src/paypal/client.js');
  const p = normalizePayment(j);
  const ir = await fetch(INTAKE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  console.log(`captured ${p.id} -> intake ${ir.status}`);
}

const [, , cmd, arg] = process.argv;
if (cmd === 'create') await create(arg || '10.00');
else if (cmd === 'capture') await capture(arg);
else console.log('usage: sandbox-flow.js create <amount> | capture <orderId>');
