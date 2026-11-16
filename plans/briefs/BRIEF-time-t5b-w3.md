# BRIEF — worker `time-t5b-w3` — app: a session's new entry takes its Beginning and Decay from layered defaults

Supervisor: lane `time-t5b` (`plans/briefs/BRIEF-time-t5b.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You do not run `sdk:build` (the supervisor built the SDK at 11:14 today; its `dist` carries the new fields). Never
`git checkout` / `restore` / `stash`. Never `kill -9`. No migration (stop if one seems needed). Another session shares this
checkout: edit only the files below.

## What the SDK now declares (built, read-only for you)

- `EntryShape.defaultBeginning?: 'perpetual' | 'began'` and `EntryShape.defaultDecayRate?: number` (0–1), on every entry type
  descriptor's `entryShape` (`getDefinition('<bare id>@<version>').entryShape`). Core: world lore, character lore, place =
  `perpetual`, 0; item = `began`, 0; history = neither. A ruleset's derived type carries them when its entry type or ⏳
  repertoire declares them (`deriveEntryTypes` in `@serene-pub/core-catalog`).
- `core:outlet/create-lore-entry@1` params `defaultBeginning` (enum `perpetual` | `began`) and `defaultDecayRate` (number
  0–1), no defaults. They arrive in the host as `p.params?.defaultBeginning` / `p.params?.defaultDecayRate`, beside
  `p.params?.entryType`. Params, never ports: a model's output cannot reach them.

## Owner rulings this depends on (verbatim)

- 2026-11-13: "determine what entry types are created as perpetual vs living by default and also allow overrides in the SDK
  so genres/pipelines etc can override our sensible defaults"; the rate is "a value between 0 and 1".
- 2026-11-14 (§8 item 4): "Core defaults when a dated session writes a new entry: World lore, Place, Character lore =
  perpetual fact; Item = began, fact". (History: **untouched** in this lane; `scenes/historyEntryOfDate.ts` is not touched.)
- The plan's Write rule: an entry's switches come from "the entry type's default … ← the genre's override ← the writing
  step's value ← a person's setting, never the model's choice."
- 2026-11-14 ★7: "Decay with a timeline: story time…; without: rounds" — Decay is kept with the Timeline off.

## The rule to build (the lead's corrections rule)

1. **One pure function resolves the layers**, and it is the only place that does: per field, the step's value ← over the
   genre's ← over the entry type's, else perpetual and 0. (The genre layer has **no source yet** — its place in the genre
   declaration is a question for the owner — so the host passes none; the function still takes it, and the table tests it.)
2. It applies wherever a **session creates a new entry**, in **every write mode, on both routes**: the `create-lore-entry`
   insert in `src/lib/server/pipelines/runtime/host.ts` (the `else [created] = await tx.insert(schema.lorebookEntries)…`
   branch, ~12164) serves the `book` route (straight into the lorebook under Full) and the `own-book` route (the session's
   own book under Review changes, Off, someone else's book, a filing tool's `toNotes`). Apply later moves the row as it is
   (`ownBook.ts` ~2245–2252), carrying the values: nothing to change there.
3. **Never** on: a match (the write changes an existing entry, `changeLoreEntry`), a history day (`fileOntoHistoryDay`), a
   person's create (`sockets/entries.ts`), an import, a duplicate, a starter. Those paths are not touched.
4. **The Beginning** is set only when the session reads at a story date: take the date from the session's reading,
   `sessionReadingOf(db, sessionId)` (`state/reading.ts` ~331) `.moment` (a `StoryDate` at day grain; **null** when the
   lorebook's Timeline is off or there is no clock) — **not** from the write line (`target.line.reading.moment` is null on
   the own-book route). Read it **before** `db.transaction(…)`. Resolved `began` + a date → the entry's `year`, `month`,
   `day` are that date (`month`/`day` may be null, as the date carries them); resolved `began` with no date, or
   `perpetual` → no date parts.
5. **The Decay** resolves from the layers whatever the Timeline (Timeline off or no date unsets only the Beginning).
6. The step's values are checked at the commit, refused with a sentence (`HostScopeError(\`${node.key}: …\`)`, like the
   unknown `entryType` refusal) — never coerced: `defaultBeginning` other than `perpetual`/`began`: *‹value› is not a
   Beginning default. Say 'perpetual' or 'began', or leave it empty.*; `defaultDecayRate` not a finite number from 0 to 1:
   *A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living entry.*; `defaultBeginning` on a type whose entries
   carry their own date (`!takesBeginning(typeId)`, `utils/lorebookEntries.ts` ~343 — History): *‹type name› entries carry
   their own date, so defaultBeginning does nothing here. Leave it empty.* Empty / `null` / absent = not set. (A
   `defaultDecayRate` on a History write is neither refused nor applied: the history day path is untouched; report it.)
7. `entryInsert` (`utils/lorebookEntries.ts` ~405) already takes `year`/`month`/`day` (for a type that `takesBeginning`) and
   `decayRate` from its first argument; spread the resolved values there. Verify `typedFieldsOf`'s `fields` never carries
   `year`/`month`/`day` for these types, so nothing collides.
8. Undo is unchanged: the turn's per-turn record (`imprintMade … subject: "entry"`) unmakes the created entry as today.

## Build

- New module `src/lib/server/lorebooks/entryDefaults.ts` beside `entryVersions.ts`:
  - the pure resolver (e.g. `newEntryTime({ type, genre, step, date, takesBeginning }) → { year, month, day, decayRate }`,
    the layers as `{ defaultBeginning?, defaultDecayRate? }`);
  - the pure check of a step's params (returns the layer or the refusal sentence; the host throws);
  - the reader of a type's declared defaults from the SDK registry (`entryDeclaration(typeId)` from
    `$lib/server/entries/declarations` for the version, then `getDefinition(\`${typeId}@${version}\`)` from
    `@serene-pub/sdk`, its `entryShape`). Do not edit `entries/declarations.ts` (not this lane's); if you think it should
    carry the defaults, say so under Noticed.
  Choose plain, qualified names (NOMENCLATURE R3: never a bare `type` / `default`); list every exported name in your report.
  Comments state the rule, not the story.
- `host.ts`: the new-entry branch only (plus reading the reading and checking the params before the transaction, next to the
  `entryType` / `typedFieldsOf` checks). **Inside `db.transaction(async (tx) => …)` use only `tx`** — the outer `db`
  deadlocks PGlite silently.

## Tests

- `src/lib/server/lorebooks/entryDefaults.test.ts` (pure, no DB): the resolver's table — each layer alone, each absent, step
  over genre over type per field independently (a step setting only the rate keeps the type's Beginning), `began` without a
  date gives no date parts, a date with null month/day; the params check (each refusal sentence, empty/null = unset); the
  reader for core's five (world lore/character lore/place perpetual 0, item began 0, history none) and for a ruleset
  repertoire's derived type with defaults (declare one in the test with `defineRepertoire` / `defineRuleset` from
  `@serene-pub/sdk` and `deriveEntryTypes` from `@serene-pub/core-catalog`, under a test namespace, as other app tests that
  register a ruleset do — grep for one).
- `src/lib/server/pipelines/runtime/host.entryDefaults.int.test.ts` (read `host.datedVersion.int.test.ts`,
  `host.fullDirect.int.test.ts`, `host.ownBookRoute.int.test.ts` and `lorebooks/autoApply.int.test.ts` first and reuse their
  fixtures; 60 s timeouts on tests that open a DB):
  - Full, Timeline on, clock at a date: a new Item begins at the session's date, Decay 0; a new World lore entry is
    perpetual, 0; a new History entry is created as today;
  - the step's params win: World lore with `defaultBeginning: 'began'` begins at the date, `defaultDecayRate: 0.3` gives
    0.3; Item with `defaultBeginning: 'perpetual'` has no date;
  - Timeline off: the Item has no date, and a step's `defaultDecayRate: 0.4` still gives 0.4; Timeline on with no clock: no
    date;
  - Review changes then Apply: the same step's Item lands in the session's own book with the same Beginning and Decay as
    under Full, and keeps them after Apply moves it into the lorebook;
  - untouched: a person's new Item (`entries` create through its socket handler or its helper, as an existing test does) is
    perpetual, 0; a `match` write that changes an existing entry leaves that entry's Beginning and Decay as they were;
  - the created entry reads with its values at once (the row as the entries list serves it: `toEntryRow`, or the list
    handler an existing test calls);
  - a refused param (rate 2) writes nothing and says the sentence.

## Files owned (edit only these)

new `src/lib/server/lorebooks/entryDefaults.ts`, new `src/lib/server/lorebooks/entryDefaults.test.ts`,
`src/lib/server/pipelines/runtime/host.ts` (the create case: the checks before the transaction and the new-entry branch),
new `src/lib/server/pipelines/runtime/host.entryDefaults.int.test.ts`. An existing test you must change because it pinned
today's behaviour for a **new Item** written by a session: allowed, with the change named in your report. **Stop and report**
(do not change it) if an existing test of a session-written entry changes for any type other than Item or History.

## Rules

- It is a **session**, never a chat. Never write "no lorebook". No other product's name anywhere.
- `socket.off(event)` needs its handler; no `crypto.randomUUID` in browser code (you write none).

## Done means

One vitest at a time across the lane: first `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one runs, wait
and check again. Then, capped, from `/home/jody/github/serene-pub`:

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/lorebooks/entryDefaults.test.ts src/lib/server/pipelines/runtime/host.entryDefaults.int.test.ts > plans/time-t5b-w3-1.log 2>&1"

then the neighbours that write entries from sessions:

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.datedVersion.int.test.ts src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts src/lib/server/pipelines/runtime/host.ownBookRoute.int.test.ts src/lib/server/pipelines/runtime/host.ownBookFull.int.test.ts src/lib/server/pipelines/runtime/host.heldEntryChange.int.test.ts src/lib/server/lorebooks/autoApply.int.test.ts > plans/time-t5b-w3-2.log 2>&1"

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/time-t5b-w3-tsc.log 2>&1`
(0 errors in your files; report others'). `npx prettier --check` on your files (report; don't reformat whole files).

## Report

Your final message: changed files; every exported name; the sentences as built; tests with results (log paths); any
existing test you changed and why; anything you stopped on; **Noticed, not done**.
