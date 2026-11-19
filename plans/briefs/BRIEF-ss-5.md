# BRIEF — build lane `ss-5` — a locked setting is shown read-only with its cause; locks hold at run time (programme 2.4)

Repo `/home/jody/github/serene-pub` (app); SDK only if a derived form component in
`../serene-pub-sdk` draws the row (find out; never `git checkout / restore / stash` there). Supervisor: read
`.claude/guides/multi-agent.md`, then `plans/PLAN-session-settings-cleanup-2026-11-15.md` (S5, its "ASK FIRST"
note ~160–166, and "Ruled, 2026-11-15 (evening)" ~265–275), `plans/INVENTORY-session-settings-2026-11-15.md`
(locks), `plans/REPORT-ss-2a-2026-11-16.md` and `plans/REPORT-ss-2b-2026-11-16.md` (what changed in the same
files today), `docs/sessions.md` and `docs/pipelines.md` where they speak of locked settings, `STYLE-GUIDE.md`
(forms ~1205, disabled controls and their reasons, copy rules), `NOMENCLATURE.md` §1, §24 and the rows **lock**
/ **exposure** / **settings form**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write` (nor a scratch-copy
equivalent). Never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-<n>.log 2>&1"`,
one run at a time; wait for other lanes with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration expected. No full run, no
`npm run build`.

## Owner

- 2026-10-20 (A10 / R32): "a locked setting shows its value, read-only, to admins, and **nothing to the owner**."
- 2026-11-15: "we don't need to teleport or hide settings as much as possible"; then, to the lead's
  recommendation that a locked setting be shown read-only with its cause to the session's owner: "Yes, I agree
  with you." **The later words rule: R32 is reversed.**
- Standing: members never see or touch model plumbing (connections, models, sampling, loadouts): a locked
  setting of that kind stays hidden from a non-admin exactly as an unlocked one of that kind is; prompt choice
  is the session owner's. P1: every automatic thing shows its cause.

## Build

### A. Shown, read-only, with its cause

- In the derived session settings form (`server/sessions/settingsForm.ts` ~263–291 and ~644 decide today that
  the owner does not get a locked setting; the client draws what the server sends: find the components), a
  locked setting is **sent to and shown to the session's owner**: its current value, the control disabled, and
  one line of cause beside it. Cause wording by where the lock comes from (find every lock source in the code:
  preset, genre, pub-wide admin lock, a ruleset?): today admins see *Set by the session's preset.*; the owner
  sees the same sentence family (★ each sentence in the report: *Set by the session's preset.* / *Set by the
  genre.* / …). A disabled control's reason is tied with `aria-describedby` (STYLE-GUIDE).
