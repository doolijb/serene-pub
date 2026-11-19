# BRIEF — build lane `tl-1` — a genre's timeline stance, and the SDK catching a pipeline that does not respect it (programme 1.7)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-timeline-stance-2026-11-16.md` (**re-verify every file:line**),
`plans/PLAN-entry-time-and-lines-2026-11-14.md` 326–334 (the ruling), `../serene-pub-sdk/INTEGRATING.md` (the
steps on genres, presets and validation: by section), `NOMENCLATURE.md` §1, §23, §24 and the rows **timeline**,
**timeline mandate**, **keepsTime**, `docs/lorebook-time.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root (`npm run sdk:test` from the app root, capped: the standing
failures only). Before `npm run sdk:build` (app root): `pgrep -af "vite"` (dev / preview up → do not build,
report "blocked on your dev server") and wait until no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-1-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration. No full run, no build.

## Owner (2026-11-15)

"they are core values and data. It's up to the session's sum configuration to save, mutate, query and render
it. They shouldn't be something that could get changed or fucked up in a way that another session suddenly
can't use it properly. However a session can set that it accepts timelines mandated, excluded or either/or. The
SDK should catch when a pipeline doesn't respect that type safety, i.e. timeline mechanics and values are null,
available, or nullable, can't be mutated, can be, might be (if lorebook has a timeline)."
Standing: genres expect, never lock (a session on a lorebook that does not match still plays, degrading in
words); P1; P3 (no new setting without who / why / what breaks); SDK should feel like Drizzle; no `@2` bumps
before 0.7; removing or renaming a published SDK name is the owner's call (widening a union is not a removal).

## The design to build (names 🚧, each ★ in the report)

### A. The stance (SDK `sdk/src/genres.ts`, `announce.ts`)

- `GenreDecl.timeline` widens from `'required'` to **`'required' | 'excluded' | 'either'`**. Left out, it is
  derived as today's behaviour implies: `keepsTime: 'story'` → `'either'`; `'real'`, `'none'` or no `keepsTime`
  → `'excluded'`. `'required'` keeps its present meaning and its `keepsTime: 'story'` check; `'either'` also
  needs `keepsTime: 'story'`; `'excluded'` with `keepsTime: 'story'` is refused (state the sentence).
  One exported pure function gives the resolved stance of a genre (🚧 `timelineStanceOf(genre)`), and core uses
  it wherever it derives the same thing today (`timelineDefaultFor`, the timeline pass): no second derivation.
- A preset keeps `defaults.timeline?: boolean` and is checked against the stance: `false` under `'required'`
  (today's refusal) and `true` under `'excluded'` are refused at announce.
- **It is an expectation, not a lock** (ruling: genres expect, never lock): nothing in this lane refuses a
  session on a lorebook that does not match its genre's stance. What the stance changes for a session is what
  the SDK promises a pipeline's author and checks, below; at run time today's degradations stay (the sentences
  in `TIMELINE_OFF_SENTENCES`).

### B. What each definition says about the timeline (SDK contracts and variables)

A definition that reads or writes timeline state declares it, in one new optional property on the definition
(🚧 `timeline: 'reads' | 'writes'`): the reads and variables in the inventory §2 (`current-date`,
`story-calendar`, `history` / `earlier-scenes` date fields, `history-entries`, `cast-presences`' `at`), the
writes in §3 (`advance-story-clock`; `create-lore-entry` / `update-lore-entry` only for their history-entry
use: decide whether a param value can carry that or the outlet is marked "may write", and say which). The
property is policy, not part of a definition's content hash, unless every sibling policy field is hashed (check
`sdk/src/hash.ts`; a re-pin of every hash is not wanted).

### C. The checks (where a genre and its pipelines meet)

`validate(doc)` knows no genre (inventory §4), and one spec can be registered by several genres. So the checks
run **where a genre's registrations are assembled** (find it: `announce.ts` checks presets against a genre
there; the registry / `validate` entry that sees a genre with its pipelines), as findings in the existing
`Finding` shape:

| Stance | A step that **writes** timeline state | A step or template that **reads** it |
|---|---|---|
| `required` | fine | fine: the value is available |
| `either` | fine: it may be skipped at run time, in words | **warning** when the value is used unguarded: a template that prints a timeline variable outside an `{{#if}}` on it; a spec that wires a timeline read's date into an in-port with no fallback (only where the SDK can tell: say exactly what it can and cannot see) |
| `excluded` | **error**: this genre excludes a timeline, the step can never write | **warning**: the value is always absent (an error would break shared pipelines that degrade correctly) |

- The template checker reads `VarField.optional` for this (it never does today): mark `current-date` and
  `story-calendar` optional (they are absent on a book with no timeline; the docs already say so), and give the
  checker the stance as an option (🚧 `TemplateCheckOptions.timeline`), so an unguarded use under `either` is a
  warning with a fix that names the guard.
- **TypeScript:** exported helper types so an author's own code can say what it holds: 🚧
  `TimelineValue<S, T>` = `T` for `'required'`, `T | null` for `'either'`, `null` for `'excluded'`, used by the
  typed variable values where the SDK already has value types (`VarValue`); do not attempt to type handler
  inputs (they are `any` today): say so in the docs.
- Every shipped genre, preset, spec and template passes with **no new warning** (fix shipped templates or specs
  that the new checks rightly flag; list them), except where a warning is the honest state (list those too, with
  the reason).

### D. App

`timelineDefaultFor` and the timeline pass use the SDK's one function. The start form's advisory copy stays as
it is. Where the app runs validation for the admin (the Pipelines view's findings, plugin install), the new
findings appear through the existing path; no new UI. If a plugin genre that declares nothing would newly fail
(an **error**) where it loaded before, that is a break for 0.6 users: downgrade that case to a warning and
report it.

### E. Docs and names

`INTEGRATING.md` (genres: the stance; validation: the table above); the SDK guide where genres and templates
are taught (one checked example per stance); `docs/lorebook-time.md` only if a sentence becomes untrue;
`NOMENCLATURE.md`: the **timeline mandate** row becomes the **timeline stance** row with its charter (purpose,
owns, does not own: it never locks a session), `'required'` unchanged, §25; retire nothing.

## Files owned

SDK: `sdk/src/genres.ts`, `announce.ts`, `validate.ts` or the registry's check site, `template.ts`,
`templateCheck.ts`, `variables.ts`, `storyTime.ts` (types), `descriptors.ts` (the new property),
`contracts/src/queries.ts` / `outlets.ts` (the property on the named definitions only: another lane's
uncommitted edits are in those files; targeted edits), `core-catalog/src/registry/genres.ts` (explicit stances
only if a derived one would be wrong), shipped templates / specs the checks flag, SDK tests, guides,
`INTEGRATING.md`. App: `lorebooks/timeline.ts`, `lorebooks/timelinePass.ts`, pinned tests that move
(registry / spec hashes with "(was …)" only if they must), `NOMENCLATURE.md`.

## Out of scope

Refusing or blocking a session or a lorebook; any new setting or UI; typing handler inputs; changing run-time
degradation; the Line picker; presence.

## Stop and ask when

CLAUDE.md §Decisions applies; widening `timeline` breaks a published type for plugin authors in a way a 0.6
plugin would fail to compile or load; no place exists where a genre and its pipelines are checked together;
the derived stance changes any shipped genre's behaviour; a shipped pipeline would need an `error`.

## Done means

SDK: tests for the stance (each value, derivation, the three refusals), each cell of the table, the template
option, the helper types (type-level tests as the SDK does them); `sdk:build`; `npm run sdk:test` (capped) the
standing failures only. App: `timelineDefault.test.ts`, `timelinePass.int.test.ts`,
`sessions.timelineDefault.int.test.ts`, the registry / spec hash tests, the two prompt-baseline tests
(byte-identical), a plugin-genre fixture that declares nothing still loads. `tsc` 0; `npm run check` 0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-tl-1-<date>.md`): the stance and its derivation; which
definitions carry the property; where the checks run and what each can and cannot see; shipped things changed
or flagged; names (★); changed files; tests; **Noticed, not done**. Under about 700 words.

## Cold review (2026-11-16): NOT LAUNCHED — waits on the owner (DISCUSS-LATER D46)

The quote is at `PLAN-entry-time-and-lines-2026-11-14.md` 328–333 (item 13, answering a question about entry
defaults and a genre override; it ends "No genre override is built."). The brief missed two rulings: 2026-11-14
(same plan 263–266) "preset may override the genres default, but not it's mandate", and item 14 "Chat and Guide
undated like Minimal". Corrections that hold whatever the owner answers:

1. **Never derive `'excluded'`.** Anything undeclared resolves to `'either'`; `'excluded'` exists only when
   stated, and only then is a preset's `timeline: true` refused. (A derived `'excluded'` would turn a default
   into a mandate and stop a 0.6 plugin genre with no `keepsTime` and a `timeline: true` preset from loading:
   announce refusals are throws, `sdk/src/announce.ts` 757–765.)
2. **A write under `'excluded'` is a warning, not an error** (or an error only under a declared `'excluded'` and
   only for `advance-story-clock`): Chat and Guide share `summaries` with Story, which files history entries
   (`core-catalog/src/genres/defaults.ts` 187–194; `shared/summarize/summarizeSpec.ts` 38–43, 276), legitimately
   on a world lorebook that keeps a timeline.
3. **No stance makes a value non-null.** The value comes from the governing lorebook's switch, never the genre
   (`lorebooks/timeline.ts` 72–128; `assemble.ts` 343–375); `'required'` is "Not a lock on a session". So
   `'required'` reads are typed and checked as `T | null` like `'either'`; drop `TimelineValue`, or document it
   as "may be null under every stance". A real guarantee needs a lock, which "genres expect, never lock" forbids.
4. **The check site:** one pure exported function (🚧 `timelineFindings(genre, preset | undefined, specs)` →
   `Finding[]`), called from `announcementOf` (`announce.ts:1236`) per genre × preset, warnings only, and from an
   SDK test over the core catalogue; cross-package genres named through `use(…)` are skipped (docs say so).
5. **Expected re-pins:** `GenreDecl` and variables are hashed whole (`sdk/src/hash.ts` 80–92): marking
   `current-date` / `story-calendar` optional re-pins those two; a normalised stance written onto a genre
   declaration re-pins that genre. `VarValue` does not change.

**The owner's question (D46): whose stance?** (a) on the genre; (b) resolved per preset from the genre's mandate
plus the preset's choice (the preset is the session's create spec), checks over the genre's defaults plus that
preset's changes. The review recommends (b).
