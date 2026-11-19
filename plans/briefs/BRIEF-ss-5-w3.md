# BRIEF — worker `ss-5-w3` — the session's owner gets a locked setting read-only, with its cause

Repo `/home/jody/github/serene-pub`. Supervisor: lane `ss-5`. Paths under `src/lib/server/` unless absolute.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent); never open the
owner's real data directory. No SDK change, no migration, no client file.

## Background

Owner ruling 2026-11-15 (reverses R32 of 2026-10-20, "a locked setting shows its value, read-only, to admins,
and nothing to the owner"): **a locked setting is shown read-only with its cause to the session's owner.**
Standing: members never see or touch model plumbing (connections, models, sampling, loadouts, prompts' wording):
a locked setting of that kind stays hidden from a non-admin exactly as an unlocked one is. A worker already made
the client draw read-only rows with their reason; another made the run and the panel honour a lock through one
rule: `pipelines/registrations/values.ts` `settingLocksOf(layers, decls): Map<addressKey, { layer: "genre" |
"preset"; value }>` (read it). This worker changes only the settings form.

## Build — `sessions/settingsForm.ts`

1. **Genre group** (~263–266): an owner sees a field whose `reach` is `owner` whether or not a layer locked it
   (drop `&& !s.lockedAt` from the visibility test). Who may edit is unchanged (`editable` stays as is: an owner
   edits only when `s.ownerSees`, which is false when locked). The read-only sentence (~286–294) is unchanged:
   `Set by the session's preset.` / `Set by the session's genre.`
2. **Pipeline plain rows** (~626–630): split *who sees the row* from *who may edit it*:
   `ownerVisible = reach === "owner" && !plumbing && !modelStep` (a model-calling step or plumbing is already
   forced to `reach: "admin"`, ~619–620: keep that); a non-admin who is not `ownerVisible` gets no row;
   `editable = !r.lockedAt && !r.fixed && (viewer.isAdmin || ownerVisible)`. Check the result equals today's
   for every unlocked case (including a fixed owner-reach row shown read-only). Values and reasons unchanged
   (`resolveExposure` stays for plain rows).
3. **Prompt rows** (~716–790, the R54 branch): today they ignore a lock (`own ?? inherited`, `editable: true`).
   Build `const locks = settingLocksOf(layers, decls)` once (the `layers` and `decls` already in scope) and, per
   prompt decl, `const lock = locks.get(addr)`. When locked: `value` and `inherited` are the lock's value (plain,
   through the existing `idOf`), the session's own value ignored (kept in storage, never deleted); `source` is
   the lock's layer; `lockedAt: lock.layer`; `editable: false` for everyone (admin too: the module note says an
   administrator sees locked ones read-only); `readOnlyReason` the same sentence as the plain rows
   (`Set by the session's preset.` / `Set by the session's genre.`); no `located` entry, so the write is refused
   by construction. When not locked: exactly as today. Keep the "offered" filter; it already keeps the prompt in
   force listed.
4. **Module note** (~22–41): rewrite the owner bullet so it says a setting a layer above locked is shown to the
   owner read-only with the layer's reason (owner ruling 2026-11-15, reversing R32's "nothing to the owner");
   plumbing stays out for anyone but an administrator. Keep it short.
5. **Refusal** (~1223) stays: `${label}: ${readOnlyReason} Nothing was saved.` Now that the owner gets the row,
   an owner's write to a locked setting is refused with the cause, e.g. *Narrator interjections: Set by the
   session's preset. Nothing was saved.* Do not change it.

## Tests — `sessions/settingsForm.int.test.ts`

- Flip the existing test "a value a preset locks: the owner does not see it…" (~486): the owner now gets the
  field `{ lockedAt: "preset", editable: false, readOnlyReason: "Set by the session's preset.", value: <the
  locked value> }`; the admin's is unchanged; the run still reads the locked value; an owner's
  `updateSetting` to it rejects with `SettingRefusal` whose message is
  `"<label>: Set by the session's preset. Nothing was saved."`; nothing was written (the stored `genre_fields`
  value is unchanged).
- A **genre** lock on a genre field (pins or the genre's defaults; find how — `exposure.ts` `genreLayerValues`
  reads `getSessionGenre(...).settings` pins; a test may update the stored genre pins and restore them in a
  `finally`, or pick a shipped preset whose lock lives at the genre layer if one exists): owner gets
  `lockedAt: "genre"`, reason `Set by the session's genre.`
- How strict under the shipped **Rule Based** preset (it stores `rigour: { value: "scripts", lock: true }`):
  the owner now sees How strict read-only with `Set by the session's preset.` (find the preset's seed key in
  `/home/jody/github/serene-pub-sdk/core-catalog/src/seed/presets.ts`).
- A **pipeline plain row** locked: write `{ value, lock: true }` at an owner-reach reply setting (one of "the
  reply's own switches" the owner test at ~105 finds) on a genre-scope change row, as
  `pipelines/config/panel/sessionValues.int.test.ts` "a setting lock holds" does (read it: it inserts an
  `admin:<registration key>` genre-scope row and deletes it in `finally`); give the session a stale own value
  there first. Owner: row read-only, `lockedAt: "genre"`, value = the locked value; admin: read-only, same.
- A **plumbing / model-step** setting locked the same way stays absent from the owner's form (present,
  read-only, for the admin).
- A **prompt row** locked the same way (the reply's `prompts` address): owner gets it read-only with the lock's
  prompt id as value and the cause; `updateSetting` refuses with the cause; the session's own stored prompt
  value is still in `registrations.values`; after removing the lock, the row is editable again and shows the
  session's own value.
- A **guest** (a non-owner member) still reaches nothing (find how the file or `build()` treats a guest; reuse it).
- Fix any other existing expectation in this file that encoded "the owner does not see a locked setting", and
  say each in the report. Also run `sessions/presetEditor.int.test.ts`, `sessions/envoyVoices.int.test.ts` and
  `pipelines/config/panel/sessionValues.int.test.ts`; if one fails because of this change, fix only its
  expectation and report it; any other failure: report, don't fix.

Run, only this way, one run at a time (other lanes run vitest too — wait first):
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-w3-<n>.log 2>&1"
```
Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then
`cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "settingsForm"`
must print nothing.

## Files owned

`src/lib/server/sessions/settingsForm.ts`, `src/lib/server/sessions/settingsForm.int.test.ts`, and an
expectation-only fix in the three test files named above if this change breaks them. Read anything.

## Rules your work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md: "**Members never see or touch model plumbing** — connections, models, sampling, loadouts."
- CLAUDE.md: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**."
- Brief: "What a non-owner member sees does not change. What an admin sees does not change." · "A locked setting
  the owner could never have seen unlocked (plumbing; an admin-only reach) stays unseen." · "A stored session
  value under a lock is kept (not deleted), so unlocking restores it."
- Cold review: "plain rows keep `resolveExposure`. No second resolver." · prompt rows call the one rule.
- No new user-visible words beyond the two existing sentences `Set by the session's preset.` /
  `Set by the session's genre.`; if you think one is needed, stop and say so.

## Out of scope

The start form (`startAsks`, `exposure.ts`), the Pipelines card / `panel/write.ts`, `world.ts`, `panel/read.ts`,
`values.ts` (read only), client files, docs.

## Report

Write `/home/jody/github/serene-pub/plans/REPORT-ss-5-w3-2026-11-16.md` (status question line; changed files with
line ranges; each existing expectation changed and why; tests with pass counts and log paths; tsc; prettier
`--check` per file; Noticed, not done). Under 450 words.
