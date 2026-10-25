# REPORT — polish lane A ("the stage"), 2026-10-24

L1, L2, L3 with ★R1 and ★R3 as approved. Nothing committed; no dev server/browser.

## What changed
### SDK (`../serene-pub-sdk`)
- `core-catalog/src/registry/widgets.ts`: `lineWidth` = column | full | comfortable, default **column**, each with a one-line description.
- `components/shared/messages/MessagesWidget.svelte`: `LineWidth` + `CONVERSATION_DEFAULTS.lineWidth = "column"` (stored settings hold deviations, so unset → Column; a stored `comfortable` stays). Back · Forward strip removed (the composer's "turns ahead" note stays).
- `SessionContainer.svelte`: no scene chip on the line its divider names; "Start a new entry" row removed → `startsEntry` on the last scene of a completed entry, passed to the divider; "Next:" marker `hidden` on other lanes.
- `SceneDivider.svelte`: `startsEntry` puts "Start a new entry" first in ⋯ (drawn even for non-editors; editor items still gated). Facts title names who speaks.
- `TurnLine.svelte`: pill only while a reply is live or failed; Review stays; at rest nothing (no "replied", no "Last run stopped", no Inspect run). Timing moved to `conversation.svelte.ts` (`runTook`).
- `MessageControls.svelte`: newest reply's ⋮ shows `message-options-run` "Replied · N s" when this view timed it (Inspect run lives there).
- `SessionComposer.svelte`: Actions ▾ in the footer after the persona; retrieval notice host at the start of `composer-footer-end`; `composer-disclosure-bar` removed (chips row opens above the card only while open).
- `MessagePartsView.svelte`: a fold is drawn only with non-empty text/items.
- `guides/widgets.md` regenerated: removed composer-disclosure-bar, history-start, rewind*, turn-line-inspect, turn-line-panel-inspect; added message-options-run.
- `sdk-tests/coreConversationComponent.test.ts`, `rewindStrip.test.ts` updated.
### App
- `styles/widgets.css`: Column `--sp-measure: min(100%, calc(76 * 0.58 * 17px * var(--sp-prose-scale, 1)))`; Comfortable's rules now `:is(comfortable, column)`; strip + Inspect CSS dropped; footer one row (wraps only for the first-time notice line); Actions toggle = 32px footer pill; `message-options-run`; `data-vectors="current"` hidden.
- `sessionLayout/messageLayouts.css`: open fold has no box (text indented under the glyph); ⋮ hover-reveal under `(hover:hover) and (pointer:fine)` except `[data-msg-newest]`/open menu; divider faces hidden; dead `history-start` rule removed.
- `src/lib/shared/widgets/corePresets.ts`: Stage = one card on `normal` (`--sp-stage-card` light-dark 200/800 @70%), radius 12, padding 16, turn bar `--sp-stage-turn`, ring `--sp-stage-ring`; grid `"avatar identity controls" / "avatar content content"`; avatar 3rem; name 15/600 ink; hover fill removed; scene edge trailing. Bubbles/Compact/Cameo speaker colour gold → ink.
- `components/Header.svelte`: Back/Forward icon buttons (Undo2/Redo2) first in the right cluster, `aria-disabled` + title + sr-only reason; `.sp-head-row` max-width follows Column.
- `src/routes/sessions/[id]/+page.svelte`: builds `openSessionCtx.rewind` (keyed string; cleared on destroy); `data.hasGeneratingMessage` fix. `src/app.d.ts`: `OpenSessionCtx.rewind`, `SessionHeaderRewind`.
- `sessionPage/RagNotice.svelte` + `ragNotice.ts`: line once per device per session (`RETRIEVAL_NOTICE_READ_KEY`, capped 200), then an icon (`aria-expanded`, title = sentence); × collapses; owner-hidden = EyeOff + sr-only.
- Tests: `widgets.fill.test.ts` (Column; selector split respects parentheses), `ragNotice.test.ts`, `ragNotice.dom.test.ts`, `headerNotice.dom.test.svelte.ts`.
- Docs: STYLE-GUIDE §3.4, §6.13, §6.16 rows, "One calm message shape" paragraph, §6.18; docs/session-layout.md (×3), docs/sessions.md, docs/embeddings-and-rag.md; NOMENCLATURE §25 (Column = a Line width value; the notice's × is "collapse").

## Did differently / skipped
- **Gold for the waiting speaker: skipped** — rows carry no "whose turn" state; not invented.
- **"Start a new entry" in the composer's Actions: skipped** — the widget has no Actions menu of its own.
- **Column width ≈ 750px prose (≈805 with gutter), not the plan's ~980px.** A bare `76ch` measures the UI font (≈ Comfortable); written out as 76 × Literata's 0.58em × 17px × text size. 980px would be ~120ch. To widen: raise 76 or set `--sp-measure` in Stage. ★ decide at the walk.
- Card tint per the brief (800@70%, ring 700; light 200/300), not ★R3's literal 900/800.
- Divider faces hidden by CSS (names in the facts tooltip); summary status + drag grip still show when they apply.
- The turn bar marks every person's line (no "mine" attribute on rows).

## Tests (verbatim)
- `npm run sdk:build`: exit 0 (second run: 0 errors, 6 warnings).
- `npm run sdk:test`: tests 3876 · pass 3875 · fail 1 — `sceneSettings.test.ts` "genre() refuses a place that names no slot the genre declares": fails alone too; `sdk/src/genres.ts` modified 00:44, before this lane (owner's uncommitted edit). First run also had a one-off `plugin.test.ts` IPC deserialize error; passes alone.
- App vitest (17 files): Test Files 17 passed (17) · Tests 206 passed (206).
- svelte-check --threshold error (5.5 GB heap): COMPLETED 10324 FILES 0 ERRORS 7 WARNINGS.
- tsc --noEmit -p .: 1 error, `arrangeCanvas.dom.test.svelte.ts(11,25) TS2614 NARROW_SIDE_PX` (pre-existing).

## Visual walk
Column beside `0.5.3/chat-group.png` (header name aligned with first card) · card tint dark/light, with backing/background art · trailing scene edge · secondary turn bar in light · header at 412 (Back, Forward, panels, Settings, Layout, hide) · composer footer at 1440/412 in classic, minimal, quill · RagNotice line → icon → × · ⋮ hover-reveal (newest always visible) · folds without box; narration's centred card; Lair roll/table asides · scene divider row with "Start a new entry" in ⋯; no scene chip on the first line.

## Verification-walk fixes (main session, 2026-10-24)
- `Header.svelte`: the mirrored lead spacer (`.sp-head-lead`) now shrinks before the name (`flex: 0 999`), so at 1440 the name stays whole; a new `@container sp-head (width < 960px)` rule hides the genre, clips the cast to one face and keeps the name ≥6rem — at Half the name was ellipsized to nothing beside the full cluster.
