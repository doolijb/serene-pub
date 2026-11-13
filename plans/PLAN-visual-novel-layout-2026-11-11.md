# PLAN — Story "Visual novel" layout (ADV box) — 2026-11-11 — revision 2

Status: **GO from the owner 2026-11-11**. Revision 2 replaces revision 1's "new modes on Messages" with a **separate widget**, by owner ruling (§0.4). Lanes: `vn-A` (SDK: look fields, Scene Portraits — running, redirected), `vn-C` (SDK: the Dialogue box widget and the layout), `vn-B` (app).
Design page: https://claude.ai/code/artifact/ca8e4144-dfed-48b5-9da6-e210556db6f5 (design 1).
`APP` = `/home/jody/github/serene-pub`, `SDK` = `/home/jody/github/serene-pub-sdk`.

## 0. What the owner said (verbatim, 2026-11-11)

1. Asked for four visual novel layout designs for Story; sent the first draft back: "Take a closer look at popular visual novel games and try again".
2. On the second draft: "1. But let's reconcile how we choose which message is displayed. If there's more than one cast member, there may be multiple replies in sequence" — picks design 1 (ADV box).
3. On the reading-place proposal: "I say just go for it. I think your proposal works. I've voice is queued/rendering, don't auto advance until it plays through if auto is on. Otherwise calculate the number a reasonable read speed and show a progress bar before the next one slides in. Set speed and auto in the widget settings".
4. After the build began on Messages: "Ah. The visual novel should be a different widget since it functions so much differently. Not overload the normal widget" and "We can probably reuse the composer".

### Ruled (R)
- **R1** Design 1: the backdrop fills the window, the last speakers stand on it, a box in the bottom band with a name plate shows the line.
- **R2** The box shows the line being read; later replies of the round queue behind it; a control steps one message at a time; sending catches you up. The approved proposal said: "Each viewer has their own place. It lives in the browser and is not stored. Opening a session starts at the newest line."
- **R3** The stage follows the box (speaker and sprites as of the line shown).
- **R4** Auto: when on and voice is queued or rendering for the line, wait until it has played through; otherwise compute a reading time from a reading speed and show a progress bar before the next line slides in. Auto and speed are settings of the widget.
- **R5** It is a **different widget**. The Messages widget is not changed.
- **R6** The **Composer** is reused: the new widget has no input of its own.

### Recommended by the lead, not objected to — built, flagged in the report (★)
- **★1** A layout setting that draws the session's backdrop behind the panels, with a dim.
- **★2** Speaker focus on the Stage (dim whoever did not write the line shown).
- **★4** Ships as a ready-made Story layout named **Visual novel** beside **World**; Story's genre default layout is unchanged; nothing illustrates a backdrop on its own.
- **★5** Advance by the bar's button (the whole bar is the target).

