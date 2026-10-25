# PLAN — 0.5 polish parity (audit of 0.5.3 vs the 0.6 WIP branch)

_2026-10-24. Status: BUILT (lanes A–E, same day; ★R1–R4 as recommended); verification walk done on the fixture instance, dark + light, 2560/1440/412; grouped test run see §7. Owner-word items are collected in each REPORT-polish-lane*-2026-10-24.md. Owner asked: note what 0.5 did better (cleanliness, readability, pleasant on the eyes), plan how to bring 0.6 closer to 0.5's feel, polish and minimalism, and draft designs on the canvas._

Evidence: 0.5.3 is the tag `v0.5.3` (read-only worktree at `../serene-pub.worktrees/v0.5.3`) plus its
shipped screenshots in `docs-assets/screenshots/`. The current branch was walked on an isolated
instance seeded from the committed 0.5.3 fixture (`src/lib/server/db/fixtures/0.5.3`), Lamplight,
no background, at 2560×1440 and 412×915. Side-by-side set:
`<scratchpad>/audit/{0.5.3,current}/`. Design canvas: see the Artifact link in the session recap.

Nothing in this plan changes behaviour; it is rest-state look, chrome weight and copy. It is also
bound by existing rulings: no pixel-perfect proofs ([no pixel-perfect widget styling yet]),
genres pin settings and mechanisms stay in the SDK/widget API, formats belong to widgets, Lamplight
is the house theme (§2.2), style packs skin `.sp-msg` and never reach the folds (§6.13).

---

## 1. What 0.5.3 did better

Each item names the 0.5 trait, what the WIP does instead, and the cost. "Better" here means
quieter, fewer competing voices, easier to read; not more capable.

### 1.1 One row of chrome, then the story
- **0.5:** a 40px header (bare icons left and right, centred brand) and then messages. The chat
  column was a 50% slab, side panels 25% each, 8px gaps, all one indigo family. Chrome was about
  4% of the height.
- **WIP stage (`/sessions/5`):** six stacked rows before the first message: the session header
  (title · cast · genre · Settings · Layout · collapse · Jump), the Back/Forward row, "Start a new
  entry", the scene marker row, then the first message repeats the scene as a chip beside the name.
  Under the log: a "replied" pill + "Inspect run", an "Actions" disclosure, a retrieval notice with
  "Show again", and the composer with its own persona row. Chrome is about 18% of the height.
- **Cost:** the eye has to find the prose. Every one of those rows is a feature 0.5 lacked, but
  they are all shown at once at rest.

### 1.2 Messages were one calm shape
- **0.5:** every message was the same tinted card (`preset-filled-primary-50-950`, `rounded-lg`,
  no border), a 64px round ringed avatar, a bold display-face name in ink, no timestamp, 12px
  between cards. Actions were one kebab, always in the same spot. Italic action text sat one step
  lighter than dialogue, dialogue in the tertiary tint. User and character looked alike; the log
  read like a script.
- **WIP:** the default pack draws character turns bare (no card) and the user's turn in a boxed
  card, so the log alternates between two shapes. The name is set in gold (primary) at 13px, with
  a green sparkle glyph after it, a time at the far right, a kebab, and a "Reasoning" fold row on
  every reply. The avatar is 32px. Body prose is 17px serif, so three type voices (gold sans name,
  serif body, 12px sans meta) share each message.
- **Cost:** gold on every name means the accent no longer points at anything; the asymmetric card
  makes the user's line look like an alert; the fold row costs a line per message even collapsed.

### 1.3 Colour said one thing at a time
- **0.5:** hamlindigo's pale-indigo primary, filled blue only for New, green for Update, red for
  Delete, a gold star for the default. Everything else was a surface step. The one bright thing on
  a screen was the thing you could do next.
- **WIP:** Lamplight's gold is on New, Fix, Start, Open session, Send, the "All" filter chip, the
  active rail item, "Your turn" pills, the focus ring and link text. Connections shows eight rows
  of bold red "Not working"/"Not reachable". Two orange/red beta lines head Home and the wizard.
  Two red error toasts sat on every screen of the walk for twenty minutes.
