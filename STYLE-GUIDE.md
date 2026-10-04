# Serene Pub — Style Guide

How the interface looks, reads and behaves, and why. This is the design canon; the vocabulary
canon is `NOMENCLATURE.md` (words), the user manual is `docs/` (behaviour). When a rule here and
the code disagree, the code is wrong or this page is stale, and the change that reconciles them
updates both.

Everything below is grounded in the shipped code as of 2026-09-15: the Lamplight theme
(`src/lib/client/themes/lamplight.css`), the shell (`src/lib/client/components/Layout.svelte`),
the shared panel primitives (`src/lib/client/components/panels/`) and the Characters view, which
is the reference implementation of a sidebar view.

---

## 1. Principles

1. **Roles, never hex.** A component asks for a colour role (`primary`, `surface-900`, `warning`)
   and the active theme answers. No component names a hex, an oklch, or a specific theme. The rail's
   ground is the one computed value — `--sp-rail-bg` in `app.css`, a `color-mix` off a role that
   sets the rail one step beyond the sidebar in whichever direction the mode runs. It was dark under
   every mode until **2026-09-23**, when it was ruled to follow the mode like everything else; the
   mix is still the same gesture, just mirrored under light.
2. **One rail, one sidebar, one search.** Navigation lives on the rail. Whatever a rail item opens
   is a sidebar view. Jump is the only search surface. Nothing else may add a navigation strip, a
   second sidebar, or a search box that is not a view's own filter.
3. **A view is complete at 400px.** Every sidebar view is 100% functional in the dock and is the
   same component at every width (Dock, Half, Focus) and on a phone. Width changes the arrangement, never the feature set.
4. **Cards, not separators.** Sections sit in cards. Horizontal rules and `border-t` separators
   between sections are retired.
5. **Selection is tonal plus a bar.** A selected row or active toggle is a tonal surface with a
   3px inset primary bar, never a filled primary background. Filled primary is for buttons.
6. **Nothing scrolls sideways.** No horizontal scrollbar in a view at any width. Rows that would
   overflow move into a popout.
7. **Dark first, paired always.** The design is authored in dark mode. Every colour that is not a
   role-with-stop pair must be written as a light/dark pair so light themes stay legible.
8. **Sentence case, plain verbs.** Labels are sentence case. Buttons say what happens. No all-caps
   labels, no eyebrow labels, no decorative numbering.
9. **Ask the container, not the viewport.** Inside a view, responsive rules query the view's width,
   never the window's.

---

## 2. Colour

### 2.1 The theme system

Serene Pub is themeable. Every theme, built in or custom, defines the same Skeleton roles, each as
an eleven-stop ladder from `50` (lightest) to `950` (darkest) with a `contrast-*` companion:

| Role        | Ladder   | What it means in the interface                                        |
| ----------- | -------- | --------------------------------------------------------------------- |
| `primary`   | 50 – 950 | **Act on it.** Buttons, focus rings, links, the active rail bar.      |
| `secondary` | 50 – 950 | Secondary emphasis. Rarely needed; never for actions.                 |
| `tertiary`  | 50 – 950 | System and admin: the Admin rail item, lore-in-play dots.             |
| `success`   | 50 – 950 | Healthy, connected, saved.                                            |
| `warning`   | 50 – 950 | **The model is working.** Live dots, generating chips, the beta line. |
| `error`     | 50 – 950 | Failed, destructive, a required field missing.                        |
| `surface`   | 50 – 950 | Every ground, panel, border and text tone.                            |

Because components only ever ask for these roles, the shell looks like whichever theme is active.
Under Rose it is rose; under Lamplight it is lamplight. This is the guarantee that lets one
implementation serve twenty-five themes.

### 2.2 Lamplight, the house theme

Lamplight is the default for new installs, branched from hamlindigo. It keeps the indigo ground
and gives each role one job, with the 500 stop as the anchor:

| Role        | 500 stop                    | Reads as                 |
| ----------- | --------------------------- | ------------------------ |
| `primary`   | `oklch(80.3% 0.12 84deg)`   | lamp gold                |
| `secondary` | `oklch(80.28% 0.08 267deg)` | hamlindigo's pale indigo |
| `tertiary`  | `oklch(64.32% 0.06 213deg)` | teal                     |
| `success`   | `oklch(68% 0.11 160deg)`    | moss                     |
| `warning`   | `oklch(70% 0.17 45deg)`     | ember                    |
| `error`     | `oklch(60% 0.19 20deg)`     | warm red                 |

Its surface ladder is hamlindigo's with two deeper stops, so the shell has room for its layers:

| Stop | Value                       | Used for                                    |
| ---- | --------------------------- | ------------------------------------------- |
| 50   | `oklch(93.75% 0.01 267deg)` | ink on dark                                 |
| 200  | `oklch(89.7% 0.02 267deg)`  | prose, secondary ink                        |
| 400  | `oklch(70.33% 0.05 267deg)` | muted text, rest icons                      |
| 500  | `oklch(56.88% 0.07 267deg)` | quiet text, placeholders, hints             |
| 800  | `oklch(38% 0.05 267deg)`    | borders, hover, the selected row (dark)     |
| 900  | `oklch(32% 0.04 267deg)`    | the page, and cards on a 950 ground         |
| 950  | `oklch(26% 0.04 267deg)`    | the sidebar, popovers, inputs on a 900 page |

The rail is one step deeper still: `color-mix(in oklch, var(--color-surface-950), black 20%)`.
That is the only computed colour in the shell and it exists because the rail needs to sit under
the sidebar without a border.

The ladders are generated from oklch curves, and the file header lists the roles. Edit the curve,
not a stop, and re-generate, so a theme change never leaves one stop out of line with its neighbours.

### 2.3 Which stop for what

The same three questions decide almost every colour:

**What is it sitting on?** Grounds alternate between `950` and `900`. The sidebar and popovers are
`950`; the page is `900`. A card on the sidebar is `900`; an input or card on the page is `950`.
Never stack the same stop on itself. Borders are `800` on either ground.

**Can the user act on it?** Then it is `primary`. A primary button is `preset-filled-primary-500`,
which under Lamplight is gold with dark text (contrast well above 7:1). Links are `primary-500`
on dark and `primary-700` on light. Focus rings are `primary-500`. The active rail item and the
selected row carry the 3px inset `primary-500` bar.

**What is it telling you?** Live state is `warning` (the ember dot beside "Wren is thinking", the
generating chip). Health is `success` (the connected dot). Failure is `error`. These three are
signals, never decoration: a colour used as a signal is not also used as a tint.

Text tones, dark mode: ink `surface-50`, body `surface-200`, muted `surface-400`, quiet
`surface-500`. Muted is for secondary lines a reader still needs (a tagline, a timestamp); quiet is
for hints and placeholders that can be missed.

### 2.4 Selection and emphasis

| State                  | Treatment                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Selected row           | `.sidebar-row-active`: `bg-surface-200 dark:bg-surface-800` + `inset 3px 0 0 primary-500`, with `aria-current` |
| Active rail item       | `text-primary-500 bg-surface-900` + the same inset bar                                                         |
| Open-but-inactive view | a 6px `surface-500` dot on the rail item (§5.1)                                                                |
| Active toggle or chip  | `preset-tonal-primary`                                                                                         |
| Selected card          | `ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-950` (an inset bar hides under an image)            |
| Hover on a row         | `surface-200-800`                                                                                              |
| Primary button         | `preset-filled-primary-500`                                                                                    |
| Secondary button       | `preset-tonal-surface` (redeclared in `app.css`: `surface-200-800`, one step off either ground)                |
| Quiet action           | text in `surface-400`, `hover:text-surface-200`                                                                |
| Destructive            | text or fill in `error`                                                                                        |

`preset-filled-primary-500` is a button. It is never a selected row, an active tab, or a badge:
the old convention failed contrast at 3.62:1 and was retired app-wide.


**`preset-tonal-surface` is one step off the ground** (notes 25, 2026-10-02). Skeleton fills it
with `surface-50-950`, which in dark mode is the sidebar's and the popovers' own ground (§2.3), so
every secondary button and toolbar icon on a view read as text with no button around it. `app.css`
redeclares the utility after the Skeleton import (a second `@utility` of one name merges, and the
later declaration wins) to `surface-200-800`, the row-hover stop: visible on the 950 sidebar and the
900 card alike. Never "fix" one call site with a darker class; the token is the fix.

**Rulings of the 2026-09-26 consistency pass:**

- A Skeleton **Switch** keeps its filled primary track when on. It shows the control's own state,
  not a selection among siblings, so the tonal-plus-bar rule does not apply to it.
- **Menu items** hover neutral (`hover:bg-surface-200-800`). Only the destructive item is tinted
  (`text-error-600-400 hover:bg-error-500/10`). No menu item hovers to a filled colour.
- **Save, Update and Create** are the surface's one filled primary. **Set default** and other
  secondary actions are `preset-tonal-surface`. Success green and ember are signals, never buttons.
- A **`⋯` trigger** stays surface when its menu is open (`bg-surface-200-800`), and a popover's
  ground is `bg-surface-50-950` with a `border-surface-200-800` edge, never gold.
- `text-muted` and `text-muted-foreground` are not defined by any theme and render at full ink.
  Muted text is `text-surface-600-400`.

### 2.5 Contrast

Text and interactive elements meet WCAG AA, 4.5:1, against their ground on every built-in theme.
Document View, the accessibility shell, promises AAA at 7:1 in its own stylesheet and keeps its own
greyscale palette; nothing here applies to it. When you add a colour pairing, measure it. Known
figures: `preset-tonal-primary` measured 11.6:1 under hamlindigo and has not been re-measured under
Lamplight; the filled primary button is above 7:1 under Lamplight; `surface-400` on `surface-950`
is about 5:1, which is why muted text stops at 400 and quiet text is never body copy.

### 2.6 Light mode

The design is dark first, and **nothing is exempt**. The rail used to be, and the shell's own
grounds quietly were: `Layout.svelte` carried unpaired `bg-surface-950` on the sidebar container and
the phone's bottom bar, so under a light theme the panel stayed dark while its text went dark with
the mode — every sidebar view, not one of them. Fixed 2026-09-23. A literal dark stop such as
`bg-surface-950` or `text-surface-400` reads wrong under a light theme, so anything that is not
already a paired token is written as a pair:
`bg-surface-100 dark:bg-surface-950`, `border-surface-300 dark:border-surface-800`,
`text-surface-600 dark:text-surface-400`. Skeleton's paired utilities (`surface-200-800`,
`preset-filled-surface-100-900`) do this in one token and are preferred. A component that only
declares dark stops is a bug, even if it looks right today.

### 2.7 What not to do

- No hex or oklch in a component. No `#e2b75c`, no `oklch(...)`.
- No gradient washes as decoration. A gradient is allowed only as a deterministic cover for an
  entity with no image, built from two role stops.
- No colour as the only carrier of meaning: the star, the dot, the bar and the ring each pair with
  text or an accessible name.
- No `primary` tint on large areas. Gold is an accent; a gold panel is a bug.

### 2.8 Card and glass

Two surfaces stand behind content that floats over something else, and the **theme** owns both
looks. Nothing else draws them.

- **Card**: Skeleton's filled surface preset, `preset-filled-surface-100-900` with a
  `border-surface-200-800` edge and the theme's `--radius-container`. Opaque.
- **Glass**: `preset-glass-surface` (app.css), built the way Skeleton's Presets guide builds one:
  the theme tokens `--sp-glass-bg`, `--sp-glass-bd`, `--sp-glass-glow` and `--sp-glass-blur`, a
  light/dark pair on `:root`. A custom theme restyles every glass surface by overriding the tokens.

