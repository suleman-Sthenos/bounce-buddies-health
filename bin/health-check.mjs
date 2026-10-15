// The live game's health check (his order, 15 October 2026: know when the game is not working before players complain).
// Runs every 3 hours on GitHub (.github/workflows/health.yml) and by hand: node bin/health-check.mjs
// Fails (exit 1, so GitHub emails the repo owner) if the game does not load and play in a real browser, the world board does not
// answer, the security headers or private paths are wrong, a page is missing, or players' games reported a problem in the
// last 3 hours. The game itself lives in a private repo; this public copy holds only the checks, so GitHub runs them free.
import { spawnSync } from 'node:child_process'; import path from 'node:path';
const SITE = 'https://bounce-buddies.vercel.app', here = path.dirname(new URL(import.meta.url).pathname), problems = [], fine = [];
const lc = spawnSync(process.execPath, [path.join(here, 'live-check.mjs'), SITE + '/'], { encoding: 'utf8', timeout: 240e3 });
for (const k of ['BOARD', 'GAME', 'HEADERS', 'PRIVATE']) {
  const line = (lc.stdout || '').split('\n').find(l => l.startsWith(k + ' ')) || `${k} gave no answer (${(lc.stderr || '').trim().split('\n').pop() || 'live check did not run'})`;
  (line.startsWith(k + ' ok') ? fine : problems).push(line);
}
for (const p of ['/privacy.html', '/support.html', '/og-image.png']) {
  const r = await fetch(SITE + p).catch(e => ({ status: 'error ' + e.message }));
  (r.status === 200 ? fine : problems).push(`${p} ${r.status}`);
}
const rep = await fetch(SITE + '/api/report').then(r => r.json()).catch(e => ({ error: e.message }));
if (rep.error || !Number.isInteger(rep.recentKinds)) problems.push('problem reports: no answer (' + (rep.error || JSON.stringify(rep)) + ')');
else (rep.recentKinds ? problems : fine).push(`problem reports: ${rep.recentKinds} problem(s) seen in players' games in the last 3 hours (${rep.kinds} today, ${rep.reports} reports)`);
for (const l of fine) console.log('ok   ' + l);
for (const l of problems) console.log('FAIL ' + l);
console.log(problems.length ? `RESULT: FAIL (${problems.length})` : 'RESULT: PASS'); process.exit(problems.length ? 1 : 0);
