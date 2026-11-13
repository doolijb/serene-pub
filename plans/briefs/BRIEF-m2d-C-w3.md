# BRIEF m2d-C-w3 — docs and vocabulary pass (NOMENCLATURE, STYLE-GUIDE, docs/)

You are a `lane-worker` in lane **m2d-C** (client + docs of build M2d). Work from `/home/jody/github/serene-pub`. Report back in your final message (no report file): changed files with the sections you touched, each new §25 row's first cell + identifier list, every §24 grep you ran and what it found, assumptions, **Noticed, not done**.

## Goal
The docs/vocabulary half of plan `~/.claude/plans/PLAN-sdk-creation-seams-2026-10-30.md` §16–§17 (lane C, worker "T"): the ★F charter pass on the M2 NOMENCLATURE rows, §25 rows for every new M2d name, §23 for the retired `appletTitle`, STYLE-GUIDE, and `docs/`. **Code is already built** (by workers w1/w2 of this lane, and lane D on the SDK/server). Describe what is built — read the code to confirm every identifier you write; never describe something not in the code. Read files by line range (`sed -n`), never whole: `NOMENCLATURE.md` is 3,384 lines, `STYLE-GUIDE.md` ~2,300.

**These three files already carry other people's uncommitted edits** (`git diff NOMENCLATURE.md STYLE-GUIDE.md docs/sessions.md` shows them). Never revert or reword lines you were not asked to touch. Use `Edit`-style exact replacements, never a whole-file rewrite.

## What was built (confirm each against the code before you write it)

Lane C (this lane):
- **Apps view** — rail view key `apps`, title _Apps_, icon `LayoutGrid`; `src/lib/client/components/sidebars/AppsSidebar.svelte`; registered in `Layout.svelte` **only while at least one applet is listed** (★N1), right after Sessions in the Play group (`rightNavOrder` and `CONTENT_ORDER`; the phone's More sheet); address `/apps` (`src/lib/client/shell/viewRoutes.ts` `VIEW_ROUTES`), a cold `/apps` with no applet listed goes Home (`appsAddressVerdict` → `"home"`); `isAppletLauncherPath` (Layout's `appletOn`: `/apps/<id>` is the launcher, `/apps` the view). The view is a card grid at `PanelSplit`'s `reading` fill width, `auto-fill, minmax(220px, 1fr)`, alphabetical, no toolbar/filter/New menu; Layout asks `sessions:genres` once and hands the cards in (`appletCards`).
- **applet card** — `src/lib/client/components/AppletCard.svelte`: one `<a href="/apps/<pluginId>">`; a 16:9 **poster** (`object-cover`; none → `surface-200-800` ground + 40px `LayoutGrid` glyph), an optional 40px square **logo** over the poster's lower-left ringed in the card's ground, the title (15px medium), `MetaLine` with the **blurb** as its lead clamped to two lines and the genre names as facts. `MetaLine` gained `leadLines?: 1 | 2`.
- **Home's Apps section** (`src/routes/+page.svelte`): after _Pick up where you left off_, before _Characters_, only while an applet is listed; 1 / 2 (640px) / 3 (900px) columns of the home container.
- **The Sessions view's Apps group is gone** (`SessionsSidebar.svelte`); `appletRows.ts` now feeds the Apps view and Home (`AppletRow { pluginId, title, poster?, logo?, blurb?, genres }`); the entry-point rule (Sessions › New › an applet genre opens its launcher; _Use the start form_) is unchanged.
- **`sessions:genres` row `appletCard?: { title, poster?, logo?, blurb? }`** replaces `appletTitle` (2026-10-31 → retired 2026-11-04), present exactly when the launcher mounts.
- **applet loading screen** — `src/lib/client/components/AppletLoading.svelte` (`STILL_LOADING_MS` 20 s): over the launcher's frame (and over a session-mounted applet frame — the `session-view` of a genre with `shape.applet` — in its slot, title only, no poster/logo, no Leave button) from mount until the frame's `ready`: poster dimmed as backdrop (`surface-100-900` ground without one), logo or title centred, indeterminate `SpProgress`, _Loading <title>…_ (`role="status"`), after 20 s _Still loading…_ — the timer changes the words only (P1); fades out over `MOTION.slow` (a still under reduced motion); a `fatal` frame error ends the loading part and shows the host's sentence (`FRAME_FATAL_SENTENCE`, `src/lib/client/components/frames/frameFatal.ts`, the same words `PluginFrame` shows — never the frame's own words) with a **Leave** button on the launcher. Leave (`AppletLeave`) and Esc work throughout. `PluginFrame` gained `onready` / `onfatal` callback props (no wire change).
- **★48** — `sessionPage/requests/navigation.ts` `answerCreateSession` refuses an undeclared field at the request (new dep `readGenreFieldKeys`), in the server's words `'<key>' is not a field of the genre '<genreId>'.` (mirrors server `declaredFieldRefusal`).
- Launcher **Leave** still returns to the Sessions view (unchanged; do not document it as going to Apps).

