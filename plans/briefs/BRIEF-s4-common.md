# BRIEF — S4 common contract (every `s4-*` lane reads this first) — 2026-11-08

**Programme:** seat-cast S4 rest. Plan of record: `plans/PLAN-sdk-creation-seams-2026-10-30.md` **§34** (lines ~1431 to end) — the design, the challenger's fixes and the owner's rulings of 2026-11-08 (the last three bullets of the file). Owner GO 2026-11-08: "Sounds good, go for it. Keep it easy, convenient and fun for modders to work on."

Supervisors: read `.claude/guides/multi-agent.md` first, then this file, then your lane brief, then §34 in full. You read down for your workers (NOMENCLATURE §1, §24, the group section for your area, §25 ledger; STYLE-GUIDE sections for any UI; `docs/<area>.md`; INTEGRATING steps for SDK work) and quote what they need into their briefs. At most **2 lane-workers** live.

## Owner rulings this programme rests on (quote them; never reinterpret)

- 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks. But [own books] can be surfaced and overlays can have their parent merged in place."
- 2026-11-08 ★B-5: the book is **fixed at start** — chosen at create; the edit form shows a read-only line (supersedes the 2026-10-21 "until play has written" lock in `sessions/bookLock.ts:2-4`).
- 2026-11-05: "Everything in session is cast → active card." Cards seed cast; cast reads its active linked card by default.
- 2026-11-05: "If a cast's feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."
- 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member keeps acting for that seat (`seated_by_user_id`).
- 2026-11-05: "Data wise, the session is a patron of the lorebook and branch, it doesn't own it."
- 2026-11-08 ★S4-1: provided books keep plugin-stamped cards **hidden** as the release carrier; every starter copy is card-less.
- 2026-11-08: all other §34.6 ★ as recommended (list in the plan's "Owner rulings on §34" bullet).
- Memory rule "There is ALWAYS a lorebook": never write copy or code paths that frame a session as having no lorebook; say own book / overlay.

## Modder rule (owner 2026-11-08) — every SDK-facing change

Plugins never parse ref strings (typed, host-filled fields and helpers do it); one JSDoc sentence per new field; INTEGRATING (`../serene-pub-sdk/INTEGRATING.md`) and the guide examples move in the same change; a refusal says what to do instead; every removed or renamed published name gets a migration note (old → new, one example). The SDK should feel like Drizzle: typed, one way.

## Hard rules (CLAUDE.md — each has cost data)

- Migrations are **generated** (`npm run db:generate`), never hand-written; the index must exceed the highest applied (today 0146). **Only one lane per wave may generate**; the lane brief says if yours does. Never seed a row at a fixed id. Never touch 0000–0093.
- 0.6 is in users' hands: any change to stored data ships with a forward migration or boot pass and a test that **a second boot changes nothing**.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- `socket.off(event)` always with the handler. `SvelteSet`/`SvelteMap`, never `$state(new Set())`.
- An event in `SCOPED_EVENTS` must carry its scope key in the payload.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views never call `toaster`/`notify` for socket results in new code.
- Toasts go through `notify` (`src/lib/client/utils/notify.ts`), never the raw toaster.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- It is a **session**, never a chat.
- Never `kill -9` a dev server. Never `git checkout`/`restore`/`stash` in either repo.
- A dev server is running on :5199 (another session). **No `sdk:build` while any serene-pub `vite dev` runs** — check `pgrep -af "vite dev"`; if one is up, report "blocked on your dev server" for that step and finish the rest.

## Decisions

Decide implementation inside your files and name each choice in the report. **Propose and wait (★, one recommendation + trade-off)** for anything a user sees that §34 doesn't already word, any new name/setting/event/table/migration not in §34, deleting data, or files outside your lane. New names: read NOMENCLATURE §1 and §24 first; mark 🚧 provisional; queue a §25 ledger row (the lane holding NOMENCLATURE writes it). Findings outside your scope go under **Noticed, not done** — never fixed in passing.

## Tests

- Only the targeted test files for what you touched, inside a capped scope, logged to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <lane>-tests.log 2>&1; echo test-exit=$? >> <lane>-tests.log'`
- `tsc` / `npm run check` under a 12G scope with `NODE_OPTIONS=--max-old-space-size=8192`, one after the other; baseline before you start, report before/after.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- Scratch files start with your lane id; put them in your session scratchpad, not the repo.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit (a whole-file `--write` re-sorts classes and reflows markup other work owns). If a file fails the check only on lines you didn't touch, leave it and say so.

## Report

`plans/REPORT-s4-<lane>-2026-11-08.md` (if the harness refuses, put the whole report in your final message; the lead saves it). Sections: changed files; tests run with results; tsc/check before/after; open ★; **Noticed, not done**; NOMENCLATURE rows queued (if you don't hold the file).