### New, owner not yet asked — built, asked in the report
- **★6** A **Pause** toggle on the reading bar while reading on by itself is on, not stored. Reason: widget settings are reachable only through the layout editor, which needs advanced controls (`docs/session-layout.md:17`); a guest or a person with advanced controls off would otherwise have no way to stop an automatic action (P1; advanced-controls ruling 2026-11-10: never hide a P1 off-switch).
- **★7** Labels **Read on by itself** and **Next line**. The owner said "auto"; the labels avoid **Auto-advance** · *Next turn* (the turn order's setting on the same Story screen, NOMENCLATURE :441).
- **★8** The widget's name **Dialogue box** (id `dialogue-box`): the one candidate free in both repos and NOMENCLATURE (checked 2026-11-11; `line-box` overloads "line", `caption` is taken). Caveat for the owner: speech already uses *dialogue* for quoted speech only (**Dialogue only** under **What is read**, NOMENCLATURE :802), and code calls modals *dialogs*; the row carries a ⚠ saying the Dialogue box shows whole lines, narration included.

### Asked, not built
- **★9** Should the Composer and Turn line follow a Dialogue box as they follow a Messages? **Not built** (challenge 2, revision 2). The owner's ★11 of 2026-11-05 (`PLAN-session-layout-simplify-2026-11-05.md:33`) says: "A Composer writes to the Messages widget shown in its own zone … on a non-Messages tab it keeps the last channel shown and says *Writing to ‹channel›*." Today's owner words: "We can probably reuse the composer". Both are honoured with no change: the Composer under the Dialogue box follows the **Log** tab beside it, writes to the main channel, and says *Writing to Story*. Dropping that line for a Dialogue box would reinterpret ★11, so it waits for the owner.

### Left out
- Any change to the Messages widget (R5). The revision-1 Messages settings (`replyPacing`, `autoRead`, `readingSpeed`), `isShownLine` / `data-msg-shown` and the **Name plate** Messages style are **withdrawn**; lane vn-A undoes what it had added.
- A **Hide** control; paging inside a reply; Skip/Save/Load; any change for cards with no sprites (they stand as today: the avatar); wider sides; a channel setting on the Dialogue box (it shows the main channel); a second line of history inside the box (the full log is a Messages tab).

## 1. Mechanism

### 1.1 Layout look: backdrop behind the panels (★1) — lane vn-A (SDK), vn-B (app)
- `SDK/sdk/src/sessionLayout.ts`: two optional flat keys on `PanelLayoutV2` beside `backing`/`opacity`/`gap` (:591-599), in `PanelLook` (:547), `DEFAULT_PANEL_LOOK` (:558), private `lookOf` (:1482), validator (:1937 block): `behind?: 'background' | 'backdrop'` (absent = `'background'`, today) and `behindDim?: number` 0–100 (absent = 0).
- App: `arrangeOps.ts` `LookPatch`/`lookOf`/`setLook` (:47, :426, :449; a default value is dropped); `LayoutLookSection.svelte`: **Behind the panels** — *Your background* · *The session's backdrop*; **Dim** (shown for the backdrop), help *Darkens the picture so the panels over it are easier to read.*
- Draw: first child of `.layout-body` in `SessionLayoutRender.svelte` (:300), absolutely positioned, `aria-hidden`, cover fit, dim as a second layer; only when `behind === 'backdrop'` and the session has `backdropMediaId`. The media URL line is lifted from `RemoteWidget.svelte:153-158` into one shared helper.
- Storage: layouts are JSON stored verbatim; an added optional key survives. **No migration, no boot pass.**

### 1.2 The Dialogue box widget (R2, R5) — lane vn-C
A new core widget, `id: 'dialogue-box'`, title **Dialogue box**, `maxInstances: 1`. Purpose: read the story one line at a time. Owns: the reading place and the pace of reading. Does not own: the log (Messages), writing (the Composer), who speaks next (the turn order), speech (the server and `SpokenLine`).
- Declaration in `SDK/core-catalog/src/registry/widgets.ts` (model: Turn line :383-413, Album :1229); `coreWidgets`, `CORE_COMPONENTS`; component at `core-catalog/components/shared/dialogue-box/`; app loader line in `APP/src/lib/server/components/core.ts`.
- It makes its own `createConversation(ctx)` (as the Composer and Turn line do, `conversation.svelte.ts:80`) and renders **one** existing `SessionMessage` for the line being read (`SessionMessage.svelte:32-55` needs only the conversation and widget context). `isLastMessage` passed to it is true only for the true newest row, so Retry, Extend and swipe appear only there, as the server allows. The row's own menu, edit, pictures and `SpokenLine` come with the component, **except selection**: the selection bar lives in `MessagesWidget.svelte:384-465` (2026-11-05 D7: "The selection bar stays inside Messages at its foot"), so the Dialogue box offers no **Select for summary** — an optional, additive switch on `createConversation` or `MessageControls` that Messages never passes. It shows the main channel's rows only. It renders through `Panel`, not a conversation mount, so it declares `scopes: ['session:full']` (no core panel widget does today; without it the dossier is null). It joins the view-only component list (`widgets.ts:1691-1698`, C6 Q3: components carrying the row's verbs run on core trust).
- **Reading place** = a message id, client-only, per mount. On mount it is the newest row. Pure module `core-catalog/src/shared/ui/conversation/readingPlace.ts` (unit-tested, no Svelte):
  - **Passing rule.** When rows change: while a row follows the place and the row at the place is (a) the viewer's own line, or (b) not a message of a character or person (a change line, a marker), move to the next row. Otherwise hold: later rows are queued.
  - **Catching up.** `ownNewestMessageId` (below) greater than the place, and one of this widget's rows: the place jumps to it, then the passing rule runs, so the first reply shows at once.
  - **Next line** moves one row and re-runs the passing rule. A row removed under the place (Back, delete): the greatest remaining id ≤ it, else the newest.
- **Reading bar** under the line: who is queued (*Osk has replied* · *Osk and Bren have replied* · *3 more lines* · *Osk is writing…*), **Next line** (a real button; the whole bar is its target), the progress bar and **Pause** while reading on by itself. Nothing queued and no timer: the bar draws nothing. With no lines at all the widget draws nothing (owner R10, 2026-11-05: "don't have most widgets show placeholder text when there's nothing to show. Messages being an obvious exception").
- A new line **slides in** (a short transition on the line's part; reduced motion: none).
- Parts: `dialogue-box.root`, `.line`, `.bar`, `.queued`, `.next`, `.progress`, `.pause`. The name plate is the widget's own default look on the row's name part, in `widgets.css`.
- **Own line id.** `MessageV1` withholds `userId` by design (`SDK/sdk/src/widgets.ts:236`). The dossier carries one optional field, `ownNewestMessageId?: number | null` (`sdk/src/sessionDossier.ts`): the id of the newest loaded row the viewing user wrote. The app fills it where the dossier is built (`sessionPageProjections.ts:924-931`).
- **Shown line signal** (R3). The Dialogue box sends the host request `show-line` `{ messageId: number | null }` (declared beside `show-channel`, `sdk/src/widgets.ts`): the place when it is behind the newest row, else `null`. Sent when the place changes, never per streamed chunk.

### 1.3 Read on by itself (R4, ★6) — lane vn-C
Settings of the Dialogue box (the only two):

| Key | Label | Values | Default |
|---|---|---|---|
| `autoRead` | **Read on by itself** | boolean | `false` |
| `readingSpeed` | **Reading speed** | integer words per minute, 80–600, `showIf autoRead` | 220 |

- Pure functions in a new file beside `spokenLine.ts`: `lineSpeechPhase(...)` → `none | awaiting | speaking | ready | playing | ended | blocked`, and `readingTimeMs(text, wordsPerMinute)` (floor 1.5 s).
- The widget learns that a clip ended from `SpokenLine`'s existing host `audio` events (`SpokenLine.svelte:21-24`). If that needs an added callback prop on `SpokenLine`, it is additive and optional, and Messages passes nothing.
- It moves to the next row only when one is queued, and:
  - **Voice coming or playing** (`spokenPending` set, or the clip is playing): wait; advance when playback **ended**. A user pause holds until they resume or press Next line.
  - **No voice** (Read aloud off, playback not automatic, `canSpeak` false, no marker arrived, the marker cleared with no audio, play refused by the browser): the reading timer. It counts from when the line was shown, never ends before the line settled plus a 1.5 s grace (the marker is written just after settle), and the progress bar (`sp-progress`, STYLE-GUIDE :2303) fills over it.
  - **Stale marker cap:** a marker older than 90 s with no audio counts as no voice.
- A line is eligible to play aloud when it becomes the line being read, under the existing playback and Read aloud switches.
- **Pause** on the bar stops it for this mount until pressed again; not stored.

### 1.4 The Composer (R6) — nothing built
- The Composer and Turn line are not changed. `conversationTargetOf` (`APP/src/lib/client/sessionLayout/conversationTarget.ts:60-80`) finds the tabbed panel through `holds()` and writes to its `messages` tab with `writingTo: true`: the main channel, with the line *Writing to Story*. With no Messages placed at all the pick is null and the Composer writes to the first writable channel, so a Dialogue box also works alone.
- Message DOM ids need no work: every mount not named in `pageIds` gets a box prefix (`ComponentMount.svelte:266-270`).
- `sdk-tests/coreShippedLayouts.test.ts:39-43` requires a shipped layout's middle to hold Messages followed by a Turn line and a Composer; the shipped layout keeps a Messages tab in the same panel, so it holds.

### 1.5 Stage follows the box, speaker focus (R3, ★2) — lane vn-A (SDK), vn-B (app)
- App: `requests/showLine.ts` keeps the shown line; `charactersSection.svelte.ts:62-74` cuts the loaded messages to those at or before it before `currentSpritesOf` and `lastSpokeOf` (`projections/characters.ts:149-202`). No shown line = exactly today. Page-wide: among core widgets only Scene Portraits reads `sprite` and `lastSpokeAt`.
- SDK: `SessionCharactersV1.speakerRef?: string | null`; the published comment on `SessionCharacterV1.sprite` (`sdk/src/widgets.ts:1214`) says it follows the shown line when the page has one.
- SDK Scene Portraits: setting `speakerFocus` (boolean, **Dim whoever isn't speaking**, default `false`); `data-speaker-focus` on the root, `data-speaking` on the face. Speaker not on stage: nobody dimmed.
- App CSS: the dim rule; a built-in Scene Portraits style **Open stage** (`open-stage`): transparent panel, no 40svh cap, no padding, figures cut by the panel's foot, name and rank hidden.

### 1.6 The layout (★4) — lane vn-C
`SDK/core-catalog/src/registry/layouts.ts` + `genres.ts`: `layout({ slug: 'visual-novel', name: 'Visual novel', description, preset })`.
- Middle: `scene-portraits` (Fill; `who: recent`, `recentTurns: 2`, `face: sprite`, `arrangement: stage`, `speakerFocus: true`; style `open-stage`) · one panel with tabs `dialogue-box`, `messages` (titled *Log*), `stats#characters` (`height: { share: 4 }`) · `turn-line` · `composer`.
- Sides empty. Look: `backing: 'glass'`, `behind: 'backdrop'`. `autoRead` stays off (P1).
- Its own assertions in `coreShippedLayouts` (the listed layouts assert no look keys); the goldens file updated.
- Reaches the DB through `syncLayoutPresets` at boot; a boot test that a second boot writes nothing.

## 2. Lanes

| Lane | Repo | Owns | After |
|---|---|---|---|
| `vn-A` | SDK | `sdk/src/sessionLayout.ts` (look), Scene Portraits (`registry/widgets.ts` its declaration, `components/shared/scene-portraits/`, `src/shared/ui/scene-portraits/`), `sdk/src/widgets.ts` (`speakerRef`, the sprite comment), their tests; **undoes its revision-1 Messages edits** | running |
| `vn-C` | SDK | `core-catalog/components/shared/dialogue-box/` (new), `core-catalog/src/shared/ui/conversation/readingPlace.ts` and the speech-phase file (new), `registry/widgets.ts` (the new declaration and exports), `registry/layouts.ts`, `registry/genres.ts` (one entry), `sdk/src/widgets.ts` (`show-line`), `sdk/src/sessionDossier.ts` (`ownNewestMessageId`), optional additive switches on `SpokenLine.svelte`, `SessionMessage.svelte`, `MessageControls.svelte` and `conversation.svelte.ts` (Messages passes nothing), their tests and the enumerating tests | vn-A |
| lead | — | `npm run sdk:build` (no `vite dev` up) | vn-C |
| `vn-B` | app | `src/lib/client/sessionLayout/`, `src/lib/client/components/sessionPage/{requests,projections}/`, `sessionPageProjections.ts`, `host/RemoteWidget.svelte`, `src/lib/server/components/core.ts`, `src/lib/client/styles/widgets.css`, `src/lib/shared/widgets/corePresets.ts`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/{session-layout,genre-story,sessions}.md`, their tests | sdk:build |
| lead | — | one grouped verification: `tsc`, `check`, `sdk:test`, `npm test`, `build` | vn-B |

New names (all 🚧, recorded in NOMENCLATURE §25 by `vn-B`): **Dialogue box** / `dialogue-box` and its seven parts, **reading place**, `autoRead`, `readingSpeed`, `behind`, `behindDim`, `ownNewestMessageId`, `show-line`, `speakerRef`, `speakerFocus`, style **Open stage**, layout **Visual novel**.

## 3. Principles check
- **P1** Every new behaviour is off by default (`autoRead: false`, `speakerFocus: false`, `behind: background`); the widget is placed only by a layout or a person. The reading bar names who is queued; the progress bar shows why the next line is coming; Pause and Next line are on it.
- **P2** The Dialogue box owns the reading place and publishes it by request; Messages is untouched; the Composer still owns writing; the host owns the characters projection; Scene Portraits only reads. The layout look reads the session's backdrop and never writes it.
- **P3** Two widget settings (the owner asked for both), one Stage setting, two look settings. Who changes them: whoever arranges a layout. Without them: the default layout, unchanged.
- **P6** The Dialogue box's charter is in §1.2 and goes into its NOMENCLATURE row.
- **0.6 ruling:** no stored data or id changes; additions only to published SDK names.

## 4. Open after this build
- Cards with no sprites on the stage (stand as the avatar today).
- Whether **Hide** is wanted.
- Whether the as-of cut should be per Scene Portraits copy instead of page-wide.

## 5. Challenge answers (plan-challenger, revision 1, 2026-11-11) — binding where they still apply

1. **`isLastMessage` / `data-msg-newest` must keep meaning the true newest row — accepted.** In revision 2 the Dialogue box passes the true value to its one `SessionMessage`; nothing in Messages changes.
2. **Names collide with Auto-advance · Next turn — accepted.** `autoRead`, **Read on by itself**, **Next line** (★7).
3. **The place is dropped on mount — rejected.** The approved proposal says "Opening a session starts at the newest line."
4. **`ownNewestMessageId` is session-wide — accepted.** The widget jumps only when the id is one of its own (main channel) rows.
5. **★6 Pause was never shown to the owner — accepted.** Listed apart with its P1 reason; asked in the report.

## 6. Challenge answers (plan-challenger, revision 2, 2026-11-11) — binding

1. **The row menu leads into a selection with no way out (HIGH) — accept.** No selection in the Dialogue box; an optional additive switch hides **Select for summary**.
2. **★9 reinterprets ★11 of 2026-11-05, and doing nothing suffices (HIGH) — accept.** Not built; asked in the report with both quoted.
3. **Scopes, ids, view-only (MEDIUM) — accept.** `scopes: ['session:full']`; ids need no work; the component joins the view-only list.
4. **Placeholder text against R10 (MEDIUM-LOW) — accept.** An empty Dialogue box draws nothing.
5. **"Dialogue" is used by speech (LOW) — accept.** The name stays, with the caveat in ★8 and a ⚠ in its NOMENCLATURE row.

## 7. Found by lane vn-C (2026-11-11) — binding for vn-B

1. **S1 — the bar cannot be clicked from the component.** The host forwards `click` only from `button`, `a` and `sp-*` elements. **Next line** stays the real button; vn-B's CSS stretches it over the bar (★5 is met in CSS, no SDK change).
2. **S2 — ★10, new, owner not yet asked, built on the lead's recommendation.** Every tab stays mounted, so the hidden **Log** tab (Messages) autoplays the newest line and takes the voice from the Dialogue box; R4 ("don't auto advance until it plays through") cannot hold beside it. While the drawn layout holds a Dialogue box, the page gives each Messages copy playback data that does not autoplay; the box's shown line is the only automatic voice; a line still plays in the Log from its play button. Host data only, no Messages file edited; with no Dialogue box in the layout nothing changes. Asked in the report (it changes what the Log does in that layout).
3. Lane decisions accepted by the lead: the `paused` phase; audio with no `play` within 5 s counts as no voice; `reads` gains `layout`; the `conversation/index.ts` export line.
