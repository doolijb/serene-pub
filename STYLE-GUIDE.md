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
   and the active theme answers. No component names a hex, an oklch, or a specific theme. The one
   exception is the rail's darkened ground, computed with `color-mix` from a role.
2. **One rail, one sidebar, one search.** Navigation lives on the rail. Whatever a rail item opens
   is a sidebar view. Jump is the only search surface. Nothing else may add a navigation strip, a
   second sidebar, or a search box that is not a view's own filter.
3. **A view is complete at 400px.** Every sidebar view is 100% functional in the dock and is the
   same component at full page and on a phone. Width changes the arrangement, never the feature set.
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

| Role        | Ladder     | What it means in the interface                                  |
| ----------- | ---------- | --------------------------------------------------------------- |
| `primary`   | 50 – 950   | **Act on it.** Buttons, focus rings, links, the active rail bar. |
| `secondary` | 50 – 950   | Secondary emphasis. Rarely needed; never for actions.            |
| `tertiary`  | 50 – 950   | System and admin: the Admin rail item, lore-in-play dots.        |
| `success`   | 50 – 950   | Healthy, connected, saved.                                       |
| `warning`   | 50 – 950   | **The model is working.** Live dots, generating chips, the beta line. |
| `error`     | 50 – 950   | Failed, destructive, a required field missing.                   |
| `surface`   | 50 – 950   | Every ground, panel, border and text tone.                       |

Because components only ever ask for these roles, the shell looks like whichever theme is active.
Under Rose it is rose; under Lamplight it is lamplight. This is the guarantee that lets one
implementation serve twenty-five themes.

### 2.2 Lamplight, the house theme

Lamplight is the default for new installs, branched from hamlindigo. It keeps the indigo ground
and gives each role one job, with the 500 stop as the anchor:

| Role        | 500 stop                    | Reads as                      |
| ----------- | --------------------------- | ----------------------------- |
| `primary`   | `oklch(80.3% 0.12 84deg)`   | lamp gold                     |
| `secondary` | `oklch(80.28% 0.08 267deg)` | hamlindigo's pale indigo      |
| `tertiary`  | `oklch(64.32% 0.06 213deg)` | teal                          |
| `success`   | `oklch(68% 0.11 160deg)`    | moss                          |
| `warning`   | `oklch(70% 0.17 45deg)`     | ember                         |
| `error`     | `oklch(60% 0.19 20deg)`     | warm red                      |

Its surface ladder is hamlindigo's with two deeper stops, so the shell has room for its layers:

| Stop  | Value                        | Used for                                     |
| ----- | ---------------------------- | -------------------------------------------- |
| 50    | `oklch(93.75% 0.01 267deg)`  | ink on dark                                  |
| 200   | `oklch(89.7% 0.02 267deg)`   | prose, secondary ink                         |
| 400   | `oklch(70.33% 0.05 267deg)`  | muted text, rest icons                       |
| 500   | `oklch(56.88% 0.07 267deg)`  | quiet text, placeholders, hints              |
| 800   | `oklch(38% 0.05 267deg)`     | borders, hover, the selected row (dark)      |
| 900   | `oklch(32% 0.04 267deg)`     | the page, and cards on a 950 ground          |
| 950   | `oklch(26% 0.04 267deg)`     | the sidebar, popovers, inputs on a 900 page  |

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

| State                       | Treatment                                                                       |
| --------------------------- | ------------------------------------------------------------------------------- |
| Selected row                | `.sidebar-row-active`: `bg-surface-200 dark:bg-surface-800` + `inset 3px 0 0 primary-500`, with `aria-current` |
| Active rail item            | `text-primary-500 bg-surface-900` + the same inset bar                          |
| Open-but-inactive view      | a 6px `primary-500` dot on the rail item                                        |
| Active toggle or chip       | `preset-tonal-primary`                                                          |
| Selected card               | `ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-950` (an inset bar hides under an image) |
| Hover on a row              | `surface-200-800`                                                               |
| Primary button              | `preset-filled-primary-500`                                                     |
| Secondary button            | `preset-tonal` or `preset-tonal-surface`                                        |
| Quiet action                | text in `surface-400`, `hover:text-surface-200`                                 |
| Destructive                 | text or fill in `error`                                                         |

`preset-filled-primary-500` is a button. It is never a selected row, an active tab, or a badge:
the old convention failed contrast at 3.62:1 and was retired app-wide.

### 2.5 Contrast

