// Prints the SHA-1 of the live page as a real browser receives it, five times in a row (one per line).
// A plain curl can be answered by Vercel's bot "Security Checkpoint" page; a real headless browser is not.
// Then one line about the world board: 'BOARD ok <n> players' only if /api/board answers JSON with a players list;
// 'GAME ok' only if the game started with no security-policy violation; 'HEADERS ok' only if the page carries the security headers.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const URL_ = process.argv[2] || 'https://bounce-buddies.vercel.app/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', port = 9400 + Math.floor(Math.random() * 400); // CHROME: the health check on GitHub's Linux machines
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bblivecheck-'));
const ch = spawn(CHROME, ['--headless=new', '--use-mock-keychain', '--no-first-run', '--mute-audio', ...(process.env.CI ? ['--no-sandbox'] : []), `--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const pause = ms => new Promise(r => setTimeout(r, ms));
// never leave a browser behind: on a time-out or a kill signal, close it and its throwaway profile
const cleanup = () => { try { ch.kill('SIGKILL'); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
for (const sig of ['SIGALRM', 'SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); process.exit(1); });
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, e => { console.log('error: ' + (e && e.message)); cleanup(); process.exit(1); }); // e.g. Chrome never opened a page
setTimeout(() => { console.log('error: timed out'); cleanup(); process.exit(1); }, 80e3).unref();
let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.some(t => t.type === 'page')) break; } catch {} await pause(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), blocked = []; ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(m.params.entry.text)) blocked.push(m.params.entry.text.slice(0, 120));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  // headless Chrome names itself 'HeadlessChrome', which Vercel's bot protection challenges; present as the same Chrome without that word
  await send('Runtime.enable'); const ua = (await send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })).result.result.value;
  await send('Emulation.setUserAgentOverride', { userAgent: ua.replace('HeadlessChrome', 'Chrome') });
  await send('Log.enable'); await send('Page.enable'); await send('Page.navigate', { url: URL_ + '?mute=1' }); await pause(2500);
  await send('Runtime.evaluate', { awaitPromise: true, expression: `fetch(${JSON.stringify(URL_)} + '?warm=' + Date.now(), { cache: 'no-store' }).then(r => r.text())` }); await pause(1500); // the first answer can be the checkpoint handing over its pass
  for (let k = 0; k < 5; k++) {
    const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `fetch(${JSON.stringify(URL_)} + '?v=' + Date.now(), { cache: 'no-store' }).then(r => r.arrayBuffer()).then(b => crypto.subtle.digest('SHA-1', b)).then(d => [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''))` });
    console.log(r.result.result.value || 'error'); await pause(1500);
  }
  const b = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `fetch(new URL('/api/board', ${JSON.stringify(URL_)}), { cache: 'no-store' }).then(async r => { const j = await r.json().catch(() => null); return r.ok && j && Array.isArray(j.players) ? 'BOARD ok ' + j.players.length + ' players' : 'BOARD bad ' + r.status; }).catch(e => 'BOARD bad ' + e.message)` });
  console.log(b.result.result.value || 'BOARD bad no answer');
  const started = (await send('Runtime.evaluate', { returnByValue: true, expression: "typeof window.__bb === 'object' && window.__bb.G.t > 0" })).result.result.value;
  console.log(started && !blocked.length ? 'GAME ok' : 'GAME bad: ' + (started ? '' : 'not started; ') + blocked.slice(0, 2).join(' | '));
  const h = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `fetch(${JSON.stringify(URL_)} + '?hdr=' + Date.now(), { cache: 'no-store' }).then(r => ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cross-origin-opener-policy', 'permissions-policy', 'strict-transport-security'].map(k => r.headers.get(k) || ''))` });
  const [csp, nos, xfo, ref, coop, perm, hsts] = h.result.result.value || [];
  const miss = [[/script-src 'sha256-/.test(csp) && /frame-ancestors 'none'/.test(csp) && /default-src 'none'/.test(csp), 'policy'], [nos === 'nosniff', 'nosniff'], [xfo === 'DENY', 'frame'],
    [ref === 'no-referrer', 'referrer'], [coop === 'same-origin', 'opener'], [/camera=\(\)/.test(perm || '') && /microphone=\(\)/.test(perm || ''), 'permissions'], [/max-age=\d{7,}/.test(hsts || ''), 'https-only']].filter(x => !x[0]).map(x => x[1]);
  console.log(miss.length ? 'HEADERS bad: missing ' + miss.join(', ') : 'HEADERS ok');
  // private files must not be served (they live only on this Mac or in the deployment's build)
  const pv = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `Promise.all(['/.env', '/.env.local', '/.vercel/project.json', '/package.json', '/package-lock.json', '/vercel.json', '/.vercelignore', '/.git/config'].map(p => fetch(new URL(p, ${JSON.stringify(URL_)}), { method: 'HEAD', cache: 'no-store' }).then(r => [p, r.status])))` });
  const served = (pv.result.result.value || [['?', 0]]).filter(([p, st]) => st !== 404);
  console.log(served.length ? 'PRIVATE bad: ' + served.map(x => x.join(' ')).join(', ') : 'PRIVATE ok');
} finally { ws.close(); cleanup(); }
process.exit(0);
