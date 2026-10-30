// AI review layer. Produces EXPLAINABLE flags for a human reviewer.
// It never approves, holds, declines or moves money - output is advisory text
// for the seller's own review queue. No fraud-accuracy claims are made.
//
// META_API_KEY is read from env at call time. Until credit use is confirmed,
// run with AI_PROVIDER=mock to exercise the pipeline without API calls.
//
// Hosted route (verified 30 Oct against Meta Model API docs + live responses):
//   POST https://api.meta.ai/v1/chat/completions, model muse-spark-1.2,
//   reasoning_effort "minimal" (docs: shortest reasoning pass; "none" is
//   rejected HTTP 400 on Muse Spark), max_completion_tokens bounds output
//   spend, response_format json_schema forces parseable output.
// Prompt design follows the validated TraceMint pattern: small prompt,
// ONLY-these-facts instruction, then offline validation of every figure
// and identifier in the model's output before it is shown.

const SYSTEM = `You are a payment review assistant for a small online seller. Given one payment's metadata and the seller's own review settings, list observable signals worth a human's attention.
Rules:
- Use ONLY the facts in the input JSON. Never invent IDs, amounts, or settings.
- Never claim a payment IS fraudulent. Never give a numeric probability.
- payer_email and payer_name here are KNOWN SANDBOX TEST FIXTURES, not real buyers: never mention them as signals. Test data is not evidence of fraud.
- A mismatch with the seller's own settings (markets list, typical order limit) is a valid signal. Never call any country, name, or email provider suspicious by itself.
- At most 3 flags. Every flag MUST have a concrete why (the observed fact) and suggested_check (a manual action). Each string 20-140 characters. summary under 30 words.
Return JSON matching the required schema.`;

const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'payment_review',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        flags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              signal: { type: 'string', minLength: 4 },
              why: { type: 'string', minLength: 20 },
              suggested_check: { type: 'string', minLength: 20 },
            },
            required: ['signal', 'why', 'suggested_check'],
            additionalProperties: false,
          },
        },
        summary: { type: 'string' },
      },
      required: ['flags', 'summary'],
      additionalProperties: false,
    },
  },
};

// Known sandbox fixture markers. A model observation about these is test-data
// detection, never a seller risk signal - strip it before display.
const FIXTURE_RE = /example\.com|\bsb-|john doe|sandbox|fixture|test account|test data/i;

// Offline grounding check, same idea as TraceMint's validateDigest: every
// number and ID-like token in the output must exist in the input facts.
export function validateAiReview(out, facts) {
  const known = new Set();
  const add = (v) => { if (v !== undefined && v !== null) known.add(String(v)); };
  add(facts.amount); add(parseFloat(facts.amount || '0').toFixed(2));
  add(facts.currency); add(facts.order_id); add(facts.id); add(facts.country); add(facts.status);
  const b = facts.seller_baseline || {};
  add(b.typical_max_amount); add(Number(b.typical_max_amount).toFixed(2)); add(b.currency);
  for (const m of b.markets || []) add(m);

  const errors = [];
  let text = [out.summary || '', ...(out.flags || []).flatMap(f => [f.signal, f.why, f.suggested_check])].join(' ');
  // every ID-like token (13+ alnum) must be a known ID; then strip known IDs
  // so their digits are not misread as figures below
  for (const m of text.match(/\b[A-Z0-9]{13,}\b/g) || []) {
    if (!known.has(m)) errors.push(`ungrounded id: ${m}`);
  }
  for (const k of known) if (k.length >= 13) text = text.split(k).join(' ');
  // every figure quoted must be a known fact (tiny enumerations like "3 flags" exempt)
  for (const m of text.match(/(?<![A-Z0-9.])\d+(?:\.\d{1,2})?(?!\d)/g) || []) {
    if (!known.has(m) && !known.has(parseFloat(m).toFixed(2)) && parseFloat(m) > 2)
      errors.push(`ungrounded figure: ${m}`);
  }
  // Semantic grounding: a flag is only kept if it re-expresses a rule finding
  // that is actually TRUE for this payment under the seller's own settings.
  // Token-level checks above catch invented figures; this catches invented
  // MEANING (a risk claim no configured rule or observed field supports).
  const amt = parseFloat(facts.amount || '0');
  const truths = {
    above_max: Number.isFinite(b.typical_max_amount) && amt > b.typical_max_amount,
    outside_markets: !!(facts.country && b.markets?.length && !b.markets.includes(facts.country)),
    missing_email: !facts.payer_email,
  };
  const thin = (out.flags || []).some(f => (f.why || '').trim().length < 20 || (f.suggested_check || '').trim().length < 20);
  if (thin && (out.flags || []).length) errors.push('flag missing concrete why/suggested_check');
  const flags = (out.flags || []).filter(f => {
    if ((f.why || '').trim().length < 20 || (f.suggested_check || '').trim().length < 20) return false;
    const s = `${f.signal} ${f.why}`;
    if (FIXTURE_RE.test(s)) return false; // test-data observation, not a seller signal
    if (/above|exceed|over|larger|typical|limit|maximum|max order|order size/i.test(s)) return truths.above_max;
    if (/market|country|region|geograph/i.test(s)) return truths.outside_markets;
    if (/missing|absent|no payer|without.*email/i.test(s)) return truths.missing_email;
    return false; // claim category we cannot verify from configured rules/observed data
  });
  return { ok: errors.length === 0, errors, flags, summary: (out.summary || '').trim() };
}

