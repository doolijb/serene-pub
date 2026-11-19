# BRIEF — worker task `fnd-5` — the three new failures of full run 14

Repo `/home/jody/github/serene-pub`. Full run 14: `plans/lead-full14.log` / `plans/lead-full14.json`
(27,224 passed, 7 failed in 6 files; SDK suite 4,830 / 4,835 with the four known; `npm run check` 0 errors;
`npm run build` succeeded). Four of the seven are left failing on purpose and are **not yours**:
`pipelines/boot/paramsSlotWiring.test.ts` (2, D19), `pipelines/config/panel/groups.int.test.ts` (1, D20),
`pipelines/runtime/guideGrounding.int.test.ts` (1, D22).

Rules: never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`; never commit; no
migration; no SDK edit. Inside `db.transaction` only `tx`. Comments state the rule, not the story. No other
lane is editing. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-5-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## The three (read each assertion message in the JSON before opening code)

1. `src/lib/server/sockets/lorebookState.int.test.ts` — "deleting the book … takes the book's stats with it —
   its places', its world's and its cast's — on every line". Likely cause: lane `lb-1` (2026-11-16: deleting a
   lorebook a session plays on is refused, `sessions/bookLock.ts` `bookDeleteRefusal`; and `lb-1-fix`: a
   session's own notes answer "Lorebook not found." to the lorebook delete). Reports:
   `plans/REPORT-lb-1-2026-11-16.md`.
2. `src/lib/server/state/clockMoves.int.test.ts` — "a story with no clock yet › a session with no shared
   lorebook keeps its clock in its own book: unset, a move is refused; set, it moves from there". Likely cause:
   lane `tl-4` (a new session's own notes keep no timeline unless the genre requires one or the preset says so;
   `plans/REPORT-tl-4-2026-11-16.md` item 1: fixtures that make notes this way and need a timeline now state
   it) or `tl-2d-fix`.
3. `src/lib/shared/conformance/commentHistory.test.ts` — "no file's phrase-hit count exceeds its recorded
   ratchet": a comment written by one of today's lanes uses a history phrase ("no longer", "used to", "now …",
   a lane tag…). The assertion names the file(s) and counts.

## Method (per test)

Decide and say which: **(a)** the test pins behaviour a lane changed on purpose under an owner ruling → make
the test state what it needs (e.g. a fixture stating its timeline; deleting a lorebook no session plays on) or
re-pin, old → new, never weakening an assertion; **(b)** a real defect → fix the code if the fix is small,
with the test unchanged, else stop on it and report; **(c)** for the comment ratchet: reword the comment(s) to
state the rule (never raise the ratchet).

## Report (under 250 words)

Per test: cause (lane, file:line), kind, what changed; the rerun of the three files green (log name); `tsc` 0;
anything you stopped on.