Lane D (SDK + server, built in parallel): its report `plans/REPORT-m2d-D-2026-11-04.md` carries its §25 row text. **Check for it first and again before you finish.** If present, land its rows as written (fix only R-rule problems, and say which). If absent at the end, write rows yourself from the code (read-only: `../serene-pub-sdk/sdk/src/appletCard.ts`, `../serene-pub-sdk/sdk/src/extension.ts` (`appletCard`), `../serene-pub-sdk/cli/src/compiler.ts` (`E_APPLET_CARD_*`, `W_SETTING_UNDESCRIBED` — grep), `src/lib/server/plugins/appletMount.ts`, `src/lib/server/sockets/sessions.ts` (`appletCard` row)) and from plan §16 C3, and say "lane D report absent; rows written from code" in your report. Write only what the code shows exists.

## Steps

1. **NOMENCLATURE.md** — read §1 (lines 29–65), §23 head (1390–1400 and one example row), §24 (1580–1592), §25's head and its last rows (`grep -n "M2a\|M2b\|M2c" NOMENCLATURE.md`, ~lines 3140–3166), §26 Shell (3168–3200), §22 Icons (`LayoutGrid` row ~1249).
   - **★F charter pass**: each M2 row in §25 (the rows whose last cell names M2a/M2b/M2c — about 25 rows, 3141–3165) gains its charter **in the row**, briefly (one short clause each, ≤ ~40 words total per row): *purpose · why it exists · what it owns · what it does not own (and who does)*. CLAUDE.md P6: *"Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row."* Append it to the row's identifier cell as `**Charter:** purpose …; owns …; not …` — or follow the format if §25 already has a charter convention (grep `Charter` first). Do not rewrite the rows' existing text.
   - Update the **applet** row (3163): the Sessions view's Apps group → the **Apps view** (append an "⚠ 2026-11-04 M2d:" note; don't delete history).
   - **New §25 rows** (🚧, dated 2026-11-04, last cell `M2d (lane C), 2026-11-04 (plan §16 C1/C2/C4, ★48)`), one row per concept, each saying what it is **not** where a neighbour exists (§24 rule 5): **Apps view** (`apps`; not the launcher; not "app" = Serene Pub; UI label per §24 rule 6) · **applet card** (not a session card `SessionCardItem`, not a genre) with **poster**, **logo**, **blurb** (blurb = the same sense as §5.2's section-row blurb: one short descriptive line; poster ≠ a lorebook cover / character portrait; logo ≠ a service logo in §22) · **applet loading screen** (not `LoadingState`, not `ShellLoading`; ends on `ready` only) · `PluginFrame` `onready`/`onfatal` + `FRAME_FATAL_SENTENCE` · `MetaLine` `leadLines` · ★48's request-time field check · the `sessions:genres` **`appletCard`** row (and the SDK `appletCard` declaration block, lane D) · lane D's names. **§24 grep before each new word**: `grep -rniw "<word>" src ../serene-pub-sdk/sdk/src ../serene-pub-sdk/cli/src src/lib/server/db/schema* | head` and record the result in your report.
   - **§23 Retired words**: add `appletTitle` (sessions:genres row, 2026-10-31 → 2026-11-04, replaced by `appletCard`) in the section's own row format; and the Sessions view's **Apps group** (replaced by the Apps view).
   - §22 Icons: if the nouns table lists views with icons, add Apps → `LayoutGrid` (note it is also the lenses' cards icon — read the "Resolved collisions" subsection and say there if a collision rule applies; if unsure, put it under "Needs an icon"/ask in your report instead).
   - §26 Shell: if it lists the rail's views, add Apps.

2. **STYLE-GUIDE.md**:
   - §5.1 (line ~432): the **Play** group lists _Sessions, Apps (only while an applet is listed), Characters …_.
   - §5.2 fill widths (~line 541): add the Apps view to the `reading` card-grid list.
   - §6.4: replace the 🚧 Apps-group sentences inside the session-row paragraph (~lines 870–878, from "🚧 Above them, **Apps**" to "the group is absent when empty.") with a short paragraph of its own after the session card paragraph: the **applet card** (anatomy as built, the `auto-fill, minmax(220px, 1fr)` grid off the pane's width, the Apps view and Home's section, a press opens the launcher; Leave + Esc / `AppletLeave` keep the text that was there).
   - §6.7: the **applet loading screen** beside `LoadingState`/`ShellLoading` (one short paragraph).
   - §8: one clause noting the loading screen's fade (`MOTION.slow`, still under reduced motion) and that no timer ends it.
   - §11: unchanged unless a rule moved (it did not).

3. **docs/** (user-facing, plain words, "session" never "chat", "app" means Serene Pub — say "Apps" for the label and "a plugin's game"/"applet"-free prose as the existing text does):
   - Move `docs/sessions.md` `### Apps` (lines ~327–341) to `docs/getting-around.md` as an **Apps** section (pick the right heading level and place — near the rail/views text; read the file's headings) describing: the Apps view (in the rail after Sessions, only once a plugin with a game is installed), the cards (picture, logo, one line, the session types), Home's Apps section, the loading screen (_Loading …_, _Still loading…_ after a while, Leave/Esc work while it loads, a game that fails says so and offers Leave), then the existing text about Leave/Esc, New game/Continue/Load, saves as ordinary sessions, and the entry-point rule (**New** › the game opens its own screen; **Use the start form**). In `sessions.md` leave one sentence pointing to the new section (Load opens this list showing only the game's sessions — keep that fact in sessions.md where it describes the list).
   - Fix every link to `sessions.md#apps`: `docs/getting-around.md` line ~173 (and grep `-rn "sessions.md#apps\|sessions#apps" docs ../serene-pub-sdk/guides`). Also that paragraph: "opened from **Apps** in the Sessions view" → the Apps view. Anchors are GitHub-style slugs of the heading (`## Apps` → `#apps`). **Do not run `npm run docs:build`** (it writes `src/lib/generated/**`, outside this lane's files); the lead runs it. Check links by grep.
   - `docs/plugins.md` "## Pictures, sound and data that come with a package" (line ~44): the art a package may declare for its game's card — a 16:9 picture (1280×720 recommended; the card crops, nothing checks the ratio), an optional square logo, and a one-line description (at most 160 characters) — confirm the limits and the manifest key against lane D's code (`appletCard` in the SDK) before writing them; if the code differs, follow the code and say so.
   - **No C5 sentence** (applet code running only while open — HELD by the owner). Nothing about ★34 Restore or ★50. No CHANGELOG file exists; write none.

## Files owned (edit only these)
`NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/sessions.md`, `docs/getting-around.md`, `docs/plugins.md` (and any other `docs/*.md` only to fix a link to `sessions.md#apps`).
## Files readable
Everything (code read-only).
## Out of scope — never written
C5 / ★N4, ★34, ★50, ★39, ★47, C6 Resume; anything not built; renaming any existing term; reflowing or rewording paragraphs you were not asked to touch; `npm run docs:build`.
## Stop and ask when
A name you need is not in the list above or in lane D's report; the code contradicts this brief; a §24 grep finds a collision (record it, write the row with a ⚠ note, and flag it — do not rename anything).
## Done means
All edits made; `grep -rn "sessions.md#apps" docs` returns nothing stale; `grep -n "appletTitle" NOMENCLATURE.md STYLE-GUIDE.md docs/*.md` shows only historical/retired mentions; `npx prettier --check` is NOT required for these Markdown files (record whether each passed before and after, without `--write`).

## Rules you carry (quoted from the documents; they bind your work)

**Verbatim (every implementation brief):**
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You have no reason to run `sdk:build` in this task.)

**Working tree:** many files under `src/` already carry other lanes' uncommitted edits (e.g. `src/routes/sessions/[id]/+page.svelte`). Never revert, reformat or "clean up" anything you did not write. Never `git checkout`/`restore`/`stash`. Edit only the files listed under Files owned.

**CLAUDE.md (quoted):**
- P1 *"Deterministic, never hidden. Code decides what code can; the model only judges. Same inputs, same result."*
- P3 *"Few settings … A setting must answer who changes this, why, and what breaks without it — no answer, no setting."* → no new setting, no toggle.
- Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."* · *"Say each assumption when you make it."*
- Standing rulings: *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."* · *"Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."*
- Hard rules: *"`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."* · *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* · *"It is a **session**, never a *chat*."*
- Reading discipline: read line ranges (`sed -n`), never a whole large file. `Layout.svelte` (3,680 lines) and `src/routes/+page.svelte` (3,700+) are large.

**NOMENCLATURE (quoted):** R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not type names · R6 mark 🚧 provisional vocabulary. §24: *"Grep for it first — across `src`, the SDK, and the schema … Say what it is **not**, in the declaration, if a near-neighbour exists … UI labels are prose and need not match internal names — but must not contradict them."* — "app" means Serene Pub; **applet** is the plugin-provided thing in code; the UI label is **Apps**. New names in this build (all 🚧, use exactly these, invent no others; if you need another, stop and say so in your report): **Apps view** (rail view key `apps`), **applet card** (`AppletCard.svelte`), **poster**, **logo**, **blurb**, **applet loading screen** (`AppletLoading.svelte`), `appletCard` (the `sessions:genres` row field). Mark new code comments `🚧 M2d`.

**STYLE-GUIDE (quoted):**
- §2.3/§2.7: colour by role and stop (`surface-200-800`, `text-surface-600-400`), never a hex.
- §2.4: focus *"`outline-2 outline-primary-500 outline-offset-2`"*; *"Hover on a row `surface-200-800`"*.
- §3.2: *"The table is closed … A component never writes `text-[11px]`, `text-[13px]` or `text-[15px]`"*: `text-meta` 11 · `text-xs` 12 · `text-chip` 13 · `text-sm` 14 · `text-lead` 15 · `text-base` 16.
- §4.1: *"Radii are tokens, not literals … `rounded-container` (12px) Cards … new code never writes a bracketed radius."* `rounded-lg` 8px, `rounded-base` 10px.
- §5.2: *"A view's root is `flex h-full min-h-0 flex-col` with `ViewModeTracker` observing it (`use:vm.observe`), and nothing more. No padding on a view root: `PanelSplit`'s panes own the 16px."* · *"`PanelSplit`'s `toolbar` snippet pins the view toolbar above its `list` snippet, which is the scroller … a view writes no `min-h-0 flex-1 overflow-y-auto` wrapper and no margin under its toolbar."* · *"every list view passes `listFills`, and the list alone takes the view … centred at `fillWidth` … **`reading`**, 1120px, for a card grid"*.
- §5.3/§11: *"Responsive rules query the `view` container, never the viewport"*; *"No horizontal scroll at 399px, at Half or in Focus."*
- §6.4 meta line: *"`MetaLine` … **muted** (`surface-600-400`) … An optional **lead** (`children`) comes first at 13px … the **facts** (`items`) follow at 12px and are never cut … joined by ` · ` and never by hand."*
- §6.7: *"Loading is `LoadingState` … never bare _Loading…_ text and never a blank pane."*
- §8: *"There are no entrance animations on load, no hover transitions on every card … Respect `prefers-reduced-motion` on anything longer than 150ms. Durations come from `src/lib/client/utils/motion.ts` (`MOTION.fast` 130, `base` 180, `slow` 220, `motionDuration()` honours reduced motion): a component never writes a literal `duration` … Progress is `SpProgress` (`hostElements/SpProgress.svelte`) … inside a `text-primary-500` wrapper (the bar is `currentColor`); an unknown amount passes `value: null` (its indeterminate third)."*
- §9: *"Every interactive element is a real `button`, `a` or input with an accessible name … Never an interactive inside an interactive … Nothing is hover-only … Targets are 44px on touch."*
- §10: sentence case; a button says what happens; it is a session, never a chat.

**Skeleton v5:** before using any Skeleton component: `grep -n "^# <Name>" /home/jody/github/serene-pub/AI-TEMP/skeleton-llms-svelte.txt` then `sed -n` that section only. (You likely need none.)

**Tests:** run only your targeted files: `cd /home/jody/github/serene-pub && npx vitest run <file> …`. *Never pipe vitest into `head`* (the SIGPIPE leaks PGlite temp dirs). `*.dom.test.ts` for components, `*.test.ts` for pure modules; copy the setup of a neighbouring test of the same kind. Do not run svelte-check, tsc, `npm test` or build — the lead runs them. Run `npx prettier --check <file>` on every file you changed. `npx prettier --write` only on files you CREATED. For an existing file, first record whether it passed `--check` before your edit (run it before you start); if it did, keep it passing by fixing your own lines by hand; if it already failed, leave it failing and say so — never reformat other people's lines.
