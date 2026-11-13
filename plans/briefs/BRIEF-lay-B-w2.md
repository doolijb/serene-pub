# BRIEF lay-B-w2 — Scene Portraits *Who*, Author's note *Scenario*, Stats *Characters* sheet (SDK core-catalog)

Worker (Sonnet) for lane lay-B. Supervisor: lay-B. Paths: SDK = /home/jody/github/serene-pub-sdk, APP = /home/jody/github/serene-pub.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **do not run sdk:build / any build at all**.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Background
Owner ruling R5 (2026-11-05): the common layout has a character-management tab "like an rpg character management screen: inventory, skills…"; bottom left the avatar of the latest **character** that spoke, bottom right the latest **persona** that spoke; Left's 2nd tab "scenario / author's note management". Lead decision D13 (quoted): "Scene Portraits `whoKind` (Characters · Personas · Both, default Both). **Both = exactly today** (characters + the viewer's own persona when *Include your persona* is on); **Personas** = every visible persona that spoke (any player's); **Characters** = no personas. A test pins the default. Author's note gains a Scenario field (requests `session-scenario` / `set-session-scenario`; the app's answerer reads the session and writes through the EXISTING `sessions:update` …; owner-only as there); shown even where the note isn't offered. Stats: a Characters tab = `stats` `arrangement: 'faces'`, `owners: 'all'`, PLUS sheet sections by the ruleset's groups and a portrait column."

Three independent tasks. Another worker edits the `messages` entry, new `composer`/`turn-line` entries, `coreWidgets` and `CORE_COMPONENTS` of `core-catalog/src/registry/widgets.ts` at the same time: in that file edit ONLY the `scene-portraits` entry, with the Edit tool, exact hunks, re-reading right before each edit; never rewrite or reformat the file.

## Task 1 — Scene Portraits `whoKind`
- Registry `scene-portraits` settings: add, right after `who`:
  ```ts
  whoKind: { type: 'enum', label: 'Who', description: 'Characters only, personas only, or both — read by Everyone in the scene and Whoever spoke last; Members you pick shows whomever it names.', of: ['characters','personas','both'], members: [{key:'characters',label:'Characters'},{key:'personas',label:'Personas'},{key:'both',label:'Both'}], default: 'both' }
  ```
  No `showIf`: the SDK's `showIf` is one `{ field, equals }` (it cannot say "scene or recent"), and `persona` (*Include your persona*) already sets the precedent of a setting read by two of the three values and described so. Add a short 🚧 doc comment citing D13.
- `core-catalog/src/shared/ui/scene-portraits/portraits.ts`: `ScenePortraitsSettings.whoKind`, `SCENE_PORTRAITS_DEFAULTS.whoKind = 'both'`, `readScenePortraitsSettings` reads it (anything else → `both`), export the value list the way `WHO`/`FACE` are (check how they are exported; mirror it). `scenePortraitMembersOf`: filter BEFORE ranking/slicing:
  - `both` → exactly today's code path (byte-for-byte the same result for every input).
  - `characters` → `members.filter(m => !m.isPersona)` (no persona even with `persona: true`).
  - `personas` → every unbenched `isPersona` member, ANY player's (ignores `persona`); under `scene` only those with `lastSpokeAt != null` ("that spoke"); `recent` ranks them as today.
  - `pick` ignores `whoKind`.
  - `sceneFiguresOf` is untouched (say so in the doc comment).
- Tests in `sdk-tests/coreScenePortraits.test.ts` (import from `../core-catalog/src/...` as the file does): (a) **the default pins today**: for each `who` in scene/recent and `persona` on/off, `scenePortraitMembersOf(cast, as({ who, persona }))` deep-equals `scenePortraitMembersOf(cast, as({ who, persona, whoKind: 'both' }))` and the existing expected refs; (b) characters drops Wee even with persona on; (c) personas → recent gives Zed then Wee (both players'), `recentTurns: 1` gives Zed; (d) the decl declares `whoKind` default `both` and the reader falls back to `both` on junk. The test fixture `cast` already has `Wee` (mine persona) and `Zed` (another player's persona).

