// Offline unit tests - NO real network calls anywhere. All fetches are fakes.
import assert from 'node:assert/strict';
import { reviewPayment, validateAiReview } from '../src/ai/review.js';
import { verifyWebhook } from '../src/paypal/client.js';

let passed = 0;
const ok = (name) => { passed++; console.log('PASS', name); };

const payment = { id: '40F60803AJ4959130', order_id: '8M5445749A7911412', status: 'COMPLETED', amount: '742.50', currency: 'USD', country: 'US', payer_email: 'sb-x@personal.example.com', payer_name: 'John Doe' };
const baseline = { markets: ['US', 'IN'], typical_max_amount: 500, currency: 'USD' };

// 1. Rules (mock) review never touches the network, even run concurrently with AI.
{
  let fetches = 0;
  const countingFetch = async () => { fetches++; throw new Error('must not be called by rules'); };
  const results = await Promise.all(Array.from({ length: 10 }, () => reviewPayment(payment, baseline, { provider: 'mock', fetchImpl: countingFetch })));
  assert.equal(fetches, 0, 'rules review made a network call');
  assert.ok(results.every(r => r.mocked), 'rules review missing mocked label');
  ok('concurrent rules reviews: zero network calls');
}

// 2. Concurrent rules + AI: only the AI call hits the (fake) network; rules unaffected.
{
  let aiCalls = 0;
  const fakeMeta = async (url) => {
    aiCalls++;
    return { ok: true, json: async () => ({ model: 'muse-spark-1.2', usage: { prompt_tokens: 1, completion_tokens: 1 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ flags: [{ signal: 'amount_above_typical_max', why: 'Observed amount 742.50 USD exceeds seller baseline typical_max_amount of 500 USD.', suggested_check: 'Manually verify order details before processing fulfillment.' }], summary: 'Amount exceeds typical limit.' }) } }] }) };
  };
  process.env.META_API_KEY = 'test-key';
  const [rules, ai] = await Promise.all([
    reviewPayment(payment, baseline, { provider: 'mock', fetchImpl: fakeMeta }),
    reviewPayment(payment, baseline, { provider: 'meta', fetchImpl: fakeMeta }),
  ]);
  assert.equal(aiCalls, 1, 'expected exactly one AI fetch');
  assert.ok(rules.mocked && !rules.provider, 'rules result polluted by AI path');
  assert.equal(ai.provider, 'meta');
  assert.equal(ai.flags.length, 1);
  delete process.env.META_API_KEY;
  ok('concurrent rules + AI: isolated providers, one AI call');
}

// 3. AI failure modes withhold, never throw fake content.
{
  const mk = (payload, finish = 'stop') => async () => ({ ok: true, json: async () => ({ usage: {}, choices: [{ finish_reason: finish, message: { content: payload } }] }) });
  process.env.META_API_KEY = 'k';
  assert.equal((await reviewPayment(payment, baseline, { provider: 'meta', fetchImpl: mk(null) })).ai_status, 'no_content');
  assert.equal((await reviewPayment(payment, baseline, { provider: 'meta', fetchImpl: mk('{"flags":[]', 'length') })).ai_status, 'truncated');
  assert.equal((await reviewPayment(payment, baseline, { provider: 'meta', fetchImpl: mk('not json') })).ai_status, 'unparseable');
  const hallu = JSON.stringify({ flags: [{ signal: 'Velocity spike xxxxxxxx', why: '17 payments totaling 9999.00 USD seen recently.', suggested_check: 'Check account FAKEID123456789 immediately.' }], summary: 'x' });
  assert.equal((await reviewPayment(payment, baseline, { provider: 'meta', fetchImpl: mk(hallu) })).ai_status, 'invalid');
  delete process.env.META_API_KEY;
  ok('no_content / truncated / unparseable / hallucinated all withheld');
}

// 4. Semantic grounding: false rule findings dropped even with grounded tokens.
{
  const facts = { ...payment, seller_baseline: baseline };
  const falseFinding = { flags: [{ signal: 'Amount above limit', why: '19.99 USD exceeds the 500 USD typical order limit.', suggested_check: 'Confirm the order total with the buyer.' }], summary: 'Amount above limit.' };
  const v = validateAiReview(falseFinding, { ...facts, amount: '19.99' });
  assert.equal(v.flags.length, 0, 'false amount finding kept');
  ok('semantic grounding drops untrue rule findings');
}

// 5. Webhook verifier: SUCCESS true, FAILURE false, HTTP error throws (mocked PayPal).
{
  process.env.PAYPAL_CLIENT_ID = 'id'; process.env.PAYPAL_CLIENT_SECRET = 'secret';
  const mkVerify = (status, httpOk = true) => async (url) => ({
    ok: true,
    json: async () => url.includes('oauth2') ? { access_token: 't' } : { verification_status: status },
  });
  const headers = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://example.com/cert', 'paypal-transmission-id': 't1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': 'now' };
  assert.equal(await verifyWebhook({ headers, body: { id: 'evt1' }, webhookId: 'wh1' }, mkVerify('SUCCESS')), true);
  assert.equal(await verifyWebhook({ headers, body: { id: 'evt1' }, webhookId: 'wh1' }, mkVerify('FAILURE')), false);
  const errFetch = async (url) => url.includes('oauth2') ? { ok: true, json: async () => ({ access_token: 't' }) } : { ok: false, status: 500 };
  await assert.rejects(() => verifyWebhook({ headers, body: {}, webhookId: 'wh1' }, errFetch), /paypal verify 500/);
  ok('webhook verifier: valid accepted, invalid rejected, API error throws');
}

console.log(`\n${passed} tests passed - zero real network calls`);
