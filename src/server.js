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
      store.setReview(p.id, { ...review, status: 'needs_review' });
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
        store.setReview(p.id, { ...review, status: 'needs_review' });
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
      const review = await reviewPayment(p, store.getConfig());
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
