# Bounce Buddies health check

Checks the live game at https://bounce-buddies.vercel.app every 3 hours: it loads and plays the game in Chrome, checks the
world board, the security headers, that private files are not served, the privacy and support pages, and whether players'
games reported a problem in the last 3 hours. A failed run emails the repo owner.

Run it by hand: `node bin/health-check.mjs` (needs Node 22 and Chrome; set `CHROME` to Chrome's path on Linux).

These are only the checks. The game itself lives in a private repo.
