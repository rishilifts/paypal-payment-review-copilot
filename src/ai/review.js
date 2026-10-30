// AI review layer. Produces EXPLAINABLE flags for a human reviewer.
// It never approves, holds, declines or moves money - output is advisory text
// for the seller's own review queue. No fraud-accuracy claims are made.
//
// META_API_KEY is read from env at call time. Until credit use is confirmed,
// run with AI_PROVIDER=mock to exercise the pipeline without API calls.

const SYSTEM = `You are a payment review assistant for a small online seller.
Given one PayPal sandbox payment's metadata, list observable signals worth a
human's attention. Rules:
- Describe only what the data shows (mismatches, missing fields, unusual patterns).
- Never claim a payment IS fraudulent. Never give a numeric probability.
- Suggest concrete manual checks the seller can do.
Return strict JSON: {"flags":[{"signal":string,"why":string,"suggested_check":string}],"summary":string}`;

export async function reviewPayment(payment, baseline) {
  if ((process.env.AI_PROVIDER || 'mock') === 'mock') return mockReview(payment, baseline);
  const key = process.env.META_API_KEY;
  if (!key) throw new Error('META_API_KEY not set');
  const r = await fetch('https://api.llama.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.META_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(payment, null, 2) }
      ],
      temperature: 0.2
    })
  });
  if (!r.ok) throw new Error(`meta api ${r.status}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(text); }
  catch { return { flags: [], summary: text.slice(0, 500), parse_fallback: true }; }
}

function mockReview(payment, baseline) {
  const b = baseline || { markets: [], typical_max_amount: Infinity };
  const flags = [];
  if (!payment.payer_email) flags.push({ signal: 'missing payer email', why: 'No payer email is present in this payment\'s metadata.', suggested_check: 'Open the order in the PayPal dashboard and confirm the buyer contact.' });
  if (payment.country && b.markets?.length && !b.markets.includes(payment.country))
    flags.push({ signal: 'outside listed markets', why: `Buyer country ${payment.country} is not in the markets you listed (${b.markets.join(', ')}). This is a mismatch against your own settings, not a fraud verdict.`, suggested_check: 'Confirm the shipping address matches the order details before fulfilling.' });
  const amt = parseFloat(payment.amount || '0');
  if (Number.isFinite(b.typical_max_amount) && amt > b.typical_max_amount)
    flags.push({ signal: 'above your typical order size', why: `${payment.amount} ${payment.currency} is above the typical order limit you set (${b.typical_max_amount} ${b.currency || ''}).`, suggested_check: 'Message the buyer to confirm the order before shipping.' });
  return { flags, summary: flags.length ? `${flags.length} signal(s) vs your settings.` : 'No mismatches against your settings.', mocked: true };
}
