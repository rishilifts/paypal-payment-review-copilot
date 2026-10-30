const list = document.getElementById('list');
const status = document.getElementById('status');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badgeText = { needs_review: 'Needs review', marked_for_review: 'Marked for review', cleared_by_seller: 'Cleared' };

function card(p) {
  const r = p.review || {};
  const st = r.status || 'needs_review';
  const flags = (r.flags || []).map(f => `
    <div class="flag">
      <div class="signal">${esc(f.signal)}</div>
      <div class="why">${esc(f.why)}</div>
      ${f.suggested_check ? `<div class="check">Suggested check: ${esc(f.suggested_check)}</div>` : ''}
    </div>`).join('');
  return `
  <article class="card" data-id="${esc(p.id)}">
    <div class="top">
      <span class="amount">${esc(p.amount)} ${esc(p.currency)}</span>
      <span class="badge ${esc(st)}">${badgeText[st] || esc(st)}</span>
    </div>
    <div class="meta">
      ${esc(p.payer_name || 'Buyer')} · ${esc(p.payer_email || 'no email')} · ${esc(p.country || 'country n/a')}<br>
      ${esc(p.created || '')} · ${esc(p.status || '')} · id ${esc(p.id)}
    </div>
    ${(flags || r.summary) ? `<div class="flags">${flags}${!flags && r.summary ? `<div class="summary">${esc(r.summary)}</div>` : ''}</div>` : ''}
    ${flags && r.summary ? `<div class="summary">${esc(r.summary)}</div>` : ''}
    <div class="actions">
      <button class="mark" data-act="mark">Mark for review</button>
      <button class="clear" data-act="clear">Clear flag</button>
    </div>
  </article>`;
}

async function load() {
  const r = await fetch('/api/payments');
  const j = await r.json();
  status.textContent = j.payments.length
    ? `${j.payments.length} sandbox payment(s) · AI notes are advisory only`
    : '';
  list.innerHTML = j.payments.length
    ? j.payments.map(card).join('')
    : '<div class="empty">No sandbox payments yet.<br>Connect a PayPal sandbox app to start reviewing.</div>';
}

list.addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.card').dataset.id;
  b.disabled = true;
  await fetch(`/api/review/${encodeURIComponent(id)}/${b.dataset.act}`, { method: 'POST' });
  await load();
});

load();
setInterval(load, 5000);
