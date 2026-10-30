const list = document.getElementById('list');
const status = document.getElementById('status');
const baselineEl = document.getElementById('baseline');
const mockbar = document.getElementById('mockbar');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateText = { needs_review: 'Needs review', marked_for_review: 'Marked for review', cleared_by_seller: 'Cleared', no_signals: 'No signals' };
const signalText = { amount_above_typical_max: 'Above your typical order size', outside_markets: 'Outside your listed markets', missing_email: 'Missing payer email' };
const signalLabel = s => signalText[s] || String(s || '').replace(/_/g, ' ');

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function row(p) {
  const r = p.review || {};
  const hasFlags = (r.flags || []).length > 0;
  const st = r.status && r.status !== 'needs_review' ? r.status : (hasFlags ? 'needs_review' : 'no_signals');
  const flags = (r.flags || []).map(f => `
    <div class="flag">
      <div class="signal">${esc(signalLabel(f.signal))}</div>${signalText[f.signal] ? `<div class="signalcode">${esc(f.signal)}</div>` : ''}
      <div class="why">${esc(f.why)}</div>
      ${f.suggested_check ? `<div class="check">Check: ${esc(f.suggested_check)}</div>` : ''}
    </div>`).join('');
  const aiBtn = p.ai && !p.ai.ai_status
    ? `<button class="airun" data-act="ai">AI review saved - replay (no new call)</button>`
    : `<button class="airun" data-act="ai">Run AI review - uses one Meta credit call</button>`;
  const actions = st === 'needs_review'
    ? `<div class="actions"><button class="mark" data-act="mark">Mark for review</button><button class="clear" data-act="clear">Clear flags</button></div>`
    : st === 'marked_for_review'
    ? `<div class="actions"><button class="clear" data-act="clear">Clear flags</button></div>`
    : '';
  return `
  <article class="row" data-id="${esc(p.id)}">
    <div class="top">
      <span class="amount">${esc(p.amount)} ${esc(p.currency)}</span>
      <span class="state ${esc(st)}">${stateText[st] || esc(st)}</span>
      ${r.provider === 'meta' ? `<span class="aitag">AI review - Meta ${esc(r.model || 'muse-spark')}</span>` : r.mocked ? '<span class="rulestag">rules-based</span>' : ''}
    </div>
    <div class="meta">${esc(p.payer_name || 'Buyer')} · ${esc(p.payer_email || 'no email')} · ${esc(p.country || 'n/a')} · ${fmtTime(p.created)} · ${esc(p.status || '')}</div>
    ${flags ? `<div class="flags">${flags}</div>` : (st === 'no_signals' ? '<div class="clean">Nothing here conflicts with your settings.</div>' : '')}
    ${r.summary && hasFlags ? `<div class="summary">${esc(r.summary)}</div>` : ''}
    ${actions}
    <div class="actions">${aiBtn}</div>
    <div class="ainote" data-ainote></div>
  </article>`;
}

async function load() {
  const [cfg, r] = await Promise.all([fetch('/api/config').then(x => x.json()), fetch('/api/payments').then(x => x.json())]);
  if (cfg.mode === 'mock' && cfg.paypal) {
    mockbar.textContent = 'SANDBOX MODE - real PayPal sandbox test payments, no real money. Reviews are rules-based by default; AI-assisted review (Meta Muse Spark) runs only on demand per payment.';
    mockbar.classList.remove('hidden');
  } else if (cfg.mode === 'mock') {
    mockbar.textContent = 'LOCAL MOCK SAMPLE - no PayPal account connected, AI not connected. Data below is placeholder.';
    mockbar.classList.remove('hidden');
  } else mockbar.classList.add('hidden');
  const c = cfg.config || {};
  const baseLabel = cfg.mode === 'mock' ? 'Demo baseline (mock settings)' : 'Your baseline';
  document.getElementById('f-markets').value = (c.markets || []).join(', ');
  document.getElementById('f-max').value = c.typical_max_amount ?? '';
  baselineEl.innerHTML = `${baseLabel} &nbsp;<b>markets ${esc((c.markets || []).join(' · ') || 'not set')}</b> &nbsp;·&nbsp; <b>typical order up to ${esc(c.typical_max_amount)} ${esc(c.currency || '')}</b>`;
  status.textContent = r.payments.length ? `${r.payments.length} payment(s) in queue` : '';
  list.innerHTML = r.payments.length
    ? r.payments.map(row).join('')
    : '<div class="empty">No payments yet. Connect a PayPal sandbox app to start reviewing.</div>';
}

list.addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.row').dataset.id;
  b.disabled = true;
  if (b.dataset.act === 'ai') {
    const note = b.closest('.row').querySelector('[data-ainote]');
    note.textContent = 'Running AI review (one Meta API call)...';
    const r = await fetch(`/api/review/${encodeURIComponent(id)}/rerun?ai=1`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    note.textContent = j.cached ? 'Saved AI review shown - no new API call made.'
      : j.ok ? 'AI review complete - result saved; repeats replay it without new calls.'
      : `AI review withheld (${j.ai_status || j.error || 'error'}) - rules review unchanged.`;
  } else {
    await fetch(`/api/review/${encodeURIComponent(id)}/${b.dataset.act}`, { method: 'POST' });
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
      msg.textContent = 'Saved. Re-checking queue...';
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

load();
setInterval(load, 5000);