The Messages widget's **message backing** (`card | glass | none`, NOMENCLATURE §9) uses these two.
A message style only declares which backing it prefers (`--sp-backing`), and the person's Card
setting (Auto / On / Off) decides whether it is drawn. A style that wants glass inside its own
markup (Dreamlit Cameo's per-line cards) reads the same `--sp-glass-*` tokens, never its own
colours.

---

## 3. Typography

### 3.1 Faces

| Face               | Role                                                                                  | Weights shipped      | Source                                             |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| **Funnel Display** | Titles, view names, session names, speaker names                                      | 400, 600, 700        | `@fontsource/funnel-display`                       |
| **Funnel Sans**    | Everything else: controls, labels, lists, body                                        | 400, 500, 600, 700   | `@fontsource/funnel-sans`                          |
| **Fira Mono**      | Code, receipts, keyboard hints                                                        | 400                  | `@fontsource/fira-mono`                            |
| **Literata**       | Story prose in a session: the message log, the composer's preview and the Writer and Page line skins | 400, 500, 400 italic | `@fontsource/literata`, as `--sp-prose` on `:root` |

Fonts are self-hosted and imported in `src/app.css`; nothing is fetched from the web. The theme
sets `--typo-heading--font-family` to Funnel Display at weight 600 with letter-spacing `-0.01em`,
and `--typo-base--font-family` to Funnel Sans. Use the theme's heading font as `[font-family:var(--typo-heading--font-family)]`; there is no
`font-heading` utility. The `.funnel-display` class in `app.css` is the older spelling, retired
from components on 2026-09-26 (it names a font, not the theme's heading role).

Two faces, one family, is deliberate: Display carries identity, Sans carries information, and
they never fight because they share their letterforms. Literata is the one exception, ruled
2026-09-16 with the session stage: it is the reading face for the fiction itself and appears
nowhere in the interface. A control, a label, a list or a setting is never set in it; a message
body, a narrator line, the composer's preview and the Writer skin's field always are. Do not add a
fourth face.

### 3.2 Scale

The interface uses a fixed set of sizes. Pick from this table; do not invent a size.

| Size | Line height | Weight  | Face    | Used for                                                                 |
| ---- | ----------- | ------- | ------- | ------------------------------------------------------------------------ |
| 32px | 1.15        | 600     | Display | The home greeting                                                        |
| 24px | 1.2         | 600     | Display | A page title inside the main area (the admin header)                     |
| 20px | 1.2         | 600     | Display | A session's name in its header, beside the cast stack and the genre name |
| 18px | 1.3         | 600     | Display | A detail hero's name, a continue card's title                            |
| 16px | 1.4         | 600     | Display | A sidebar view's title                                                   |
| 15px | 1.4         | 500     | Sans    | A list row's name                                                        |
| 14px | 1.5         | 400/500 | Sans    | Body, rail labels, inputs                                                |
| 13px | 1.45        | 400/500 | Sans    | Tabs, chips, buttons in the dock, secondary body                         |
| 12px | 1.4         | 400     | Sans    | Field labels, timestamps, meta lines                                     |
| 11px | 1.3         | 400     | Sans    | Group names on the rail, counts, keyboard hints                          |

Letter-spacing is tightened only on Display at 20px and above (`-0.01em`, `-0.015em` at 32px).
Sans is never tracked. Nothing is set in all caps: a label that needs to look like a label is 12px
in `surface-500` in sentence case.

### 3.3 Hierarchy without decoration

A view title is 16px Display. A section inside a card is a 14px medium Sans heading. A field
label is 12px quiet. That is three levels, and it is enough: if a screen needs a fourth, it needs
a card boundary or a tab, not a smaller font.

Speaker names in the story are Display at 14px, gold for the cast and `surface-200` for the user's
persona, so the eye can find who is speaking before it reads what was said.

Story prose is Literata at 17px with a 1.65 line height, and it is set in two tones: dialogue
inside quotation marks is ink (`surface-50`), everything around it is body (`surface-300`). The
split is information, not decoration: who is speaking to whom reads before the words do. Narrator
lines are the same face in italic at 16px, `surface-400`, centred. Speaker names and times sit on
one row above the prose; times are 12px quiet.

### 3.4 Measure and wrapping

Body copy in a column wraps at about 65 to 75 characters. Story prose is the exception, and it is a
person's choice: the messages widget's **Line width** setting (`lineWidth`, on the root as
`data-line-width`) is **Full** by default — the rows and the composer take the whole width the
widget is given (5.3, the fill rule) — or **Comfortable**, a 640px measure (`--sp-measure`) plus a
56px gutter for the speaker's avatar, centred on the session. Either way the composer is the same
width as the prose, so what you type lands where you typed it. Comfortable caps the rows and the
composer, never the scroll region: the whole panel scrolls, its scrollbar at the panel's edge and the
wheel working over the gutters beside the column. A measure is never a hidden cap. Lists truncate with an ellipsis on one line for taglines and two lines for descriptions;
never let a row grow taller than its neighbours because of copy. Long identifiers wrap with
`break-words` rather than overflow.

---

## 4. Space, shape and size

The base unit is 4px. Everything below is a multiple of it, with the two exceptions noted.

### 4.1 Radii

| Radius | Used for                                                   |
| ------ | ---------------------------------------------------------- |
| 6px    | The theme's base radius: small controls, kbd hints         |
| 8px    | Menu items, small buttons, popover rows                    |
| 10px   | Rail items, list rows, inputs, tabs' container, chips' box |
| 12px   | Cards, the drop overlay                                    |
| 14px   | Continue cards, the hero avatar, the composer              |
| full   | Pills: filter chips, persona pills, status chips           |

### 4.2 Heights and widths

| Thing                     | Size                                                        |
| ------------------------- | ----------------------------------------------------------- |
| Rail                      | 64px narrow, 208px wide                                     |
| Rail item                 | 44 × 44 narrow; 40px rows wide                              |
| Sidebar                   | 400px (Dock); half the room right of the rail (Half)        |
| Sidebar edge (drag)       | 12px hit area over the border, 18 × 40 grip                 |
| Spine                     | 56px                                                        |
| Sidebar header            | 56px                                                        |
| List pane in Focus        | 340px default, 360–380px for card lists                     |
| Input, filter box, button | 40px; 32px for the small size                               |
| Toolbar icon button       | 40 × 40, the filter box's height (§6.3)                     |
| Avatar                    | xs 24 · sm 32 · md 40 · lg 56 · xl 72 (§6.4, Avatars)       |
| List row                  | 44px minimum                                                |
| Tab                       | 40px                                                        |
| Icon-only rail toggle     | 44 × 44 narrow, 32 × 32 wide                                |
| Touch target              | 44px, everywhere a finger can land                          |
| Jump pill                 | 34px tall, fixed at top 8px, right 16px                     |
| Jump overlay              | min(640px, 92vw) wide, at most 64vh tall, 12vh from the top |

The two exceptions to the 4px grid are the 34px pill, sized to sit inside a 56px header with
11px above and below, and the 3px inset bar, which is a line, not a box.

### 4.3 Gaps

Fields inside a card: 16px. Cards in a stack: 12px. Rows in a list: 4px. Items in a chip row:
6px. Sections on the home: 32px. Card padding: 16px. Pane padding: 16px.

---

## 5. Layout

### 5.1 The shell

The window is rail, sidebar, main. The rail is fixed to the left edge and holds Home, the **Play**
group (Sessions, Characters — personas included — Library, Lorebooks, Tags), the **Tune** group (Connections, Sampling,
Pipelines, Settings, and whatever the pub enables), then Activity, Admin and the account. The
sidebar shows one view; other opened views stay mounted as tabs and show as a dot on their rail
item. Main is the page. Below the `lg` breakpoint the rail becomes a five-item bottom bar and a view
opens as a full-screen sheet.

The wide rail shows labels and the group names; the user toggles it and the choice persists per
browser. Design for both forms: an item's active and open states are identical in each.


**Widths.** A view shows at one of three widths, chosen by the width switch in its header (three
32px icon buttons in a tonal track, replacing the old expand button), by dragging its edge, or by
Ctrl+\\. **Dock** is the 400px sidebar and **Half** is half the room right of the rail; both sit
beside the page, and which one a view comes back at is remembered per browser. **Focus** puts the
view over the page, which stays mounted and hidden. Focus is the only width with an address: it
shallow-routes to the view's own path (`viewRoutes.ts`), so Back steps down a width, and a cold
load of that path focuses the view over Home. Over a session, Focus draws the **spine** at the
right edge (cast, the ember dot while a reply is written, the way back); a phone's sheet shows the
same thing as a return bar at its top.

**Escape steps down one layer**: Stage only, then Focus to the width it came from, then the dock
folds. It stays out of text fields, dialogs and open popovers, and never leaves a page.

**Stage only** (Ctrl+.) hides the rail and the sidebar; an 8px strip at the left edge brings the
rail back over the stage, and a "Leave stage only" pill takes the Jump pill's place. The shell
sets `data-stage-only` on its root for pages to hide their own chrome.

**Open-view dots**: `surface-500` for a view that is open but not showing; `warning` (ember) on
Sessions while the session under a focused view is writing. Gold stays for "act on it".
The **Activity** and **Admin** dots are status (§6.11): the worst unread notification (Admin: the
worst Needs you item), `error` or `primary`; an info-only notification lights nothing, queued work
never does, and the count or state is in the item's `aria-label`. The phone's Views button shows
the worse of the two as one dot, never a count badge.

### 5.2 Views

A view is a component the shell mounts inside a wrapper that is a CSS container named `view`.
Views own their content and their search state; the shell owns the frame. A view registers its
search with Jump through `jumpCtx.registerScope` and, if it can refuse to close, a close gate
through `panelsCtx.registerViewCloseGate`.

A list-with-detail view uses `PanelSplit`: one pane in the dock, list beside detail at desk width.
The switch is `ViewModeTracker`, which measures the view and answers `compact` under 900px and
`desk` at or above it, holding its last answer while the view is hidden.

The list is the fixed column (`listWidth`) and the detail takes the room — except where the list
is the thing being looked at. The **Library**'s portrait grid passes `detailWidth` instead, which
turns the split around: the grid fills and the detail is a `clamp(360px, 32%, 560px)` column. A
view may measure its list pane too (a second `ViewModeTracker`, read by `.width`) when the list
changes form inside its own column: the Library is a single column of rows with its filters in a
popout under 560px of list, and a portrait grid with its filters in a row from there.

Where the reader should choose how wide the editor is — the lorebook's list beside its editor, on
Entries, Time and Cast — the desk split is a **`ResizableSplit`** instead: a 16px divider
(`role="separator"`, focusable, `aria-valuenow` = the list's share in percent) that is dragged,
stepped with the arrow keys (Shift for 10%, Home/End for the ends) and reset by a double click.
The share, never a pixel width, is remembered per device in `localStorage` (every touch in
try/catch) under one key per family of views (`serene-pub:loreSplit` for all three lorebook
splits, so changing lens never moves it), clamped to 20–80%, with pixel floors (260px list, 320px
editor) held by the grid's `minmax`. It looks like the shell's edge: a primary hairline and a grip,
both shown on hover, focus and drag.

### 5.3 Responsive rules

Inside a view, use container variants on the `view` container:

| Variant              | Fires at | Use it for                                   |
| -------------------- | -------- | -------------------------------------------- |
| `@lg/view:`          | 512px    | Two-column field rows, side-by-side metrics  |
| `@min-[900px]/view:` | 900px    | Anything that mirrors the desk switch in CSS |

Inside a `PanelSplit`, each pane is its own named container too (notes 14, 2026-10-02): **`list`**
and **`detail`**. A detail decides its columns from `@…/detail:` — the `view` container is list and
detail together, so a detail asking it would grow columns into room the list holds. The session and
character details go to two columns of cards at `@2xl/detail:` / `@3xl/detail:`; a card keeps its
own reading measure. A view with no split that would otherwise run a row 1400px wide in Focus
centres its content at a reading width (Activity: 880px). **Connections** (notes 42, 2026-10-03)
is the one split view whose list takes the whole view while nothing is open at desk width —
centred at 1120px, its defaults four across and its cards side by side, because the connections
are the view's main business rather than an index to a detail. Opening anything splits it: a
340px list column (rows only) beside the detail. The list is a named `list` container in both,
so what is inside asks `@…/list:` (the jobs grid goes four across at `@min-[36rem]/list:`).

Never `@sm/view:` for a two-column decision: it fires at 384px, which is narrower than the 399px
dock, so it would fire in the sidebar. Never a viewport variant (`sm:`, `md:`, `lg:`) inside a view:
the window is wide while the column is narrow, and the rule fires in the wrong place. Viewport
variants are for the shell and for pages in main, and even there `@container/home`-style named
containers are preferred.

**The session's zones** decide from the session's own measured box, never the viewport, so an
open sidebar counts. The conversation fills the zone it is placed in — the middle by default (Line width: Full, 3.4); under Comfortable its
column is centred in that box, and **the middle zone takes the balance; the column keeps its
measure**. The middle runs from side to side, over the body gap
too, with no padding on the body: it widens by the difference between the sides, its widgets fill
it, and the column is placed off the middle's own centre by half the balance
(`--sp-stage-balance-start` / `-end`, `columnInsetPx` in `sessionLayout/tuckedSides.ts`), so no
strip between a side and the column is outside a widget and the wheel scrolls everywhere there. The
balance is paid only from room beyond the stage's plan — its measure plus a scrollbar gutter on each
edge (`stagePlanPx`), which is what lets the log's rows centre where the composer does — and the body
has no width cap. **The middle grows; a docked side keeps its ladder width** (ruled 2026-09-28,
reversing the 09-27 side fill): the sides are their ladder footprint and nothing more
(`dockedZoneWidths` in `sessionLayout/sideSlot.ts`), `.layout-center` is `flex: 1` and takes every
pixel the window adds, and the conversation fills it (or, under Comfortable, the column keeps its
measure inside it). Never size a side from the
window's spare room. **An empty side keeps its column** (ruled 2026-09-29): a declared side that docks
at this width, pinned or not, and holds nothing is drawn as `.side-empty` at the width its first widget
will have, so the middle never grows into it. It shows the page's own background — no tint, no
border, no text and no drop hint (6.7: hints belong to the editor) — so it reads as part of the body;
`aria-hidden` and no tab stop. The column is **soft** (`emptyColumnsPx` in
`sessionLayout/sideSlot.ts`): it is never counted in the tuck threshold, it is granted only from room
beyond the populated sides and the stage's measure, two empty columns go together, and it gives way
to 0 before any populated side tucks. Tucked, stowed, hidden or on its drawer rung, an empty side draws
nothing: no column and no icon rail. A side holding only a conversation (any Messages instance, the
bare log included) is populated, never empty, on the desktop and the phone alike (`sidePopulated`).

**Placement is free** (brief 7a, 2026-09-29): any widget may sit in any zone, the conversation
included. The one placement rule is the **primary floor** (`sessionLayout/primaryFloor.ts`): a layout
places at least one instance of the genre's primary widget, anywhere. The editor never offers to
remove the last one: its card shows a lock with the note *A session needs one Messages widget* where
the × would be, on the grid cards, the rail's edit bar and the phone editor's rows alike. A reader
that finds none appends it to the middle. A zone never refuses a card. A conversation in a side draws
through the same renderer as in the middle and GROWS down its rail; it takes the side's ladder width,
and the middle's balance (`--sp-stage-balance-*`, set on `.layout-center`) never reaches it.

**The stage follows the conversation** (QE, recommended default, `sessionLayout/placementRules.ts`):
Stage only and the phone draw the layout's primary log (the first unclaimed Messages in reading
order) wherever it sits. In a side, that side's one mount takes `sideSlot`'s `stage` slot and fills
the body, its other widgets `data-stage-hidden` around their mounts; the middle is hidden (Stage only)
or stowed (phone), and on the phone its widgets are listed in the panels menu as **Middle**, opening
`.layout-center` itself as the sheet. A container change, never a second render. **Done refuses an
empty middle** (QF, same file) with a toast: *Put a widget in the middle, or move one back.* A middle arranged with widgets side by side carries no balance: it has no single
column to centre. When the
box is narrower than the docked sides plus the stage's measure (3.4, the stage's minimum at either
Line width), the sides **tuck** to their
icon rails and a panel comes out as a flyout, one at a time, with `aria-expanded` on its icon, a
labelled dialog, focus moved in and returned to the icon on Escape (`sessionLayout/tuckedSides.ts`).
The session measures with a `ResizeObserver`, not `container-type`, because its flyouts are
`position: fixed`.

A container makes itself the containing block for `position: fixed` descendants. Dialogs and
popovers inside views must be portaled to the body; every Skeleton `Dialog` and `Popover` in the
app already is, and a new one must be too.

**Session widgets** answer their own cell, never the window or the `view`. Every remote widget's
box (`ComponentMount`'s `.sp-remote-box`, marked `data-sp-widget-box`) fills the cell the layout
gave it, both ways, and is an inline-size container named `sp-widget`. Widget CSS uses
`@container sp-widget (min-width: …)` and `cqi` units. A root that wants the full height sets
`block-size: 100%`; the box's height is definite. There is no block-axis container, because a
cell whose height comes from its content would measure as zero.

**The fill rule** (ruled 2026-09-29): a widget fills the width its zone grants. The WidgetHost wrapper
is `display: contents`; the box is the zone's content width, the widget's root is 100% of the box, and
its parts stretch — stat cards, the lore list, the scene's faces and the conversation's rows and
composer alike. The only inset is the widget's own declared gutter (its root's padding). A widget
never caps itself at a width the person cannot see or change: the conversation's reading measure is
its **Line width** setting (3.4), off by default. A cap that stays scales with the cell, such as a
scene portrait's `clamp(8rem, 45cqi, 20rem)` or content sized to itself (an image, a table, a form in
a message); it is never a fixed rem width that a wide cell leaves standing in empty panel. Container
queries key off the box (`@container sp-widget`), never an inner column.