- **Cost:** nothing is quiet, so nothing is loud. A fresh user's first screen says "warning"
  three times before "Evening, admin."

### 1.4 Reading measure
- **0.5:** the chat column was 50% of the window (about 980px at 2560), roughly 120 characters at
  14px; at 1440 about 100.
- **WIP:** `lineWidth` defaults to Full (§3.4): at 2560 a line runs about 1350px, 180+
  characters of 17px serif. "Comfortable" (640px) exists but is off by default and is narrower
  than 0.5 ever was.
- **Cost:** long lines are the single biggest readability regression at desk width.

### 1.5 Forms and settings were short
- **0.5:** a settings card was a title, one sentence, a switch. The sampling panel was label,
  slider, min/value/max. The connections panel was one dropdown and a short form.
- **WIP Settings → User:** every card has a title, two sentences of help, then the field label
  repeated ("Language" twice, "Time zone" twice), then a third sentence under the control. Sampling
  keeps 0.5's shape but adds a hint line under every slider and a "n of m sent" count per group.
- **Cost:** the page is three times taller for the same six decisions; the labels say the same
  thing twice.

### 1.6 Lists were two lines and a face
- **0.5:** rows were tonal cards, a 64px avatar (stacked for groups), a bold name, one muted line,
  one kebab. No selected state, but nothing else either.
- **WIP:** rows are name (15px) + italic preview (12px) + date + a status dot + a kebab, avatars at
  40px. Characters default to a 3-up card grid in a 400px column.
- **Cost:** the date and the dot repeat the "Your turn" group label above the row; the italic
  preview and the name compete.

### 1.7 No voids
- **0.5:** a panel was always full: the list was the panel. The chat stayed in the centre.
- **WIP Focus (`/sessions`, `/characters`):** a 340–400px list and a 2000px empty pane reading
  "Pick a session, or start one." Lorebooks avoids this by centring its list; the other list views
  do not.
- **Cost:** the first thing a wide screen shows after a click is an empty field.

### 1.8 Phone header
- **0.5:** hamburger, title, two icons; 18–20px type in panels.
- **WIP:** "Ord…" (truncated title), cast stack, five icons, the Jump button: seven targets in 412px.
- **Cost:** the session's name is the first thing lost.

### 1.9 Small things 0.5 did
- Disabled buttons at 40% + grayscale, press scale 0.98, 130–220ms fades (WIP keeps most of this).
- The home hero: one card, a logo, a tagline, a dismissible beta banner in gold, not a warning.
- Panel titles at `text-lg`, never a breadcrumb; "Chats" was the whole header.
- The message kebab opened one menu with five verbs; the WIP's `⋯` on the scene row, on the message,
  on the composer and on the view header are four menus with four vocabularies.

## 2. What the WIP does better (keep, and style around)
The rail with groups and the wide/narrow toggle; Jump; Dock/Half/Focus with the width switch; the
"Pick up where you left off" cards; the serif prose and the two-tone quote/action colours; optional
timestamps and folds; the admin overview; the wizard; the scene markers; the cast stack in the
header; Back/Forward history. None of this goes. The plan hides, groups and recolours; it removes
nothing a person can do.

---

## 3. Plan

Lanes are independent unless noted. Each has an acceptance line that is a screenshot judged
"decent" against the matching 0.5 frame, dark and light, at 1440, 2560 and 412 — no goldens.

