# REPORT — vn-B (app): the Visual novel layout, 2026-11-11

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write). Four `lane-worker`s, two at a time (briefs `plans/briefs/BRIEF-vn-B-w1.md` … `-w4.md`). Nothing committed, stashed or built; no dev server; nothing in `../serene-pub-sdk` edited.

## Summary
- Every brief item (1–10, 7b) built; nothing stopped on.
- `npx tsc --noEmit -p .` clean; `npm run check` 0 errors (8 warnings, none in lane files).
- Lane tests: 88 files, 845 tests pass. Wider run of `src/lib/client/sessionLayout/` + `components/sessionPage/`: 1534/1535 (the one failure is not this lane's, see Noticed).
- Messages, Composer, Turn line, `conversationTarget.ts` unchanged. No socket listener, toast, migration or stored-layout rewrite.

## Changed files

**Look and the picture behind the panels (1, 2)**
- `src/lib/client/sessionLayout/arrangeOps.ts` — `LookPatch` gains `behind` / `behindDim`; `lookOf` fills both (`Required<PanelLook>`); `setLook` drops defaults, rounds and clamps `behindDim` 0–100.
- `src/lib/client/sessionLayout/LayoutLookSection.svelte` — **Behind the panels** (*Your background* · *The session's backdrop*), segmented `aria-pressed` group; **Dim** 0–100 range shown only for the backdrop; both through `onChange` (Undo/Cancel). Editors unchanged.
- `src/lib/client/sessionLayout/LayoutBackdrop.svelte` (new) — `aria-hidden` absolute layer, cover-fit `<img alt="">` plus dim layer `color-mix(in oklab, var(--color-surface-950) <dim>%, transparent)`; drawn only when the look says backdrop and the session has one.
- `src/lib/client/sessionLayout/SessionLayoutRender.svelte` — `<LayoutBackdrop>` first child of `.layout-body`; `has-backdrop` class turns on `.side-slot { position: relative }`; no new stacking context.
- `src/lib/client/components/host/backdropSrc.ts` (new) `sessionBackdropSrc(mediaId)`; `host/RemoteWidget.svelte` uses it (`sessionV1.backdrop` set only when the helper returns a src).

**Dialogue box reaches the app (3)** — `src/lib/server/components/core.ts`: the `"dialogue-box"` loader line.

**Own line id (4)** — `sessionPageProjections.ts`: `ownNewestMessageId` via new exported `ownNewestMessageIdOf(messages, viewerUserId)` (newest id with `role === "user"` and the viewer's `userId`; greetings carry the owner's `userId` on assistant rows, `sessions/greetings.ts:246`).

**Shown line and the stage (5)**
- `requests/showLine.ts` (new): `shownLines` (`SvelteMap` by session id, one entry), `answerShowLine`, `shownLineOf`, `clearShownLine`; refusals *show-line needs a session* · *show-line needs a message id (a whole number) or null*. `requests/index.ts`: the `"show-line"` row.
- `projections/characters.ts`: `messagesAsOf`, `speakerOf`; optional `CharactersSource.shownMessageId` / `.speakerId`; `projectCharacters` emits `speakerRef`.
- `projections/charactersSection.svelte.ts`: optional input `shownLine()` defaulting to `shownLineOf(sessionId)`; cut applied before `currentSpritesOf` / `lastSpokeOf`; speaker id a primitive `$derived`.
- `src/lib/client/sessionLayout/sessionLayoutModel.svelte.ts`: `holdsDialogueBox`; an effect clears the shown line while no `dialogue-box` is drawn, and on teardown; `oneVoice` (7b).

**One automatic voice (7b)** — same file, `dossierFor` gives each **Messages** copy `spokenPlayback: "click"` while a Dialogue box is drawn, when the page's value is `auto` or absent (`never`, `click` untouched). No Dialogue box, or Composer / Turn line: the page's own dossier object. The Dialogue box gets the page's dossier through `Panel`'s `session:full` context. Host data only.

**Shipped style pins (6)** — `src/lib/server/db/layoutPresets.ts`: private `resolveShippedPins(tx, pins)` in `copyLayoutIntoSession`; one `inArray` query on `tx`, `source = 'system'`; a slug-only pin matches only when the row's `widgetSlug` equals `widgetOfInstance(instanceId)` and becomes `{ id, slug }`; unknown slug dropped; a pin with a numeric `id` passes untouched.

**CSS and styles (7)**
- `src/lib/client/styles/widgets.css` (new rules only): speaker-focus dim at the end of `§scene-portraits` (transition only under `prefers-reduced-motion: no-preference`); new `§dialogue-box` (box, line, name plate on `messages.message-name`, bar, queued words, buttons, `sp-progress` colour, bar-wide target via Next line's `::after`, Pause `z-index: 1`, focus ring on the button, `sp-dialogue-arrive` slide-in, none under reduced motion).
- `src/lib/shared/widgets/corePresets.ts`: `SCENE_PORTRAITS_STYLE_PRESETS` in `CORE_STYLE_PRESETS` — the SDK's bare `default` plus **Open stage** (`--sp-widget-background: transparent`, `--sp-widget-border: none`, no root padding, no 40svh cap, stage clips, figure `block-size: 125%` top-anchored, name and rank hidden).

**Docs and canon (10)** — `NOMENCLATURE.md` (§9 rows 🚧 with charters: Dialogue box, reading place, `autoRead` · `readingSpeed`, Visual novel, `behind` · `behindDim`, `show-line`, `ownNewestMessageId`, `speakerRef`, `speakerFocus`, Open stage; amended backing, Arrange inspector, Scene Portraits, current sprite; §25 entry incl. internal names `oneVoice`, `shownMessageId` / `speakerId`, `shownLine`, `resolveShippedPins`, `has-backdrop`); `STYLE-GUIDE.md` (§2.8, §6.16, §6.22, §8); `docs/session-layout.md` (widgets table row, `### The Dialogue box`, Scene Portraits' setting and style, Layout settings, Story layouts); `docs/genre-story.md:36`; `docs/sessions.md` Sprites.

**Tests, new** — `sessionLayout/layoutBackdrop.dom.test.svelte.ts`; `host/backdropSrc.test.ts`; `requests/showLine.test.ts`; `sessionPageProjections.ownLine.test.ts`; `sessionLayout/dialogueBoxPage.dom.test.svelte.ts`; `components/surfaces/dialogueBoxPanel.dom.test.svelte.ts` (⚠ outside the brief's list; the test item 3 asks for, beside `panel.dom.test.svelte.ts`).

**Tests, edited and why**
- `arrangeOps.test.ts`: two `toEqual(lookOf(…))` gain the two look keys.
- `layoutLookSection.dom.test.svelte.ts`: `gapButtons()` selector scoped to the gap group (it matched the new Behind group).
- `corePresets.test.ts`: the "no packs" example moves from `scene-portraits` to `stats`.
- `projections/characters.test.ts`: "missing data" gains `speakerRef: null`.
- `coreWidgets.test.ts`: id list gains `dialogue-box`; the "reads no log" exception includes it; the title/icon/layout deep-equal skips it (no `icon` / `layout`, as `composer`, `turn-line`).
- Additions only: `requests/index.test.ts`, `sockets/components.int.test.ts`, `db/layoutPresets.int.test.ts`, `db/layoutPresets.boot.int.test.ts` (Visual novel row seeds once; a second boot leaves it equal).

## Decisions made in scope
- Slug-pin fix in the **copy**, not the store: every live session's layout row comes through `copyLayoutIntoSession`, so a resolved `{ id, slug }` reaches every reader as an ordinary pin; a person's own pins are never touched.
- Shown line keyed by session id; cleared by the layout model.
- The cut orders by **message id** (`id <= shown`); a shown line not among the loaded rows is ignored.
- `speakerRef`: with a line shown, its writer (`characterId ?? personaId`) even if hidden; with none, the writer of the newest visible loaded line on any channel; null when not in `members`.
- 7b applies to Messages copies only.
- Behind the panels is a segmented control, like Widget gap.

## Open ★
- From the plan, built, still to ask: ★6 Pause, ★7 labels, ★8 name; ★10 one automatic voice. ★9 not built.
- **★A** copy: Behind the panels help *What shows through behind the panels.*
- **★B** the line in the Dialogue box wears no Messages style (Stage, Bubbles…), only the base row plus the name plate. Recommendation: let it wear its Log's style unless pinned its own, as Composer and Turn line do (`conversationStyleSources`). Trade-off: one more widget follows another's style.
- **★C** Open stage's 125% figure crop is a guess; needs a look on a real sprite.
- **★D** "Dim" is now both the Backdrop widget's setting and the layout's.

## Noticed, not done
- `components/sessionPage/narrateDraft.dom.test.ts` fails: it regexes `src/routes/sessions/[id]/+page.svelte`, last modified 09:47 by another session.
- `src/lib/server/components/core.ts` header comment (~:11) still lists three view-only widgets.
- `docs/session-layout.md` § Spoken lines and the speech docs describe autoplay without the Dialogue box exception.
- `INTEGRATING.md` §5b still says "45 request kinds".
- Several edited files were already prettier-unclean and were left so.
- An active, unplaced `dialogue-box` is appended to the right zone after a layout switch (existing behaviour), so `holdsDialogueBox` stays true.
- `sessionV1.backdrop` is now `null` for a backdrop id that isn't a positive integer.
- Three `/tmp/serene-pub-vitest-*` dirs of unknown origin left alone.
- The lane's scope reviewer raised no substantive objection (three low findings, applied or named above).

## After the lane — the lead's grouped verification (2026-11-11)
- `npx tsc --noEmit -p .` clean; `npm run check` 0 errors (needs `NODE_OPTIONS=--max-old-space-size=8192`, the default heap aborts); `npm run build` succeeds.
- `npm run sdk:test`: 4645 tests, 5 failed on the first run. Three were this work's and are fixed: `scenePortraits.test.ts` (expects `speaking: false`), `surface.test.ts` (the seven `readingPlace` exports tagged `@experimental`), `vocabulary.test.ts` (`behind` joins `PLAIN_ENGLISH`). Still failing, other sessions': `deriveDontSpell` (turnOrder, speakMessage, three counts incl. `session-runs`), `surface` (`STORY_CREATE_SPEC_ID`, `CREATE_SESSION_PERSONA_*`), `vocabulary` (`characters`, `run`).
- `npm test`: 24414 tests, 35 failed on the first run. Three were this work's and are fixed: `sessions.layoutCopy.int.test.ts` ×2 and one `commentHistory` hit. **Change:** `resolveShippedPins` now copies an unmatched slug-only pin as it is instead of dropping it — dropping let a session's older pin survive a Start from (the existing LB test). The lane's two unknown-slug tests assert the pass-through. The other 32 failures are in files this work did not touch (replyRoad, genreFieldDefaults, importBoundary, coreRow, wiring, specHashes, narrateDraft, …).
- Not done: no walk in a running app. Nothing has been seen on screen.
