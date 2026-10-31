// Records the real app with CDP screencast while driving a timed shot plan.
// Usage: node scripts/demo-shoot.mjs <orderId|-> <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [orderId, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn('node', ['src/server.js'], {
  env: { ...process.env, AI_PROVIDER: 'meta', PORT: '8787' }, stdio: 'ignore'
});
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=9223', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
process.on('exit', cleanup);

async function waitApi(n) {
  for (let i = 0; i < 60; i++) {
    try { const j = await fetch('http://localhost:8787/api/payments').then(r => r.json());
      if (j.payments.length >= n) return j.payments.length; } catch {}
    await sleep(500);
  }
  throw new Error('server not ready');
}
await waitApi(2);
for (let i = 0; i < 40; i++) {
  try { await fetch('http://localhost:9223/json/version'); break; } catch { await sleep(400); }
}

const list = await fetch('http://localhost:9223/json/list').then(r => r.json());
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let mid = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const frames = []; let loaded = false;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
  else if (m.method === 'Page.screencastFrame') {
    frames.push({ ts: Date.now(), data: m.params.data });
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  } else if (m.method === 'Page.loadEventFired') loaded = true;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:8787' });
for (let i = 0; i < 40 && !loaded; i++) await sleep(250);
await sleep(2500); // app fetches + renders
let shooting = true;
  const shooter = (async () => {
    while (shooting) {
      const t = Date.now();
      try { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
        frames.push({ ts: t, data: r.data }); } catch {}
      await sleep(140);
    }
  })();
const t0 = Date.now();
const at = async (ms, fn) => { const w = t0 + ms - Date.now(); if (w > 0) await sleep(w); return fn(); };
const evalJs = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true });
const clickInRow = (amount, sel) => evalJs(`
  (() => { const row = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('${amount}'));
    const b = row && row.querySelector('${sel}'); if (b) { b.scrollIntoView({block:'center'}); b.click(); return b.textContent; } return 'not found'; })()`
).then(r => console.log('click', sel, '->', JSON.stringify(r.result?.value)));

await at(5000, () => console.log('dwell done'));
if (orderId && orderId !== '-') {
  await at(5000, () => {
    console.log('capturing order', orderId);
    const c = spawn('node', ['scripts/sandbox-flow.js', 'capture', orderId], { env: process.env });
    c.stdout.on('data', d => console.log('capture:', String(d).trim()));
    c.stderr.on('data', d => console.log('capture-err:', String(d).trim()));
  });
  await waitApi(3); console.log('third payment in queue at', Date.now() - t0, 'ms');
  await sleep(3500);
}
await at(14000, () => clickInRow('742.50', 'button.airun'));
await sleep(4500);
await at(21000, () => clickInRow('742.50', 'button.mark'));
await sleep(4500);
shooting = false; await shooter;
console.log('frames:', frames.length, 'duration ms:', Date.now() - t0);
frames.forEach((f, i) => fs.writeFileSync(path.join(outDir, `f-${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')));
fs.writeFileSync(path.join(outDir, 'timestamps.json'), JSON.stringify(frames.map(f => f.ts)));
cleanup(); process.exit(0);
