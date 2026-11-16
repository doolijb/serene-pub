# BRIEF — `time-t4b` worker 3 — a cast member's versions as rail versions (pure helpers)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4b`. The rules section at the end of this file is part of this brief.

## Goal

The cast member page will draw a member's **cast versions** on the version rail (`time/VersionRail.svelte`, now generic over `RailVersion` / `RailElsewhere` from `time/entryVersions.ts`). Build the arithmetic, with unit tests, in pure TypeScript. Nothing here draws or sends anything; another worker wires the page.

## Files owned

- new `src/lib/client/lorebooks/cast/castVersions.ts` and `src/lib/client/lorebooks/cast/castVersions.test.ts`
- `src/lib/client/lorebooks/cast/castVersionRead.ts` (+ `castVersionRead.test.ts`): add one function
- `src/lib/client/lorebooks/cast/castSave.ts` (+ `castSave.test.ts`): only `CAST_FIELD_WORDS` additions
- `src/lib/client/lorebooks/time/entryVersions.ts`: only widen `momentOfVersion`'s parameter types from `EntryVersion` to `RailVersion` (behaviour unchanged)

## Facts (checked by the supervisor; re-read the code named)

- A **cast version** is a whole profile row (`character_versions`). The member's **base** is the undated, main, no-life-point, person-written version: *From the beginning*. Its id is now on the cast row as `baseVersionId`; `castVersionId` is the version in force at the book's present on main (what the page opens on there).
- `amendments:list` sends each non-base, non-retired cast version as `Sockets.Amendments.CastRow` (`src/lib/shared/sockets/types.ts`, search `interface CastRow extends Row`): `id`, `castId`, `branchId`, `year`, `month`, `day`, `personalPosition` (the **life point**; null = every appearance), `fields` (what changed from the version before, in member-form column names), `columns` (the whole version, `CastVersionColumns`), and now `writeOrder`, `sourceSessionId` (null = a person's), `sourceSessionName` (null when not shown).
- **The server's reader decides order and "in force"**: `versionInForce(rows, line, moment, appearance)` in `src/lib/shared/lorebooks/lineReading.ts` (~597–648; read `inForceOver`): date first (undated lowest), then the nearer line, then the higher life point (null lowest), then the higher write order, then id. Never order by `amendmentsOnLine`'s date-and-id, and never fold several versions at one date into one (owner 2026-11-14: "Each as its own node"). It needs `LineCastVersion` fields: map a `CastRow` with `retiredOrder: null`, `sourceMessageId: null`.
- Which versions a line reads: `rowReadsOnLine(row, line, dateOfRow, null)` (same file ~365). The others are **Elsewhere**.
- A session-written version is **read-only** on the rail (changed from its session).
- `momentOfVersion` (`entryVersions.ts`): a dated version's date; *From the beginning* is the year before the first dated version, or null when nothing is dated.

## Build

1. `castVersions.ts`:
   ```ts
   /** 🚧 One cast version on the rail: the base (*From the beginning*) or a dated one. */
   export interface CastVersion extends RailVersion {
     /** The cast version's id; null only for a member with no base. */
     versionId: number | null
     /** Its Changes row; null for the base. */
     row: Sockets.Amendments.CastRow | null
     personalPosition: number | null
   }
   export type CastElsewhere = Sockets.Amendments.CastRow & { locked: boolean; chip: string | null }
   export function castVersions(args: {
     baseVersionId: number | null
     rows: readonly Sockets.Amendments.CastRow[]   // this member's
     line: Line
   }): { versions: CastVersion[]; elsewhere: CastElsewhere[] }
   ```
   - First the base: `key: "beginning"`, `kind: "beginning"`, `date: null`, `branchId: null`, `own: line.branchId === null`, `changes: []`, `movable: false`, `editIds: baseVersionId != null ? [baseVersionId] : []`, `versionId: baseVersionId`, `row: null`, `personalPosition: null`.
   - Then every row the line reads, grouped by date (`compareDates` equal), groups in date order; inside a group, in the reader's order (lowest first, the one `versionInForce` takes last): get it by repeatedly calling `versionInForce` on the group at its own date with `appearance` null and taking the winner off the end. Each: `key: \`v:${id}\``, `kind: "dated"`, `date`, `branchId`, `own: branchId === line.branchId`, `changes: Object.keys(fields)`, `locked: sourceSessionId != null`, `movable: own && !locked`, `editIds: [id]`, `versionId: id`, `row`, `personalPosition`; when the group has more than one: `chip: castVersionChip(row)` and `readHere: true` on the group's last (the one the lorebook reads there); a group of one has `chip: null` and no `readHere`.
   - `elsewhere`: the rows the line does not read, by date, then write order, then id, each with `locked: sourceSessionId != null`, `chip: castVersionChip(row)` only when it has a session or a life point, else null.
   - `castVersionChip(row): string` 🚧: a session's: *written in ‹sourceSessionName›*, or *written in a session* when the name is null; then, when it has a life point, *at ‹n› in their life* (joined with ` · ` after the session words); a person's with no life point: *at every point in their life*.
2. `castVersionAt(args: { versions: CastVersion[]; rows: readonly CastRow[]; line: Line; moment: StoryDate | null; shownVersionId: number | null }): CastVersion` — the node the reading takes: with a moment, `versionInForce` over the rows the line reads at that moment (appearance null) → that node, none → the base; at now on main → the node whose `versionId === shownVersionId` (the base when it is the base's id), else the last node; at now on another line → `versionInForce` with moment null → that node, none → the base.
3. `castTakenAt(versions, date, lineBranchId, moving: CastVersion | null): CastVersion | null` — the line's own (`own`), person-written (`!locked`) dated version at exactly `date` with the same life point as `moving` (null when `moving` is null), other than `moving` itself. (What a new version at that date would merge into on the server, and what a move there is refused for.)
4. `castLaterCount(rows, v: CastVersion): number` — how many versions a save of `v` would leave with their own words if *Change later versions too* stays off: for the base, every main row (`branchId` null); for a dated one, the rows on `v.branchId` ordered after it (later date; same date and higher `writeOrder`; same write order and higher id). Session rows count (the server keeps them and counts them as kept).
5. `UNDATED_MEMBER_KEYS = ["ownName", "ownNickname", "timbre"] as const` 🚧 — the keys a dated change cannot carry (they are not in the server's `CAST_AMENDABLE`, `sockets/amendments.ts` ~661): they always save through the member save (the version at the book's present), as today. And:
   ```ts
   export function castVersionSave(v: CastVersion, diff: Record<string, unknown>): {
     /** Sent with `lorebooks:updateBinding` and no `castVersionId`. */
     undated: Record<string, unknown> | null
     /** The base: `updateBinding` with `castVersionId`. A dated one: `amendments:update` `fields` — its own `row.fields` plus the diff, never a folded whole. */
     version: Record<string, unknown> | null
   }
   export function castNewVersionSave(diff): { undated: Record<string, unknown> | null; fields: Record<string, unknown> }
   ```
   (`version` is null when the diff has no version key; for a dated one `{ ...v.row!.fields, ...versionPart }`.)
6. `castChangesWords(keys: string[]): string` 🚧 — *changes ‹words›* with `castFieldWord` from `castSave.ts`, joined with `, `; *changes nothing* for none. Add to `CAST_FIELD_WORDS` (🚧) every `CastVersionColumns` key it lacks: `ownName` "the name in this book", `ownNickname` "the nickname in this book", `timbre` "the voice". (Check the type for any other missing key and add a plain word for it; list them.)
7. `castDeleteSentence(name: string): (when: string, line: string | null) => string` 🚧 — *Delete the version dated ‹when›? From then on ‹name› reads as the version before it, and this version's edit history goes with it.*; with a line: *Delete the version dated ‹when› on ‹line›? …* (same rest). (Only a person's versions can be deleted from the rail, and their history always goes with them.)
8. In `castVersionRead.ts`: `rowAtVersion<T extends CastRow-like>(row: T, versions: readonly CastVersion[], v: CastVersion): T` — the member as the form shows `v`: `withBaseVersion(row)`, then for each node from the first dated one up to and including `v`, in rail order, its `versionColumns(row.columns)` and `rowOwnedChanges(row.fields)` (the helpers already in that file); then put back the row's own `ownName`, `ownNickname` and `timbre` (the undated keys: the form shows and saves them as the book's present has them), and set `castVersionId: v.versionId`. For the base: `withBaseVersion(row)` with the same put-back. Export the existing private helpers only if needed.
9. Tests (`castVersions.test.ts`, additions to `castVersionRead.test.ts`, `castSave.test.ts` for the words): order across dates; two versions at one date (a person's and a session's; two life points) are two nodes in the reader's order with chips and `readHere` on the one `versionInForce` takes; a fork: main's versions inherited (`own: false`), the fork's own, a main version past the fork date and a sibling line's under `elsewhere`; `castVersionAt` at a moment, at now on main by `shownVersionId`, at now on a fork; `castTakenAt` (session-only date not taken; person's at a life point not taken for a null-life-point add; a re-date's own key ignored); `castLaterCount` for base and dated; `castVersionSave` / `castNewVersionSave` splits; `castChangesWords`; `castDeleteSentence`; `rowAtVersion` (aliases fold from an earlier node; undated keys stay the row's). Run the three test files plus `time/entryVersions.test.ts`, then `tsc`.

## Out of scope

Svelte files; the server; `lineReading.ts` (shared, not this lane's: call its functions, never change them); the entry helpers beyond item's widening.

## Stop and report when

`versionInForce` cannot be used as described without changing `lineReading.ts`; a type in `types.ts` is missing a field this brief says is there (worker 1 added `writeOrder`, `sourceSessionId`, `sourceSessionName`, `baseVersionId`).

---

# Rules every `time-t4b` worker works under (quoted by the supervisor; read with your own brief)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Owner rulings (verbatim)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook."
- 2026-11-13 (the vertical time view): "Also provide a vertical time view like i suggested for other entries."
- 2026-11-13 (versions): "show the option to change the effective date of that version. Save edits that version, but also need a button to save as a new dated version … navigate the dated versions like a vertical timeline, adding new versions before or after."
- 2026-11-14: the chosen screen (the rail beside the fields, a strip when narrow) and "Yes, move the moment bar".
- 2026-11-14: "hide all the extra time management noise in entries and the lorebook when timelines aren't enabled": with the Timeline off, no rail, no dates; one plain form with its edit-history fold.
- 2026-11-14: **Save writes the selected version** ("The selected version"). The page still OPENS on the version in force at the lorebook's present; after a version is picked on the rail, Save writes that one.
- 2026-11-14: **several versions at one date: "Each as its own node."**
- Standing: cast members get no Beginning and no Decay; members never see or touch model plumbing; it is a **session**, never a chat.

## Hard rules (each has cost data or hours)

- `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- `socket.off(event)` with no handler removes every listener app-wide: always `socket.off(event, handler)`.
- Views never call `toaster`/`notify` for socket replies they did not ask for; the page's own awaited write may say how it went through `notify` as it does today. Refusals are toasted by the shell.
- An event in `SCOPED_EVENTS` must carry its scope key (`lorebookId`, …) in the payload.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- No migration, no new socket event, no new setting. Stop and report instead.
- Comments state the rule, not the story (no "lane X added", no "was …").
- Never `prettier --write` a whole file; format only the lines you changed (check with `npx prettier --check <file>` and leave unrelated hunks alone).
- Edit only the files your brief owns. Anything else you need goes in your report.
- Every new name, label, sentence or prop goes in your report's list (the supervisor records them in NOMENCLATURE §25); mark new copy 🚧 in a comment where the sentence is defined.

## STYLE-GUIDE rules (quoted)

- §5.3 / §6.19: the rail is one component, two layouts from its own box (`@container/versions`, two columns at `@min-[36rem]/versions:`, never the viewport). Wide: a vertical list of buttons beside the fields, the selected one `aria-current`, quiet **+ Add a version here** buttons between them named for where they add (*Add a version between Year 7 and Year 9*), each version's edit rows under it behind an **Edits** toggle (`preset-pressed`, `aria-pressed`). Narrow: a row of chips above the fields (`preset-pressed` when selected). The fields render once in both.
- §6.1: one primary button per surface (`preset-filled-primary-500`); a destructive action is never the primary; removing something saved is `preset-tonal-error`.
- §6.14: unsaved means different from what is saved; "Ask first, then discard — never the other way round": a selection change that would close an edit awaits `loreRoute.confirmLeave()` and only on Leave drops the draft. On a railed form a move of the moment bar that would show another version asks once and, on Stay, puts the moment back.
- §9: every interactive element is a real `button` with an accessible name; never an interactive inside an interactive; `aria-current` on the selected row; nothing hover-only; 44px targets on touch (`min-h-11`, `pointer-coarse:min-h-11`).
- §10: sentence case; a button says what happens; help is one sentence; one name per thing.

## Tests

Run only your targeted files, from the repo root, one at a time, each as:

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t4b-<name>.log 2>&1"`

Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs (another session runs tests in this checkout). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors in your files).

Another Claude session is editing `src/lib/client/components/Layout.svelte`, `components/pipelines/**`, `components/modals/{CharacterCreatorModal,CharacterSelectModal}.svelte`, `src/routes/+page.svelte`, `src/lib/shared/utils/docsPages.ts`: never touch them; errors there are not yours.

## Report

Your final message: changed files; what you built against each numbered item of your brief; tests run with pass/fail counts and log paths; every name, label and sentence added; anything you could not do or decided (with the reason); Noticed, not done.
