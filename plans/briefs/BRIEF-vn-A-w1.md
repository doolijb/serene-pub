# BRIEF — vn-A-w1: SDK contracts, Scene Portraits, the Visual novel layout

Supervisor: lane `vn-A` (report to it, not the owner). Repo: **`/home/jody/github/serene-pub-sdk`** (the SDK repo). Design: `/home/jody/github/serene-pub/plans/PLAN-visual-novel-layout-2026-11-11.md` §1.1, §1.4, §1.5 (read those sections only). GO from the owner 2026-11-11. Another worker (`w2`) is editing `core-catalog/components/shared/messages/` and `core-catalog/src/shared/ui/conversation/` at the same time — never touch those. Other sessions may edit other areas of this repo.

## Goal

### A. Do these three first (w2 compiles against them)

1. `sdk/src/widgets.ts` — a new host request **`show-line`**, declared right after `'show-channel'` in all three tables that list `'show-channel'` (the `WidgetRequests` interface ~:2005, `WIDGET_REQUEST_ASKERS` ~:2889 as `'core'`, `WIDGET_REQUEST_APIS` ~:3014 as `'session'`), each with a 🚧 comment in the style of its neighbour:
   ```ts
   /**
    * 🚧 Core's Messages widget tells its host which line its reader is on
    * (PLAN-visual-novel-layout §1.2): sent by the primary log only (a copy with
    * no `channel` claim), when its **reading place** changes — the place's
    * message id while the copy holds lines behind it (`replyPacing: 'hold'`),
    * `null` once the reader is at the newest row. Never per streamed chunk; the
    * same value is never sent twice in a row. The page keeps it as client-only
    * state, and the scene follows it (`SessionCharactersV1.speakerRef`, the
    * current sprites). Core's only.
    */
   'show-line': { params: { messageId: number | null }; result: void }
   ```
   `grep -rn "show-channel" sdk/src core-catalog/src cli/src contracts/src conformance/src docs/src` and mirror any other list that enumerates request kinds.
2. `sdk/src/sessionDossier.ts` — on `SessionDossierV1`, after `settledThrough` (:369), add:
   ```ts
   /**
    * 🚧 The id of the newest loaded row the viewing user wrote; names only the viewer's own row.
    * Null: the viewer has written none of the loaded rows. Absent: a host that predates it.
    * Core's Messages reads it to catch a held reader up when they send (PLAN-visual-novel-layout §1.2).
    */
   ownNewestMessageId?: number | null
   ```
   The phrase "the id of the newest loaded row the viewing user wrote; names only the viewer's own row" is the lane brief's wording — keep it.
3. `sdk/src/widgets.ts` — `SessionCharactersV1` (:1145): add after `members`
   ```ts
   /**
    * 🚧 Who wrote the line the page shows — the line a Messages copy's reader is on
    * (`show-line`), or the newest visible line when none is shown: that member's `ref`.
    * Null when the line is nobody's in `members` (narration, a person with no persona) or
    * there is none. Absent: a host that predates it. Scene Portraits' speaker focus reads it.
    */
   speakerRef?: string | null
   ```
   and amend the published comment on `SessionCharacterV1.sprite` (:1214, today "The member's CURRENT sprite — the one on the newest line it spoke, in `spriteSet` — resolved; null when the card has no sprites.") to say it follows the shown line when the page has one, e.g. "The member's CURRENT sprite — the one on the newest line it spoke (🚧 at or before the line the page shows, when a Messages copy holds its reader's place: `show-line`), in `spriteSet` — resolved; null when the card has no sprites." Change nothing else on that type.

4. Registry `core-catalog/src/registry/widgets.ts`, the `messages` entry: three settings in group `Reading`, placed right after `showSceneMarkers` (:296-301), in this order, each with a 🚧 doc comment naming PLAN-visual-novel-layout §1.2/§1.3 and P1 (off by default):
   ```ts
   replyPacing: {
       type: 'enum',
       label: 'Replies',
       description: 'Show each reply as it arrives, or hold your place and show the next line when you ask for it.',
       of: ['follow', 'hold'],
       members: [
           { key: 'follow', label: 'As they arrive' },
           { key: 'hold', label: 'One at a time' },
       ],
       default: 'follow',
       group: 'Reading',
   },
   autoRead: {
       type: 'boolean',
       label: 'Read on by itself',
       description: 'Show the next line on its own: once its voice has finished, or after the time it takes to read.',
       default: false,
       group: 'Reading',
       showIf: { field: 'replyPacing', equals: 'hold' },
   },
   readingSpeed: {
       type: 'integer',
       label: 'Reading speed',
       description: 'Words per minute: how long a line with no voice stays before the next one comes in.',
       min: 80,
       max: 600,
       default: 220,
       group: 'Reading',
       showIf: { field: 'autoRead', equals: true },
   },
   ```
   (Check how a neighbouring `type: 'integer'` setting is spelled, e.g. `recentTurns` :500, and match it.) Labels are ★7 in the plan; descriptions are new copy — keep them, and list them in your report as copy for the owner.

