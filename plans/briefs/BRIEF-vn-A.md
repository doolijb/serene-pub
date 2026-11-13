# BRIEF — vn-A: the Visual novel layout, the SDK half

Design: `plans/PLAN-visual-novel-layout-2026-11-11.md`. Read **all** of it, including §0 (the owner's words), §5 **Challenge answers** if present (binding), and the names in §2. GO from the owner 2026-11-11. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions may be editing this repo's other areas; touch only your files.

You work in the **SDK repo**, `/home/jody/github/serene-pub-sdk`. Read the relevant steps of `INTEGRATING.md` there (the widget, dossier and host-request sections) before changing contracts; read `NOMENCLATURE.md` §1 and §24 in the app repo before using any name. The names in the plan are decided; do not coin others — if one collides in code, stop and report.

## Goal (plan sections in brackets)

1. **Look fields [§1.1].** `sdk/src/sessionLayout.ts`: optional `behind?: 'background' | 'backdrop'` and `behindDim?: number` (0–100) on `PanelLayoutV2`, `PanelLook`, `DEFAULT_PANEL_LOOK` (`'background'`, 0), the private `lookOf`, and the validator (errors in words, in the style of the neighbouring `backing`/`opacity` checks). `DrawnLayout.look` carries them.
2. **Messages: hold my place [§1.2].**
   - Settings `replyPacing`, `autoRead`, `readingSpeed` in `core-catalog/src/registry/widgets.ts` (group `Reading`, `showIf` as the plan's table), mirrored in `ConversationSettings`, `CONVERSATION_DEFAULTS`, `readConversationSettings`.
   - Pure module `core-catalog/src/shared/ui/conversation/readingPlace.ts`: the passing rule, catching up, Next, a removed row, the queued summary (who has replied, who is writing). No Svelte, fully unit-tested.
   - State on `conversation.svelte.ts`; `SessionContainer.svelte` draws rows up to the place in `hold`; `isLastMessage`, `item.isNewest` and `data-msg-newest` keep meaning the **true newest row** (challenge answer 1, binding); add `isShownLine` / `data-msg-shown` for the line being read, and key hold-mode playback on it. `follow` behaves byte for byte as today.
   - The reading bar and its parts (`messages.reading-bar`, `-next`, `-queued`, `-progress`, `-pause`), drawn only in `hold` and only with something queued (or Auto's bar running). The whole bar is the target; **Next line** is a real button with an accessible name.
   - `sdk/src/sessionDossier.ts`: optional `ownNewestMessageId?: number | null`, documented as "the id of the newest loaded row the viewing user wrote; names only the viewer's own row". The widget reads it and jumps only when that id is one of this copy's own rows (challenge answer 4); the app fills it (lane vn-B).
   - Host request `show-line` `{ messageId: number | null }`, declared beside `show-channel` in `sdk/src/widgets.ts` and sent by the **primary** Messages only, when the place changes: the place when behind the newest row, else `null`. Not per streamed chunk.
3. **Auto next [§1.3].** `lineSpeechPhase` and `readingTimeMs` in `messages/spokenLine.ts` (pure, table-tested); `ended` through `SpokenLine.svelte`'s `onPlayback` into `conv.speech`; the Auto controller on the conversation model with the rules in §1.3 exactly (voice coming or playing waits for **ended**; a user pause holds; no voice uses the reading timer from when the line was shown, never before settle + 1.5 s; a marker older than 90 s with no audio is no voice; the progress bar is `sp-progress`); **Pause** on the bar, not stored. In `hold`, a line is eligible to play aloud when it becomes the line being read.
4. **Scene Portraits [§1.4].** `SessionCharactersV1.speakerRef?: string | null` in `sdk/src/widgets.ts`, and amend the published comment on `SessionCharacterV1.sprite` (:1214) to say it follows the shown line when the page has one; setting `speakerFocus` (boolean, label **Dim whoever isn't speaking**, default `false`) in the registry, `ScenePortraitsSettings`, its defaults and reader; `ScenePortrait.speaking`; `data-speaker-focus` on the root and `data-speaking` on the face. Nobody dimmed when the speaker is not on stage. No CSS here (the app owns `widgets.css`).
5. **The layout [§1.5].** `core-catalog/src/registry/layouts.ts`: the `visual-novel` preset exactly as the plan lists it; `genres.ts`: `layout({ slug: 'visual-novel', name: 'Visual novel', description, preset })` after `world`. The style pins name the app's style slugs `name-plate` (Messages) and `open-stage` (Scene Portraits) — verify how a core layout pins a style on an instance (`widgetStyles: { [instanceId]: { slug } }`) and that an unknown slug at validation time does not refuse the layout; if it does, stop and report.

## Files owned

- `sdk/src/sessionLayout.ts`, `sdk/src/widgets.ts`, `sdk/src/sessionDossier.ts` (the additions above only)
- `core-catalog/src/registry/widgets.ts` (the Messages and Scene Portraits declarations only), `core-catalog/src/registry/layouts.ts`, `core-catalog/src/registry/genres.ts` (the one `layout()` entry)
- `core-catalog/components/shared/messages/`, `core-catalog/components/shared/scene-portraits/`
- `core-catalog/src/shared/ui/conversation/`, `core-catalog/src/shared/ui/scene-portraits/`
- `sdk-tests/` files for these (new, and existing ones updated only where an assertion lists settings, parts, request kinds or shipped layouts; list each update)
- SDK guides only where an existing list of Messages settings, host requests or widget parts would now be wrong

## Out of scope (write down, never build)

- Anything in the app repo: the look UI, the backdrop layer, `showLine` host state, the characters projection, CSS, style presets, NOMENCLATURE, docs (lane vn-B).
- A Hide control; paging inside a reply; any change for cards with no sprites; wider sides; a keyboard shortcut for Next beyond the button's own.
- `npm run sdk:build` (the lead builds).

## Stop and ask when

CLAUDE.md §Decisions applies; a plan name collides; a published SDK name would have to be removed or renamed; the style-pin question in Goal 5; anything in §1 turns out not to work as the plan claims (report the evidence, propose the smallest alternative, and continue with the parts that do not depend on it).

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a directory.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Never `npm run sdk:build` (the lead builds). Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Never pipe vitest into `head`. Heavy SDK DOM tests run in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`. Find how SDK tests are run for single files (the app's `npm run sdk:test` script) and run only your targeted files.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Never read state a method writes inside an effect-called store method without `untrack`.
- It is a **session**, never a *chat*.
- Scratch files start with `vn-A-`.

## Done means

- Targeted tests pass: the validator (accepts and refuses the look keys; look defaults in `resolveDrawn`); `readingPlace` (hold after own line, queue, Next, change lines pass, catching up, removed row, newest-first, no own id); `lineSpeechPhase` / `readingTimeMs` tables; the conversation component (defaults and readers; Next shows exactly one more line; Auto waits while speaking, advances on ended and not on pause, runs the timed bar with no voice; `follow` unchanged); Scene Portraits (`speakerFocus` declared and default; `speaking` only for `speakerRef`; attributes); widget parts; the new shipped layout validates, and `coreShippedLayouts` covers it with its own assertions.
- Typecheck clean for your files (the SDK packages' own `tsc`).
- **Report:** `/home/jody/github/serene-pub/plans/REPORT-vn-A-2026-11-11.md` — changed files, tests run with results, every existing test you updated and why, the exact shapes lane vn-B must implement against (the request payload, the dossier field, `speakerRef`, the look keys, the style slugs, the part names and data attributes the CSS must target), open ★, **Noticed, not done**.