## Task 2 — Author's note gains **Scenario**
Requests (already declared by the supervisor in `SDK/sdk/src/widgets.ts`, core-only):
```ts
'session-scenario': { params: Record<string, never>; result: { scenario: string; canEdit: boolean } }
'set-session-scenario': { params: { scenario: string }; result: { scenario: string; canEdit: boolean } }
```
- `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`: a **Scenario** field ABOVE the note, asked with `session-scenario` on mount (its own ticket/error state, beside the note's), saved explicitly with its own **Save** / **Discard** and *Unsaved changes* exactly like the note's (STYLE-GUIDE §6.14 quoted from the file's own header: "edits wait for **Save**; dirty is derived (the draft differs from what is saved, never 'touched'); a re-read moves the saved snapshot and keeps what is being typed. What goes wrong is said here, in this widget (R77) — never a toast.").
  - Owner edits (`canEdit`); others read: the textarea `disabled`, and the line *Only the session's owner can change the scenario.*
  - Copy (through `t()`, no other new words): label `Scenario`; placeholder `Describe the session scenario, setting, or context (optional)` (the app's Edit Session wording); read failure `Could not read the scenario: {reason}`; save failure reuses `Not saved: {reason}`.
  - Shown whether or not the note is offered. When `!answer.offered` the note part says NOTHING (drop *This kind of session has no author's note.* in that case — the widget then is the Scenario alone). While the note is still loading, keep today's *Reading the author's note…*.
  - Parts: reuse `authors-note.field`, `authors-note.label label`, `authors-note.note`, `authors-note.alert`, `authors-note.actions toolbar`, `authors-note.unsaved`, `authors-note.discard`, `authors-note.save` for the scenario's elements, and add exactly two new parts: `authors-note.scenario` (the scenario's `<section>` wrapper) and `authors-note.scenario-text` (its textarea). Keep the markup free of look (no classes, no inline style).
  - No re-read event exists for a scenario changed elsewhere; ask on mount and adopt the save's answer. Say so in a comment and in Noticed.
  - Update the file header comment for the scenario (cite D13).
- Tests: the existing `sdk-tests/coreAuthorsNoteComponent.test.ts` mounts the BUILT dist module (stale until the lead's rebuild) — update its `requests` handler so it also answers `session-scenario` (`{ scenario: '', canEdit: true }`) and leave its assertions alone; don't expect to run it green. Add a NEW `sdk-tests/coreAuthorsNoteScenario.test.ts` that mounts the SOURCE entry (`mountComponent({ root: CORE_CATALOG, entry: 'components/genres/story/authors-note/authors-note.ts', owner: 'core', timeoutMs: 60_000, … })`, from `./harnessGuard.js` the way `coreConversationComponent.test.ts` does) and pins: owner sees an editable Scenario above the note, Save sends `set-session-scenario { scenario }` once and goes clean; a non-owner sees it disabled with the owner-only line; `offered: false` → the Scenario is shown and no *no author's note* sentence. Look at how `coreConversationComponent.test.ts` and the existing author's-note test read the mirrored DOM and drive input/clicks; copy those helpers.

## Task 3 — Stats: the **Characters** sheet (`arrangement: 'faces'`)
File: `core-catalog/components/shared/stats/StatsWidget.svelte` (1010 lines; read by ranges). Today `arrangement: 'faces'` draws a chip strip (`stats.faces`) over ONE sheet, `cardOf(faceShown)` inside `stats.faces-sheet`. Change ONLY the faces case (cards/list/strip draw exactly as today):
- The chosen owner's sheet becomes two columns in markup order: a **portrait column** then the **sections**:
  - `<aside data-widget-part="stats.sheet-portrait">`: the large face — reuse the existing `faceOf(owner, group)` snippet so the portrait picker still opens from it — then the name (`stats.sheet-name`, with the faces chips' *{name} (you)* rule for the viewer's own) and a one-line role (`stats.sheet-role`) = the existing `groupLabel(group)` words (*Cast* · *World* · *Places*). No new words.
  - `<div data-widget-part="stats.sheet-sections">` holding the sheet's blocks as sections, in today's `cardOf` order (offers, where-and-when, the rules' attributes, tools, carried, each zone, ties, carries). **"By the ruleset's groups"**: the rulesets declare NO slot groups (`SessionStateSlotV1` has no group field — checked), so the sections are the groups the sheet already has: each zone is its own section under its own ruleset label (`stats.zone-head`, already drawn), ties under a visible head using the existing `t("Ties")` word (part `stats.ties-head label`), and the attributes block first with no head. Do not invent headings. Wrap each block that is a section in nothing new unless needed for the two-column layout; say what you did.
  - The faces arrangement no longer draws the card head (`stats.card-head`) inside the sheet — the portrait column replaces it. Root gets `data-sheet=""` on `stats.faces-sheet` so the stylesheet can lay out the columns (lay-C writes that CSS; put none here).
- Keep: the faces strip, the chosen chip per viewer (`saveState`), the changed dots, the empty sentences (a genre whose rules declare no attributes keeps *This session's rules declare no attributes.* / `emptyState`), offers, Give to…, trails, every refusal path.
- Tests: add to `sdk-tests/coreStateWidgets.test.ts` (it mounts `components/shared/stats/stats.ts` from source) ONE test: `arrangement: 'faces'`, `owners: 'all'`, a cast member with a slot and a zone → the sheet has `stats.sheet-portrait` with the name and role *Cast*, `stats.sheet-sections` with the slot row and the zone head, no `stats.card-head` inside `stats.faces-sheet`; and that `arrangement: 'cards'` still draws `stats.card-head`. Reuse the file's fixtures. Run the WHOLE file and the other stats files (`coreStatsKinds`, `coreStatsPieces`, `coreStatsTies`) — they must stay green.

## Rules (CLAUDE.md, quoted)
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat*."
- STYLE-GUIDE §6.16: "A session widget's markup carries **no look** … Its elements carry **widget parts** … `<part owner>.<part name>` … A part name is kebab-case, singular, and says what the element is, never how it looks. State stays in the widget's own `data-*`."
- Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." Any user-visible word or part name beyond the ones named in this brief → stop and ask in your report.
- Component helper logic you add goes in `components/**`, not `core-catalog/src/shared/ui/**` — EXCEPT `portraits.ts`, which is the named home of the portraits reader (its component reads the built dist; that's fine, the pure test imports src).

## Files owned
- `SDK/core-catalog/src/registry/widgets.ts` — the `scene-portraits` entry only.
- `SDK/core-catalog/src/shared/ui/scene-portraits/portraits.ts` (+ its `index.ts` re-export if a new export needs it).
- `SDK/core-catalog/components/genres/story/authors-note/**`.
- `SDK/core-catalog/components/shared/stats/StatsWidget.svelte`.
- `SDK/sdk-tests/coreScenePortraits.test.ts`, `coreAuthorsNoteComponent.test.ts` (handler only), new `coreAuthorsNoteScenario.test.ts`, `coreStateWidgets.test.ts` (one new test).

## Files readable
Anything. Do NOT edit `sdk/src/**`, other components, layouts, guides, the app.

## Done means
Run, one file at a time from `/home/jody/github/serene-pub-sdk/sdk-tests` with `npx tsx --test <file>` (never piped into `head`): `coreScenePortraits.test.ts`, `scenePortraits.test.ts`, `coreAuthorsNoteScenario.test.ts`, `coreStateWidgets.test.ts`, `coreStatsKinds.test.ts`, `coreStatsPieces.test.ts`, `coreStatsTies.test.ts`, `dungeonCrawlerWalk3.test.ts` — all green, with counts. Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "scene-portraits|registry/widgets|coreScenePortraits|coreAuthorsNote|coreStateWidgets"` prints nothing.

## Report
Write `/home/jody/github/serene-pub/plans/REPORT-lay-B-w2-2026-11-05.md`: changed/new files; the `whoKind` decl and reader; the Author's note scenario DOM + copy strings; the Stats faces sheet DOM (parts added, `data-sheet`); tests with pass/fail counts; Noticed-not-done; open questions.
