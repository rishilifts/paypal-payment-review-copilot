// PayPal sandbox client (Orders v2 + webhook verification).
// REAL sandbox only - env-configured. No live/real-money endpoints exist here.
const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

async function token() {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID/SECRET not set');
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) throw new Error(`paypal token ${r.status}`);
  return (await r.json()).access_token;
}

export async function getOrder(orderId) {
  const t = await token();
  const r = await fetch(`${BASE}/v2/checkout/orders/${orderId}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`paypal getOrder ${r.status}`);
  return r.json();
}

// Verify a webhook signature with PayPal (required before trusting events).
export async function verifyWebhook({ headers, body, webhookId }) {
  const t = await token();
  const r = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: body
    })
  });
  if (!r.ok) throw new Error(`paypal verify ${r.status}`);
  const j = await r.json();
  return j.verification_status === 'SUCCESS';
}

// Normalize a payment event/order into the shape the copilot reviews.
export function normalizePayment(src) {
  const c = src.purchase_units?.[0]?.payments?.captures?.[0];
  const p = src.payer || {};
  return {
    id: c?.id || src.id,
    order_id: src.id,
    status: c?.status || src.status,
    amount: c?.amount?.value || src.purchase_units?.[0]?.amount?.value,
    currency: c?.amount?.currency_code || src.purchase_units?.[0]?.amount?.currency_code,
    payer_email: p.email_address,
    payer_name: [p.name?.given_name, p.name?.surname].filter(Boolean).join(' '),
    payer_id: p.payer_id,
    country: p.address?.country_code,
    created: c?.create_time || src.create_time,
    raw: src
  };
}