### L0 — Rulings needed before L2/L3/L4 (★ owner)
- ★R1 **Default measure.** Make `lineWidth` default to a new **Column** value: `min(100%, 76ch)` of
  the body size (about 980px at 17px, which is 0.5's 50% slab at 2560), centred, composer the same
  width. Keep Full and Comfortable as choices. Recommended: yes, Column by default.
- ★R2 **Gold is for the next action.** One filled-primary control per screen region (the view's New,
  the composer's Send). Status, filters, selection, links and names use surface or secondary.
  Recommended: yes; it is what §2.4 already implies ("Save/Update/Create = the one filled primary").
- ★R3 **Default pack rest look.** Retune the default pack toward 0.5's card: both roles get the same
  shape. Choose card (0.5) or bare (prose). Recommended: **card for both**, tinted
  `surface-900` on the 950 panel, 12px radius, no border, mirroring 0.5's `primary-50-950` in
  Lamplight's ladder.
- ★R4 **Beta notice.** One dismissible tonal line on Home, sentence case, `surface-500` text with a
  gold dot; the pre-release line folds into it ("Beta, pre-release 0.6.0-pr-5 — keep backups.").
  Never two lines, never warning-coloured, never on the wizard above the card.

### L1 — Quiet the stage chrome (sessionPage, MessagesWidget)
Goal: at most **two** rows above the first message and **one** control row under the log.
1. Session header stays (title · cast · genre · Settings · Layout · Jump). Back/Forward move into
   the header's right cluster as two icon buttons; the "Back / Forward" word row goes.
2. "Start a new entry" becomes an item in the scene marker's `⋯` menu and the composer's Actions.
3. The scene marker row keeps the dot, name and line count; the per-message "Scene n" chip is
   dropped on the message that immediately follows its marker (it is the same information twice).
4. Under the log: the "replied" pill and "Inspect run" fold into the last message's kebab; the
   retrieval notice (`RagNotice`) shows once per session as a toast-free inline line that collapses
   to an icon in the composer footer after first read (it already has "Show again").
5. The "Actions" disclosure and the persona chip row merge into the composer footer: persona chip ·
   Actions ▾ · Preview · More · Send. One row.
Files: `src/lib/client/components/sessionPage/*` (header, `RagNotice.svelte`, composer flow),
`../serene-pub-sdk/core-catalog/components/shared/messages/MessagesWidget.svelte`, composer skins.
Acceptance: `/sessions/5` at 1440 shows the first message within 120px of the header.

### L2 — Message rest state (default pack; depends on ★R3)
In `src/lib/client/sessionLayout/messageLayouts.css` and the default pack:
- Same card for every role (★R3). User turn is distinguished by the avatar side or a 2px
  `secondary` bar, never by being the only box.
- Avatar 48px round with a 2px `surface-800` ring (0.5 used 64; 48 keeps the 17px serif centred).
- Name: Display 15px 600 in `surface-50` (ink). Gold name only for the speaker whose turn it is,
  and only while the session waits on them.
- Drop the sparkle glyph from the name row; the swipe chevron and time stay at the right, 12px
  `surface-500`; timestamps keep their setting (default off, as now).
- Folds: render the Reasoning fold only when the reply carries reasoning (already true for Plan);
  verify it is not drawn for the fixture's empty reasoning. Folds inherit the card, never a second box.
- Gap between cards 12px; card padding 16px (0.5's two nested `p-2`).
Acceptance: `/sessions/5` beside `0.5.3/chat-group.png`.

### L3 — Measure (depends on ★R1)
`lineWidth` gains `column`; the widget root carries `data-line-width="column"`;
`--sp-measure: min(100%, 76ch)`; composer follows. Default for new sessions and for sessions whose
setting is unset. Docs: `docs/session-layout.md` Line width.

### L4 — Colour restraint (depends on ★R2, ★R4)
1. **Status vocabulary:** a connection's state is a 6px dot + 13px `surface-400` text. Red text only
   when the connection fills a loadout that is in use (the Admin "Needs you" case). The "Fix"
   button is tonal, not filled; "Start" stays filled only on the row that can start.
2. **Filters and selection:** the "All" chip and the active rail item are tonal surface + the 3px
   bar (§1 principle 5), never filled primary.
3. **Beta notice** per ★R4 (`src/routes/+page.svelte`, wizard).
4. **Toasts:** error toasts auto-dismiss at 8s, collapse repeats from one source into one, and are
   not raised by a background poll (the Ollama version/running-models poll) on screens that did
   not ask — route those to the Activity dot instead ([toasts only central]).
5. **"Your turn" pill vs "Continue →":** keep the pill, drop the Continue text to the arrow only,
   or keep Continue and make the pill a dot. One signal per card.

### L5 — Settings copy
One card = title (the setting's name), one sentence, the control. The control's own label is
removed when it equals the title. Help under a control only when it says something new (the time
zone's "Now:" line stays; the language translation paragraph moves to the docs link). Apply to
Settings → User, Themes, Media; Admin → General. Sampling: the slider hint collapses into the
label's `title` and the "n of m sent" count moves to the group header's right edge in 11px.

### L6 — List rows
Sessions/Characters list rows: name 15px · one muted line (the preview, not italic) · kebab. The
date joins the muted line's end in 12px; the status dot goes (the group label already says "Your
turn"). Avatar 44px. Characters default to the list in the 400px dock and to cards at Half and
above (0.5's behaviour: cards were a toggle, list the default).

### L7 — No voids at desk width
A list-with-detail view with nothing selected renders the list centred at its max width (the
Lorebooks pattern) instead of list + empty pane; selecting an item animates the list to the left
column. `PanelSplit.svelte` gains `emptyMode: "centred"`; views opt in.

### L8 — Phone header
Title first and never truncated below 12 characters; cast stack at 24px; one `⋯` holding Settings,
Layout and History; Jump stays in the bottom bar's Views sheet. Composer footer at 412 keeps
persona · Send only; the rest under `⋯`.

### L9 — Home
Beta notice per ★R4. Characters section: a two-column list of 48px round avatar + name + one line
(0.5's `home.png`) with the card grid behind the existing list/card toggle. "Playing as" row stays.
The Documentation / Document View links move to the account menu (they are on the sign-in page too).

### L10 — Verification (one pass at the end)
Screenshot each lane's screens on the fixture instance, dark and light, 1440/2560/412, lay them
beside the 0.5 frames, fix until decent. Run the C7 gate and the client test suite once. Update
`STYLE-GUIDE.md` §2.4, §3.4, §6.4, §6.13 and `docs/session-layout.md`, `docs/sessions.md` in the
same change; record any new word in `NOMENCLATURE.md` §25 (candidate: **Column** as a line width
value).

## 4. Order and size
L0 (rulings) → L2+L3 (the stage, one lane, ~1 day) → L1 (~1 day) → L4 (~½ day) → L5+L6+L9
(~1 day) → L7+L8 (~½ day) → L10. Everything is CSS, markup and copy; the one schema-adjacent
change is the `lineWidth` default (a widget setting, no migration).

---

## 5. Second pass (2026-10-24, later): missed items and opportunities

Walked: Half width, Jump, the new-session form, character detail and edit, Admin → Users and
Pipelines, Activity, Models, Document View, light mode on the stage, Home and Settings, the
composer's More menu. Screenshots `<scratchpad>/audit/current/p2-*.png`.

### 5.1 Missed regressions
- **Half width has the same void as Focus (§1.7), and it is worse.** At Half the list column is
  340px inside a 1250px pane; the remaining 900px reads "Pick a session, or start one." while the
  session is already open on the right. Add to L7: at Half with nothing selected, the list fills
  the pane at its max width; at Half with the current session open, the list should select the
  current session's row (it already does in the dock) and show its detail, never the empty line.
- **Light mode contrast.** Gold on the light ground fails for text: message names, the "All 46"
  link, "Your turn" pills (pale yellow with gold text), the scene marker, the tab underline label.
  Lamplight's primary-500 is `oklch 80%`, a dark-mode accent. Add to L4: in light mode the text
  uses of primary move to `primary-700`-ish (the ladder has it) or to ink; the pill is tonal
  surface with a gold dot. 0.5's light screens (`mobile-settings-light.png`) used pale indigo
  buttons with ink text and nothing in yellow.
- **The success toast for a toggle.** "Light mode enabled" raises a toast on every mode switch
  (`CustomThemeManager.svelte:134`). The switch already shows its state. Add to L4.4: no toast for
  a change the control itself shows.
- **Error toasts from a background poll never leave.** The two Ollama toasts came from the
  connections live-status poll (`src/lib/server/sockets/ollama.ts:644` → the central error
  listener) and stayed on every screen for the whole walk, dark and light. The toaster is
  `createToaster()` with defaults (`src/lib/client/utils/toaster.ts`). L4.4 stands; add: a socket
  error raised by a status poll is never a toast.
- **The new-session form.** `StartSessionForm.svelte` draws five genre cards, each with a title, a
  two-line blurb, a meta line (`characters · characters you play · lorebook optional`), a second
  two-line blurb and a "More" link: ~900px of column before the Name field, in the 400px dock.
  0.5 opened a chat with name + participants. Add **L11**: genre as a radio list of name + one
  line (15px / 13px), the current genre expanded to show its meta line and More; Name and Preset
  above the fold; Start stays top right.
- **Character edit.** The form opens with a card explaining cast members ("Represents 1 cast
  member in 1 lorebook… A card is where a character starts…"), then a hint under every field
  (Nickname, Summary, Aliases), a character counter, and a "Show all fields" switch with its own
  sentence at the bottom. Add to L5: the cast-member card becomes one muted line under the name;
  field hints become placeholders or the field's `title`; the counter shows only past 80%.
- **Lorebook rows carry their row number** ("1, 2, 3, 34, 37" in the left gutter of
  `LorebooksSidebar.svelte`'s rows). It is the book's id or position; neither helps a reader.
  Add to L6: drop it.
- **Activity in Focus** is one card in a 2000px pane under a two-tab bar that spans the width.
  Add to L7 (same centred-list treatment) and give the tab bar the list's max width.
- **Document View's footer** repeats the two beta lines (§1.3). ★R4 applies there too.
- **The composer's More menu** holds "What can be attached", a help topic, between two actions.
  Help belongs under the attach button's `title` or in the docs link, not in the verb list.

### 5.2 Things the WIP does well that the first pass under-credited
- **Jump** is the cleanest surface in the app: one input, a scope chip, three key hints. It is
  the model for every other overlay.
- **Admin tables** (Users, Pipelines) are consistent and quiet: a title, one sentence, a filter,
  a table, a filter rail. The only noise is the monospace id column on Pipelines; it could sit
  behind the row's menu or a column toggle.
- **Character detail** is already close to 0.5's calm: hero, three tabs, two-column cards.
- **Models** list rows are two lines and a chip; keep.

### 5.3 Opportunities beyond parity (cheap, not in 0.5 either)
- **One overlay recipe.** Jump's panel (950 ground, 1px 800 border, 12px radius, no shadow) should
  be the recipe for the Actions popover, row menus, the More menu and dialogs, so the app has one
  floating look.
- **Hover-reveal for the per-message kebab** on desk width (keep it always visible on touch and
  for the last reply). 0.5 kept it visible; the WIP's 12px time plus kebab on every line is more
  than 0.5 showed. Reveal on hover or focus-within costs nothing and quiets the right edge.
- **Read-mode measure for every long-form panel**, not just the stage: lorebook entry bodies,
  character description cards and docs pages already wrap at about 75ch (§3.4); Settings cards do
  not (the help sentence runs 160 characters at 2560). Cap Settings and Admin form cards at 760px.
- **A single "meta line" primitive**: `12px surface-500`, items joined by " · ", used by list rows,
  continue cards, the session header and pills, so dates, genre names and counts stop appearing in
  three different weights.

### 5.4 Lane updates
- L4 gains: light-mode primary text, no toast for a visible toggle, no toast from a status poll.
- L5 gains: character edit hints and the cast-member card.
- L6 gains: drop lorebook row numbers; meta-line primitive.
- L7 gains: Half width void; Activity.
- **L11 (new) — Start a session**: compact genre radio list; Name and Preset above the fold.
- **L12 (new) — One overlay recipe + hover-reveal kebab** (opportunity, not parity; owner's call).

## 6. Second pass: the numbers (current tree vs 0.5.3)

Counts over `src/lib/client` + `src/routes` `.svelte` (576 files) against the 0.5.3 tree. The
message widget in the SDK uses no Tailwind; its look is `styles/widgets.css` (8.6k lines) and
`sessionLayout/messageLayouts.css`.

| Convention | 0.5.3 | Current | Read |
| --- | --- | --- | --- |
| `text-xs` / `text-sm` | 729 / 618 | 2040 / 1499 | small type is now the default voice |
| arbitrary `text-[Npx]` | ~0 | 413 (10 sizes; `text-[11px]` in 118 files) | no scale is being followed |
| `widgets.css` font sizes | — | 36 distinct; six `--sp-w-font-*` tokens 0.68–0.76rem apart | one token would do |
| radius classes | 4 (lg 175, base 168, full 107, xl 37) | 25; `rounded-[10px]` 166 uses in 80 files; `rounded-container` 0 | the house radius is not a token |
| colour classes that render nothing | 183 `text-muted-foreground` | 47 (`bg-surface-100-800`, `border-surface-200-700`, … pairings that don't sum to 1000) | the same class of bug, new names |
| `bg-surface-*` variants | 25 | 45 | |
| error text shades on alerts | — | 3 (`error-500`, `600-400`, `700-300`) | |
| `title=` vs `<Tooltip>` | 370 / 0 | 766 / 8 | |
| kebab labels / kebabs outside RowMenu | — | 18 wordings / 10 copies | |
| pill recipes | — | 14 | |
| toast calls | — | 427 in 121 files (error 209, success 189) | every component toasts for itself |
| `MOTION` constants adopted | throughout | 2 files; `softFade`/`animateHeight` unused; 300/500ms hand-rolled progress bars ×8 | |
| target heights | 44 | 32, 40 and 44 compete (min-h-11 104, min-h-10 44, min-h-8 40) | |

What this says: the look drifted not because the rulings are wrong (STYLE-GUIDE §3.2 has the
scale, §4.1 the radii, §8 the motion constants) but because nothing enforces them, so 80 files
each chose a near value. 0.5 was calmer partly because it had fewer files making the choice.

### L13 — Token hygiene (new; mechanical, safe, half a day each)
1. Fix the 47 non-existent surface pairings (15 files; worst `KoboldCppSettingsTab`,
   `routes/pipelines/library`, `KoboldCppPerfTab`); then collapse `bg-surface-*` to three tiers
   (ground 900, panel 950, raised 800) and `border-surface-*` to one hairline.
2. A type scale as utilities (`text-meta` 11, `text-small` 12, `text-body` 14, `text-lead` 15)
   mapped to §3.2, and replace the 413 arbitrary sizes. Collapse `--sp-w-font-*` to three tokens.
3. `--radius-base` becomes 10px (today `0.375rem`) so `rounded-[10px]` → `rounded-base`; map
   `[12px]` → `rounded-container`, `[8px]` → `rounded-lg`. 25 classes → 5.
4. Three primitives: `Badge` (absorbs 14 pill recipes), one kebab via `RowMenu` with the label
   "More actions for X" (absorbs 10 copies and 18 wordings), `FieldHelp`/`InlineError` (absorbs
   the sm/xs help split and three error shades).
5. Route transitions through `motion.ts` and progress bars through `SpProgress`; delete the
   literal 120/150/300/500 durations.
6. Toasts: a `notify()` facade in one place that applies the L4.4 rules (dedupe by source,
   8s, no toast for a visible state change, no toast from a poll) so 121 files stop deciding.

L13 is a prerequisite for L2–L6 landing cleanly; its first three items can go in any order and
need no ruling.

## 7. Grouped verification (2026-10-24, after lanes A–E + walk fixes)
- Visual walk on the 0.5.3 fixture instance (Lamplight, no background): Home, stage (2560/1440/412,
  Dock/Half/Focus), Sessions/Characters/Connections/Lorebooks/Models/Settings/character edit/start a
  session, dark and light. Two fixes landed in `Header.svelte` (mirror spacer gives way; mid-width
  give-way rule). Screenshots: `<scratchpad>/audit/after/`.
- `svelte-check --threshold error`: 0 errors, 7 pre-existing warnings.
- `tsc --noEmit -p .`: 2 errors, both `.ts` tests importing a named export from a `.svelte` module
  (`metaLine.ssr.test.ts` new, `arrangeCanvas.dom.test.svelte.ts` pre-existing); svelte-check accepts
  both. ★ Move `metaLineItems` to a `.ts` sibling if tsc must be clean.
- Full app suite (`vitest run --maxWorkers=2`, 14G scope): **1667 files passed, 1 skipped; 18763
  tests passed, 11 skipped**. (The default worker count OOM-kills a 10G scope.)
- `npm run sdk:test` (lane A): 3875/3876; the one failure (`sceneSettings.test.ts`) predates this work
  (`sdk/src/genres.ts` edited 00:44).
- **C7 gate** (conversation spec): exhibit selectors updated to the new parts
  (`scripts/c7Gate/specs/conversationExhibits.ts`, `engine.ts` normalises `data-drag-key`,
  `data-ledger-message`, "on message N"); goldens re-baselined for all five packs (rises: compact axe
  colour-contrast 5→6, cameo undecided 4→6, stream medians +~0.7s); second judged run: flows, stream,
  tab order and structure all match; **41 scroll-position readings differ** (0px vs a recorded 1–45px
  in Compact, one 19px in Cameo at 390px) — the recording caught an unsettled scroll; three probe runs
  read 0px. ★ Next: make exhibits wait for the scroll to settle before reading, re-baseline, judge
  twice. Pack goldens are gitignored (machine-local). The side-widget specs stop on
  `core:genre/adventure` (merged into Story) — pre-existing, not touched.
- Delete missing from the message menu is the 2026-10-23 ruling (deletion off unless a pipeline
  registers on `message-deletion-asked`), not a regression.

## 8. Owner-word items — ruled 2026-10-24 ("Use your best judgements")
Kept as built: Column at 76ch (≈93 characters a line is the top of the comfortable range; raise the
76 only if the owner misses 0.5's width); the card at 800@70% with a 700 ring; Start filled for a
managed process (the region's next action; §6.1 updated); light-mode primary text on primary-950
(contrast); the start form's gating (genre list never collapses, preset collapsed until Change);
switch cards beside their words at every width; "Run scripts"; the Messaging status line gone; the
two mouse-only `title` sentences (the docs carry the steps); Document View / Import tonal; meta line
in `surface-600-400`; the names **meta line**, **setting card**, **cast line**, **badge**, **field
help** (🚧 cleared); avatar `md` 44 everywhere; Activity/Models/Lorebooks at 560; Sessions showing
the open session at any desk width; Library dock rows as one meta line; one hairline a step softer;
10px base radius for Skeleton's own controls; other themes taking their own radius; 13px help; the
SpProgress tint and pulse; 180/130ms durations; the chip-radius coupling; lorebook selected rows on
`.sidebar-row-active`.
Changed: **Lamplight `--text-scaling` 1.067 → 1** so the closed scale is literal (text-xs 12,
text-chip 13, text-sm 14, text-lead 15 no longer collapse; the whole interface draws ~6% smaller,
which is 0.5's density). `metaLineItems` moved to `panels/metaLine.ts` (tsc clean). The gate reader
waits for scrollers to settle before a shape is read (`engine.ts` `settleScroll`; unverified by a
run — the next re-baseline + judged pass on the owner's machine is the check).
Left open: the SDK `sceneSettings.test.ts` failure (predates this work); the gate's side-widget specs
on the retired Adventure genre; ~55 ⏳ pressed sites outside lane B's list (§2.4).
