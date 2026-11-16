# BRIEF — worker `time-t4a-w4` — the entry form's two zones: the field sections and the entry row

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~500
words): changed files, the context's exported names, tests run with results, every label and sentence added.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context

In a lorebook that keeps a timeline, the entry form (`EntryWorkspace.svelte`, another worker's, later) will
draw an entry with a rail of **versions** over story time, and the form in **two zones: the entry, and the
version** (owner 2026-11-14, "Lets go with all your recommendations"). The zones rule (owner 2026-11-14:
"A makes sense"):

> One rule: **a field is the entry's until it is made to differ at a date.** Storage is unchanged; this is only
> how the form shows it. Always the entry's, shown in the entry row, never per version: line, Beginning, Decay,
> archive. **Keywords, Pinned, Off and Part of** (and only these four): when no dated change on the line being
> read carries the field, it shows once in "the entry" area and editing it writes the entry's own stored value.
> Each of the four has a small action **Change from this version…**, offered while a dated version is selected:
> it moves the field into that version's fields, marked *differs by version*, and from then on the field is
> edited per version. **Make it the same everywhere** on such a field removes it from every dated change of this
> line's own (after a confirmation naming how many versions change) and it returns to the entry area with the
> value of the version shown. Inherited versions of other lines are not touched; if one of them carries the
> field it stays *differs by version* and the action says why it is not offered. Name, Content and the type's
> own fields are always the version's. Copy 🚧: **Change from this version…**, **Make it the same
> everywhere**, *differs by version*.

The entry form will draw "the entry" area itself (the entry row, then whichever of the four are the entry's,
with **Change from this version…**). Your part: the context the form sets, the two field sections reading it,
and the entry row learning to say the line and to hold the entry area under it. With no context set (the
Timeline off, History, a new entry, any other mount) **everything draws exactly as today**.

Read first: `src/lib/client/lorebooks/time/entryVersions.ts` (`ZONE_FIELDS`, `ZoneField`, `zoneOf`),
`src/lib/client/lorebooks/sections/EntryCoreFields.svelte` (Keywords = `KeywordChips` bound to `draft.keys`;
Part of = `PartOfField`), `sections/EntryAdvancedFields.svelte` (mounts `BeginningDecayRow` at the top for every
type but History), `time/BeginningDecayRow.svelte`, `sections/poolContext.ts` (the pattern for a context).

## Build

1. New `src/lib/client/lorebooks/time/versionZones.ts`:
   - `interface VersionZones { readonly railed: boolean; zoneOf(field: ZoneField): "entry" | "version";
     sameEverywhere(field: ZoneField): { count: number; run: () => void } | { blocked: string } }`
     (the form implements it with getters so it stays reactive; document that).
   - `setVersionZones(z: VersionZones)`, `getVersionZones(): VersionZones | null` (a private `Symbol` key;
     `null` when no ancestor set it).
   - Copy constants (🚧): `DIFFERS_BY_VERSION_LABEL = "differs by version"`, `SAME_EVERYWHERE_LABEL = "Make it
     the same everywhere"`, `CHANGE_FROM_VERSION_LABEL = "Change from this version…"`, `SAME_EVERYWHERE_CONFIRM
     = "Make it the same"`, and `sameEverywhereQuestion(count: number)` =
     `` `Make this the same in every version? ${count} ${count === 1 ? "version" : "versions"} on this line will read the value shown here.` ``
   - One small unit test file `time/versionZones.test.ts` (the question's singular and plural).
2. `sections/EntryCoreFields.svelte`: `const zones = getVersionZones()`. For **Keywords** and **Part of** each:
   with `zones?.railed` and `zoneOf(field) === "entry"`, do not draw it (the form draws it in the entry area);
   with `zoneOf(field) === "version"`, draw it as today and under it one muted line: *differs by version* and a
   quiet text button **Make it the same everywhere**. Pressing it: when `sameEverywhere(field)` is `{ blocked }`
   the button is disabled and carries the sentence as its `title` and in a muted line under it; when
   `{ count, run }` it opens an inline confirmation in place: the question sentence,
   **Make it the same** (`preset-tonal-warning btn-sm`) which calls `run()` and closes, and **Cancel**
   (`preset-tonal-surface btn-sm`). Keep `data-lore-field="keywords"` on the keyword wrapper as today. Field
   keys: `keys`, `anchorEntryId`.
3. `sections/EntryAdvancedFields.svelte`: with `getVersionZones()?.railed`, do not draw `BeginningDecayRow`
   (the form draws the entry row at the top). Nothing else changes.
4. `time/BeginningDecayRow.svelte`: two optional props. `lineWords?: string` (e.g. *On main*, *On The burning*):
   when given and the Timeline is on, the collapsed words read `` `${lineWords} · ${beginning} · ${decay}` ``
   (so *On main · Perpetual · Fact*), and the aria-label says the same. `children?: Snippet`: drawn under the
   row's toggle, outside the fold, always visible (the entry area's fields). Without either prop the row is
   exactly as today (its existing tests must pass unchanged).

## Files owned

`src/lib/client/lorebooks/time/versionZones.ts` (new), `time/versionZones.test.ts` (new),
`sections/EntryCoreFields.svelte`, `sections/EntryAdvancedFields.svelte`, `time/BeginningDecayRow.svelte`,
`time/beginningDecayRow.dom.test.svelte.ts`, `sections/entryAdvancedFields.dom.test.svelte.ts`, a new
`sections/entryZones.dom.test.svelte.ts` and a test-only fixture `sections/EntryZonesFixture.svelte` (sets the
version-zones context and the lore pool context — `setLorePoolCtx` — then mounts `EntryCoreFields` and
`EntryAdvancedFields`; doc comment *Test fixture … never mounted by the app*). Nothing else; in particular not
`EntryWorkspace.svelte` (another worker's, later) and not the rail.

## Rules (quoted from the canon)

- Svelte 5 runes; `$state(new Set())` / `new Map()` is not reactive on mutation: `SvelteSet` / `SvelteMap`.
- STYLE-GUIDE §6.1: a destructive action is never the primary; a safe action to read twice is
  `preset-tonal-warning`; quiet actions are text buttons. §9: every control a real button with an accessible
  name; never an interactive inside an interactive; nothing hover-only; 44px targets on touch. §10: sentence
  case; a button says what happens; help is one sentence.
- No `crypto.randomUUID`, no `navigator.clipboard`. No sockets in these files.
- Comments state the rule, not the story. No `prettier --write` on a directory or on a file you did not
  otherwise change; `npx prettier --check` yours (some of these files may already fail `--check`: do not
  reformat lines you did not change).
- `NOMENCLATURE.md` R3: in code/comments say *entry version*, never a bare *version* where a card or cast
  version could be meant.

## Done means

DOM tests: with no context, Keywords, Part of and the Beginning row draw as today; railed with keys and
anchorEntryId in the entry zone, neither is drawn and the advanced fields draw no Beginning row; railed with keys
in the version zone, the keywords draw with *differs by version* and **Make it the same everywhere**, which asks
with the count and calls `run` on yes (not on Cancel); a `{ blocked }` answer disables it and shows the sentence;
`BeginningDecayRow` with `lineWords` reads *On main · Perpetual · Fact* and draws `children` outside its fold;
with the Timeline off `lineWords` is not shown (check what the row says today with it off). Run (one at a time;
first check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait while one runs; never pipe vitest
into `head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/time/versionZones.test.ts src/lib/client/lorebooks/sections/entryZones.dom.test.svelte.ts src/lib/client/lorebooks/sections/entryAdvancedFields.dom.test.svelte.ts src/lib/client/lorebooks/time/beginningDecayRow.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts > plans/time-t4a-w4.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files (report the count).