- The same on every surface that offers that setting to the owner: the session's Settings tab, the start form
  (`StartSessionForm`), the Pipelines card in session mode (a locked step value shows read-only there; the
  ss-2a report's "cannot tell" item: does a locked prompt choice stay visible?). List the surfaces found.
- What a non-owner member sees does not change. What an admin sees does not change, except wording made
  consistent if the two differ for no reason (report).
- A locked setting the owner could never have seen unlocked (plumbing; an admin-only reach) stays unseen.
- The server still refuses a write to a locked setting, with a sentence that names the cause (find today's
  refusal; keep it or align it with the row's cause line: ★).

### B. Locks hold at run time

`pipelines/registrations/values.ts` (~128–134 before today's lanes; re-find it: lane ss-2a moved rules into
`readStoredValue` / `sessionLayerAt`) throws a lock away when resolving: a session-scope value stored before the
lock was set, or written by another path (the boot fold, the attic, an import), must **not** win over a locked
preset / genre value at run time, and the panel must show the same (one resolver: use the shared rule from
ss-2a-fix; no second copy). Inventory first: where a lock is stored, which layers it binds, what "the run-time
lock repair" in the plan refers to; then make run, panel and form agree. A stored session value under a lock is
kept (not deleted), so unlocking restores it; say so in the docs (★ if the code makes deleting the natural
choice: report before choosing).

### C. Docs and names

`docs/sessions.md` and `docs/pipelines.md`: lane `doc-1` changed them today to say the owner no longer sees a
locked setting (true then); change them to what is built. `NOMENCLATURE.md`: the **lock** row's charter (what a
lock owns: who sees what, that it holds at run time), R32's reversal with both dates in §25.

## Files owned

`server/sessions/settingsForm.ts` (the exposure decision and the refusal), `pipelines/registrations/values.ts`
and the resolver sites that must honour a lock (`config/world.ts`, `config/panel/read.ts`: only through the
shared rule), the client components that draw a setting row in the session settings form, the start form and
the Pipelines card (session mode), their tests, the docs, `NOMENCLATURE.md`. Lanes `kn-4a1` (lorebook knowledge
screens) and `kn-4b` (an SDK outlet; `host.ts`, `bindings.outlets.ts`) are running: not their files.

## Out of scope

Which settings are lockable or who may lock; new locks; the Line row; prompt rows on every section (2.2); turn
controls (2.3); any new setting.

## Stop and ask when

CLAUDE.md §Decisions applies; a locked setting's value itself would reveal plumbing to a non-admin; honouring a
lock at run time changes what an existing session's next reply reads in a way that is not "the lock now holds"
(report the case with counts from a scratch copy if needed; never open the owner's real data dir from a test);
a migration.

## Done means

Tests (capped): the owner receives a locked setting read-only with its cause (each lock source); cannot write
it (refusal); a member and an admin see what they saw; a plumbing setting stays hidden from the owner; DOM
tests for the row (disabled, cause, `aria-describedby`) on each surface; run time: a stale session value under
a lock does not win, run = panel = form, unlocking restores it; the two prompt-baseline tests and the parity
harness still green. `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-ss-5-<date>.md`): lock sources and where each is stored;
surfaces changed; every sentence (★); what run time does now vs before, with the cases; changed files; tests;
**Noticed, not done**. Under about 600 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **Read-only is words, never a disabled control** (STYLE-GUIDE 2166–2167: "the value's name plus [the reason]
   … never a disabled control"; :1593). `SessionSettingField.svelte` (9–11, 124–134) already draws that branch:
   reuse it. Give the cause line an id and tie it to the value with `aria-describedby`.
2. **Where things are** (`server/sessions/settingsForm.ts`): genre group: :264 decides "locked → nothing to the
   owner", :266 editable, 286–294 the read-only sentence; pipeline group: 630–632 visibility and editable
   (one test today: split "who sees the row" from "who may edit it"; plumbing and model-calling steps stay
   forced to `admin`, 625–626), 664–674 the sentence. The refusal (:1223) already prints
   `${label}: ${readOnlyReason} Nothing was saved.` and will name the cause once the row is sent.
   Lock sources: `session_presets.settings` (`exposure.ts` 111–128); the genre's defaults and pins (100–108);
   `{value, lock}` inside genre or preset registration values (`registrations/values.ts` 60–101). No
   `system_settings` lock; a stored ruleset lock has been ignored since 2026-11-05.
   Client: `SessionSettingField.svelte` draws the row; `SessionSettingsForm.svelte`, `SessionRoutineRow.svelte`,
   `SpeechSettingsBlock.svelte`, `TurnPicker.svelte` (174–182, the narrator cadence) use it: all are surfaces.
   Docs: `docs/sessions.md` 34, 417; `docs/pipelines.md` 19, 141.
3. **Part B, exactly.** Today, with a locked genre or preset value and a stored session value: the **run** lets
   the session value win (`values.ts` 141–149 `addressedValues` without `keepDecisions` strips `{value, lock}`;
   `config/world.ts` 997–1003 pushes the session layer first); the **panel** too (`panel/read.ts` 145–170); the
   form's **plain rows** show the locked value (`resolveExposure`, 641–642); the form's **prompt rows ignore the
   lock entirely** (716–783: `own ?? inherited`, `editable: true`); genre fields already hold at run time
   (`sessionGenres.ts` 508–554). Build **one exported rule in `values.ts`**: "this address is locked above, at
   layer X" (on `addressedValues(…, { keepDecisions: true })`; do **not** name it `lockedAbove`: `exposure.ts:206`
   uses that for genre fields), called by the run, the panel and the form's prompt branch (owned: add
   `settingsForm.ts` 716–783); plain rows keep `resolveExposure`. No second resolver.
   **Who can set such a lock:** core offers **Lock** only on genre settings (`session-presets/IdPage.svelte`
   ~1740; `panel/write.ts` never writes one; every shipped lock is a genre setting). So Part B changes a reply
   only where a genre declaration or hand-edited data stores `{value, lock}` in `registrations.values`: state
   that in the report with one count query over that column on a scratch database, and in the docs.
4. **Not built in this lane (★ in the report, DISCUSS-LATER D44):** a cause line on the Pipelines card (no lock
   can be set there today; the panel only resolves through the rule); locked settings shown on the **start
   form** (the ruling says "to the session's owner"; before a session exists a locked setting is "taken, never
   asked", `exposure.ts` 275–276).
5. **The ruling, quoted accurately for §25:** the rule is the layering proposal's A10 as rewritten, ruled by the
   owner as R32 on 2026-10-20 ("Exposure cascades (A10 as rewritten)"; the words "nothing to the owner" are the
   proposal's text) and tagged R1 in the code (`exposure.ts` 18–20, `settingsForm.ts` 22–30). Its reversal rests
   on the owner's 2026-11-15 evening reply "Yes, I agree with you." to the lead's "a locked setting is shown
   read-only with its cause to the session's owner. This reverses A10 / R32".