Text and interactive elements meet WCAG AA, 4.5:1, against their ground on every built-in theme.
Document View, the accessibility shell, promises AAA at 7:1 in its own stylesheet and keeps its own
greyscale palette; nothing here applies to it. When you add a colour pairing, measure it. Known
figures: `preset-tonal-primary` measured 11.6:1 under hamlindigo and has not been re-measured under
Lamplight; the filled primary button is above 7:1 under Lamplight; `surface-400` on `surface-950`
is about 5:1, which is why muted text stops at 400 and quiet text is never body copy.

### 2.6 Light mode

The design is dark first. A literal dark stop such as `bg-surface-950` or `text-surface-400` reads
wrong under a light theme, so anything that is not already a paired token is written as a pair:
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

---

## 3. Typography

### 3.1 Faces

| Face               | Role                                             | Weights shipped | Source                          |
| ------------------ | ------------------------------------------------ | --------------- | ------------------------------- |
| **Funnel Display** | Titles, view names, session names, speaker names | 400, 600, 700   | `@fontsource/funnel-display`    |
| **Funnel Sans**    | Everything else: controls, labels, lists, body   | 400, 500, 600, 700 | `@fontsource/funnel-sans`    |
| **Fira Mono**      | Code, receipts, keyboard hints                   | 400             | `@fontsource/fira-mono`         |
| **Literata**       | Story prose in a session: the message log, the composer's preview and the Writer skin | 400, 500, 400 italic | `@fontsource/literata`, as `--sp-prose` on `:root` |

Fonts are self-hosted and imported in `src/app.css`; nothing is fetched from the web. The theme
sets `--typo-heading--font-family` to Funnel Display at weight 600 with letter-spacing `-0.01em`,
and `--typo-base--font-family` to Funnel Sans. Use the theme's heading font through the `font-heading`
utility or `[font-family:var(--typo-heading--font-family)]`; the `.funnel-display` class in
`app.css` is the older spelling and still works.

Two faces, one family, is deliberate: Display carries identity, Sans carries information, and
they never fight because they share their letterforms. Literata is the one exception, ruled
2026-09-16 with the session stage: it is the reading face for the fiction itself and appears
nowhere in the interface. A control, a label, a list or a setting is never set in it; a message
body, a narrator line, the composer's preview and the Writer skin's field always are. Do not add a
fourth face.

### 3.2 Scale

The interface uses a fixed set of sizes. Pick from this table; do not invent a size.

| Size  | Line height | Weight  | Face    | Used for                                                   |
| ----- | ----------- | ------- | ------- | ---------------------------------------------------------- |
| 32px  | 1.15        | 600     | Display | The home greeting                                          |
| 24px  | 1.2         | 600     | Display | A page title inside the main area (the admin header)       |
| 20px  | 1.2         | 600     | Display | A session's name in its header (target; the session page is not yet built to this) |
| 18px  | 1.3         | 600     | Display | A detail hero's name, a continue card's title              |
| 16px  | 1.4         | 600     | Display | A sidebar view's title                                     |
| 15px  | 1.4         | 500     | Sans    | A list row's name                                          |
| 14px  | 1.5         | 400/500 | Sans    | Body, rail labels, inputs                                  |
| 13px  | 1.45        | 400/500 | Sans    | Tabs, chips, buttons in the dock, secondary body           |
| 12px  | 1.4         | 400     | Sans    | Field labels, timestamps, meta lines                       |
| 11px  | 1.3         | 400     | Sans    | Group names on the rail, counts, keyboard hints            |

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

Body copy in a column wraps at about 65 to 75 characters. Story prose gets a 640px measure
(`--sp-measure`) centred in the middle zone, with a 56px gutter on its left for the speaker's
avatar; the composer is the same width as the prose, so what you type lands where you typed it. Lists truncate with an ellipsis on one line for taglines and two lines for descriptions;
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

| Thing                      | Size                                              |
| -------------------------- | ------------------------------------------------- |
| Rail                       | 64px narrow, 208px wide                           |
| Rail item                  | 44 × 44 narrow; 40px rows wide                    |
| Sidebar                    | 400px                                             |
| Sidebar header             | 56px                                              |
| List pane at full page     | 340px default, 360–380px for card lists           |
| Input, filter box, button  | 40px; 32px for the small size                     |
| List row                   | 44px minimum                                      |
| Tab                        | 40px                                              |
| Icon-only rail toggle      | 44 × 44 narrow, 32 × 32 wide                      |
| Touch target               | 44px, everywhere a finger can land                |
| Jump pill                  | 34px tall, fixed at top 8px, right 16px           |
| Jump overlay               | min(640px, 92vw) wide, at most 64vh tall, 12vh from the top |

The two exceptions to the 4px grid are the 34px pill, sized to sit inside a 56px header with
11px above and below, and the 3px inset bar, which is a line, not a box.

### 4.3 Gaps

