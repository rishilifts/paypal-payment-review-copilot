const list = document.getElementById('list');
const baselineEl = document.getElementById('baseline');
const mockbar = document.getElementById('mockbar');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const humanize = s => String(s ?? '').replace(/typical_max_amount/g, 'typical order size').replace(/\b[A-Za-z]+_[A-Za-z_]+\b/g, m => m.replace(/_/g, ' '));

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

let CFG = null;
let payments = [];
const dismissed = new Set();
const tickState = {};

const CHECKLIST = [
  'Look at what was ordered',
  'Confirm the buyer details',
  'Open the payment in your PayPal account and check it is really there'
];

const stOf = p => {
  const r = p.review || {};
  const hasFlags = (r.flags || []).length > 0;
  return r.status && r.status !== 'needs_review' ? r.status : (hasFlags ? 'needs_review' : 'no_signals');
};

function whyText(p) {
  const c = (CFG && CFG.config) || {};
  const flags = (p.review && p.review.flags) || [];
  return flags.map(f => {
    if (f.signal === 'amount_above_typical_max' || f.signal === 'above your typical order size')
      return `It is over your ${c.typical_max_amount} ${c.currency || p.currency || ''} review setting.`;
    if (f.signal === 'outside_markets' || f.signal === 'outside listed markets')
      return 'The buyer is outside the markets in your review settings.';
    if (f.signal === 'missing_email' || f.signal === 'missing payer email')
      return 'This payment has no buyer email attached.';
    return humanize(f.why);
  }).join(' ');
}

function homeHtml() {
  if (!payments.length) return '<div class="empty">No payments yet. Connect a PayPal sandbox app to start reviewing.</div>';
  const parts = [];
  const quiet = [];
  for (const p of payments) {
    const st = stOf(p);
    const flagged = st === 'needs_review' || st === 'marked_for_review';
    if (flagged && !dismissed.has(p.id)) {
      parts.push(`
      <section class="hero" data-id="${esc(p.id)}">
        <div class="hero-label">${st === 'marked_for_review' ? 'Marked for a closer look' : 'New order'}</div>
        <div class="hero-amount">${esc(p.amount)} ${esc(p.currency)}</div>
        <div class="hero-buyer">${esc(p.payer_name || 'Buyer')} - ${fmtTime(p.created)}</div>
        <p class="hero-why">${esc(whyText(p))} Worth a quick look before you ship.</p>
        <div class="hero-actions">
          <a class="primary" href="#/check/${encodeURIComponent(p.id)}">Check this order</a>
          ${st === 'needs_review' ? '<button class="link" data-act="skip">Skip for now</button>' : ''}
        </div>
      </section>`);
    } else if (!flagged) {
      const note = st === 'cleared_by_seller' ? 'You checked this one' : 'No rule flags';
      quiet.push(`<div class="quiet" data-id="${esc(p.id)}"><span class="q-amount">${esc(p.amount)} ${esc(p.currency)}</span><span class="q-note">${note}</span></div>`);
    }
  }
  return parts.concat(quiet).join('');
}

function checkHtml(p) {
  const st = stOf(p);
  const ticks = tickState[p.id] || (tickState[p.id] = [false, false, false]);
  const r = p.review || {};
  const aiBtn = p.ai && !p.ai.ai_status
    ? `<button class="link small" data-act="ai">Show the saved AI note again - no new call</button>`
    : `<button class="link small" data-act="ai">Ask the AI helper for a second look - one call, then the answer is saved</button>`;
  const flags = (r.flags || []).map(f => `<div class="d-row"><b>Flag</b><span>${esc(humanize(f.signal))} - ${esc(humanize(f.why))}</span></div>`).join('');
  return `
  <section class="check" data-id="${esc(p.id)}">
    <a class="back" href="#">&larr; Back</a>
    <h1 class="check-title">Check this order</h1>
    <div class="check-amount">${esc(p.amount)} ${esc(p.currency)}</div>
    <div class="check-buyer">${esc(p.payer_name || 'Buyer')} - ${fmtTime(p.created)}</div>
    <p class="why-text">${esc(whyText(p))}</p>
    <div class="why-label">Before you ship, take a minute to:</div>
    <ul class="ticks">
      ${CHECKLIST.map((c, i) => `<li data-tick="${i}" class="${ticks[i] ? 'on' : ''}"><span class="circle"></span><span>${esc(c)}</span></li>`).join('')}
    </ul>
    <div class="check-actions">
      <button class="primarybtn" data-act="done" ${ticks.every(Boolean) ? '' : 'disabled'}>Everything checks out</button>
      ${st === 'marked_for_review' ? '' : '<button class="link" data-act="mark">Mark it for a closer look</button>'}
    </div>
    <div class="hint-done" data-hint ${ticks.every(Boolean) ? 'hidden' : ''}>Tick the three checks above to finish.</div>
    <details class="details">
      <summary>Details and AI helper</summary>
      <div class="d-body">
        <div class="d-row"><b>Buyer</b><span>${esc(p.payer_name || 'Buyer')} - ${esc(p.payer_email || 'no email')}</span></div>
        <div class="d-row"><b>Country</b><span>${esc(p.country || 'n/a')}</span></div>
        <div class="d-row"><b>PayPal status</b><span>${esc(p.status || '')}</span></div>
        <div class="d-row"><b>Time</b><span>${fmtTime(p.created)}</span></div>
        ${flags}
        ${r.summary ? `<div class="d-row"><b>Summary</b><span>${esc(humanize(r.summary))}</span></div>` : ''}
        <div class="d-row">${aiBtn}<div class="ainote" data-ainote></div></div>
      </div>
    </details>
  </section>`;
}