### B. Layout look keys (plan §1.1) — `sdk/src/sessionLayout.ts`

- `PanelLayoutV2` (:591): `behind?: 'background' | 'backdrop'` and `behindDim?: number` beside `backing`/`opacity`/`gap`, each with a 🚧 one-line doc ("What shows behind the panels: the person's own background (absent, `'background'`) or the session's backdrop." / "Percent, 0–100, darkening the backdrop behind the panels; absent is 0."). **Inline the union — do not coin a type alias name** (a new exported name needs the owner).
- `PanelLook` (:547): the same two as **optional** fields (`behind?`, `behindDim?`) — the lane brief says optional, and making them required would break app code that builds a `PanelLook`.
- `DEFAULT_PANEL_LOOK` (:558): add `behind: 'background', behindDim: 0`.
- private `lookOf` (:1482): always fills both — `behind: p.behind === 'backdrop' ? 'backdrop' : 'background'`, `behindDim` clamped 0–100 like `opacity`, default 0. Change its return type and `DrawnLayout.look` (:1455) to `Required<PanelLook> & { gapPx: number }` so a reader gets both keys.
- Validator (:1937 block): after the `gap` check,
  `if (pl.behind !== undefined && pl.behind !== 'background' && pl.behind !== 'backdrop') errors.push("panels.behind: 'background' or 'backdrop'")` and
  `behindDim` refused unless a finite number 0–100: `'panels.behindDim: a number from 0 to 100'`. Add both to the `validateSessionLayout` jsdoc list (:1647–1656) and to the file-head comment that lists the look keys (:15). **Leave the existing `'panels: { version: 2, … backing?, opacity?, gap? }'` error strings unchanged** (tests in two repos may match them).
- Layouts are stored verbatim as JSON: no migration, no converter change.

### C. Scene Portraits speaker focus (plan §1.4)

- Registry `core-catalog/src/registry/widgets.ts`, the `scene-portraits` entry (:435) — add right after `arrangement`:
  ```ts
  /**
   * 🚧 Speaker focus (PLAN-visual-novel-layout ★2): dim every face but the one
   * who wrote the line shown (`characters.v1.speakerRef`). Off by default (P1);
   * nobody is dimmed while that speaker is not among the faces.
   */
  speakerFocus: {
      type: 'boolean',
      label: "Dim whoever isn't speaking",
      description: 'Every face but the one whose line is shown is dimmed.',
      default: false,
  },
  ```
  No `group` (its neighbours `face`/`arrangement` have none).
- `core-catalog/src/shared/ui/scene-portraits/portraits.ts`: `speakerFocus: boolean` on `ScenePortraitsSettings` (doc line), `speakerFocus: false` in `SCENE_PORTRAITS_DEFAULTS`, read in `readScenePortraitsSettings` (`typeof v.speakerFocus === 'boolean' ? … : d.speakerFocus`). `ScenePortrait.speaking: boolean` — true only when `characters?.speakerRef` is a non-empty string equal to that member's `ref`; set in `scenePortraitsOf`.
- `core-catalog/components/shared/scene-portraits/ScenePortraitsWidget.svelte`: on the root (`scene-portraits.root`, :336) `data-speaker-focus` present (`""`) only when `settings.speakerFocus` **and** at least one drawn portrait has `speaking` (so nobody is dimmed when the speaker is not on stage), else absent (`undefined`); on the member face (`scene-portraits.face` in the `portrait` snippet, :246) `data-speaking` present when `member.speaking`. Never on the `figure` snippet's faces (met people). **No CSS** — the app owns `widgets.css`.

### D. The Visual novel layout (plan §1.5)

