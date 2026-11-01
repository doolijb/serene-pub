# Common rules — audio.cpp managed build (every lane reads this first)

Plan: `plans/PLAN-audiocpp-managed-2026-10-28.md` (read whole; it is short). Seam map of the
KoboldCPP managed stack: `plans/briefs/ACPP-SEAM-MAP.md`. Hardware companion (NOT this build,
but do not block it): `plans/PLAN-local-hardware-2026-10-28.md` §4–§5.

Repo: /home/jody/github/serene-pub (app) · ../serene-pub-sdk (SDK, file:-linked; this build should
need NO SDK change — if you think it does, stop and route it to the lead).

Rules (each has cost hours or data):
- Read only the files your brief lists plus what they import; read line ranges, never whole large files.
- Own only your paths (§4 of the plan + your brief). Another agent ("Mundi") edits SDK + core concurrently: additive edits only, re-read a shared file right before editing it, never revert a hunk you did not write. Shared files: `services/register.ts`, `adapters/registry.ts`, `shared/sockets/{types,interest}.ts`, `client/sockets/typedSocket.ts`, `db/schema.ts`, `db/defaults.ts`, admin `IdPage.svelte`, docs.
- Never `git commit/checkout/restore/stash` anywhere; never `npm run sdk:build` (not needed); never `kill -9` a dev server; never edit server files while a dev instance is booting.
- Migrations are GENERATED (`npm run db:generate -- --name <snake>`); the new index must exceed the highest applied (0131 today — check `drizzle/meta/_journal.json` first, Mundi may add one). Never seed a row at a hardcoded id.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- `$state(new Set/Map)` is not reactive → `SvelteSet/SvelteMap`. `socket.off(event)` without handler removes every listener — always pass the handler.
- Socket families: gated events go in `GATED_EVENTS` (sorted), admin-only prefixes in `RESTRICTED_INTEREST_PREFIXES`; a scoped event's payload must carry its scope key.
- Quote heredocs (`<<'EOF'`). Isolated dev instance only (own port + scratch data dir; see memory recipe in `plans/briefs/LANE-V-verify.md` if needed); private headless Chromium only — never the shared Playwright MCP page.
- Tests: write them, run ONLY the files you touched; no full suites (lane V does one grouped run). Int tests that open a DB inside `it` need an explicit 60 s timeout. Cap vitest scope (`/tmp` PGlite leak).
- Vocabulary: before naming anything new read NOMENCLATURE §1, §24 and the §10 Speech table; never a §23 retired word; it is a **session**, never a chat; "**run by Serene Pub**" is the managed phrasing (never "managed by"). Record new terms in §25 in the same change.
- Hand-back: you cannot write `plans/REPORT-*` files (harness refuses) — put the full report in your final message: what was built (paths), decisions taken, tests written + their results, routed items for other lanes (★ for the owner), and anything unverified. The lead saves it.