**A placed widget is flush.** The host draws no card around a widget in a zone: no surface, no
border and no title bar, so the widget's style decides its surface. The card (`HOST_CARD_CLASS` in
`sessionLayout/hostCard.ts`) comes back when the widget's **Card** setting (`hostCard`, a core
setting every widget has, off by default) is on. It is always on while the widget is opened for a
moment over the session: a flyout, a tucked panel, the phone's panel sheet. The widget is told which
through `layout.v1.chrome.card`, and its box carries `data-sp-card="on"` or `"off"` for a stylesheet
to key off. The card is classes on the same element, never a wrapper that comes and goes, because a
new parent would remount the widget.

### 5.4 Layering

| z-index | Layer                                                   |
| ------- | ------------------------------------------------------- |
| 10      | The shell: rail, sidebar, main                          |
| 20      | The view edge (drag handle), inside the shell           |
| 29      | Stage only's left-edge strip that brings the rail back  |
| 30      | Stage only's rail, shown over the stage (`lg:`)         |
| 40      | The mobile Views sheet                                  |
| 44      | The Jump pill                                           |
| 45      | A view open as a mobile sheet                           |
| 50      | Modal backdrops and dialogs, including the Jump overlay |
| 1000    | Popovers and menus                                      |

The pill sits **under** every sidebar view and above the rest of the page (ruled 2026-09-17). It
is not rendered at all while a view is in Focus on desktop, while the Views sheet is open, or in Stage only, nor while a view is open as a sheet
below `lg`: the shell is its own stacking context, so nothing outside it can slide beneath a view
that fills the window, and the z-index alone would leave the pill drawn over the sheet. Ctrl K
opens the overlay in every state. A modal opened from a sheet must cover the sheet.
Do not add a layer between 45 and 50.

---

## 6. Components and patterns

### 6.1 Buttons

One primary button per surface. It is `preset-filled-primary-500`, 40px (or `btn-sm` at 32px in a
dock), with a 16px icon before a one-word label when the icon helps. Secondary actions are tonal.
Actions that would be clutter as buttons are quiet text links. A destructive action is never the
primary.

Where one control has two outcomes and the second is the dangerous one, it is a **split button**:
the safe action fills the primary, a chevron beside it opens a popover, and the dangerous action
sits inside carrying its whole warning in the item — never a toast after the fact. The lorebook
editor's Save while reading as of a date is the pattern (`EntryWorkspace.svelte`, `amendSave`).

### 6.2 Filter input

`PanelFilterInput`: 40px, `rounded-[10px]`, a search glyph, a placeholder built from a noun and a
count ("Filter 14 characters"), a clear control that returns focus to the input, and a primary
focus ring on the wrapper. It binds the same state the view filters on and Jump drives.

### 6.3 The view toolbar, the filter popout and the New menu

**The view toolbar** (notes 25, 2026-10-02) is the top of every sidebar view's list, and the top of
an editor that stands in for one (Sampling): **`ViewToolbar`** (`components/panels/ViewToolbar.svelte`).
One shape, so the same control is in the same place whichever rail item opened the view:

