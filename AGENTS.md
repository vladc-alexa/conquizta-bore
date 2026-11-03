<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# conquizta-bore / ST0NE QUIZ

Next.js 16 + Prisma + Postgres trivia-brawl game (ro/cârciumă theme). Deployed on Coolify (app 14,
`cqt-bore-test-2026` webhook). Depth lives in the `conquizta-bore-dev` skill — load it before a big task;
this file is the always-on summary.

## Non-negotiables
- **Ship straight to `main`.** No feature branches, no PRs. Commit, `git push origin main`, Coolify builds main.
- **The local `DATABASE_URL` in a long-lived shell is PRODUCTION.** Never run migrations by accident; export
  nothing globally, pass `DATABASE_URL=...` per command.
- **Order: migrate live DB → then ship.** `npx prisma migrate deploy` → `npx prisma generate` (mandatory) → deploy.
  A Coolify deploy does NOT run migrations.
- `npm run build` runs BARE (never through a pipe — exit code would be the pipe's). `npm run lint` is broken
  repo-wide on Next 16; don't chase it.

## Commands
```
npm run build                                   # must be green before anything ships
DATABASE_URL="postgresql://postgres:...@127.0.0.1:55433/mahalador" npx prisma migrate deploy
npx prisma generate
DATABASE_URL="...55433..." npx next start -p 3214      # throwaway DB + local server for E2E harnesses
COOLIFY_WEBHOOK_SECRET=cqt-bore-test-2026 ~/.hermes/scripts/coolify-deploy.sh vladc-alexa/conquizta-bore refs/heads/main
```
E2E harnesses: `scripts/*-e2e.mjs` (carciuma, admin-review, admin-counts, bot-fill). Run against the
throwaway DB on port 55433, never prod. "Pushed AND deployed?" needs both: `git log -1 --format=%h main`
matches origin, and the new build answers a marker only the new code serves.

## Map
- `app/` — routes: `carciuma` (main game), `duel`, `tower`, `train`, `leaderboard`, `login`, `register`, `admin`, `api/`
- `components/` — React UI; `lib/` — game logic/helpers; `prisma/schema.prisma` — data model
- `scripts/` — E2E harnesses + seeds; `bot/` — chat bots; `tools/` — maintenance utilities
- `proxy.ts`, `zero.html` — edge/proxy + standalone page

## Pitfalls seen in practice
- `@@unique([gameId, toId, status])` on a state machine breaks on the second terminal row.
- Text over animated art needs an explicit `z`; `pointer-events-none` defeats hit-testing.
- A `useEffect` timer keyed on a poll-rebuilt array never re-fires (array identity changes).
- Multi-line `git commit -m "…"` gets cut by the harness — use short subjects.
- Check phone width at 390 px for every UI change; `browser_exec` sessions share one browser profile.

## Cost hygiene
New session per task (a long session resends its whole transcript every call — that is the token bill).
Grep and `head` instead of reading whole files or full build logs; don't reload pruned skills mid-session.
