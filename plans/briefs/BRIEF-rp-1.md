# BRIEF — worker task `rp-1` — small repairs that need no decision (programme 2.9)

Repo `/home/jody/github/serene-pub`. SDK not touched. Read first:
`plans/INVENTORY-memory-distances-repairs-2026-11-17.md` part 3 (2.9: **re-verify every file:line**),
`plans/PLAN-session-settings-cleanup-2026-11-15.md` (the sections on How strict and On revision: quote the
owner's words in your report), `plans/REPORT-ss-2b-2026-11-16.md` and `-ss-5-` (`writeRigour`,
`settingLocksOf`: how How strict is written and locked today), `docs/sessions.md` (How strict; On revision).

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. Lane `perf-3` is editing `pipelines/runtime/host.ts` (one case),
`sessions/sessionSpeech.ts`, `sessions/rewind.ts`, `sessions/turnYield.ts`, `sessions/actionsPush.ts`: do not
touch those. An isolated instance of the app may be running for a UI walk: it does not edit code; do not stop
it. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/rp-1-<n>.log 2>&1"`
(always at least one path), after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` and `npm run check`.

## Repairs

1. **How strict is narrowed on the server mid-session, as it is at creation.** Creation, the preset switch and
   the forms narrow How strict by the session's ruleset; `sessions:update` and `sessions:updateSetting` check
   genre options only, so a session whose ruleset does not allow a value accepts it through the socket (the
   inventory's example: a Lair session on Freeform accepts *Rules*). Both doors apply the **same narrowing
   function** creation uses (find it; do not write a second rule), refuse in the existing sentence for an
   option the session does not offer, and change nothing. Tests: each door, a value the ruleset does not
   allow (refused, nothing written), one it allows (written), a locked setting (still refused as a lock).
2. **`sessionType` cannot be set through `sessions:update`.** The inventory found any owner can send it; it is
   a create-time fact (session type is the create spec). Find what the door does with it today; make it
   ignored-or-refused in the manner that door treats other create-only fields (say which), with a test that a
   session's type does not change.
3. **On revision's description on screen** (`src/lib/client/components/sessionForms/EditSessionForm.svelte`
   ~3095–3097) still carries the old sentence; the docs were corrected by an earlier lane (find the corrected
   sentence in `docs/sessions.md`: lane `time-t10`): the on-screen description says the same thing in one
   sentence (reuse the docs' wording, trimmed to the form's one-sentence help: ★ in your report). DOM test if
   one pins the old text (old → new).
4. **Stale comments:** "needs a story clock" survives in two comments (find them): state today's rule or
   delete.
5. **Report, do not change** (each needs the owner): the truly dead `world_attributes` /
   `session_attribute_picks` (writes refused since 2026-10-23; read only by the branch copy): say exactly what
   still reads them and what removing them would take (a migration: not here); `on_revision_default` (read,
   no writer); save-at-once (On revision, scene settings and the player label still wait for Save).

Missing tests the inventory names: add one for `onRevisionDefaultFor` (what it returns per genre / preset
today: pin it).

## Report (under 300 words)

Per repair: what changed (file:line), the owner's words that cover it, tests and counts with log names; the
on-screen sentence (★); item 5's facts; `tsc` / `npm run check`; anything not done.