Fields inside a card: 16px. Cards in a stack: 12px. Rows in a list: 4px. Items in a chip row:
6px. Sections on the home: 32px. Card padding: 16px. Pane padding: 16px.

---

## 5. Layout

### 5.1 The shell

The window is rail, sidebar, main. The rail is fixed to the left edge and holds Home, the **Play**
group (Sessions, Characters, Personas, Lorebooks, Tags), the **Tune** group (Connections, Sampling,
Pipelines, Settings, and whatever the instance enables), then Activity, Admin and the account. The
sidebar shows one view; other opened views stay mounted as tabs and show as a dot on their rail
item. Main is the page. Below the `lg` breakpoint the rail becomes a five-item bottom bar and a view
opens as a full-screen sheet.

The wide rail shows labels and the group names; the user toggles it and the choice persists per
browser. Design for both forms: an item's active and open states are identical in each.

### 5.2 Views

A view is a component the shell mounts inside a wrapper that is a CSS container named `view`.
Views own their content and their search state; the shell owns the frame. A view registers its
search with Jump through `jumpCtx.registerScope` and, if it can refuse to close, a close gate
through `panelsCtx.registerViewCloseGate`.

A list-with-detail view uses `PanelSplit`: one pane in the dock, list beside detail at desk width.
The switch is `ViewModeTracker`, which measures the view and answers `compact` under 900px and
`desk` at or above it, holding its last answer while the view is hidden.

### 5.3 Responsive rules

Inside a view, use container variants on the `view` container:

| Variant                   | Fires at | Use it for                                          |
| ------------------------- | -------- | --------------------------------------------------- |
| `@lg/view:`               | 512px    | Two-column field rows, side-by-side metrics         |
| `@min-[900px]/view:`      | 900px    | Anything that mirrors the desk switch in CSS        |

Never `@sm/view:` for a two-column decision: it fires at 384px, which is narrower than the 399px
dock, so it would fire in the sidebar. Never a viewport variant (`sm:`, `md:`, `lg:`) inside a view:
the window is wide while the column is narrow, and the rule fires in the wrong place. Viewport
variants are for the shell and for pages in main, and even there `@container/home`-style named
containers are preferred.

A container makes itself the containing block for `position: fixed` descendants. Dialogs and
popovers inside views must be portaled to the body; every Skeleton `Dialog` and `Popover` in the
app already is, and a new one must be too.

### 5.4 Layering

| z-index  | Layer                                                    |
| -------- | -------------------------------------------------------- |
| 10       | The shell: rail, sidebar, main                           |
| 40       | The mobile More sheet                                    |
| 45       | A view open as a mobile sheet                            |
| 46       | The Jump pill                                            |
| 50       | Modal backdrops and dialogs, including the Jump overlay  |
| 100      | The update notice bar                                    |
| 1000     | Popovers and menus                                       |

The pill sits above every sheet and below every modal on purpose; a modal opened from a sheet must
cover the sheet. Do not add a layer between 46 and 50.

---

## 6. Components and patterns

### 6.1 Buttons

One primary button per surface. It is `preset-filled-primary-500`, 40px (or `btn-sm` at 32px in a
dock), with a 16px icon before a one-word label when the icon helps. Secondary actions are tonal.
Actions that would be clutter as buttons are quiet text links. A destructive action is never the
primary.

### 6.2 Filter input

`PanelFilterInput`: 40px, `rounded-[10px]`, a search glyph, a placeholder built from a noun and a
count ("Filter 14 characters"), a clear control that returns focus to the input, and a primary
focus ring on the wrapper. It binds the same state the view filters on and Jump drives.

### 6.3 Filter popout and the New menu

When a view has more filters than one box, they live in a popout: a 40px icon button that opens a
popover of `role="radio"` rows (single choice) with the checked row in the selected treatment; an
active choice shows as one dismissible chip under the toolbar and lights the button tonal. A chip
row that would need to scroll sideways is always a popout instead.

The ways to add something live in one primary **New** button on its own row above the toolbar,
opening a `role="menu"` of items with a title and a one-line description, such as Write a character,
Browse the library, Import a card.

### 6.4 List rows and cards

`SidebarListItem` is the row shell; `active` applies the selected treatment. A row is a 40px
avatar (rounded 9px), a 15px name, a 12px muted second line, and at most one chip at the right with
a `+N` for the rest. A favourite is a small filled star after the name; a persona is a small `UserRound` after it. The
row's own actions are in a `⋯` popover menu. The numeric id column is off (`showIndex={false}`) in
views that show names.