- `core-catalog/src/registry/layouts.ts`: a new exported `STORY_VISUAL_NOVEL_LAYOUT: SessionLayoutV1` after `STORY_WORLD_LAYOUT`, with an `@internal` doc comment in the file's voice (what it is: the scene fills the window, the last two speakers stand on the session's backdrop, the story reads one line at a time in a glass box at the foot; holding is on, reading on by itself is off — P1; sides empty). Exactly:
  ```ts
  panels: {
      version: 2,
      left: [],
      middle: [
          { key: "p1", tabs: ["scene-portraits"], height: "fill" },
          { key: "p2", tabs: ["messages", "stats#characters"], height: { share: 4 } },
          { key: "p3", tabs: ["turn-line"] },
          { key: "p4", tabs: ["composer"] }
      ],
      right: [],
      backing: "glass",
      behind: "backdrop"
  },
  widgetSettings: {
      "scene-portraits": { who: "recent", recentTurns: 2, face: "sprite", arrangement: "stage", speakerFocus: true },
      messages: { replyPacing: "hold", title: "Story" },
      "stats#characters": { owners: "cast", castScope: "all", arrangement: "faces", title: "Characters" }
  },
  widgetStyles: {
      messages: { slug: systemStyleSlug("messages", "name-plate") },
      "scene-portraits": { slug: systemStyleSlug("scene-portraits", "open-stage") }
  }
  ```
  (`messages.title` and the `stats#characters` settings mirror `STORY_LAYOUT`'s same instances; `autoRead` is **not** set.) Import `systemStyleSlug` from `@serene-pub/sdk` (registry `widgets.ts` already does). Why the prefixed slug: the app seeds each core style row with slug `systemStyleSlug(widgetId, presetSlug)` = `messages:name-plate`, and `resolveStyle` matches a pin by that row slug; a shipped layout cannot know a row id. The validator only requires a non-empty `slug` string, so an unknown slug does not refuse the layout. The file-head comment says "No look keys: the defaults apply." — amend it to say this layout is the exception.
- `core-catalog/src/registry/genres.ts` (:688-689, Story's `layouts:`): add after the `world` entry
  `layout({ slug: "visual-novel", name: { en: "Visual novel" }, description: { en: "The scene fills the window: the last speakers stand on the session's backdrop, and the story reads one line at a time in a box at its foot." }, preset: STORY_VISUAL_NOVEL_LAYOUT })`, import it, and extend the `layouts` doc comment above by one clause (the Visual novel layout beside them, ★4). Touch nothing else in `genres.ts`.

## Files owned (edit only these)

- `sdk/src/widgets.ts`, `sdk/src/sessionDossier.ts`, `sdk/src/sessionLayout.ts` — the additions above only
- `core-catalog/src/registry/widgets.ts` — the `messages` and `scene-portraits` entries only
- `core-catalog/src/registry/layouts.ts`, `core-catalog/src/registry/genres.ts` (the one `layout()` entry, its import and doc clause)
- `core-catalog/src/shared/ui/scene-portraits/portraits.ts`, `core-catalog/components/shared/scene-portraits/ScenePortraitsWidget.svelte`
- `sdk-tests/`: new test files; existing ones only where an assertion lists request kinds, Scene Portraits settings, the drawn look's keys, or shipped layouts — list every existing test you change and why in your report.

w2 mirrors the three Messages settings in the widget's own reader (`MessagesWidget.svelte`); that file is w2's.

## Files readable

Anything in both repos. Useful: `sdk-tests/resolveDrawn.test.ts`, `sdk-tests/panelsV2Of.test.ts`, `sdk-tests/coreShippedLayouts.test.ts`, `sdk-tests/coreScenePortraits.test.ts`, `sdk-tests/coreScenePortraitsComponent.test.ts`, `sdk-tests/widgetSections.test.ts`, `sdk-tests/cliClone.test.ts:148`, `sdk-tests/coreGenreDefaults.test.ts`, `sdk-tests/coreStatsTies.test.ts:17-55` (the `alias` mount precedent).

## Tests (Done means)

Tests here are `node:test` files run with `tsx` from `sdk-tests/`, against the sources (not `dist`). Run one file:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test <file>.test.ts; echo test-exit=$?'`

⚠ A **component** test bundles the component, and the bundler resolves `@serene-pub/core-catalog/scene-portraits` to the **built `dist`**, which does not have your changes (nobody may build). Mount with `alias: { '@serene-pub/core-catalog/scene-portraits': resolve(CORE_CATALOG, 'src', 'shared', 'ui', 'scene-portraits', 'index.ts') }` as `coreStatsTies.test.ts` does for session-state.

1. Validator: accepts `behind: 'background' | 'backdrop'` and `behindDim` 0/55/100; refuses `behind: 'wall'`, `behindDim: -1`, `101`, `'5'`, `NaN` with the two error strings above. `resolveDrawn` look: defaults `behind: 'background'`, `behindDim: 0`; reads a stored `backdrop`/`40`; an unknown `behind` reads `background`; `behindDim` 140 clamps to 100. Put these where the existing look tests are (find them: `grep -n "opacity" sdk-tests/resolveDrawn.test.ts sdk-tests/*.test.ts`); update any existing `deepEqual` on a drawn `look` to include the two keys (list them).
2. Scene Portraits (`coreScenePortraits.test.ts`): `speakerFocus` declared (boolean, default false, the label), in `SCENE_PORTRAITS_DEFAULTS`, read by `readScenePortraitsSettings` (true/false/garbage); `speaking` true only for the member whose `ref === speakerRef`, false for all when `speakerRef` is null/absent/names nobody shown.
3. Scene Portraits component (a new file, e.g. `coreScenePortraitsSpeaker.test.ts`, with the alias): `data-speaking` on the speaker's face only; `data-speaker-focus` on the root only with `speakerFocus: true` and the speaker on stage; absent with `speakerFocus: false`; absent when `speakerRef` names someone not drawn.
4. Shipped layout (`coreShippedLayouts.test.ts`): the new layout gets its **own** test — `validateSessionLayout` has no error; `panels.backing === 'glass'`, `panels.behind === 'backdrop'`, `panels.behindDim === undefined`; `widgetSettings.messages.replyPacing === 'hold'` and `autoRead` undefined; `speakerFocus: true`; the two style pins are `messages:name-plate` and `scene-portraits:open-stage`; middle tabs as listed, sides empty. Do **not** add it to the existing list that asserts look keys undefined. Story's genre lists layouts `default`, `world`, `visual-novel` in that order (update any existing assertion that lists Story's layouts).
5. Messages settings: a node test (in a new file or the nearest existing registry test) that `CORE_WIDGETS`' `messages` entry declares `replyPacing` (enum follow/hold, default follow, group Reading), `autoRead` (boolean false, `showIf replyPacing = hold`), `readingSpeed` (integer 80–600, default 220, `showIf autoRead = true`); update any existing assertion that lists the Messages settings keys.
6. `show-line`: whatever existing test enumerates request kinds or askers (`widgetSections.test.ts`, others found by grep) passes with it, updated if it lists kinds.
7. Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit` — no new errors in your files (another lane may have its own; report any outside your files, don't fix them).

Run each touched test file. `npx prettier --check <file>` on each file you changed (report, don't reformat files you didn't otherwise change).

## Rules you work under (quoted)

- NOMENCLATURE R3 "Qualify, never abbreviate to the bare noun." · R6 "Mark vocabulary that is not permanent": every new name here is 🚧 provisional — mark the doc comments 🚧. Do **not** coin any name beyond those in this brief (`show-line`, `ownNewestMessageId`, `speakerRef`, `speakerFocus`, `behind`, `behindDim`, `speaking`, `STORY_VISUAL_NOVEL_LAYOUT`, `visual-novel`). If one collides with an existing name in code, stop and report.
- CLAUDE.md §Decisions: "Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change." Copy is given above; if you think any is wrong, keep it and say so in your report.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "0.6 is in users' hands … Removing or renaming a published SDK name is the owner's call." Additions only.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())`/`new Map()` is not reactive on mutation — use `SvelteSet`/`SvelteMap`.
- It is a **session**, never a *chat*.
- Scratch files start with `vn-A-w1-` and live in `/tmp/claude-1000/` scratch, never in the repo.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never build in this lane.)
- Never `git checkout`, `restore` or `clean` in either repo. Never `prettier --write` on a directory.
- Never pipe a test run into `head`.

## Stop and ask when

A name collides; a published SDK name would have to change; an existing test outside the listed kinds would need changing; anything here does not work as written (report the evidence and the smallest alternative, and carry on with the rest).

## Report

Write nothing to the repo as a report. Return, as your final message: changed files; tests run with pass/fail counts; every existing test you changed and why; typecheck result; anything you stopped on; Noticed, not done.