function compactFacts(payment, baseline) {
  return {
    id: payment.id, order_id: payment.order_id, status: payment.status,
    amount: payment.amount, currency: payment.currency, country: payment.country,
    payer_email: payment.payer_email, payer_name: payment.payer_name,
    created: payment.created,
    seller_baseline: baseline || null,
  };
}

// Provider is an EXPLICIT per-call option - the global env is never mutated
// per request, so concurrent rules/AI reviews cannot leak into each other.
export async function reviewPayment(payment, baseline, opts = {}) {
  const provider = opts.provider || process.env.AI_PROVIDER || 'mock';
  if (provider === 'mock') return mockReview(payment, baseline);
  const key = process.env.META_API_KEY;
  if (!key) throw new Error('META_API_KEY not set');
  const fetchImpl = opts.fetchImpl || fetch;
  const facts = compactFacts(payment, baseline);
  const r = await fetchImpl(`${process.env.META_BASE_URL || 'https://api.meta.ai'}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.META_MODEL || 'muse-spark-1.2',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(facts) }
      ],
      max_completion_tokens: parseInt(process.env.META_MAX_TOKENS || '1024', 10),
      reasoning_effort: 'minimal',
      response_format: SCHEMA,
    })
  });
  if (!r.ok) throw new Error(`meta api ${r.status}`);
  const j = await r.json();
  const meta = { provider: 'meta', model: j.model || (process.env.META_MODEL || 'muse-spark-1.2'), usage: j.usage || null };
  // Structured outputs constrain shape, not length: a capped response can still
  // truncate, so finish_reason is checked before anything is trusted.
  const finish = j.choices?.[0]?.finish_reason;
  if (finish === 'length') return { ai_status: 'truncated', flags: [], summary: '', ...meta };
  const text = j.choices?.[0]?.message?.content;
  if (!text) return { ai_status: 'no_content', flags: [], summary: '', ...meta };
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return { ai_status: 'unparseable', flags: [], summary: '', ...meta }; }
  const v = validateAiReview(parsed, facts);
  if (!v.ok) return { ai_status: 'invalid', validation_errors: v.errors, flags: [], summary: '', ...meta };
  return { flags: v.flags, summary: v.summary, ...meta };
}

function mockReview(payment, baseline) {
  const b = baseline || { markets: [], typical_max_amount: Infinity };
  const flags = [];
  if (!payment.payer_email) flags.push({ signal: 'missing payer email', why: 'No payer email is present in this payment\'s metadata.', suggested_check: 'Open the order in the PayPal dashboard and confirm the buyer contact.' });
  if (payment.country && b.markets?.length && !b.markets.includes(payment.country))
    flags.push({ signal: 'outside listed markets', why: `Buyer country ${payment.country} is not in the markets you listed (${b.markets.join(', ')}). This is a mismatch against your own settings, not a fraud verdict.`, suggested_check: 'Confirm the shipping address matches the order details before fulfilling.' });
  const amt = parseFloat(payment.amount || '0');
  if (Number.isFinite(b.typical_max_amount) && amt > b.typical_max_amount)
    flags.push({ signal: 'above your typical order size', why: `${payment.amount} ${payment.currency} is above the typical order limit in your review settings (${b.typical_max_amount} ${b.currency || ''}).`, suggested_check: 'Message the buyer to confirm the order before shipping.' });
  return { flags, summary: flags.length ? `${flags.length} signal(s) vs your settings.` : 'No mismatches against your settings.', mocked: true };
}