1. **The action row.** The view's one primary first: labelled, `preset-filled-primary-500`
   `btn-sm` (**New**, **Add**, **Update**, or a New menu's trigger). Then the room. Then the
   secondary actions as **icon buttons** — `toolbarButtonClass()`
   (`components/panels/toolbarButton.ts`): 40px square, `preset-tonal-surface`, a `title` and an
   `aria-label` that say the action (**Import a lorebook**, **Get a model**, **Reset unsaved
   changes**). Then **`⋯`** last, for everything rarer (Set as default, Delete).
2. **The find row.** The filter box takes the room (§6.2); the filter popout and the list/card pair
   (**`ListCardToggle`**) are icon buttons after it.
3. **The chips row.** Standing picks (Sessions' All / Your turn / Favorites) and every narrowing in
   force as a dismissible chip.

A row with nothing in it is not drawn. **Never a bare icon button**: without a preset an icon
button is an icon on the view's ground and nobody can tell it is pressable. An icon button that is
ON (a filter in force, the chosen view mode, an open panel) is `preset-tonal-primary` with
`aria-pressed`; filled primary always means "do this", never "this is on". A detail's own actions
are not this toolbar: they sit under its `DetailHero` — the primary labelled and filled, the next
one labelled and tonal (the session detail's **Open session** and **Edit**), the rest in the
`PanelNavHeader`'s `⋯`.

When a view has more filters than one box, they live in a popout: a 40px icon button that opens a
popover of `role="radio"` rows (single choice) with the checked row in the selected treatment; an
active choice shows as one dismissible chip under the toolbar and lights the button tonal. A chip
row that would need to scroll sideways is always a popout instead.

The ways to add something live in one primary **New** button at the start of the action row,
opening a `role="menu"` of items with a title and a one-line description, such as Write a character,
Browse the library, Import a card.

### 6.4 List rows and cards

`SidebarListItem` is the row shell; `active` applies the selected treatment. A row is a 40px
avatar (rounded 9px), a 15px name, a 12px muted second line, and at most one chip at the right with
a `+N` for the rest. A favourite is a small filled star after the name; a persona is a small `UserRound` after it. The
row's own actions are in a `⋯` `RowMenu` (§6.6). The numeric id column is off (`showIndex={false}`) in
views that show names.

A **session row** in the Sessions view is the denser variant (2026-09-26; faces enlarged by notes 36,
2026-10-02): a fixed 72px slot holding up to three 40px round cast faces overlapping by 40%
(`AvatarStack`, ringed in the row's ground), a 14px medium name, the
relative time at 12px **muted** on the right with a 6px primary dot before it when it is the
reader's turn, and a 12px muted `Speaker: excerpt` line. The list groups under 12px muted
sentence-case labels — _Your turn_, _Recent_, _Older_ — with no header row and no rule.

A **session card** (`SessionCardItem`, the Sessions view's card mode, notes 36) is avatar-forward:
the lead's portrait as a 16:10 cover, a group's faces (`lg`, round) standing on its lower edge,
then the name at 15px, a muted line with the genre, **Your turn** (primary dot and words) and the
time, and the last line clamped to two. A card grid is `auto-fill, minmax(150px, 1fr)` (two across the 380px list pane) off the
list pane's own width; selection is the card's ring (§2.4). **Clicking a session row or card opens
its detail at every width** (notes 32); going into the session is the detail's primary, and Jump's
pick, which is "go to", goes straight in.

**Avatars** (notes 36, 2026-10-02). One component, **`Avatar`** (`components/Avatar.svelte`), for
characters, personas, cast members and every face a session shows, on one fixed scale:

| Step | Size | Used for                                                    |
| ---- | ---- | ----------------------------------------------------------- |
| `xs` | 24px | a mention, a chip, a cover's badge, the session header's faces |
| `sm` | 32px | a one-line chip or relationship line, a detail's cast list  |
| `md` | 40px | a list or picker row: characters, cast, session faces       |
| `lg` | 56px | a card's faces, a picker card in a select modal             |
| `xl` | 72px | a detail's hero tile (`DetailHero` draws its own at 72)     |

**Every avatar is round** (owner ruling 2026-10-02): rows, pickers, cast lists, heroes, stacks, the
session header. Square — rounded to the step (6 / 8 / 9 / 12 / 14px), `shape="square"` — is only for
what is explicitly a **thumbnail**: an image list, a gallery, a card's cover picture. Message avatars
belong to the message style. The picture is cropped from the top (`object-top`).
With no picture, or one that fails to load, the tile is `surface-200-800` with the kind's glyph —
`UserRound` for a persona, `UsersRound` for a character — or, for someone with no card (a
background cast member), the name's initial. A face shown without its name beside it may carry the
**persona mark** (`personaMark`): a 16px `UserRound` notch on the corner, ringed in the ground. A
face beside its name is `decorative` (`alt=""`). Stacked faces use **`AvatarStack`**, ringed in the
ground they stand on. `size` takes a step and nothing else (the pre-scale class-pair form is gone);
a face drawn outside `Avatar` — the `sp-avatar` host element, the message log's style-pack avatar —
follows the same rules (round, top-cropped, initial on `surface-200-800`).

A **detail view** opens with **`DetailHero`** (`components/panels/DetailHero.svelte`) under its
`PanelNavHeader`: a 72px tile at radius 14 (the picture, else an initial, else an icon for things
that never have one — a connection, a model, a tag), the name at 18px Display, a 13px muted line,
an optional 12px meta line, then chips and actions. Characters, personas, sessions, users,
connections, models and tags all use it; nobody draws their own header.

A list that can be grouped (character folders) groups with a **folder header**: a 32px row with a
`Folder`/`FolderOpen` glyph, a 13px medium name, a 12px muted count, and a `⋯` menu at the right,
on the same ground as the list and separated from the rows below only by its own `py-1`. The header
is a `<button aria-expanded>` that collapses the group; the rows inside are indented by the glyph's
width and nothing else. Ungrouped rows come first with no header. A filter that empties a group
hides its header rather than showing an empty one.

A **connection card** (`ConnectionCard`, the Connections index's card mode — notes 42, 2026-10-03)
carries the same facts from the same status module, with the room to show all three things the
list is for at once: the service chip (same suppression rule), the state chip, and the **model
count**, which a row has to give up to its action. The body is one button that opens the
connection; the action is its own button in the card's footer, never nested. Cards grid
`auto-fill, minmax(220px, 1fr)` off the list pane's width; selection is the ring (§2.4). Beside an
open detail the list is navigation and shows rows only, without the list/card pair.

A row that stands for a **connection** is the title (the user's words) at 15px, a service chip
where that chip says something the title has not, and then four fixed slots the row's status
module fills and the row composes: the **state chip** (one or two words beside a dot), the
**detail** on line two, the **metric** right-aligned in an 86px column, and at most one action.
Teal-tonal chip for a managed runtime (KoboldCPP, Ollama), outlined for a host (OpenRouter,
Anthropic, ONNX).

The 2026-09-17 rule was _never one without the other_ — the title says which, the chip says what.
**Amended 2026-09-23** on both halves. The chip is suppressed where it would only repeat the
title, because a connection's default name IS its service label, so every row read `Anthropic
(Claude)` beside a chip saying `Anthropic (Claude)`. And the single `·`-joined status line became
slots, because in a 400px column it truncated from the right, which is where the fact is
(`9 models · api.anthropic.com · checked 2 min…`). A slot has a width, so nothing is cut, and a
column of states can be scanned instead of read.

Muted text is `surface-600-400`; **quiet (`surface-500`) is never a fact the reader came
for**. A row's metric ("9 models"), a job tile's state ("Not set up") and a group header's trade
("private · free") are all muted — the last of those measured 3.45:1 as quiet at 11px, which fails
AA. And the ground decides, not the role: the model table's column headers and its default row sit
on `surface-200-800`, where muted measures 3.77:1, so those cells step up to `surface-700-300`.
Measure a pairing when you add one (§2.5).

**Quiet is for icons, not text** (2026-09-25). Text must reach 4.5:1 and quiet measures 3.45:1,
so *any* quiet text a reader needs fails AA — a size band does not rescue it, because the large-text
allowance starts at 18px (14px bold), far above anything set in quiet here. A non-text element only
needs 3:1, so quiet is right for a decorative or supporting **icon** (a row's trailing chevron, a
status glyph) and wrong for a word. A connections sweep moved 27 quiet text uses to muted and left
the 7 icons alone; the tone once named `muted` in `QuantPicker` was quiet, and now matches its name.

Only ONE of a connection's five states is red. `ready` is success, `idle` is quiet, `unfinished`
is **primary** — the app is waiting on the person, and nothing has failed — `busy` is warning,
and `broken` alone is error. A fresh install showed two red rows and two **Fix** buttons because
two connections had no API key yet; incomplete is not broken and must not be coloured as though
it were.

A **model row** keeps a row's anatomy: the model's display name (the identifier with the packager,
format, quantisation and parameter count lifted out), the gold default mark, and one quiet facts
line — `12.2B · Q4_K_M · 7.5 GB · 32k context`. `Use` is outlined and inline; delete and the rest
are in the `⋯` menu. Never a `Size:`/`Modified:`/`Parameters:` key-value table, and never a filled
green button beside a filled red one: `preset-filled-*` is a button, not a badge (§2.4), and the
one irreversible action does not belong on every row.

**Amended 2026-09-25: a model sits in a CARD, not on a bare row.** This read "never a card with a
… table and a filled green button", which was one sentence prohibiting two different things — the
container and the anatomy — and only the anatomy was ever the problem. Every model list is now
`.panel-card`, 12px apart, so a model you **have** and a model you could **download** read as one
kind of thing. Use the utility's own padding rather than overriding it: two padding utilities on
one element resolve by emit order. The selected treatment is the card's ring (§2.4), not
the row's inset bar. ⚠ The density cost is real and was the original argument for rows: ~88px
against 44px, so a 400px dock shows three or four models where it showed seven.

A **downloadable model** is the same card with two more lines: the repo's own sentence,
`line-clamp-2` so two lines of a sentence is a sentence, and its tags as tonal pills (at most four,
then `+N more`). Tags are the human ones only — Hugging Face answers with `license:…`, `region:…`,
`arxiv:…` and `base_model:…` mixed in, and four chips of machine metadata is four chips nobody
reads. The licence rides the facts line instead.

A card is `rounded-[12px] border border-surface-800` with `p-4`, on the ground one step lighter
than what it sits on. That recipe is the `.panel-card` utility in `app.css`, paired for light mode;
use it rather than spelling the four classes out again. Section cards carry a 12px **muted** label or a
14px medium heading, then content. (It said quiet until 2026-09-25 — see the quiet-is-for-icons rule above: a label is text a reader uses.) Empty sections are not rendered; the card boundary is the
separator, so there is no rule between cards.

Two siblings carry the same edge (2026-10-02, notes 3/24 — the Settings view's treatment is the
reference for every sidebar view, Lorebooks first): **`.panel-edge`** is the card's border tone on
its own, for a bordered strip that is not a section card (a chip bar, a guide line); **`.panel-inset`**
is a section inside a card, one step back toward the ground, replacing a `border-t` between
sections. Never write a bare `border` / `border-l` / `border-t`: Tailwind 4's default border colour
is `currentColor`, which is how white bars ended up between the Lorebooks panes. A pane split (list
beside editor) is two cards or a list beside a `.panel-card` — never a rule. Since notes 24 (2026-10-02) the
shell's own edges (rail, sidebar, header row, spine, bottom bar), Admin's outer chrome, `PanelSplit`'s
list/detail line and the views' structural borders all wear `.panel-edge`; `surface-300-700` is left
for the outlined chip (a host connection's service chip), never a structural line.

### 6.5 Tabs

Two strips, deliberately alike:

- `PanelTabStrip`: labelled tabs, icon 16px plus text at 13px, equal widths, a 2px `primary-500`
  underline on the selected tab above a 1px `surface-800` rule, an optional error dot at the label's
  top-right. Used wherever a tab has a name the user reads: the character editor and detail view.
- `PanelTabList` + `PanelTab`: icon-only tabs for panels with many sections in a narrow dock;
  becomes a labelled vertical rail at desk width when the panel passes `orientation="vertical"`.

No segmented controls, no pill tabs, for moving between sections. A control that picks one
value from a short fixed set is not a tab and may be segmented: the view header's width switch
(Dock, Half, Focus) and Settings' story text size (ruled with the Full UI build, 2026-09-26).
A segmented control is a row of its options, whatever surrounds it: it lays out by its own
`orientation` (`app.css`), never an ancestor's vertical tab rail.

### 6.6 Popovers, menus and dialogs

Popovers are Skeleton `Popover` in a `Portal`, positioner `z-[1000]!`, content `w-[min(90vw,Npx)]`,
placement `bottom-end`, and they flip when the viewport says so. Menus are `role="menu"` with
`role="menuitem"` rows and a `tabindex="-1"` container, arrow-key movement, Escape to close, and
focus returned to the trigger. Dialogs are Skeleton `Dialog` in a `Portal` at `z-50`. Nothing in the
app renders its own `fixed inset-0` backdrop. A question asked before a verb that replaces or deletes
something is an `alertdialog` whose words say what goes and what stays; its confirm is the primary
when the person gets something back (a retake, a layout copied in) and filled `error` when it only
takes away, per §2: a delete, or **Start from scratch**, which clears every widget's settings and
style. An `alertdialog` is answered, never dismissed by a click outside (`closeOnInteractOutside` off;
its buttons and Escape close it), and when a yes removes the control it was asked from, focus goes
to the nearest control that brings it back, never the page (the layout editor's
`LayoutConfirmDialog`, 2026-09-29). A question may name a second way out: a tonal button between
Cancel and the confirm, the dialog one step wider so the three keep one line (**Save changes to**
over a layout changed elsewhere offers _Start again instead_ beside _Save over them_, 2026-09-30).

An action menu is **`RowMenu`** (`components/menus/RowMenu.svelte`, 2026-09-27), built on
Skeleton's `Menu`, which owns the roles, the roving highlight, arrows/Home/End/typeahead, Escape
and the focus return. Items are data — `{ label, icon, onSelect, destructive?, disabled?, href?,
title? }` or `{ separator: true }`, falsy entries dropped — so every menu draws the same row: a
bordered `bg-surface-50-950` panel at `p-1`, 36px rows at 13px with a 16px icon,
`rounded-[8px] px-2.5`, hovering `surface-200-800`; the destructive row is `text-error-600-400`
hovering `error-500/10` and sits after a separator. No title inside the panel: the trigger names
it. The default trigger is the `⋯`; a caller may restyle it (`triggerClass`) or replace its content
(`trigger`). `PanelNavHeader` takes the same items as `menuItems`. Do not hand-build a menu from
a `Popover` and buttons.

### 6.7 Empty, loading and drop states

An empty state is `EmptyState`: an icon, one sentence, and at most one action, phrased as an
invitation. A drop target shows its hint only while a file is over it, as an overlay with a dashed
`primary-500/70` border and a short imperative ("Drop to import this card"; the composer's is "Drop
to attach"), never a permanent footer. Loading is a spinner in place, never a blank pane. A file
waiting to be sent is a **tray tile** (§6.18).

### 6.8 Jump

The pill at the top right is the entry point; the overlay is the surface. The scope chip follows
the open view or the route; Backspace on an empty box widens one step (view → route → Everywhere),
the chip's × drops straight to Everywhere; a `kind:` prefix narrows. Enter opens the highlighted
row in the sidebar, Shift Enter (or Shift click) opens it focused; a hit that is a page navigates
either way. Results are grouped, the highlighted row uses the selected treatment, and a scoped
search always ends with an Everywhere tail. A footer names the keys as `kbd` chips — ↑ ↓ move ·
Enter open · Shift Enter open focused · Backspace widen — only at 480px of overlay width and up
(`@min-[480px]/jump:`). Views feed Jump through registration, never by adding their own search UI.

The pill is 34px tall in a 56px band, so it sits _in_ a header row rather than over one — but only
where that row leaves it the room. It publishes its measured width as `--jump-pill-width`
(the label names the scope, so it is 190px over Admin and 247px over Documentation), and any
surface whose own controls reach the top-right corner reserves that width plus the pill's 1rem
inset and one `gap-1.5`. Today that is one surface: the session header, whose **Layout** button
and quiet **Hide the session header** toggle end before the pill. Furled (a per-device choice,
`shellPrefs.headerFurled`), the header leaves no band at all: one faint 32px button (44px on
touch, brighter on hover or focus) stands in the same place, left of the pill, to bring it back,
and the layout's top strips roll up with it. A sidebar view in **Focus** reserves nothing, because the pill is not
rendered while one is open (§5.4). While the session layout editor is open its toolbar owns the
band and the pill is not rendered either. In both cases the Ctrl K overlay still opens.

---

### 6.9 Documentation pages

The docs are compiled once (NOMENCLATURE §27) and read in two places: the **Help** sidebar view
and Document View. There is no docs page: `/docs` and `/docs/<slug>` are Help's Focus addresses
(§5.4), and loading one opens Help in Focus at that page. Help styles the article with
`src/lib/client/styles/docs.css`, scoped under `.docs-article`; Document View keeps its greyscale
palette (§2.5) and renders the same markup unstyled.

- **Prose** is Tailwind Typography (`prose dark:prose-invert`), with its literal backticks around
  inline code removed — code-heavy reference pages read as pills, not quoted strings.
- **Banner** (`.doc-banner`): a warning-tinted bar with a 3px left rule and no icon. One per page,
  above the title; the index repeats it once above its source's group.
- **Admonitions** (`.doc-admonition-{note,tip,warning}`): bordered cards with a 3px left rule and
  an uppercase title. note = surface, tip = success, warning = warning. Three kinds, no more.
- **Code blocks**: highlighted at build time; colours come from `--shiki-light`/`--shiki-dark`
  custom properties, switched by `[data-mode="dark"]`, with surface-100/900 fallbacks for plain
  fences so light mode never shows a black block. Rounded, 1px border, `overflow-x: auto`.
- **Tables** sit inside `.doc-table`, which scrolls sideways; the page body never does (§11).
- **Figures** (`.doc-figure`): the §6.4 card recipe around a `≤1200px` webp with a muted caption;
  `max-width: 100%` always.
- **Pipeline graphs** (`.doc-graph`): the §6.4 card around an inline SVG laid out by ELK at build
  time. Node stroke by kind: inlet primary, query secondary, task surface, oracle warning, outlet
  success; edges and arrowheads muted surface. Natural size, never scaled: the card scrolls both
  ways and is capped at 32rem tall, so a 27-node map stays legible without owning the page.
- **Playground** (`.doc-playground`): the same card around two faces of one block — the highlighted
  `pre` and a sandboxed frame that runs it — with a right-aligned toolbar above them carrying one
  tonal `btn-sm`, **Run in playground** / **Show code**. Nothing loads until it is pressed, and a
  block the compiler emitted without a source gets no toolbar at all. Help only:
  Document View keeps the static block (§2.5).
- **Outline** ("On this page"): depth 2–3 headings, shown only when the docs container is ≥ 48rem.
  From 40rem the article drops `prose-sm` and prose's 65ch cap (`prose-base max-w-none`), a step
  before the outline: the column bounds the line, and a capped column beside a list pane reads as a
  slot, not a page.
- **Search** is one query with two boxes onto it: the `PanelFilterInput` at the head of Help's
  index, and Jump (§6.8), which Help registers with — the chip reads _Documentation_ while Help is
  open, and `doc:` narrows from anywhere. Every word must match, in any order, in the heading, the
  page title or the section's text (the index carries ≤1200 chars of it); the whole query in a
  heading ranks first, and the SDK reference always ranks after the guides. Results replace the page
  list from two characters, grouped **Using Serene Pub** then **Reference**, each row the heading (marked
  words tinted, never recoloured), its page, and a two-line snippet around the match. ↓ from the box
  enters the list, ↑ from the first row returns. Opening one lands on that heading and keeps the
  query, so Back returns to the results.
- **Index groups**: the page list follows the compiler's nav groups — the guides fill five
  (**Start here** · **Guides** · **How-to** · **For power users** · **Reference and help**), then
  each SDK source its own. Every group heading is the §3.3 14px section heading, never an eyebrow;
  only groups not from the `app` source carry the tonal **Reference** badge.
- **Reading on**: an article ends with Previous / Next in its own group's reading order, and Help
  reopens on the page last read (per browser) unless an address, link or jump names another.
- **Contextual help** is `DocPeek`: a 28px "?" beside a heading that opens a popover with the
  section's heading and opening prose and a **Read the full guide** link. `AdminPageHeader` takes it
  as `doc={docsHref(...)}`. App-only: the pages themselves keep plain `/docs/...` links, which the
  website serves and the app opens in Help.

### 6.10 Host elements (sp elements)

An **sp element** (`sp-popover`, `sp-menu`, `sp-message-body`, …; NOMENCLATURE, _host element_) is the
page's own behaviour offered to a plugin's remote component, so it carries **structure, not a
look** (R22): the element itself gets `.sp-<name>`, its parts the classes its `.d.ts` lists
(`.sp-popover-panel`, `.sp-progress-fill`), and the widget's own `class` passes through. An sp element sets
no `preset-*`, colour, radius or spacing beyond what the behaviour needs — a popover is positioned,
a progress bar is visible (`currentColor`), a form control uses Skeleton's base `input` / `textarea`
class so a dark theme never draws page-coloured text on a browser-white field. Everything else is a
skin's (§2.7 applies to skins as to screens). Popovers, menus and dialogs inside sp elements follow
§6.6; their portalled panels carry the widget box's skin scope (`data-skin-scope`), so a skin still reaches them.
Unstyled-but-correct is the accepted failure mode; broken is not. Core's own skin over the parts —
the §6.6 dialog, menu and tooltip recipes — is `src/lib/client/styles/hostElements.css`; a
popover's panel is left bare because its body is the widget's own card.

### 6.11 Admin pages

Ruled 2026-09-27 (the admin overhaul), and the same day: **admin is purely a view**, never a
page. The Admin view (`admin/AdminView.svelte`) holds the section list, grouped by the job
(Overview · Models · People · Play · Pipelines · Writing · Extensions · Pub,
`shell/adminNav.ts`), and the section on screen; at desk width the list (240px) sits beside the
section, below it they take turns. Sections are components (`admin/sections/**`) routed by
`adminRouter`, addressed under `/admin` only while the view is in Focus; `src/routes/admin/**` is
an empty catch-all so a link or a reload opens the view at that section. The section pane sits
on the view's 950 ground, so every admin card is `panel-card`. Every section opens with
`AdminPageHeader`: the **breadcrumb trail**, a 24px Display title, one sentence saying what the
section decides, and at most one filled primary among its actions. The group name is never
repeated in the title; the trail carries it.

**The pattern is Django admin's** (note 37, owner 2026-10-02: "use django admin as the example").
Every admin page is one of four shapes:

| Shape | Address | Built from | Used by |
| --- | --- | --- | --- |
| Index | `/admin` | cards that each answer one question and link to the fix | Overview |
| Changelist | `/admin/<section>` | `AdminChangelist` (`title` given, so it draws the header) | Connections, Sampling, Users, Sessions, Genres, Presets, Pipelines, Events, Configurations, Scripts, Prompts, the three template kinds, Plugins, Components, History |
| Add / change form | `/admin/<section>/new`, `/admin/<section>/:id` | `AdminChangeForm` + `AdminFieldset` + `AdminField` (+ `AdminInline`) | every changelist's objects, the pipeline workspace and the component editor included (their tools are the form's children; the save row is the form's); Events and History records are read-only change views (`AdminPageHeader` + fieldsets, no save row) |
| Settings form | `/admin/<section>` | one column of `.panel-card` cards, 820px, one topic per card | Defaults, General, Network, Data and backups, Updates, Diagnostics |

A **non-singleton** section is always changelist → change form → add / delete, each its own
address, never a list beside a detail (`AdminSplit` is retired). A **singleton** stays a settings
form with the breadcrumb. Read-only kinds (Sessions) are a changelist with no Add, no row link and
no bulk actions (Django's view permission); kinds that arrive with code (Genres, Pipelines) have no
Add and no Delete. **Events** is read-only too: a changelist (filters: family, declared by, genre,
bound) whose rows open a read-only change view — the event's facts, its genres and the presets that
bind it as `AdminInline`s with no Add another (a binding is edited on its preset's change form),
and the event map scoped by Genre / Preset in the view's own query, opening on the event's first
genre. Objects whose only make-path is a copy (Prompts) still have **Add**: the add form
asks what to start from.

**Breadcrumbs** (`AdminBreadcrumbs`, drawn by `AdminPageHeader`, worked out in
`components/admin/breadcrumbs.ts` from the address and `shell/adminNav.ts`): **Admin › <group> ›
<section> › … › <page>**, 13px muted, the last step in 950 ink with `aria-current="page"`, chevron
separators. The group is words (it has no page); the section links back to its changelist **as it
was left** — search, filters, sort and page (`rememberChangelistQuery`), Django's
`_changelist_filters`. Under 36rem of pane only the last two steps show. Nothing on the Overview.
Never hand-build a back link or a breadcrumb in a section.

**Admin never nests another view** (owner ruling 2026-09-27: "they need their own django admin
like management"). A section that manages objects a sidebar view also shows is a Django-style
**changelist** and **change form** built from the shared pieces in `components/admin/`, reusing
the view's field-level components (`ConnectionTypeForm`, `ConnectionStopScripts`,
`SamplingValuesForm`, `SamplingEnabledForm`, …), never its shell or navigation stack. A
schema-grouped editor gets **one fieldset per group** (Sampling: Core, Repetition, Budget, …;
`groupHeadings={false}` so the group is not named twice). An **immutable** object (a built-in
config) is readonly on its change form, offers **Duplicate** (`/new?from=<id>`) in the header, and
has no Delete; a bulk delete names it as kept, and when nothing selected can go the confirmation
offers only **Close**. A link out to the user's view opens it (`panelsCtx`), it does not
navigate the page.

**`AdminChangelist`** answers its own width with container queries (§5.3,
`@container/changelist`), never the viewport: under 45rem rows are **stacked** (the title as a
15px link, then the columns as a 12px muted facts line), from 45rem a table, and from 60rem the
**filter rail** (240px `panel-card`, Django's `list_filter`) stands beside the table; narrower,
filters are a 40px `ListFilter` button opening the §6.3 popout. Each facet is a `radiogroup` of
"All" plus its values with counts (counted against the other facets); an active filter shows as a
dismissible tonal chip under the toolbar with **Clear all**. Headers sort (`aria-sort`); stacked, a
Sort select does. Given a `title`, the changelist draws the section header with **"Add <thing>"**
as its one filled primary (dropped while the list is empty, where `EmptyState` carries it). A 40px
**action bar** carries the page's select-all (in the header cell when tabled), "N of M selected",
Django's **Select all N <things>** once the whole page is ticked, **Clear selection** and the
**Actions** `RowMenu` of **bulk actions** ("Delete selected <things>…", Make available / Hide,
Export…). Rows page 50 at a time through the Skeleton **Pagination** (numbers, ellipses, prev /
next), with the range ("51–100 of 230") and **Show all**. Search, filters, sort and page live in
the section's query (`q`, the facet keys, `o=-key`, `p=2`), never local state; a section's own keys
ride through with `keepQuery`.

**Delete asks on a confirmation page, not a dialog** (`AdminDeleteConfirm`, Django's "Are you
sure?"): the changelist or change form gives its place to it, with the trail "… › <object> ›
Delete". It lists each object that goes and, under it, what goes or changes with it, and names the
objects that **stay** and why (built-in, still in use where the server refuses, your own account) —
the content is `deletionFor` in `changelist.ts`, so every section words it the same way. **No, take
me back** is focused first; the destructive button names the count ("Delete 3 prompts"); when
nothing selected can go, only **Back** is offered.

**`AdminChangeForm`**: the trail, `AdminPageHeader` (tonal actions — Duplicate, Export — and a
**History** link to `/admin/history?type=<noun>&id=<id>`), an error summary (`role="alert"`, each
field error a button that focuses its field), then **`AdminFieldset`**s — a `panel-card` with a
14px `h2` and a muted sentence, or a `<details>` for **Advanced** — holding **`AdminField`** rows
(label, control, 12px help under it, the error above the help; no control means a readonly value,
never a disabled input). Related objects the object **owns** are an editable **`AdminInline`**
(Django's `TabularInline` formset, owner ruling 2026-10-02): a fieldset holding a small table
(stacked under 36rem, each column then a labelled control) whose rows are edited in place, with
**Add another <thing>** appending a row marked _Ready to add_ (an × drops it), a **Delete?** tick
per saved row (a protected row says why instead: _Built-in_), and a **Change** link to the row's own
change form where it has one. The rows are part of the parent's unsaved edits
(`components/admin/inlineRows.ts`: added / changed fields / deleted), committed by the parent's
Save, Save and continue or Save and add another, and dropped with the form. Relations the object
does **not** own (the pipelines that pick a prompt, the chains that run a script) stay
read-and-link: rows link to their own change forms, nothing is edited there. The **save row** is sticky at the foot of the pane on the 950 ground: **Delete**
(quiet error text) at the start, the unsaved-changes dot, then **Save and add another**, **Save
and continue editing** (Ctrl+S) and **Save**, the one filled primary. Save lands on the
changelist, continue stays (an add lands on the new object's change form), another opens the add
form (pre-filled from this object where the add form reads `?from=`). Under 36rem of pane the two
long saves fold into a §6.1 split button beside Save; `saveRowExtra` puts tonal **Review** /
**Discard** beside the unsaved-changes words (the pipeline workspace). Dirty state is
`UnsavedEdits` plus `adminUnsavedEdits`, so leaving asks first. **Every switch, tick and approval
on a change form waits for Save** (owner ruling 2026-10-02): a genre's switch, default preset,
presets and plugin swaps; a configuration's settings and **Offered** tick; a component's **Offered
to layouts** and scope review; a plugin's permissions, approval and storage quota; a connection's
model **Hide / Show** and **Use** (2026-10-03, listed under the table as _Waiting for Save_ chips,
each with an × that puts it back; `admin/sections/connections/modelEdits.ts`). Where the server
takes one setting per write, Save sends the difference as single writes in order
(`client/admin/sequentialSave.ts`, each an `awaitReply` on that verb's answer or its `:error`),
waits for every answer, and only then says _Saved_; a refusal is named in the error summary
("Offered: Quick start: …") and stays an unsaved edit. Every write a form sends must answer — a
handler that could return silently emits its `:error`. One-shot acts with their own button
(Duplicate, Unload, a configuration's New / Rename / Reset all / Delete) still act when pressed.
What saves on its own on the connection form (capabilities, stop scripts, a runtime's settings,
and the models' **Refresh**, **Add by name** and **Download / Cancel**, which are one-shot acts)
never joins the draft, and its fieldset says so. Save sends the connection first, then the model
levers, visibility before the defaults that need it.

History (`/admin/history`) is the one read-only log: a **changelist** with no Add and no bulk
actions, whose search and changelist filters — Object, Who, Action and **When** (Django's
`DateFieldListFilter`: Any date, Today, Past 7 days, This month, This year) — are applied by the
server from the address (`counted: false` filters list their full option set with no counts; the
search is sent after a 300ms pause; "Load older changes" under the list fetches the next page).
Each row opens the record's read-only **change view** (`/admin/history/:id`): the summary as title,
**Open <object>** and **This object's history** in the header, then a "Change" fieldset of
readonly fields and a "Changed fields" fieldset, and no save row. `?type=<kind>&id=<id>` is the
link a change form's History button uses; the one object it narrows to is a dismissible chip under
the header.

**Links name views, not pages.** Any plain `<a href="/admin/...">` or `/docs/...` anywhere in the
app opens the Admin or Help view in place (`shell/viewLinks.ts`, caught by the shell), keeping the
page underneath; a modified click still opens a tab. **Addresses can land on a field**: a
`#target` (an element id, a `data-field`, or a `SettingSwitch` name) scrolls it into view and rings
it once (`.sp-landed`, app.css); a heading's id rings its card. Needs you actions and Jump's
**Admin settings** rows (`shell/adminSettings.ts`, one row per field, drift-tested) land this way.

**Status is a dot plus words**, never colour alone: `error` for broken or needed-and-missing,
`primary` for something to act on, `success` for healthy, `surface-500` for off. The Overview's
**Needs you** list gathers the error and act-on-it items across sections, each with the button
that fixes it; the Admin view shows the same count above its list, and each section row carries
its own dot. A blocked action says why in one line beside it and links to the fix.

### 6.12 Code fields (the template editor)

A field that holds code (a context template, a variable layout) is `TemplateEditor`: a mono
`textarea` with the editor's help drawn around it, never a second editing surface. **Lint is a
wave under the text**, drawn by a transparent copy of the text laid over the field
(`decoration-wavy`, `decoration-error-500` for an error, `decoration-warning-500` for a
warning; never a filled highlight). The wave is decoration only: the **issue list** below the field is
the accessible surface. Each row is an icon plus the word (_Error_ / _Warning_) and the line, in
`text-error-600-400` or `text-warning-700-300`, never colour alone. A near-miss fix is a
`preset-tonal-surface` button that says what it types (**Use "message"**), also on **Ctrl+.**. The
completion list is a `role="listbox"` on `bg-surface-50-950` with a `border-surface-200-800` edge,
with the selected option in `.sidebar-row-active`. **"Variables available here"** is a `role="tree"`
with roving `tabindex` beside the field, in its own named container (`@container/tpl`, side by side from
40rem, stacked below). Its roots sit on **variable shelves**: level-one rows in `font-medium` with a
count, open by default, that open and close but never insert. Above it, a `PanelFilterInput`
(_Filter N variables_; ↓ enters the tree) with a polite live count; the tree scrolls inside
`max-h-[28rem]` so the box stays put. A root row carries its shape in plain words (_text_, _list_,
_keyed list_), the syntax it writes in mono, a _For example_ line, and the supplier, all in
`text-surface-600-400`. A root the template reads gets a `preset-tonal-primary` **Used** chip
with a check, a word and never colour alone. An unused root is unmarked. The heading carries a
`DocPeek`.

### 6.13 A message's folds

What a reply carries beside its text folds **above** the body, collapsed on load, in one fixed
order: a narrator's instructions, then its folded sections (a **Plan**, a stage's notes), then
**Reasoning** (which fills in while it streams), then the reply. Each fold is a full-width `<button type="button" aria-expanded
aria-controls>` holding a glyph, a sentence-case label and a chevron that turns when open; its
panel stays mounted (the 0fr → 1fr track) and its contents leave the tab order while closed. A
section that is a list renders as a list, one item per line, never as JSON. The style packs skin
the message but never reach the folds: a pack decides how a reply looks, not whether its Plan is
there.

### 6.14 Unsaved changes

A form that buffers edits behind a Save asks before they are lost — and **only** then. A false
_Discard unsaved changes?_ teaches people to click through the real one, so the rule is strict in
both directions (2026-09-27):

- **Unsaved means different from what is saved, not "touched".** Dirty is derived, never set by
  an effect or a typed-anything flag: `UnsavedEdits` (`client/forms/unsavedEdits.svelte.ts`) holds
  a **saved snapshot** and compares the draft to it with `sameFormValue`
  (`client/forms/sameFormValue.ts`). Key order never counts; `null`, `undefined`, `""` and `[]`
  are one empty; `"5"` from an input equals `5`; arrays are ordered unless the form names the
  path `unordered` (tags, ids picked from a list). Changing a value and changing it back is clean.
- **The snapshot is the draft as the form built it** (`adoptSaved`, `markSaved()` after a load),
  so a form that trims, splits or fills defaults on load is not dirty the moment it opens.
- **Save resets it, and a push never lies.** Each push of the saved row moves the snapshot
  (`adoptSaved`): a clean form follows the row; an edited form keeps the person's edits and stays
  dirty only while they differ from what is now saved — so the echo of its own save is clean and
  another tab's save never wipes what is being typed. Delete or Create-then-leave calls
  `forget()` first.
- **A Save form holds every edit, or says which ones it doesn't** (2026-10-02). Adding,
  removing or switching something inside a form with a Save is a pending change ("Ready to add"
  on a row not yet saved), counted in dirty, sent on Save, dropped with the form. A control that
  must write as it moves (a preset, an action toggle, a per-call pipeline setting) carries the
  words **Applies at once** on its label or help line, and the tab says the rule once at its top.
  An admin change form has none (2026-10-02): its switches wait for Save, and Save waits for
  every write it sends (§6.11).
  A one-shot action with its own button or dialog (Apply, Upgrade, Reassign…) is explicit and
  needs no marker. Reference: Edit session.
- **Write-only fields** (a token, a passphrase) have an empty snapshot, are cleared once sent,
  and carry `autocomplete="off"` / `"new-password"` so a password manager's fill is never an edit.
- **One question, one dialog.** In the Admin view a section registers
  `adminUnsavedEdits(() => dirty)`; another section, Back, closing the view, and the section list
  replacing the section below desk width all ask through `AdminUnsavedChangesModal` (**Keep
  editing** · **Discard**) via `adminRouter.confirmDiscard()` — never `window.confirm`. Other views
  answer their shell close gate with their own unsaved-changes modal. The tab asks on reload
  (`warnBeforeUnload`) only while something is unsaved — the lorebook workspace included.
- **Ask first, then discard — never the other way round** (lorebooks plan B7, 2026-10-03). A
  selection change that would close an edit (a canvas pick, a dropped row, the pencil) awaits the
  guard (`loreRoute.confirmLeave()`), and only on Leave drops the draft and clears the guard flag
  in the same step, so the transition that follows is not asked about it again. A held value
  (a date a drop asked for) is held only after the answer, and only for the row it was meant for.
  A draft that moves with the reading (the moment bar) keeps the moment it was typed at; moving
  the reading never asks.

### 6.15 The setup wizard

The home route's first-run wizard (`src/routes/+page.svelte`, ruled 2026-09-27) is one decision per
screen, in a card at most `max-w-2xl` wide.

- **Progress** is one 4px bar per step still on the person's road — filled `primary-500` up to and
  including the current step, `surface-300-700` after — with the step's sentence-case label under
  it (`sm` and up; below that a single "Step 2 of 5 · Choose an LLM" line). Finished steps are
  buttons back to themselves; the current one carries `aria-current="step"`. Steps that only one
  answer leads to (Character, Who you are) appear once that answer is chosen, so the count never
  promises screens the person will not see. No numbered circles.
- **A choice is a whole-card button** (`CHOICE_CARD`: the dashboard's inset card — `surface-50-950`
  ground, `surface-200-800` border, radius 14): a 40px tonal icon tile, a semibold title, a muted
  one-line explanation in plain words, and the trade as tonal chips (_Private · Free · Costs per
  message_). At most one option wears a `preset-tonal-primary` **Recommended** chip. A selected
  card adds `ring-2 ring-primary-500` and a check (§2.4); it is never filled.
- **The footer** holds **Back** (tonal) on the left and the screen's one primary on the right. A
  step that waits on work elsewhere says so in a `role="status"` line and moves on by itself when
  the fact it waits for lands — never a "Done" button the person has to remember to press.

### 6.16 Widget parts

🚧 _Stub, ruled 2026-09-27; the markup moves in phases (plans/DESIGN-default-widget-stylesheet
§2.9)._ A session widget's markup carries **no look**: no spacing, type, colour, radius or
`preset-*` classes. Its elements carry **widget parts**, stable names in one attribute, and a
style draws them.

- **Carrier:** `data-widget-part`, a whitespace-separated token list, selected with `~=`:
  `[data-widget-part~="stats.card"]`. Never `id` (widgets repeat), never `data-part` (Skeleton's
  Zag vocabulary: `trigger`, `list`, `item` sit in the same boxes), never a class (classes are
  what a style grants).
- **Grammar:** `<part owner>.<part name>`. The **part owner** is whoever draws the element: the
  widget, by its widget id (`stats.card`, `world-state.place`, `scene-portraits.face`; a plugin
  writes its whole plugin widget id, `acme:map.pin`, and the last `.` splits), or a **shared
  control** core draws inside several widgets, by its own name (`stat-slot.bar`: the slot control
  World State and Stats share). A shared control's parts are the same in every widget, so a style
  draws them once and scopes them to one widget through ancestry:
  `[data-widget-part~="stats.root"] [data-widget-part~="stat-slot.bar"]`. A shared control's name
  is qualified (never bare `slot`, the pipeline word) and never a widget id. Or a bare **generic
  part** from core's closed list (`card`, `card-head`, `list`, `row`, `label`, `value`, `meter`,
  `chip`, `empty`, `toolbar`; fixed in P4) that any widget may use to look native. One element can
  carry both, the owner's first: `stats.card card`. An element that is one of a kind and also
  which one names both (`stat-slot.add stat-slot.field`). A
  part name is kebab-case, singular, and says what the element is, never how it looks. State stays
  in the widget's own `data-*` (`data-retired`, `data-empty`, `data-density`), never in a part
  name.
- **Who styles them, lowest first:** the theme's tokens → the **default widget stylesheet**
  (`src/lib/client/styles/widgets.css`, `@layer sp-widgets`, page-loaded) → a style preset or a
  person's style (unlayered, scoped to its mount's skin scope `[data-skin-scope]`, so it always wins). A plugin
  brings its own stylesheet, and its own classes and Tailwind utilities still work on top. Deferring
  to the parts is encouraged.
- **Until the markup moves:** `@layer sp-widgets` is ordered **after** `utilities` (`app.css`), so
  it beats the utilities still baked into core's markup the way the unlayered files it replaced
  did. It drops below `components` once no core widget carries utilities (phase P3 exit).

**Parts by widget.** This table is the one list of each widget's parts, and each shared
control's (NOMENCLATURE §9 points here). A phase that strips a widget's markup adds its row. Until P4 the sheet has no rules for the
generic tokens, so they name what an element is and draw nothing yet.

| Widget  | Parts (widget-specific first, then generic)                                                                                                                                                                                  | State on the widget's own `data-*`                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stats   | `stats.root` (the box) · `stats.alert` (a refusal or failed read) · `stats.empty empty` (the empty floor) · `stats.card card` · `stats.card-head card-head` · `stats.card-name` · `stats.card-note` (a member with nothing to show) · `stats.card-body list` | `data-density` (`full` · `compact`) on `stats.card-body`; rows are the slot control's (`stat-slot.*`, below) |
| World State | `world-state.root` (the box) · `world-state.alert` (a refusal or failed read) · `world-state.empty empty` (the empty floor) · `world-state.place` (a location in play, a group rather than a card) · `world-state.place-head` (no generic `card-head`: a place is not a card) · `world-state.place-name` | `data-layout` (`strip` · `list`) on `world-state.root`; rows are the slot control's (`stat-slot.*`, below) |
| Scene Portraits | `scene-portraits.root` (the box) · `scene-portraits.alert` (a refusal) · `scene-portraits.alert-text` · `scene-portraits.dismiss` (the alert's close) · `scene-portraits.empty empty` (the empty floor) · `scene-portraits.scene` (the faces' row) · `scene-portraits.face` · `scene-portraits.face-img` · `scene-portraits.face-name` · `scene-portraits.set-menu` (the `sp-popover` in a face's corner) · `scene-portraits.set` (the sprite-set pill) · `scene-portraits.set-name` · `scene-portraits.set-panel` (the popover's body) · `scene-portraits.set-title` · `scene-portraits.set-list` · `scene-portraits.set-option` · `scene-portraits.set-note` · `scene-portraits.pins` (the pinned source's two cells) · `scene-portraits.pin` · `scene-portraits.pin-img` · `scene-portraits.pin-clear` · `scene-portraits.pin-placeholder` (an unpinned side); the mini bars: `scene-portraits.bars list` · `scene-portraits.bar row` · `scene-portraits.bar-label label` · `scene-portraits.bar-track meter` · `scene-portraits.bar-fill` | `data-blank` on `scene-portraits.face-img` (a member with no picture); a bar's fill is the inline `--sp-fill` |
| Lore entries | `lore-entries.root` (the box) · `lore-entries.note` (said instead of the list: the book is its owner's, or there is none) · `lore-entries.search-bar toolbar` · `lore-entries.search` (the field's label box) · `lore-entries.search-label` (screen reader only) · `lore-entries.search-icon` · `lore-entries.search-input` · `lore-entries.refresh` · `lore-entries.filter-bar toolbar` · `lore-entries.filters` (the radio group) · `lore-entries.filter chip` (a pill) · `lore-entries.filter-input` (its radio, unseen over it) · `lore-entries.sort` · `lore-entries.sort-field` (the `sp-combobox`) · `lore-entries.alert` (a refusal or failed read) · `lore-entries.held` (a mark saved to the entry that a dated amendment still decides in the session: muted, not the error tone) · `lore-entries.entries list` · `lore-entries.entry row` · `lore-entries.entry-text` · `lore-entries.entry-title label` · `lore-entries.entry-keys` · `lore-entries.entry-read` · `lore-entries.marks` · `lore-entries.pin` · `lore-entries.off` · `lore-entries.empty empty` (the empty floor) · `lore-entries.pager` · `lore-entries.previous` · `lore-entries.page-count` · `lore-entries.next` | `data-off` on `lore-entries.entry` (turned off: its title struck through); a pressed mark is its button's `aria-pressed`, the chosen filter its radio's `:checked` (native state, no widget attribute) |
| Author's note 🚧 | `authors-note.root` (the box) · `authors-note.note` (said instead of the form, or above it: the genre has none, only the owner may change it) · `authors-note.alert` (a failed read or a refused save) · `authors-note.field` (a label box) · `authors-note.label label` · `authors-note.text` (the note's textarea) · `authors-note.numbers` (depth and interval side by side) · `authors-note.number` · `authors-note.help` · `authors-note.advanced` (the `sp-accordion` fold: Sent as) · `authors-note.role` · `authors-note.role-field` (the `sp-combobox`) · `authors-note.actions toolbar` · `authors-note.unsaved` · `authors-note.discard` · `authors-note.save` · `authors-note.last-reply` (what the newest reply did with the note) | `data-dirty` on `authors-note.root` while the draft differs from what is saved (§6.14); `data-applied` on `authors-note.last-reply` when the newest reply carried the note; a field the viewer may not change is its own `disabled` |
| Slot control (shared: World State, Stats) | `stat-slot.root row` (one slot) · `stat-slot.label label` · `stat-slot.required` (the `*` a sheet asks for) · `stat-slot.control` (the value's cell); read: `stat-slot.bar` (a bounded number, a button) · `stat-slot.track meter` · `stat-slot.fill` · `stat-slot.bar-value value` · `stat-slot.chip chip` (a choice, or a switch) · `stat-slot.option` (a choice's menu item) · `stat-slot.line value` (text, a list, a story time); edited: `stat-slot.field` (every input, beside which one it is) · `stat-slot.editor` (an open list or story time) · `stat-slot.items list` · `stat-slot.item row` · `stat-slot.item-text label` · `stat-slot.item-less` · `stat-slot.item-more` (a held entry's − and +) · `stat-slot.item-up` · `stat-slot.item-down` · `stat-slot.item-remove` · `stat-slot.items-empty empty` · `stat-slot.add` · `stat-slot.invalid` (what was refused) · `stat-slot.done`; the lorebook picker: `stat-slot.pick-open` · `stat-slot.picker` · `stat-slot.pick-search` · `stat-slot.pick-status` · `stat-slot.pick-heading` · `stat-slot.pick-list list` · `stat-slot.pick-entry row` · `stat-slot.pick-title label` · `stat-slot.pick-held` · `stat-slot.pick-add toolbar` · `stat-slot.pick-count` · `stat-slot.pick-confirm` · `stat-slot.pick-close`; a story time: `stat-slot.year` · `stat-slot.month` · `stat-slot.day` · `stat-slot.clock` · `stat-slot.save` · `stat-slot.cancel` | On `stat-slot.root`: `data-density` (`full` · `compact`), `data-retired`, `data-slot-shape` (`derived` · `story-time` · …); `data-empty` on a chip, line or option with nothing to show; a switch that is on and a chosen picker row are `aria-pressed`, a refusal `role="alert"` |
| Messages: the selection bar and who is due next (P3f) | the selection bar: `messages.selection-bar toolbar` (selecting lines for a summary; it stands where the composer was) · `messages.selection-count` · `messages.selection-bulk` (Select all, Select none) · `messages.select-all` · `messages.select-none` · `messages.selection-finish` (Cancel, or a summary) · `messages.selection-cancel` · `messages.summarize-scene` · `messages.summarize-world` · `messages.summarize-character` · `messages.selection-button` (every button on the bar, beside which one it is) · `messages.selection-button-label` (its label, gone in a box under 40rem); the read-only banner: `messages.read-only` · `messages.read-only-icon` · `messages.read-only-text` · `messages.read-only-title`; who is due next: `messages.next-up` (its place above the field) · `messages.next-up-waiting` (nobody at the head: waiting, with Pick) · `messages.next-up-head` (someone is due) · `messages.next-up-line` · `messages.next-up-narrator` (the narrator's book, in place of a face) · `messages.next-up-text` · `messages.next-up-controls` · `messages.next-up-pick` (Pick, and Someone else: both open the turn picker) · `messages.next-up-pick-label` · `messages.next-up-continue` · `messages.next-up-after` (who follows, with `nextUp: list`) | A summary button with nothing selected is its `disabled`; the banner is `role="status"`. Which shape who-is-due-next takes is the page's (the order's head, the `nextUp` setting), never a part |
| Messages: the composer and a line's editor (P3g) | the compose block: `messages.compose` (on the reading column: the page's banners, who is due next and the composer's area) · `messages.compose-area` (the composer, or the selection bar or read-only banner standing in its place); the composer: `messages.composer` (its root) · a guest's offer `messages.join` · `messages.join-text` · `messages.join-icon` · `messages.join-title` · `messages.join-note` · `messages.join-button`; above the card: `messages.composer-disclosure` · `messages.composer-disclosure-bar` · `messages.composer-actions-toggle` · `messages.composer-actions-chevron` · `messages.composer-notice` (the retrieval notice's place) · `messages.composer-actions-row` · `messages.composer-chips` (the one row of chips, beside which `messages.composer-actions`: the turn controls, the genre's actions, More and the legend, one chip style — note 30) · `messages.composer-more-actions` (the overflow's trigger) · `messages.composer-new-dot` · `messages.composer-overflow-item` · `messages.composer-overflow-slash` · `messages.composer-overflow-note` · `messages.composer-new` (a newcomer's badge, in the overflow and the palette); the card: `messages.composer-card` · `messages.composer-meter` · `messages.composer-meter-fill` · `messages.composer-body` · `messages.composer-pane-head` · `messages.composer-pane-title` · `messages.composer-back` (Back to compose) · `messages.composer-preview` · `messages.composer-palette` · `messages.composer-palette-row` · `messages.composer-palette-button` · `messages.composer-palette-slash` · `messages.composer-palette-label` · `messages.composer-palette-note` · `messages.composer-field` (the `sp-composer-field`; the field itself is its `textarea`); the footer: `messages.composer-footer` · `messages.composer-channels` · `messages.composer-channel` · `messages.composer-persona` (a chip, or a switch) · `messages.composer-persona-name` · `messages.composer-persona-menu` · `messages.composer-persona-menu-title` · `messages.composer-persona-option` · `messages.composer-persona-option-name` · `messages.composer-footer-end` · `messages.composer-icon-button` (Preview and More, beside which: `messages.composer-preview-toggle` or `messages.composer-more`) · `messages.composer-panes` (More's panel) · `messages.composer-panes-title` · `messages.composer-panes-list` · `messages.composer-pane-option` · `messages.composer-send` · `messages.composer-stop`; under it: `messages.composer-warning` · `messages.composer-hint` · `messages.composer-key`; a line's editor (MessageComposer): `messages.edit-tabs` · `messages.edit-tab` · `messages.edit-tab-body` · `messages.edit-tab-label` · `messages.edit-more-tabs` · `messages.edit-more-tabs-button` · `messages.edit-more-tabs-body` · `messages.edit-more-tabs-label` · `messages.edit-more-tabs-icon` · `messages.edit-more-tabs-panel` · `messages.edit-more-tabs-title` · `messages.edit-more-tabs-list` · `messages.edit-more-tabs-option` · `messages.edit-row` · `messages.edit-left` · `messages.edit-panels` · `messages.edit-right` · `messages.edit-field` · `messages.edit-preview` · `messages.edit-preview-body` · attachments: `messages.composer-drop` (the card's `sp-drop-zone`) · `messages.composer-attach` (`sp-file-picker`) · `messages.composer-attach-button` · `messages.composer-tray` · `messages.composer-tray-item` · `messages.composer-tray-thumb` · `messages.composer-tray-icon` · `messages.composer-tray-name` · `messages.composer-tray-progress` · `messages.composer-tray-refusal` · `messages.composer-tray-remove` · `messages.composer-readers-button` (More › What can be attached) · `messages.composer-readers` (that dialog's body) · `messages.composer-readers-line` · `messages.composer-readers-kinds` · `messages.composer-readers-kind` · `messages.composer-readers-reason` · `messages.composer-readers-calls` · `messages.composer-announce` (the live region) | `data-composer-skin` (`classic` · `minimal` — one row, the face, the field, round icons · `writer` · `quill` — no box, the story's prose on a faint `--sp-quill-rule` underline, Send only while there is a draft; the widget's `composer` setting) on `messages.composer` and the widget's root; the composer is `hidden` while a line is edited; a highlighted palette row is its option's `aria-selected`, a refused one `aria-disabled`; Actions open is `aria-expanded`; Preview pressed and the chosen channel are `aria-pressed`; the persona written as is `aria-current`; More while a pane holds the field is `data-active`, that pane's row `data-current`; Send while someone is due next is `data-someone-due`; the meter's fill past 90% is `data-high`; an editor tab that folds into More in a narrow box is `data-collapsible`, More's trigger while a folded tab is chosen `data-active`, and its row `data-current`; a tray tile is `data-status` (`uploading` · `ready` · `refused`) and `data-kind`; a kind that may be attached is `data-allowed`; the readers disclosure open is `aria-expanded` |
| Messages: the message and the log (P3h) | the box and the log: `messages.root` (the widget's box: its palette, `--sp-measure`, the settings as `data-*`) · a copy pinned to one channel names it (S1, the Lair's Sanctum panel): `messages.channel-head` (one row across the box's top, first whichever end the composer is at) · `messages.channel-icon` · `messages.channel-title` (the channel's declared label) · `messages.log` · `messages.log-body` · `messages.log-scroll` (the `sp-scroll`) · `messages.stage` (the log's rows: as wide as the compose block — the box, or the measure under Line width: Comfortable) · `messages.stage-body` · `messages.message-list list` · `messages.log-item` (a marker's place in the list) · `messages.history-marker` (a history entry's date; beside which `messages.history-start`, Start a new entry) · `messages.scene-title` · `messages.scene-title-state`; said instead of lines: `messages.log-floor` (beside which `messages.log-note`, not granted · `messages.log-loading` · `messages.log-empty empty`) · `messages.log-floor-icon` · `messages.log-loading-icon` · `messages.log-floor-text` · `messages.older-loading` · `messages.older-loading-body` · `messages.older-loading-icon`; a line: `messages.message-row` (its `li`) · `messages.message` (the four-cell grid) · `messages.message-avatar` · `messages.message-avatar-button` · `messages.message-avatar-img` · `messages.message-avatar-glyph` · `messages.message-identity` · `messages.message-name` · `messages.message-badges` · `messages.message-badge` (beside which `messages.message-badge-scene`) · `messages.message-badge-label` (screen reader only) · `messages.message-badge-text` · `messages.message-vectors` · `messages.message-status` · `messages.message-ember` · `messages.message-controls` · `messages.message-time` · `messages.message-swipes` · `messages.message-swipe-previous` · `messages.message-swipe-count` · `messages.message-swipe-next` · `messages.message-actions` (the quick icons, the message venue's primary set) · `messages.message-action` · `messages.message-icon-button` (every icon control on the row, beside which one it is) · `messages.message-menu` (the ⋮ menu's place, where the selection controls stand while selecting) · `messages.message-selection` · `messages.message-selection-button` (beside which `messages.message-select` · `messages.message-select-above` · `messages.message-select-below` · `messages.message-in-scene`) · `messages.message-selection-label` · `messages.message-stop` · `messages.message-cancel` · `messages.message-save` · `messages.message-content` · `messages.message-disclosures` · `messages.message-disclosure` · `messages.message-disclosure-toggle` · `messages.message-disclosure-track` · `messages.message-disclosure-clip` · `messages.message-disclosure-panel` · `messages.fold-list` (a folded section's items) · `messages.message-sizer` · `messages.message-body` · `messages.message-text` · `messages.message-parts` · `messages.message-failure` · `messages.message-partial` · `messages.message-error` · `messages.message-error-line` · `messages.message-error-icon` · `messages.message-error-detail` · `messages.message-retry` · `messages.prose` (every rendered prose: a body, a disclosure's panel, a part's markdown, a block's; set in the two tones); a line being edited: `messages.edit-surface` · `messages.edit-hint` · `messages.edit-key` · `messages.edit-hint-separator` · `messages.edit-unsaved`; the ⋮ menu: `messages.message-options` · `messages.message-options-button` · `messages.message-options-panel` · `messages.message-options-title` · `messages.message-options-list` · `messages.message-option` · `messages.message-option-note` (screen reader only) · `messages.message-option-new` · `messages.message-options-divider`; a reply's typed parts: `messages.part-disclosure` · `messages.part-disclosure-toggle` · `messages.part-disclosure-chevron` · `messages.part-disclosure-track` · `messages.part-disclosure-clip` · `messages.part-disclosure-panel` · `messages.part-step-divider` · `messages.part-markdown`; the media strip (a message's images and files as square tiles below its card, a cell of `messages.message` after the content, in every state; composer attachments §3.4, note 40): `messages.media-strip` · `messages.media-images` · `messages.media-files` · `messages.media-item` · `messages.media-tile` (every image) · `messages.media-tile-img` · `messages.media-more` (the count past six) · `messages.media-missing` · `messages.media-missing-text` · `messages.media-file` (a file's tile, its download link) · `messages.media-file-name` · `messages.media-file-size` · `messages.media-remove` (editing, when the host offers a removal); a block tree: `messages.blocks` · `messages.block-markdown` · `messages.block-kv` · `messages.block-kv-label` · `messages.block-table-scroll` · `messages.block-table` · `messages.block-stat` · `messages.block-stat-head` · `messages.block-stat-label` · `messages.block-stat-value` · `messages.block-stat-track meter` · `messages.block-stat-fill` · `messages.block-image` · `messages.block-superseded` · `messages.block-choices` · `messages.block-caption` · `messages.block-answered` · `messages.block-answered-label` · `messages.block-awaiting` · `messages.block-choice-list` · `messages.block-choice` · `messages.block-form` · `messages.block-field` · `messages.block-field-label` · `messages.block-checkbox` · `messages.block-select` · `messages.block-input` · `messages.block-submit` · `messages.block-group`; the state ledger: `messages.ledger` · `messages.ledger-line` · `messages.ledger-owner` · `messages.ledger-separator` · `messages.ledger-change` · `messages.ledger-review` · `messages.ledger-review-panel` · `messages.ledger-review-title` · `messages.ledger-review-note` · `messages.proposal` · `messages.proposal-text` · `messages.proposal-anchor` · `messages.proposal-note` · `messages.proposal-decide` (beside which `messages.proposal-accept` or `messages.proposal-reject`) | On `messages.root`: `data-channel` (the channel a copy is pinned to; absent on the primary log) · `data-order` · `data-composer-position` · `data-composer-skin` · `data-line-width` (`full` · `comfortable`) · `data-show-messages` · `data-show-avatars` · `data-show-timestamps` · `data-show-scene-markers`. On `messages.message`: `data-msg-role` · `data-msg-author` · `data-msg-state` (`normal` · `selected` · `dim` · `editing`) · `data-msg-generating` · `data-msg-hidden` · `data-msg-greeting` · `data-msg-newest`; the row is `hidden` (the attribute) off the current channel and carries `--sp-scene` in a scene, `data-arrive` as it lands; `data-settled` on the sizer; `data-streaming` on `messages.message-text` while text arrives; `data-vectors` (`current` · `stale`); a toggle's `aria-expanded` (the part chevron turns) and its track's `data-expanded`; a line chosen for a summary is its Select button's `aria-pressed`; in the ⋮ menu a core verb's row says which (`data-verb`: Delete and Stop take the error's tone), Hide while hidden is `aria-pressed`, a row the line refuses `aria-disabled`; the media strip's `data-layout` (`preview` · `tiles`) and `data-editing`; a block tree's `data-depth`, a group's `data-layout` (`row` · `column`), a choice or form's `data-answered`, a superseded form's or proposal's `data-superseded` |

Stats carries no class at all (P3a, 2026-09-28): even `truncate` on the member's name moved into
the sheet, because cutting a name rather than wrapping it is a look a skin may change.
World State followed (P3b, 2026-09-28): its strip-or-list layout is `data-layout` on the root,
not a class, and the place's `truncate font-semibold` name moved the same way.
Scene Portraits followed (P3c, 2026-09-28), Skeleton classes included: the sheet writes what
`btn-icon`, `card`, `btn btn-sm`, `preset-tonal-surface` and the app's `popover-menu-*` compiled to,
with their hover, focus-visible, active and disabled rules and the pill's coarse-pointer 44px
target. A popover's body is portalled to `<body>`, and part selectors still reach it, so it takes
parts like any element. A face with no picture is the same part in a `data-blank` state; an
unpinned side is a different element, so it is its own part (`pin-placeholder`).
Lore entries followed (P3d, 2026-09-28): Skeleton's `input`, `btn-icon btn-icon-sm`, `btn btn-sm` and the
tonal presets written into the sheet with their states, and the `pointer-coarse:` 44px targets as
`@media (pointer: coarse)`. Where a state is already native or ARIA, the sheet reads it rather than
the widget restating it: a chosen filter is `:has(> …:checked)`, a pressed mark `[aria-pressed="true"]`.
Only a state with no native carrier gets a `data-*` (`data-off`).
The slot control followed (P3e, 2026-09-28), as the first **shared control**: its parts are its own
(`stat-slot.*`), whichever widget draws it, so one rule draws a slot in World State and in Stats
alike and a style scopes it to one widget through ancestry. Every input is `stat-slot.field` plus
which field it is (`stat-slot.add stat-slot.field`), so a style reaches all of them or one.
Skeleton's `input` is written into the sheet as it compiles, focus ring included, and the coarse
44px targets stay `@media (pointer: coarse)`. A value with nothing to show (unset, or a list with
nothing in it) is `data-empty`, a state rather than a part.
The conversation's selection bar, its read-only banner and its who-is-due-next line followed (P3f,
2026-09-28), all `messages.*` (the part owner is the widget, whichever of its components draws the
element). Skeleton's `btn btn-sm`, the five `preset-filled-*` tones and the two `preset-tonal-*` banners
are written into the sheet as they compile, and so are the app's `.composer-send` (Continue) and
`.composer-quiet-btn` (Pick, Someone else), which left `app.css` with the composer (P3g). The part is `next-up`, after the widget's `nextUp` setting, never the retired `showNudge`'s
_nudge_. **Viewport variants:** the `sm:` pair (the bar's labels shown from 40rem, Someone else's said
to a screen reader only below it) now answers the widget's box, `@container sp-widget`, as §5.3 asks;
the `lg:` pair (the bar's rounded top from 64rem, Continue's 44px below it) moved with the
composer's own in P3g (below). At the gate's 1440 the box is 1112px, and at 820 and 390 it is the
viewport's width, so neither side moved where it is measured; the container rule differs only where
a box is narrower than its window.
The composer followed (P3g, 2026-09-28): SessionComposer, MessageComposer (a line's editor) and the
compose block's wrappers carry no class. The compose block is `messages.compose` (the old
`sp-compose sp-column`: it shares the reading column's rule with the log's rows, which keep
`.sp-column` until P3h) and the composer's area `messages.compose-area` (the old `sp-field`). app.css's
unlayered `.composer-*` rules, their `[data-composer-skin]` variants included, now live in the sheet
keyed on parts; `.composer-send`, `.composer-quiet-btn` and `.sp-action-new-dot` are gone (nothing
wears them). The field is its host's: `sp-composer-field` draws a `textarea` that wears Skeleton's
`textarea` unless a widget passes `field-class`, and a part carries no class, so the field's rules put
back what that default adds (a block box, its colour, the ring, the transparent outline, the
placeholder's colour). State reads what is native: a palette row's `aria-selected` /
`aria-disabled`, Preview's and a channel's `aria-pressed`, the persona's `aria-current`, the
composer's `hidden` while a line is edited; only what has no native carrier is `data-*`
(`data-someone-due` on Send, `data-active` on More, `data-current` on a pane's row, `data-high` on the
meter's fill, `data-collapsible` on an editor tab). **Viewport variants:** every `lg:` / `max-lg:` rule
of the composer, the editor, the selection bar and Continue is `@container sp-widget` at 64rem (the
join heading's `h3` step at 48rem), so the composer and the bar change together: from 64rem the
composer has 1rem under it and the bar a rounded top; below it Send, Stop, Continue, Preview, More,
the persona and a channel are 44px. The box is 1112px at the gate's 1440 and the viewport's width at
820 and 390, so nothing moved where measured. **Behaviour change:** where the conversation's box is
narrower than 64rem while the window is wider (a side zone, a split middle, the middle beside docked
sides, e.g. a 1280px window with both sides docked), the composer now takes its narrow form (the
44px controls, 0.5rem under it, the bar's square top); where a window is narrower than 64rem nothing
changed.
The message and the log followed (P3h, 2026-09-28): MessagesWidget's root and log, SessionContainer,
SessionMessage, MessageControls (the ⋮ menu), MessagePartsView, MessageBlocksView and the state ledger
carry no class; the markup is `messages.*` parts only (`messages.message-*` for a line, never an
abbreviation). The reading column the log's rows sit on is `messages.stage` (the stage, NOMENCLATURE §23); every
rendered body is `messages.prose` as well as its own part, so one rule sets the prose's two tones
(`--sp-body` / `--sp-quote`, read at the end of messageLayouts.css). The packs select the same parts
(`[data-widget-part~="messages.message"]`, …). app.css's `.msg-ctrl-*` (the selection controls' box,
with `:root --msg-ctrl-size`), `.popover-menu-btn` / `-title` and `.sp-action-new` moved into the sheet
and were deleted (no users left); the selection controls' viewport step is `@container sp-widget` at
64rem, with the composer's. State stays native where it can (`aria-pressed`, `aria-disabled`,
`aria-expanded`, the row's `hidden`); what has no carrier is `data-*` (`data-verb` on a core verb's
menu row, `data-vectors`, `data-streaming`, `data-depth`, a block group's `data-layout`).
This phase was not held to zero pixels (owner, 2026-09-28): the look was checked by eye across the
five packs at 1440 and 390, dark and light. Compact now drops the text under its name row in a box
under 36rem (it had squeezed it to a sliver). **Dreamlit Cameo** was redrawn after Moonlit Echoes'
*Echo* style: a glass card per line, the speaker's portrait large and unframed in the card's leading
edge (the persona's trailing), fading toward the text and at the bottom, the text clear of its leading
part; under 36rem the portrait sits behind the text, faint. The pack no longer makes every child of its
scope an inline-size container (`:root > *`), which had reached the portalled ⋮ menu and given it a 0px
box.

**Widget tokens.** The default sheet draws its shared looks from `--sp-w-*` custom properties,
declared once on `:root` inside `@layer sp-widgets` (so they resolve in a WidgetHost box, in a
popover portalled to `<body>`, and in a mount with no host). Set one in a style's `vars` (it
lands on the widget's box and inherits down) or in a theme, and every widget that draws that
role follows, with no selector written. A token names the role it governs, never its value; a
new shared look gets a token only when it recurs or is a role a skin would retune. The defaults
are today's look exactly (P2 changed no pixel), including off-grid sizes a later look phase may
move onto §3.2 and §4.

| Token                                                   | Default                     | Governs                                                                                                    |
| ------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--sp-w-card-bg`                                        | `currentColor` 6% wash      | A card's ground (a Stats card) and an inset panel inside one (the items picker)                            |
| `--sp-w-card-radius`                                    | 0.5rem                      | A card's corners, and a portrait framed like one (Scene Portraits)                                         |
| `--sp-w-card-pad` · `--sp-w-card-gap`                   | 0.45rem 0.55rem · 0.3rem    | A card's padding; the gap between its head and body                                                        |
| `--sp-w-chip-bg` · `--sp-w-chip-on-bg`                  | 12% · 30% wash              | A chip or pill (a slot's value chip, the ledger's Review pill); a chip that is chosen                      |
| `--sp-w-chip-radius` · `--sp-w-chip-pad`                | 999px · 0.05rem 0.4rem      | A chip's pill shape (also the proposal's decide pill and the sprite-set pill); its padding                 |
| `--sp-w-control-bg`                                     | 12% wash                    | A small text button inside a widget (Done, Save, Cancel; the picker's open, confirm and close)             |
| `--sp-w-control-radius` · `--sp-w-control-pad`          | 0.3rem · 0.05rem 0.45rem    | Those buttons' corners (also a text-value slot and a picker row) and padding                               |
| `--sp-w-icon-button-radius` · `--sp-w-icon-button-pad`  | 0.25rem · 0.1rem            | A quiet square icon button (move, remove, − and + beside a held entry)                                     |
| `--sp-w-hover-bg`                                       | 12% wash                    | Those icon buttons' hover                                                                                  |
| `--sp-w-meter-track-bg` · `--sp-w-meter-fill-bg`        | 16% · 62% wash              | A meter's track (a slot's bar) and its fill (the slot's bar and the portraits' mini bars)                   |
| `--sp-w-meter-radius` · `--sp-w-meter-height`           | 999px · 0.55rem             | Every meter's track and fill corners; a slot bar's track height                                            |
| `--sp-w-empty-pad` · `--sp-w-empty-gap`                 | 0.75rem · 0.5rem            | A widget's empty floor (Stats, Scene Portraits): its padding and the gap between its lines                 |
| `--sp-w-font-head`                                      | 0.76rem                     | A card's head line (a cast member's name on a Stats card)                                                  |
| `--sp-w-font-row` · `--sp-w-font-row-compact`           | 0.74rem · 0.68rem           | A slot row's text; the same in a compact card                                                              |
| `--sp-w-font-empty`                                     | 0.72rem                     | An empty floor's text                                                                                      |
| `--sp-w-font-note`                                      | 0.7rem                      | A note under or beside a control: a refusal, the picker's heading, a held count                            |
| `--sp-w-font-meta`                                      | 0.68rem                     | The meta lines under a message: the state ledger and its proposals                                         |
| `--sp-w-muted-opacity`                                  | 0.7                         | Muted text drawn by opacity over the widget's ink: a slot's label, an empty floor, a mini bar's label      |

Not tokens: values already on a theme role (`--color-error-700`, the chosen row's
`--color-primary-500`, the conversation's glass `--sp-glass-*`, `--sp-measure`), the per-element
data values (`--sp-fill`, `--sp-scene`), and one-off shapes that belong to a single part (World
State's gaps, the slot grid's columns, the portraits' mini-bar track) — those move with their part
in P3 and get a token only if a second widget needs the role.

### 6.17 Pipeline settings

One component draws a pipeline's settings everywhere (`PipelineConfigOptions`, `mode`: `config` in the
Pipelines view and the lorebook graph panel, `session` in a session's settings, `builder` in Admin). It
draws the server's **settings groups** (NOMENCLATURE, _settings group_; the UI word is _agent_):

- **Pipeline card → agent inset → rows → Advanced.** The card is `panel-card` (its title 14px medium);
  each agent is a tonal inset (`bg-surface-50-950`, radius 10) with its name at 14px medium, its
  purpose line at 13px **muted** (never quiet, never truncated), then its rows. _Whole pipeline_ is
  the same shape, last. A single-call pipeline is one inset-less block. Nesting stops there: a
  fourth level is a card boundary, never a smaller font (§3.3).
- **The header switch** is the call's own on/off: a native `role="switch"` checkbox named by the
  agent, with visible _On_/_Off_ beside it (never colour alone), and _Off: this part does not run._
  under the header when off.
- **Front rows**: **Prompt**, **Model**, **Sampling**, then source switches, labels 12px. Model and
  Sampling sit side by side only at `@lg/view`. **Model is one grouped Listbox** (connections are the
  groups, models the rows; one pick writes the pair). The **first option** names what unset resolves
  to (the server's `inherits`); choosing it is Reset.
- **The provenance line**: one 12px muted line under a control: the §6.14 dot when the
  configuration changed it, the source in words, and **Reset** (44px on a coarse pointer) when a
  value is stored at the scope this panel writes.
- **Read-only** is the value's name plus _Set by an administrator_ (or **Change in Pipelines** for an
  admin), never a disabled control (§6.11).
- **Advanced** is one `<details>` per block, summarised _Advanced · N settings · M changed_, holding
  one `<fieldset>` per step with the step heading as its legend. Its open state lives in a
  `SvelteSet` per mount. **No counters**: no heading, label or list is ever numbered.
- **Visibility is by role, not by lock**: the server sends a row only to a role that can normally
  edit it somewhere (a non-admin gets prompts only, never a Model row); a row the role normally edits
  but which is locked now is sent read-only. A group, and so a card, exists only when it holds such a
  row. The client never hides a row the server sent.
- **In a session**: a card per pipeline the session runs, the reply open and actions closed with
  their model in the summary (admins); front rows only, no inline editors, **More settings in
  Pipelines** for admins; a card with nothing to draw is not drawn. The session's creation pipeline comes last: once
  the session is created its card starts closed, every row read-only, with one muted line saying why
  (the server's `scope.readOnlyBecause`) and no per-row _Set by an administrator_.

### 6.18 Media strip and tray

Files on a message, and files waiting to go on one. Both are widget parts (§6.16): `messages.media-*`
under a message, `messages.composer-tray*` in the composer, drawn by the default widget stylesheet.

- **Tray tile** (a file not sent yet): a bordered `surface-50-950` card, 12rem wide (9rem in a
  narrow box), a 2.5rem thumbnail or kind icon, the name truncated with its full text in `title`, a
  4px progress bar while it uploads (`role="progressbar"`), and a round ✕ at its top right named
  "Remove <file>" (44px under a coarse pointer). A refused tile has a dashed `error-500` border and
  says why in words, in `error-700-300`. Tiles sit in one row under the field that scrolls sideways,
  never wraps.
- **What can be attached** (note 41, 2026-10-03): what may be attached is said in words, never
  only by greying a control — but not in the composer's body. The More (⋮) panel lists **What can
  be attached** under its panes, in every composer skin, and it opens a dialog (`sp-dialog`): the
  summary ("This reply can read: images · text files"), every kind with the reason a refused one
  can't be attached (in `warning-800-200`), and each model call's reading. The paperclip's picker
  offers only the formats something in the reply reads, and its tooltip repeats the summary. A file
  refused at the moment of a pick, a drop or a paste still says why on its own tile, and aloud.
- **Media strip** (a sent message's files, in every state of the row): a row of **square tiles
  below the message's card, never inside it** (note 40, 2026-10-03) — its own cell of the message
  grid, in the content's columns on the row after the content, so every pack's card (Stage's
  persona card, a Bubbles bubble, a Dreamlit Cameo glass) ends above it; a pack aligns it to its
  card's side (the persona's to the trailing edge in Bubbles and Cameo, narration's centred).
  **Every image**, one or many, is a square `?v=thumb` **tile** cropped to fill (`object-fit:
  cover`), one size each (7rem; 5rem in a box under 30rem), and past six the rest fold into a
  count tile ("+3") that opens the lightbox where the tiles stop. A **file** is a **file tile**
  of the same size: kind icon, name on up to two lines (full name in `title`), size in
  `surface-700-300`, a download glyph in its corner; the card is the download link. All of them are
  thumbnails (§6.4): square, bordered `surface-300-700`, radius 12px (a card's step,
  §4), `primary-500` border on hover; every target is 44px on touch.
- **Every tile is a button** named "Open image cat.png, 2 of 3". An image whose file is gone is a
  dashed tile saying **File no longer available** (`role="img"`), never a broken image, and leaves
  the lightbox's pages.
- **Removing** is only while editing a row you control: a round ✕ on each tile, "Remove <file>".
  Adding goes through a new message, never the edit.
- **The lightbox** (`MediaLightbox`, the page's answer to `view-image`) is one modal for the
  session: ←/→, a swipe, or the side buttons page through the message's images, with a counter,
  **Download** for the app's own files and an **Info** pane (the prompt, seed and model of a
  generated image; the name, type and size of an upload). It traps focus, closes on Esc and the
  backdrop, and returns focus to the tile that opened it. ⚠ Not the character gallery's viewer.

## 7. Iconography

Icons are lucide, stroke 1.6, on the 24px grid: 20px on the rail, 18px in menus and rows, 16px
inline beside text, 14px for a badge such as the favourite star. The icon for a concept is fixed in
`NOMENCLATURE.md` §22 and is the same everywhere that concept appears. Never an emoji, never a
dingbat, never two icons for one idea.

---

## 8. Motion

Motion answers an action and shows what changed. The rail width transitions over 150ms. A popover
appears in place. Opening a view slides it 16px out of the rail and fades it in over 160ms (on a
phone the sheet rises 24px); switching between open views is instant, because a tab is not a
page; a released drag of the view's edge snaps without animation. The **Animate views** setting
(Settings → Themes, per browser) turns the open motion off.
There are no entrance animations on load, no hover transitions on every card, and no motion that
repeats on its own except the ember pulse that means the model is working and an atmosphere
(§8.1). Respect `prefers-reduced-motion` on anything longer than 150ms.

### 8.1 Atmospheres

An **atmosphere** is an animated background layer: rain, snow, mist, drifting glyphs, a candle's
glow. It is the one sanctioned self-repeating motion besides the ember pulse, and it is allowed
because it is never part of the interface. It sits under a screen's content, takes no pointer
events, is `aria-hidden`, and nothing is ever placed inside it or aligned to it. Today it appears
on one screen, the login page, where one of the fourteen shipped atmospheres is chosen at random
on each load (`src/lib/client/atmospheres/`, registry `ATMOSPHERES` in `definitions.ts`, mounted
by `AtmosphereLayer.svelte`). Anything that wants one elsewhere follows the same rules:

- **It paints with the theme, never with a colour of its own.** The host resolves `primary`,
  `secondary`, `tertiary` and the `surface` ladder from the live theme (`palette.ts`) and hands
  them to the effect; a definition carries no hex. `warning`, `success` and `error` are signals
  (§2.3) and are never used as a tint, so an ember-coloured atmosphere is not allowed even though
  the house theme's motes are gold.
- **One knob.** Intensity, 0.12–1.4, drives count, opacity and density. Speed, direction and
  colour are the atmosphere's own business, so a picker stays a picker.
- **One loop.** Every canvas atmosphere runs on the single `requestAnimationFrame` loop in
  `host.ts`: `dt` clamped to 50ms, skipped while the document is hidden, device pixel ratio
  capped at 1.5. CSS-kind atmospheres cost no JavaScript after mount.
- **Reduced motion is a still, not an absence.** A canvas atmosphere warms a few frames and
  freezes; a CSS one is frozen by the global rule in `app.css`. The mood survives, the movement
  does not.
- **The card over it stays legible on its own.** Whatever sits on an atmosphere carries its own
  ground, the theme's `950` at 75% with a backdrop blur on the login card, so contrast never
  depends on what the atmosphere happens to be drawing.
- **Off is always one step away.** An atmosphere is opt-in per surface; a surface that ships one
  on by default must make it switchable when it grows a setting. The login page has no setting
  yet and honours only the reduced-motion preference.

A computed still scene, if one is ever built, is a **backdrop** and not an atmosphere; a
user-supplied image stays a **background**. The words are kept apart in NOMENCLATURE §26.

---

## 9. Accessibility

- Every interactive element is a real `button`, `a` or input with an accessible name; icon-only
  buttons carry `aria-label` and, in the narrow rail only, a `title`.
- **Never an interactive inside an interactive.** A row picked by pressing it (`role="button"`)
  holds its own controls — a fold toggle, a mark, the `⋯` menu — *beside* the part that picks it,
  inside the row's box but not inside the button, and its key handler acts only on keys pressed
  on itself (`event.target === event.currentTarget`), so a control's Enter is the control's
  (lorebook entry rows, plan B7).
- The rail, tab strips and menus use roving `tabindex` with arrow keys; `Alt [` focuses the rail,
  `Alt ]` the sidebar, `Alt /` the page; `Ctrl K` opens Jump; `Esc` closes what is open.
- Selection is announced: `aria-current` on the selected row, `aria-selected` on tabs,
  `aria-checked` on filter rows, `aria-expanded` on anything that opens.
- Focus is visible: `outline-2 outline-primary-500 outline-offset-2`, never removed without a
  replacement of equal contrast.
- Nothing is hover-only. An affordance that fades in on hover on a fine pointer is visible on a
  coarse pointer and on keyboard focus (`pointer-fine:opacity-0 focus-visible:opacity-100`).
- Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers.
- Document View is a separate shell with its own AAA promise; the rail, sidebar and Jump are not
  mounted there and nothing here changes it.

---

## 10. Writing

- Sentence case everywhere: "Show all fields", "Browse the library", "Pick a character".
- A button says what happens: Save, Continue, Import a card. Not Submit, not OK.
- One name per thing, across the whole flow: the thing you open is a session, never a chat;
  one installation of Serene Pub is a **pub** (_your pub_, _this pub_; capitalised only where a
  sentence or label starts), never an _instance_ or a _server_ (`NOMENCLATURE.md` §26).
- Labels are nouns, hints are sentences, empty states are invitations ("Pick a character, or
  create one."), errors say what went wrong and what to do.
- No filler: a screen with nothing to say says nothing, not "No items found".
- Counts live in the copy where they help ("Filter 14 characters", "All 2"), not as badges.

---

## 11. Checklist for a new screen

- [ ] Colours are roles with stops, paired for light mode, no hex.
- [ ] Selection is tonal plus the bar; filled primary is only a button.
- [ ] Sizes come from the type scale and the size table.
- [ ] Sections are cards; there are no rules between them.
- [ ] Responsive rules query the `view` container, never the viewport, and never `@sm/view` for columns.
- [ ] No horizontal scroll at 399px, at Half or in Focus.
- [ ] Dialogs and popovers are portaled.
- [ ] Every control has a name, a focus ring and a 44px target on touch.
- [ ] Copy is sentence case and says what happens.
- [ ] New words are in `NOMENCLATURE.md`; new behaviour is in `docs/`.