function route() {
  const m = location.hash.match(/^#\/check\/(.+)$/);
  document.body.classList.toggle('on-check', !!m);
  if (m) {
    const p = payments.find(x => x.id === decodeURIComponent(m[1]));
    if (p) {
      list.innerHTML = checkHtml(p);
      return;
    }
  }
  list.innerHTML = homeHtml();
}

async function load() {
  const [cfg, r] = await Promise.all([fetch('/api/config').then(x => x.json()), fetch('/api/payments').then(x => x.json())]);
  CFG = cfg;
  payments = r.payments;
  if (cfg.mode === 'mock' && cfg.paypal) {
    mockbar.textContent = 'Demo mode: PayPal sandbox test payments - no real money is involved.';
    mockbar.classList.remove('hidden');
  } else if (cfg.mode === 'mock') {
    mockbar.textContent = 'Local sample data - no PayPal account connected.';
    mockbar.classList.remove('hidden');
  } else mockbar.classList.add('hidden');
  const c = cfg.config || {};
  document.getElementById('f-markets').value = (c.markets || []).join(', ');
  document.getElementById('f-max').value = c.typical_max_amount ?? '';
  baselineEl.textContent = `Example settings: orders over ${c.typical_max_amount} ${c.currency || ''} get flagged`;
  route();
}

list.addEventListener('click', async e => {
  const tick = e.target.closest('li[data-tick]');
  if (tick) {
    const id = tick.closest('.check').dataset.id;
    const i = Number(tick.dataset.tick);
    const ticks = tickState[id] || (tickState[id] = [false, false, false]);
    ticks[i] = !ticks[i];
    tick.classList.toggle('on', ticks[i]);
    const done = tick.closest('.check').querySelector('button[data-act="done"]');
    const all = ticks.every(Boolean);
    if (done) done.disabled = !all;
    const hint = tick.closest('.check').querySelector('[data-hint]');
    if (hint) hint.hidden = all;
    return;
  }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const host = b.closest('[data-id]');
  const id = host && host.dataset.id;
  if (!id) return;
  if (b.dataset.act === 'skip') {
    dismissed.add(id);
    route();
    return;
  }
  b.disabled = true;
  if (b.dataset.act === 'ai') {
    const note = b.closest('.d-row').querySelector('[data-ainote]');
    note.textContent = 'Asking the AI helper (one call)...';
    const r = await fetch(`/api/review/${encodeURIComponent(id)}/rerun?ai=1`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    note.textContent = j.cached ? 'Saved AI note shown - no new call made.'
      : j.ok ? 'AI note ready and saved - asking again replays it without a new call.'
      : `AI note unavailable (${j.ai_status || j.error || 'error'}) - the flags above are unchanged.`;
    b.disabled = false;
    return;
  }
  if (b.dataset.act === 'done' || b.dataset.act === 'mark') {
    const ep = b.dataset.act === 'done' ? 'clear' : 'mark';
    await fetch(`/api/review/${encodeURIComponent(id)}/${ep}`, { method: 'POST' });
    location.hash = '';
  }
  await load();
});

document.getElementById('settingsform').addEventListener('submit', async e => {
  e.preventDefault();
  const markets = document.getElementById('f-markets').value.split(',').map(x => x.trim()).filter(Boolean);
  const typical_max_amount = parseFloat(document.getElementById('f-max').value);
  const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markets, typical_max_amount }) });
  const msg = document.getElementById('settingsmsg');
  if (r.ok) {
    const cfg = await fetch('/api/config').then(x => x.json());
    if (cfg.mode === 'mock') {
      msg.textContent = 'Saved. Re-checking payments...';
      const ps = await fetch('/api/payments').then(x => x.json());
      for (const p of ps.payments) await fetch(`/api/review/${encodeURIComponent(p.id)}/rerun`, { method: 'POST' });
      msg.textContent = 'Saved.';
      await load();
    } else {
      msg.textContent = 'Saved. New payments use these settings.';
      await load();
    }
  } else {
    msg.textContent = (await r.json()).error || 'Invalid settings';
  }
});

window.addEventListener('hashchange', route);
load();
setInterval(load, 5000);
