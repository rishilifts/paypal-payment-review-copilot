// Payment Review Copilot - local dev server.
// Serves the review queue UI + JSON API + PayPal webhook intake.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './queue/store.js';
import { reviewPayment } from './ai/review.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, 'web', 'public');
const store = new Store(join(__dirname, '..', 'data', 'store.json'));
const PORT = process.env.PORT || 8787;

import crypto from 'node:crypto';
import fs from 'node:fs';
const baselineHash = c => crypto.createHash('sha256').update(JSON.stringify(c || {})).digest('hex').slice(0, 12);
const USAGE_FILE = new URL('../data/ai-usage.json', import.meta.url).pathname;
function recordUsage(u) {
  let d = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
  try { d = { ...d, ...JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) }; } catch {}
  d.calls += 1; d.prompt_tokens += u?.prompt_tokens || 0; d.completion_tokens += u?.completion_tokens || 0;
  fs.writeFileSync(USAGE_FILE, JSON.stringify(d, null, 2));
  return d;
}
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let b = '';
  for await (const c of req) b += c;
  try { return JSON.parse(b); } catch { return null; }
}

function withReviews(payments) {
  return payments.map(p => ({ ...p, raw: undefined, review: store.getReview(p.id) || null }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // --- API ---
    if (url.pathname === '/api/payments' && req.method === 'GET')
      return send(res, 200, { payments: withReviews(store.listPayments()) });

    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      // Dev intake: normalized payment JSON (from sandbox poller or webhook handler)
      const p = await readBody(req);
      if (!p || !p.id) return send(res, 400, { error: 'payment with id required' });
      store.upsertPayment(p);
      const review = await reviewPayment(store.getPayment(p.id), store.getConfig());
      store.setReview(p.id, { ...review, status: (review.flags || []).length ? 'needs_review' : 'no_signals' });
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/paypal/webhook' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body) return send(res, 400, { error: 'bad json' });
      const { verifyWebhook, getOrder, normalizePayment } = await import('./paypal/client.js');
      const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
      const ok = WEBHOOK_ID ? await verifyWebhook({ headers, body, webhookId: WEBHOOK_ID }) : false;
      if (!ok) return send(res, 401, { error: 'webhook not verified' });
      const orderId = body.resource?.supplementary_data?.related_ids?.order_id || body.resource?.id;
      if (orderId) {
        const order = await getOrder(orderId);
        const p = normalizePayment(order);
        store.upsertPayment(p);
        const review = await reviewPayment(p, store.getConfig());
        store.setReview(p.id, { ...review, status: (review.flags || []).length ? 'needs_review' : 'no_signals' });
      }
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/config' && req.method === 'GET')
      return send(res, 200, { config: store.getConfig(), mode: process.env.AI_PROVIDER || 'mock', paypal: !!(process.env.PAYPAL_CLIENT_ID) });

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: 'bad json' });
      const cfg = {};
      if (Array.isArray(b.markets)) cfg.markets = b.markets.map(x => String(x).trim().toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x));
      if (b.typical_max_amount !== undefined) {
        const n = parseFloat(b.typical_max_amount);
        if (!Number.isFinite(n) || n <= 0 || n > 1000000) return send(res, 400, { error: 'typical_max_amount must be a positive number' });
        cfg.typical_max_amount = n;
      }
      return send(res, 200, { config: store.setConfig(cfg) });
    }

    const rm = url.pathname.match(/^\/api\/review\/([^/]+)\/rerun$/);
    if (rm && req.method === 'POST') {
      const p = store.getPayment(rm[1]);
      if (!p) return send(res, 404, { error: 'unknown payment' });
      const cfg = store.getConfig();
      if (url.searchParams.get('ai') === '1') {
        // Explicit, cached real-AI review. Successes AND failures are cached per
        // (payment, baseline) so a reload or repeat click never silently re-calls
        // the API. A cached failure can only be bypassed with an explicit force=1.
        const bh = baselineHash(cfg);
        const cached = store.getAiReview(p.id);
        if (cached && cached.baseline_hash === bh && url.searchParams.get('force') !== '1')
          return send(res, 200, { ok: !cached.ai_status, ai: cached, cached: true });
        if (!process.env.META_API_KEY) return send(res, 400, { error: 'META_API_KEY not set' });
        const savedProvider = process.env.AI_PROVIDER;
        process.env.AI_PROVIDER = 'meta';
        let review;
        try { review = await reviewPayment(p, cfg); }
        catch (e) { return send(res, 502, { error: `AI review failed: ${e.message}` }); }
        finally { if (savedProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = savedProvider; }
        const usage = recordUsage(review.usage);
        const ai = { ...review, baseline_hash: bh, ran_at: new Date().toISOString() };
        // Persist every outcome, including failures, with usage recorded above -
        // but never overwrite a cached SUCCESS with a new failure.
        const prev = store.getAiReview(p.id);
        if (!(review.ai_status && prev && !prev.ai_status && prev.summary))
          store.setAiReview(p.id, ai);
        if (review.ai_status)
          return send(res, 200, { ok: false, ai_status: review.ai_status, ai, cached: false, usage, note: 'AI attempt failed validation or returned no usable content; rules review unchanged. Failure is cached; retry needs an explicit force=1.' });
        // Validated AI review replaces the visible review.
        store.setReview(p.id, { ...review, status: (review.flags || []).length ? 'needs_review' : 'no_signals' });
        return send(res, 200, { ok: true, ai, cached: false, usage });
      }
      const review = await reviewPayment(p, cfg);
      store.setReview(p.id, { ...review, status: (review.flags || []).length ? 'needs_review' : 'no_signals' });
      return send(res, 200, { ok: true });
    }

    // Internal review actions ONLY - these never touch the actual PayPal payment.
    const m = url.pathname.match(/^\/api\/review\/([^/]+)\/(mark|clear)$/);
    if (m && req.method === 'POST') {
      const [, id, action] = m;
      if (!store.getPayment(id)) return send(res, 404, { error: 'unknown payment' });
      const cur = store.getReview(id) || {};
      store.setReview(id, { ...cur, status: action === 'mark' ? 'marked_for_review' : 'cleared_by_seller' });
      return send(res, 200, { ok: true, status: store.getReview(id).status });
    }

    // --- static ---
    let fp = join(PUB, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fp.startsWith(PUB) || !existsSync(fp)) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, readFileSync(fp), MIME[extname(fp)] || 'application/octet-stream');
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`copilot dev server on http://localhost:${PORT} (AI_PROVIDER=${process.env.AI_PROVIDER || 'mock'})`));
