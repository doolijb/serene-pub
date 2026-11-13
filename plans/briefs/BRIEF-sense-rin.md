# BRIEF — lane `sense-rin` (wave 3) — "Read in?" names the real reason

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first, then what this lane triggers (named
below). Plan: `plans/PLAN-sensible-engine-2026-11-11.md` (Part 5 is what the owner's go covers). Evidence for each
item: `plans/REVIEW-sensibility-2026-11-11.md`, by row id.

Read down: `docs/lorebooks.md` (the entry editor's **Read in?** tab; "Let other entries pull this one in"),
STYLE-GUIDE (copy rules and the section for the lorebook editor), NOMENCLATURE §1, §24 and the lorebook sections,
`src/lib/server/pipelines/ranking/eligibility.ts` (its header lists the gates) and `ranking/select.ts`.

## Goal — review row A14

The ranker records why each candidate was let in or left out (`ranking_decisions.reason`, `why`), but an entry
that never became a candidate gets a catch-all: `src/lib/client/lorebooks/editor/readIn.ts` (about 118–127) falls
back to "nothing reported on it", and `editor/signals.ts` (about 99–108) to similar words.

1. For an entry in a book a session is reading, the tab states **the first gate that stopped it** last turn, in
   one plain sentence: switched off or archived; off for a while; not on this session's line or dated after its
   clock; another speaker's character lore or a secret the speaker may not see; no keyword, name or meaning match
   (with the closest score and the threshold when the ranker has them); shown elsewhere; left out for budget.
   Use what is already stored (`rankings`, `ranking_decisions`, `ranking_subject_stats`, the entry's own fields
   and the session's reading). If the server must hand the client a fact it does not hand today, extend the
   existing read's payload; do not add an event. Where a gate cannot be told from stored facts, keep an honest
   catch-all and say which gates those are in your report.
2. **Let other entries pull this one in** has no effect while the pipeline's chain depth is 0, its default
   (`docs/lorebooks.md` about 78). Where the tab or the editor shows that switch for a session whose chain depth
   is 0, say so beside it in one line. Do not hide the switch and do not change the default.

## Files owned

- `src/lib/client/lorebooks/editor/readIn.ts`, `editor/signals.ts`, the Read in? tab's component, their tests.
- The server read that feeds the tab (find it from the client call; it is in the lorebook or pipelines sockets) —
  **only** the handler for that read and its payload type. If that handler lives in `sockets/pipelines.ts`, edit
  that one handler and nothing else in the file.
- `docs/lorebooks.md`: the Read in? paragraphs.

## Out of scope

The ranker, its scores, thresholds and gates; chain depth's default; per-character recall counts and anything about
who knows what (deferred by the owner); `runtime/host.ts`, `sockets/sessions.ts`; migrations; the SDK repo.

## Stop and ask when

A new stored fact, table or event would be needed; a file outside **Files owned**. Every new sentence is
provisional 🚧 copy: list them all, each with the gate it names.

## Done means

Tests that fail before and pass after: one per gate you can tell, asserting the sentence; the catch-all only where
no gate can be told.

## Report

`plans/REPORT-sense-rin-2026-11-11.md`.

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it at the path above).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