A list that can be grouped (character folders) groups with a **folder header**: a 32px row with a
`Folder`/`FolderOpen` glyph, a 13px medium name, a 12px muted count, and a `⋯` menu at the right,
on the same ground as the list and separated from the rows below only by its own `py-1`. The header
is a `<button aria-expanded>` that collapses the group; the rows inside are indented by the glyph's
width and nothing else. Ungrouped rows come first with no header. A filter that empties a group
hides its header rather than showing an empty one.

A card is `rounded-[12px] border border-surface-800` with `p-4`, on the ground one step lighter
than what it sits on. That recipe is the `.panel-card` utility in `app.css`, paired for light mode;
use it rather than spelling the four classes out again. Section cards carry a 12px quiet label or a
14px medium heading, then content. Empty sections are not rendered; the card boundary is the
separator, so there is no rule between cards.

### 6.5 Tabs

Two strips, deliberately alike:

- `PanelTabStrip`: labelled tabs, icon 16px plus text at 13px, equal widths, a 2px `primary-500`
  underline on the selected tab above a 1px `surface-800` rule, an optional error dot at the label's
  top-right. Used wherever a tab has a name the user reads: the character editor and detail view.
- `PanelTabList` + `PanelTab`: icon-only tabs for panels with many sections in a narrow dock;
  becomes a labelled vertical rail at desk width when the panel passes `orientation="vertical"`.

No segmented controls, no pill tabs.

### 6.6 Popovers, menus and dialogs

Popovers are Skeleton `Popover` in a `Portal`, positioner `z-[1000]!`, content `w-[min(90vw,Npx)]`,
placement `bottom-end`, and they flip when the viewport says so. Menus are `role="menu"` with
`role="menuitem"` rows and a `tabindex="-1"` container, arrow-key movement, Escape to close, and
focus returned to the trigger. Dialogs are Skeleton `Dialog` in a `Portal` at `z-50`. Nothing in the
app renders its own `fixed inset-0` backdrop.

### 6.7 Empty, loading and drop states

An empty state is `EmptyState`: an icon, one sentence, and at most one action, phrased as an
invitation. A drop target shows its hint only while a file is over it, as an overlay with a dashed
`primary-500/70` border and a short imperative ("Drop to import this card"), never a permanent
footer. Loading is a spinner in place, never a blank pane.

### 6.8 Jump

The pill at the top right is the entry point; the overlay is the surface. The scope chip follows
the open view or the route; Backspace on an empty box or the chip's × drops to Everywhere; a
`kind:` prefix narrows. Results are grouped, the highlighted row uses the selected treatment, and
a scoped search always ends with an Everywhere tail. Views feed Jump through registration, never by
adding their own search UI.

---

### 6.9 Documentation pages

The docs are compiled once (NOMENCLATURE §27) and read in three places: the `/docs` page, the
**Help** sidebar view, and Document View. The first two share `src/lib/client/styles/docs.css`,
scoped under `.docs-article`; Document View keeps its greyscale palette (§2.5) and renders the
same markup unstyled.

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
  block the compiler emitted without a source gets no toolbar at all. `/docs` and Help only:
  Document View keeps the static block (§2.5).
- **Outline** ("On this page"): depth 2–3 headings, shown only when the docs container is ≥ 48rem.
- **Search** is Jump (§6.8): a heading is a `doc` hit, the chip reads *Documentation* while Help or
  `/docs` is open, and `doc:` narrows. Neither Help nor `/docs` has a search box of its own.
## 7. Iconography

Icons are lucide, stroke 1.6, on the 24px grid: 20px on the rail, 18px in menus and rows, 16px
inline beside text, 14px for a badge such as the favourite star. The icon for a concept is fixed in
`NOMENCLATURE.md` §22 and is the same everywhere that concept appears. Never an emoji, never a
dingbat, never two icons for one idea.

---

## 8. Motion

Motion answers an action and shows what changed. The rail width transitions over 150ms. A popover
appears in place. A view being hidden is `hidden`, instantly, because it is a tab, not a page.
There are no entrance animations on load, no hover transitions on every card, and no motion that
repeats on its own except the ember pulse that means the model is working. Respect
`prefers-reduced-motion` on anything longer than 150ms.

---

## 9. Accessibility

- Every interactive element is a real `button`, `a` or input with an accessible name; icon-only
  buttons carry `aria-label` and, in the narrow rail only, a `title`.
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
- One name per thing, across the whole flow: the thing you open is a session, never a chat.
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
- [ ] No horizontal scroll at 399px or at full page.
- [ ] Dialogs and popovers are portaled.
- [ ] Every control has a name, a focus ring and a 44px target on touch.
- [ ] Copy is sentence case and says what happens.
- [ ] New words are in `NOMENCLATURE.md`; new behaviour is in `docs/`.
