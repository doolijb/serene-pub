# PLAN — The widgets core's catalogue ships

**Status:** BUILT 2026-10-11 — W1 turn-order, W8 actions, W9 annex, W2 album, W3 chronicle, W4 places + map-canvas, W10 attendance (was "presence"), W6 scene-portraits uplift (+ composer Pinned images pane removed), W7 stats uplift (+ world-state alias, stat trail), B3 folio presentation, turn line, layouts rewrite; verified in one grouped run. NOT built: W5 crawl-map (no Dungeon Crawler genre yet), Notebook/Bookmarks/Character dossier (Q6), Actions "Waiting on you" block (needs dossier slice; 0.7 with C8). Open for owner: `WayV1` rename; layout editor Done regrows the strip and folds sides (pre-existing editor behaviour). Was BUILDING since 2026-10-10 (owner: "Implement"; recommended rulings Q1–Q10 taken; C1–C7 of the consolidation plan run first). Originally PROPOSED after the owner asked: "propose and design all the widgets
Serene Pub core catalogue should ship." Rulings Q1–Q7 (§7) are open; no brief goes out before they
are answered ([[feedback_planning_is_not_go]]).

**Scope.** The *set* of core widgets (`@serene-pub/core-catalog` `registry/widgets.ts` +
`components/`), their declarations (reads, scopes, settings, parts), which genres offer and place
them, and the SDK request kinds they need. Out of scope: the layout editor, the session header bar,
message styles, plugin widgets (Battleship, Twenty Questions, Whodunit, Writing Room keep their own).

**Governing idea.** A widget earns a place in core when it (a) draws data core already holds for
every session, (b) answers a question a person asks *while playing*, not while configuring, and (c)
cannot be a setting on a widget that exists. Everything that fails (c) becomes a setting (the
composer precedent); everything that fails (a) stays a plugin (the dice tray, S7).

---

## 1. Where we stand

### 1.1 Shipped (6)

| id | title | reads | scopes | genres | placed by default |
|---|---|---|---|---|---|
| `messages` | Messages | layout, messages, actions, settings, viewer, locale | — (dossier via page) | all | every layout (primary) |
| `scene-portraits` | Scene Portraits | settings | characters, session:state | all | Adventure right |
| `stats` | Stats | settings | session:state | all | Adventure right, Lair left |
| `world-state` | World State | settings | session:state | all | Adventure middle strip, Lair right (stand-in for a map) |
| `lore-entries` | Lore entries | settings | lore (request-paged) | all | nowhere |
| `authors-note` | Author's note | — (page requests) | — | Chat only | Chat right, unpinned |

Retired ids: `composer` (folded into Messages as settings), `inventory` (R79; the `inventory` list
slot is drawn by Stats and World State). Both stay in `RETIRED_WIDGET_IDS`.

### 1.2 What the catalogue already knows it is missing

- `layouts.ts` Adventure left rail: *"core ships no lore panel yet"* — false since `lore-entries`;
  the rail is still empty (genre-uplift plan §184 noted this).
- `layouts.ts` Lair right: `world-state` is *"a stand-in"* for a room list / room graph.
- Dungeon Crawler plan §4.4 / G12: a new core widget `crawl-map` 🚧 (annex-fed, elkjs).
- Writing Room layout: the manuscript wants a *document skin* (a `folio` channel read as one block
  of prose), not conversation rows — expressible nowhere today.
- Twenty Questions ships a `whos-next` plugin widget **and offers it to Chat** (`genres:
  [twentyQuestionsGenre, chatGenre]`) — a plugin filling a core gap.
- The composer's **More** panels (Lore · Pinned images · Statistics) are session UI that lives in
  the composer because no widget existed to hold it.
- `stats-and-states.md` "What isn't built yet": a story-time stat exists in shape only; the state
  widget cannot write a date through the calendar.

### 1.3 What the envelope offers a new widget today

Base sections: `layout session channels messages props settings actions viewer locale turnOrder`
(+ `annex.v1`, the person's view). Scoped: `session:state` (typed), `characters` (typed), `lore`
(grant to page `session-entries`), `session:full`, `persona` (🚧 unknown). Requests already
implemented by the page: `messages`, `open-character`, `view-avatar`, `view-image` (gallery
lightbox), `open-lore`, `prompt-details`, `inspect-run`, `pick-turn`, `fire-turn`, `change-sprite`,
`summarize`, `send`, `draft`, `decide-proposal`, `set-attribute-value`, `set-sprite-set`,
`clear-scene-image`, `session-entries`, `set-entry-marks`, `authors-note`, `set-authors-note`.
Events: `message:*`, `generation:*`, `channel:activated`, `layout:changed`, `event:recorded`,
`lore:ranked`, `lore:marked`, `genreFields:changed`.

So: a **turn-order** widget and an **images** widget need **no new SDK surface**. A history/clock
widget and a places widget need new request kinds (§5).

---

## 2. The proposed set (6 shipped + 8 new ids, 2 uplifts, 1 alias retired)

| # | id | title | one line | genres | new SDK | size |
|---|---|---|---|---|---|---|
| W1 | `turn-order` | Turn order | Who is due, who follows, Continue / Pick, the strategy in force | all | none | S |
| W2 | `album` | Album | Every image on this session's lines, newest first, into the lightbox | all | none | S |
| W3 | `chronicle` | Chronicle | The book's history entries and scenes as this session reads them; the story clock at its head | all with a lorebook (not Dungeon Crawler) | 3 requests | M |
| W4 | `places` | Places | The book's places on the line being read, as a list or a map, with the cast's `location` picked out | Adventure, Lair (+ tray elsewhere) | 1 request + shared control `map-canvas` | L |
| W5 | `crawl-map` 🚧 | Map | The dungeon as the party has seen it (DC plan G12; annex-fed) | Dungeon Crawler only | per DC plan | L (DC P2) |
| — | `messages` | + setting `presentation: rows \| folio` | A folio channel read as one block of prose | all | none | M |
| — | `notebook` 🚧 | Notebook | A person's private notes beside the session, never sent to the model | all | storage ruling (Q6) | M — **deferred** |
| W6 | `scene-portraits` uplift | Scene Portraits | Who × face × arrangement: scene / recent N / pick · avatar / sprite / chosen image · row / grid / column / stage | all | 1 field on `characters`, 1 request | M |
| W7 | `stats` uplift, absorbs `world-state` | Stats | Owners × slots × arrangement: cast / world / places / pick · all / pick / bars only · cards / list / strip; `world-state` becomes an alias | all | alias map in `sessionLayout.ts`, 1 request (trail) | M |
| W8 | `actions` | Actions | The genre's actions as buttons, plus the forms waiting on the viewer | all | none | S |
| W9 | `annex` | *(the field's label)* | One declared annex key the viewer may see, as the shape it was declared in | all | none | S |
| W10 | `presence` | Who's here | The people in the session, the persona each writes as, who is typing | all | 1 base section | S |

Everything else considered is in §6 with the reason it is not proposed.

### Why eleven and not more

Each shipped widget answers one in-play question: *what was said* (messages), *who is here*
(portraits), *how are they* (stats), *what is the world doing* (world-state), *what does the book
know* (lore-entries), *what am I steering* (author's note). The five new ones add *whose turn*
(turn-order), *what have we seen* (album), *when are we* (chronicle), *where are we* (places /
crawl-map). That closes the question list a session surface gets asked. Anything beyond is a
genre's or a plugin's.

---

## 3. Designs

Conventions for every new widget: declared in `registry/widgets.ts` with a `DEFAULT_PRESET`;
a `component()` row in `CORE_COMPONENTS` under `components/shared/<slug>/` (or
`components/genres/<genre>/<slug>/` when genre-scoped); markup carries **widget parts only**
(STYLE-GUIDE §6.16: `<id>.root`, `<id>.<part>`, generic parts `card list row label value chip empty
toolbar`); `reads` names the fewest base sections; settings in the one field language, less-used
ones `group: 'behaviour'`; one line of empty state that says *why* it is empty; guests degrade to
read-only, never to nothing (`viewer` decides).

### W1 · `turn-order` — Turn order

**Question:** whose turn is it, who follows, and may I change that.

**Declaration.** `reads: ['turnOrder', 'viewer', 'actions', 'settings']`; `scopes: ['characters']`
(faces + `mine`); `icon: 'ListOrdered'`; all genres; `maxInstances: 1` (one order per session; a
second copy would show the same thing).

**Draws.** A head line identical in meaning to the composer's *Who is due next* line (same
`turnOrder.v1.order[0]` + `candidates`), then the order as rows: face · name · state chip
(*due* / *then* / *benched* / *you*). Footer: **Continue** (request `fire-turn`, enabled when the
head is a character or narrator and `actions.v1` carries the floor), **Pick who speaks** (request
`pick-turn`), and a muted line naming the strategy in force (`turnOrder.v1.strategy`, labelled
through the catalogue's strategy names). Hides nothing while a draft exists (unlike the composer
line), because the widget is *for* looking.

**Settings.** `showBenched: boolean` (default false, behaviour) · `showStrategy: boolean` (default
true, behaviour) · `faces: boolean` (default true).

**Parts.** `turn-order.root · .head · .row · .face · .name · .state · .controls · .strategy`.

**Overlap to rule (Q1).** Twenty Questions' `whos-next` offers the same to Chat. If core ships
`turn-order`, the showcase keeps its widget for its own genre and drops `chatGenre` from `genres`.

**Not a Messages setting because** the composer line is a one-liner by design (it hides on draft);
the order as a *list you can look at while someone else writes* is a different surface.

### W2 · `album` — Album

**Question:** what has this session shown me; find that picture again.

**Declaration.** `reads: ['messages', 'settings', 'viewer', 'locale']`; `icon: 'Images'`; all
genres. Name: *album*, not *gallery* — **gallery** is a character's or persona's image set
(`EntityGalleryTab`, "gallery tabs", NOMENCLATURE §22) and a widget called Gallery would mean the
wrong thing on a session (R1). *Album* is grep-clean in app, SDK and nomenclature.

**Draws.** A grid of square tiles (the media strip's tile, `messages.media-*` → shared control
`media-tile.*`), newest first, from every `MessageV1.parts` image on the lines the widget's channel
claim shows. Each tile: the image, a corner glyph for its origin (attached · generated · sprite
shown), hover/focus caption = speaker · time. Click → request `view-image` with `gallery: { srcs,
index, captions }` so the lightbox pages the whole album. Click the caption → scroll the Messages
widget to the line (`selection:changed` is 🚧; until then the widget calls `request('messages')`
cursor and the page's existing `#message-<id>` anchor). Empty: *Nothing has been attached or
generated in this session yet.*

**Settings.** `source: all | attached | generated` (default all) · `tile: small | medium | large`
(default medium) · `channel: string` (behaviour; same claim semantics as Messages).

**Parts.** `album.root · .grid · .tile · .origin · .caption · .empty`.

**Why core.** Image generation (PLAN-image-generation) lands pictures on lines; a session that
illustrates scenes has no way to look back at them except scrolling. Reads only `messages`, so it
costs no new surface. SillyTavern's Gallery extension is the comparable.

### W3 · `chronicle` — Chronicle

**Question:** when are we in the story, and what has the book recorded of this session.

This is the composer's **Lore** panel made a widget, with the **story clock** at its head, so
that the one panel a person opens mid-play to *orient in time* is one widget rather than a
composer detour plus a settings tab.

**Declaration.** `reads: ['settings', 'viewer', 'session']`; `scopes: ['lore']` (the grant to ask
the page); `icon: 'History'` (⚠ check §22 for the glyph already given to history entries; reuse,
never a second one); genres: every genre whose shape has `lorebook` — Dungeon Crawler omits it
(`omitWidgets`, R19 no lorebooks).

**Draws, top to bottom.**
1. **Clock head** — the session's present: the clock's date (or *Following the book's newest
   entry*), **Next day / Next ‹unit›**, **Move the clock…**, **Follow the newest entry**; a chip
   when the session reads *as of* an earlier moment. Owner-only writes; guests read.
2. **Now** — the current history entry: its date, name, first line; **Open in lorebook**
   (`open-lore` `scope:'history'`), **Start new history entry**.
3. **Scenes** of that entry, each with its colour, name, message span; **Summarize scene**
   (`summarize` `kind:'scene'`); **Extend graph (N)** when unfiled scenes exist.
4. **Earlier** — a folded list of previous history entries (the pane's *Recent Entries*), click to
   read the book as of that one (`open-lore` with `sceneId`/entry).

What stays in the composer pane and does not move: *what the next reply would pull in* (it is about
the **draft**, so it belongs beside the draft) and *entries that have come up* (that is
`lore-entries`' job). After W3 lands, the composer's **Lore** pane shrinks to those two; the
history/scenes half goes. One home per fact (R1).

**Settings.** `clock: boolean` (default true) · `earlierCount: integer` 5–50 default 10
(behaviour).

**New requests (SDK `WidgetRequests`, page-implemented, owner-gated server-side):**
- `history-entries: { params: { sessionId }; result: { present: ClockV1; current: HistoryEntryV1 | null; scenes: SceneV1[]; earlier: HistoryEntryRefV1[]; unfiledScenes: number } }`
- `set-story-clock: { params: { to: 'follow' | { date: StoryDateV1 } | { step: 'day'|'month'|'year', by: number } }; result: void }`
- `start-history-entry: { params: Record<string, never>; result: { entryId: number } }`

Shapes reuse `DESIGN-story-time.md`'s date value; no new date type. Both exhaustiveness tests
(`framePort.test.ts`, `sdk-tests/surfaces.test.ts`) gain cases.

**Parts.** `chronicle.root · .clock · .clock-date · .clock-controls · .now · .entry · .scene ·
.scene-swatch · .earlier · .toolbar`.

**Name.** *Chronicle*: distinctive (R2), grep-clean, says "a record in time order", and is neither
*history* (a history **entry** is one row of it), *timeline* (unused; a bare noun that could stand
alone, R3), nor *lore* (taken twice). Ledger it in §25 with *history entry*, *scene*, *story
clock* as its near-neighbours (§24 step 5).

### W4 · `places` — Places

**Question:** where are we, what is around us, where can we go.

The Lair asked for exactly this ("a list of the dungeon's location entries with the party's
`location` picked out — and beyond it the room graph") and got `world-state` as a stand-in.
Adventure's Location slot shows a name and nothing else.

**Declaration.** `reads: ['settings', 'viewer', 'locale']`; `scopes: ['lore', 'session:state']`;
`icon: 'Map'`; `genres: [adventure, lair]` by default placement; offered everywhere a lorebook is
(tray) except Dungeon Crawler (omit; its rooms are extension data and it has `crawl-map`).

**Draws.** Two views, one setting apart:
- **List** (default on a side rail): places on the line being read, grouped by category chip, each
  row = name · category tint · who is here (faces of cast whose `location` slot points at it) ·
  ways out as a muted line (*→ The Guard Room, the cellar stair*). The place the **world**'s
  `location` points at is marked *here*. Click a row → request `open-lore` (the place's entry).
- **Map** (default in a middle strip or a wide rail): the same graph drawn by the shared control
  `map-canvas` (§3.6), squares tinted by category, arrows for ways, faces on the square where a
  cast member stands, *here* ringed. Click a square → the row's detail (ways, keeper, **Open
  entry**).

Empty: *This book has no places yet.* / *This session reads no lorebook.*

**Settings.** `view: list | map` (default list) · `highlight: world | cast | both` (default both) ·
`categories: string[]` (behaviour; empty = all) · `showWays: boolean` (default true, behaviour).

**New request.** `session-places: { params: { sessionId }; result: { asOf: StoryDateV1 | null;
places: PlaceV1[]; ways: WayV1[]; present: Array<{ placeId: number; owner: SessionStateOwnerV1 }>
} }` — the page serves it from the same projection the lorebook's Places lens reads (amendments
and archive honoured at the session's moment), with `present` joined from `session_state`'s
`location` values. Paged: no — a book's places are hundreds at most; one call, refetched on
`lore:ranked` / `event:recorded` / `genreFields:changed`.

**Parts.** `places.root · .list · .row · .here · .ways · .present · .canvas` + `map-canvas.*`.

### W5 · `crawl-map` 🚧 — Map (Dungeon Crawler)

Already designed: PLAN-dungeon-crawler §4.4, G12, P2-A. Here only to place it in the set and to
share one renderer with W4 (§3.6). Genre-scoped (`genres: [dungeonCrawler]`), annex-fed (the
`crawl-map` annex key with per-person audiences: unseen rooms absent, stubs present, shown fuses
only). Parts `crawl-map.root · .room · .way · .stub · .here · .fuse` as the DC plan lists. Its
title is *Map* inside the genre; the id stays `crawl-map` so a tray never shows two *Map*s (Places
is titled *Places*, never *Map*).

### 3.6 Shared control `map-canvas`

One renderer for W4 and W5 (and later a session-side relationships graph, if ever): nodes (id,
label, tint, badge faces, `here`), edges (from, to, bidirectional, label, `stub`), an auto layout
(elkjs as the DC plan chose; Mermaid stays out — [[project_mermaid_for_maps]] is a candidate, not a
decision), pan/zoom, keyboard focus order, click → `onPick(nodeId)`. Parts `map-canvas.root · .node
· .edge · .label · .face · .here`. It lives in `components/shared/map-canvas/` and is imported by
both widgets' components; it is **not** the app's lorebook Places lens (core-catalog components
cannot import app Svelte — [[feedback_linked_package_second_svelte]]). Two map canvases in the
codebase is a known cost; the lens may adopt this one later, not the reverse.

### 3.7 `messages` gains `presentation: rows | folio`

The Writing Room's manuscript, the Dungeon Crawler's `plotbook`/`travelogue`, and any channel
declared `role: 'folio'` read better as **one block of prose** than as rows with avatars and times.
A setting, not a widget, by the composer precedent: the data, the channel claim and the composer
are the same; only the drawing changes.

- `presentation: 'rows'` (default) draws as today.
- `presentation: 'folio'` draws every line's body as continuous prose in reading order, speaker
  changes as a thin rule (no avatar, name, time, swipes), the composer defaults to `quill`
  (page line), scene markers off. Selection, edit and the message menu still attach to the
  paragraph that *is* the line (the DOM contract keeps `li.sp-msg-row` so packs and the lightbox
  still work).
- Default follows the channel: a copy whose `channel` claim names a `folio`-role channel defaults
  to `folio`; unset or a conversation role defaults to `rows`. Stored value wins.

Parts: `messages.folio · .folio-rule` added to the existing `messages.*` list. The Writing Room
layout then places `messages#manuscript` with `{ channel: 'manuscript', presentation: 'folio' }`
and its layout comment's "not yet shipped" paragraph comes out.

### 3.9 W6 · Scene Portraits uplift — who × face × arrangement

**Asked by the owner 2026-10-10:** a widget for character images and sprites with modes for
"last X character turns, specific characters, sprites, specific images from a character". Scene
Portraits already *is* the faces widget, so this is an uplift of it, not a second widget (R1).
Its `source: pinned | scene` enum squashes two questions into one; split them into three
independent settings:

| Setting | Values | Default | Notes |
|---|---|---|---|
| `who` | `scene` · `recent` · `pick` | `scene` | *recent* = members who spoke in the last `recentTurns` turns, newest first; *pick* = `pickMembers` (string[], one name per line, as Stats does) |
| `recentTurns` | integer 1–20 | 3 | `showIf who = recent` |
| `face` | `avatar` · `sprite` · `chosen` | `sprite` | *sprite* = the member's current sprite (DESIGN-sprites §7, today's `sprites: true`); *chosen* = one image per member picked from that character's gallery, stored in `chosenImages` |
| `chosenImages` | object `{ [characterRef]: mediaRef }` | `{}` | written by the widget's own picker (⋯ on a face → *Choose image*); `showIf face = chosen` |
| `arrangement` | `row` · `grid` · `column` · `stage` | `grid` | *stage* = up to two large faces side by side, the look of today's pinned portraits |
| `persona`, `bars` | unchanged | | |

**Back-compat (0.6 is distributed):** a stored `source: 'pinned'` reads as `who: pick, face:
chosen, arrangement: stage` with `chosenImages` seeded from the browser's `sceneImages:<id>`
pins on first open; `source: 'scene'` reads as `who: scene`; `sprites: false` reads as
`face: avatar`. `source` and `sprites` become ⏳ and are pruned at the 0.7 squash. Adventure's
preset `{ source: 'scene', bars: true }` is rewritten to the new keys in `layouts.ts`.

**Data.** `SessionCharacterV1` gains `lastSpokeAt: number | null` (host already witnesses
rows, so `recent` costs the widget no `messages` read) and `galleryCount: number`. New request
`character-images: { params: { characterId: number; cursor?: string }; result: { images:
Array<{ ref: string; src: string; caption?: string }>; nextCursor?: string } }`, owner-gated
like `view-avatar`. Lightbox via the existing `view-image` with the gallery array.

**Parts added:** `scene-portraits.stage · .chooser · .chooser-tile · .recent-rank`.

**Retired by W6 (owner 2026-10-10: "remove the character image picker from the composer since it
would be replaced by this"):**
- The composer's **Pinned images** pane (`SessionComposer` More menu → `SessionSceneImagesTab.svelte`)
  and its docs section (`sessions.md` "Pinned images"); the More menu keeps Lore, Statistics and
  What can be attached.
- `scenePins.svelte.ts` and its `localStorage` key `sceneImages:<sessionId>` — read once to seed
  `chosenImages` on first open (above), then removed at the 0.7 squash.
- `SessionCharactersV1.sceneImages` (the two left/right slots) and the `clear-scene-image` request
  (`src/lib/client/components/sessionPage/requests/clearSceneImage.ts`) — ⏳ in the SDK until 0.7.0,
  then REMOVE; both exhaustiveness tests drop the case then. The picker's single job moves into the
  widget's own chooser (⋯ on a face → *Choose image*, via `character-images`).
- NOMENCLATURE §23 rows: **Pinned images** (the pane), **scene image** (the pinned slot); §9 gains
  **chosen image** (per member, per instance).

**Not in scope:** a specific sprite *label* override per member (the sprite is the line's; a
frozen expression would lie about the story). If wanted, it is a `spriteLabel` map beside
`chosenImages`, later.

### 3.10 W7 · Stats uplift — one widget for every owner's state

**Asked by the owner 2026-10-10:** "one dedicated to stats: world stats, character stats, etc."
Core has two today, `stats` (cast owners) and `world-state` (the world owner), drawing the same
`stat-slot` control with the same edit rules; `inventory` was already folded into them (R79).
The split exists only because World State wanted a *strip* above the conversation, which is an
arrangement, not a different widget. Merge them: **one `stats` widget, three axes.**

| Setting | Values | Default | Notes |
|---|---|---|---|
| `owners` | `cast` · `world` · `places` · `all` · `pick` | `cast` | *places* = `session_location` owners (DESIGN-attributes phase 4; the Dungeon Crawler's rooms); *all* groups world → cast → places with a head per group; *pick* = `pickOwners` (string[], owner labels, one per line) |
| `castScope` | `scene` · `all` | `scene` | today's `members: scene \| all`; `showIf owners ∈ {cast, all}` |
| `slots` | `all` · `bars` · `pick` | `all` | *bars* = bounded numbers only, the HUD case; *pick* = `pickSlots` (exists) |
| `arrangement` | `cards` · `list` · `strip` | `cards` | *cards* = today's Stats; *list* = one labelled row per slot down a rail (World State's list); *strip* = one line across the top of the conversation (World State's strip) |
| `density` | `compact` · `full` | `full` | exists |
| `trail` | boolean | `true` | behaviour; click a value → its **stat trail** (the changes that led here, by message) in a popover |

**Alias, not retirement.** 0.6 is in users' hands, so `world-state` keeps resolving: a new
`WIDGET_ID_ALIASES` map in `sdk/src/sessionLayout.ts` reads `world-state` (and `world-state#n`) as
`stats` with `{ owners: 'world', arrangement: 'strip' }` merged **under** the instance's stored
settings; `widgetOfInstance` and `drawnWidgetIds` resolve through it; the editor's tray offers
`stats` once. Shipped layouts (`ADVENTURE_LAYOUT` strip, `LAIR_LAYOUT` right, Whodunit's) are
rewritten to `stats#world` with those settings. The `world-state` decl, component and
`CORE_COMPONENTS` row become ⏳ and go at the 0.7 squash; `CloudSun` returns to the narrator
(NOMENCLATURE §22 "needs an icon" closes). Stored `members` reads as `castScope`.

**Data.** Nothing new on `session_state` — owners of all three kinds are already in
`SessionStateV1.owners`. New request `stat-trail: { params: { owner: SessionStateOwnerRef;
slotId: string; limit?: number }; result: { changes: Array<{ messageId: number; at: number;
from: unknown; to: unknown; by: 'user' \| 'model' \| 'pipeline' }> } }`, served from the ledger
the `Stat trail` pipeline query already reads. Edits stay the user's and immediate; proposals
stay in the transcript (the review-gate ruling is untouched).

**Parts.** `stats.group · .group-head · .strip · .trail` added; `world-state.*` parts ⏳ map to
`stats.*` in the default stylesheet for one release. Shared control `stat-slot.*` unchanged.

**Why one widget and not three.** A person asking "how are they" and "what is the world doing"
is reading the same ledger through the same control; two ids meant two settings dialogs, two
style targets and two tray rows for one capability, and a third (`places`) was about to be added.
A layout that wants both the world strip and the party cards places `stats` twice, as the Lair
already places `messages` twice.

### 3.11 W8 · `actions` — Actions

**Question:** what can I do right now, and is anyone waiting on me.

**Declaration.** `reads: ['actions', 'viewer', 'settings', 'locale']`; `icon: 'Zap'` (⚠ check §22;
reuse the glyph the composer's Actions disclosure already uses); all genres; `maxInstances: 1`.

**Draws.** The venues of `actions.v1` the viewer may press, as real buttons with their icon and
label, grouped as the genre groups them (turn controls first, then the genre's own, then
scripts an admin attached). Disabled buttons keep their reason as a tooltip, exactly as the
composer's chips do (`docs/session-actions.md` "Why a button is grey"). A second block, **Waiting
on you**, lists open forms put to the viewer's participants (`pendingAsks`) with *Answer*, which
opens the same form the transcript opens. Press → `invoke(key, args)`; nothing new. When an action
collects (a form before it fires), the widget opens the collect modal the composer uses.

**Settings.** `groups: all | turn | genre | scripts` (default all) · `size: compact | large`
(default compact; *large* is the phone-friendly tile grid) · `showWaiting: boolean` (default true,
behaviour).

**Parts.** `actions.root · .group · .group-head · .button · .reason · .waiting · .ask`.

**Not a composer setting because** the composer's disclosure is about the line being written; a
tile grid that stays visible while someone else writes is a different surface, and on a phone the
disclosure has no room for a Dungeon Crawler's eight actions.

### 3.12 W9 · `annex` — one declared annex key, by its label

**Question:** what does the pipeline know that I am allowed to see.

The Lair Castellan's running notes, the Dungeon Crawler's planning notes once revealed (R14), a
plugin genre's score sheet: every one is an annex key with a `see` audience, and today the only
place to read it is **Session data** at the foot of Settings. This widget draws one.

**Declaration.** `reads: ['annex', 'viewer', 'settings', 'locale']`; `icon: 'ScrollText'`; all
genres. `title` is the declared field's label (`AnnexFieldDecl` carries it); the widget's own
title is the fallback *Annex* when the key is unset or undeclared.

**Draws.** The key's value in the shape it was declared in, through the one field renderer
(`FieldDecl`: text as prose, integer as a number row, list as chips, object as label/value rows).
Read-only unless the field's `act` audience includes the viewer, in which case the same *Edit*
the Session data list offers appears here (the write path is the existing one). Empty states:
*Pick a key in settings* · *Nothing written yet* · *You can't see this* (never silent).

**Settings.** `key: string` (required; the settings sheet offers the declared keys the viewer may
see as a picker, free text otherwise) · `showLabel: boolean` (default false; the head already
says it).

**Parts.** `annex.root · .value · .prose · .row · .empty`.

**Why core.** It is the zero-code way for a genre author to put pipeline state on screen without
writing a component, which is the "explicit declaration, no magic" rule applied to UI
([[feedback_no_magic_in_core_pipeline_data]]): the author declares the key and its audiences; the
widget draws exactly that.

### 3.13 W10 · `presence` — Who's here

**Question:** which people are in this session now, as whom, and who is writing.

**Declaration.** `reads: ['presence', 'viewer', 'settings', 'locale']`; `scopes: ['characters']`
(the persona faces); `icon: 'Users'` (⚠ §22: Scene Portraits borrows `Users` today; after W6 it
takes its own and `Users` returns to people); all genres; `maxInstances: 1`.

**Draws.** One row per person who has the session open: their name, the persona they write as
(face + name, from `characters.v1` `mine`-style ownership), a *typing* pulse driven by the
existing typing ping (`Sockets.Sessions` typing broadcast), and *owner* / *guest* as a quiet
chip. People not present but with a seat (a member who left) are listed under *Away* with when
they were last here. Click a persona → `open-character`.

**New base section** `presence: { v1: { people: Array<{ userId: number; name: string; role:
'owner' | 'guest'; personaRefs: string[]; typing: boolean; lastSeenAt: number | null;
here: boolean }> } }`, produced by the page from the socket's join/leave/typing events (the
`sessions:view` payload already carries members; typing already broadcasts). Additive to
`WIDGET_BASE_SECTIONS`; the exhaustiveness tests gain a case.

**Settings.** `showAway: boolean` (default true) · `faces: boolean` (default true).

**Parts.** `presence.root · .person · .persona · .typing · .role · .away`.

**Why core.** "Several people, one pub" is the pitch (`coming-from-sillytavern.md`); nothing
beside the conversation shows the people. SillyTavern has no equivalent, which is the point.

### 3.14 Settings folded into proposed widgets (from the 2026-10-10 review)

- **Turn order (W1)** gains a footer line for **auto-advance**: the countdown to the next
  automatic turn and the on/off toggle (`group-sessions.md` "Auto-advance"), via the existing
  genre field write. Setting `showAutoAdvance: boolean` (default true, behaviour).
- **Album (W2)** gains `arrangement: grid | latest` (default grid): *latest* draws the newest
  image large with the rest as a thumbnail strip, so an illustrated scene can sit beside the log
  as it is generated.

### 3.16 Messages · the turn line (owner 2026-10-10: "the last run and the next response
trigger above the composer should be combined")

Between the log and the composer the Messages widget today stacks up to three strips, each from
a different owner: the page's **banners** (`sp-host-view name="session-banners"`: who is typing,
a stale preset), the **state line** under the newest reply (*Wren hp 20 → 14 · Review 2 changes*,
`MessageStateLedger` / `StateProposalList`), and the **next-up block** (`NextCharacterBlock`:
*Wren is ready to continue* · Someone else · Continue). They become **one turn line**, part
`messages.turn-line`, with two halves:

- **Left, what the last run did:** a status pill (*Narrator replied · 6.2 s* · *Wren is thinking ·
  step 2 of 3* · *Last run failed · connection timed out*) sourced from the run the newest reply
  belongs to (`runInspection.ts`, `generation:start/end`), then *Review N changes* when proposals
  wait, then *Inspect run* (request `inspect-run`). While a reply streams the pill is live and the
  right half shows **Stop**; after a failure the right half shows **Try again** (the same
  `fire-turn`).
- **Right, who is next:** the next-up text, the typing pill when someone is, **Someone else**
  (`pick-turn`) and **Continue** (`fire-turn`), exactly as `NextCharacterBlock` draws them. The
  `nextUp` setting (head / list / hidden) keeps governing this half; *hidden* hides only the
  right half.
- The stale-preset banner is not a turn fact; it moves to the session header's notice slot (one
  line, dismissible) and leaves the composer area.
- One row at any width: at phone width the left half folds to its pill and the right half keeps
  text + Continue; the links move into the pill's menu.

Parts: `messages.turn-line · .turn-line-run · .turn-line-status · .turn-line-review ·
.turn-line-next · .turn-line-typing`; the `messages.next-up-*` parts become ⏳ aliases for one
release. Docs: `sessions.md` "The session screen" and `group-sessions.md` "Who is due next"
describe the one line. NOMENCLATURE §9: **turn line**.

### 3.15 Waiting on Q6 with Notebook

- **Bookmarks** 🚧: pin a line to a side list of key moments and quotes (SillyTavern checkpoints).
  Per-person, per-session storage; rule with Notebook.
- **Character dossier** 🚧: the selected character's card text beside the log (Whodunit's case).
  Needs card text in the `characters` scope, which is a grant ruling before it is a widget.

### 3.8 `notebook` 🚧 — deferred (Q6)

A person's private notes on a session, never read by any pipeline. Everything about it is small
except **where it is stored**: `widget_settings` is settings (pruned on schema change — wrong),
`sessions.annex` is pipeline-owned with data audiences (wrong owner), `extension_data` is a
genre's slice. It needs a per-(user, session) text row, or a ruling that a widget may own a
storage key. Until Q6 is ruled, not proposed for build.

---

## 4. Default layouts after this plan

| Genre | Left | Middle | Right |
|---|---|---|---|
| Chat | — | `messages` | `authors-note` (unpinned) · tray: turn-order, album, chronicle, lore-entries, places |
| Adventure | **`chronicle`, `lore-entries`** (unpinned rail — fixes the stale "no lore panel" rail) | `world-state` strip · `messages` | `scene-portraits` · `stats` (pinned); tray: `places`, `turn-order`, `album` |
| Guide | — | `messages` | — ; tray: `album`, `lore-entries`, `chronicle` (Guide keeps omitting `authors-note`) |
| Lair | `stats` | `messages` | **`places`** (list, highlight both) replaces `world-state` as the room list · `messages#sanctum`; `world-state` moves to the tray |
| Dungeon Crawler | `stats` | `messages` | `crawl-map` · tab group `messages#parley` / `#plotbook` (folio) / `#travelogue` (folio) — per DC plan |

Per-genre `omitWidgets` additions: Dungeon Crawler omits `chronicle`, `places`, `lore-entries`
(no lorebook). Nothing else changes.

---

## 5. SDK and app surface this plan touches

- `sdk/src/widgets.ts` `WidgetRequests`: + `history-entries`, `set-story-clock`,
  `start-history-entry`, `session-places`. Additive; protocol stays 2. Both exhaustiveness tests
  gain cases; `widgetMounts.test.ts` law covers the new hosts automatically.
- `core-catalog/src/registry/widgets.ts`: + 4 decls (`turn-order`, `album`, `chronicle`,
  `places`), `crawl-map` arrives with DC P2; `coreWidgets` gains `turnOrder, album, chronicle,
  places`; `CORE_COMPONENTS` + rows; `messages.settings.presentation`.
- `core-catalog/components/shared/{turn-order,album,chronicle,places,map-canvas}/`.
- `core-catalog/src/registry/layouts.ts`: Adventure left rail, Lair right, DC layout (per §4).
- App `sessions/[id]` page: four request handlers (owner-gated server events behind them —
  `sessions:historyEntries`, `sessions:setStoryClock` (exists in settings form; reuse),
  `sessions:startHistoryEntry` (exists in the Lore pane; reuse), `sessions:places`).
- `src/lib/client/components/sessionPage/coreWidgets.ts` `CORE_WIDGET_ROWS`: + rows with
  `layout` hints (turn-order span 1 minInline 220; album span 1 minInline 200; chronicle span 1
  minInline 260; places span 2 minInline 260 minBlock 120).
- Composer **Lore** pane: drop the history/scenes half once W3 lands (same change).
- Docs: `session-layout.md` widget table (+5 rows), `sessions.md` composer panels (Lore shrinks),
  `group-sessions.md` (turn-order widget), `lorebook-time.md` (clock from the widget),
  `lorebook-places.md` (in a session), `genre-lair.md` (Places replaces the stand-in),
  `sdk/guides/widgets.md` style-parts list.
- `STYLE-GUIDE.md` §6.16: parts for each widget and `map-canvas`, `media-tile`.
- `NOMENCLATURE.md` §9: **turn order (widget)**, **album**, **chronicle**, **places (widget)**,
  **presentation** (of a Messages copy), **map canvas**; §22 icons; §25 ledger rows. §23 note under
  *gallery*: never a session widget name.
- After every catalogue edit: `npm run sdk:build` (never under the owner's dev server —
  [[feedback_sdk_build_never_under_owner_dev_server]]), then `npm run sdk:test`.

---

## 6. Considered and not proposed

| Candidate | Why not |
|---|---|
| **Proposals / Review changes** widget | Ruled: *the gate is in the transcript* (`widgets.ts` Stats comment). A second gate would be a second source of truth for the same decision. |
| **Prompt budget / Statistics** | Admin-gated diagnostics on the **draft**; belongs beside the draft (composer pane) and in Prompt Details. Duplicating it as a widget puts one fact in two homes. |
| **Dice tray** | Ruled an example plugin (LEDGER S7, 13-OPEN-RULINGS §9). |
| **Channel list** | The channel strip lives inside Messages; a copy per channel is the layout's way (Lair, DC). |
| **Cast / participants manager** | Bench, who-portrays, character detail are *configuration* (Participants tab); Scene Portraits already answers *who is here*. |
| **Relationships graph** in session | Lorebook-side canvas exists; in-session value unproven; `map-canvas` makes it cheap later if asked. |
| **Branches** | A one-shot action (Branch from here) and a lorebook-time concern; nothing to watch mid-play. |
| **Inventory** (revive) | R79 stands: it is the `inventory` list slot drawn by Stats / World State. |
| **Scene card** ("the scene as of this line") | genre-uplift §403 proposes it as a Messages setting; World State strip + Places + Chronicle cover its facts. Revisit after W3/W4. |
| **Notes sent to the model** | That is the author's note; Chat-only by ruling (AN1). |
| **TTS / voice** | No engine chosen (LEDGER L9). |
| **Session header as a widget** | The bar is shell, not a zone's content; owner ruled three fixed zones. |

---

## 7. Open rulings

- **Q1 turn-order vs showcase.** Core ships `turn-order` and Twenty Questions drops `chatGenre`
  from its `whos-next`? (Recommend yes: group sessions are a core strength and the showcase keeps
  its own-genre copy as the tutorial.)
- **Q2 names.** *Album*, *Chronicle*, *Places* as widget titles and ids. Any veto? (*Gallery* is
  taken; *history* / *timeline* / *map* rejected in §3.)
- **Q3 Chronicle absorbs the composer Lore pane's history half.** Yes/no. If no, W3 shrinks to the
  clock + read-only entries.
- **Q4 Places replaces World State in the Lair's right column.** Yes/no. (`world-state` stays in
  the tray either way.)
- **Q5 One renderer.** `map-canvas` shared by Places and `crawl-map`, elkjs, in core-catalog (two
  canvases in the codebase, the lorebook lens unchanged for now). Or wait for Mermaid.
- **Q6 Notebook storage.** A per-(user, session) notes row; or a widget-owned storage key; or
  drop the idea.
- **Q7 Folio presentation as a Messages setting** (§3.7) rather than a separate reader widget.
  (Recommend setting, by the composer precedent.)
- **Q10 Presence as a base section** (W10): a new `presence` base section fed by the page, or a scoped section behind a grant. (Recommend base: it is who is in the room, which every widget may know.)
- **Q9 Stats absorbs World State (W7)**: one `stats` widget with an `owners` axis and a `world-state` alias, or keep two ids. (Recommend merge; the alias makes it free for stored layouts.)
- **Q8 Scene Portraits uplift (W6)** as the home for character images and sprites, with pins
  moving from browser storage to instance settings. Or a separate widget. (Recommend uplift.)

---

## 8. Build order (after rulings; one lane each, targeted tests only, one grouped verification
at the end — [[feedback_batch_large_verification_runs]])

1. **B1 `turn-order`** — no SDK change; decl + component + rows + docs. Smallest; proves the
   pattern for the lane that follows.
2. **B2 `album`** — no SDK change; `media-tile` shared control extracted from the media strip.
3. **B3 `messages.presentation`** — Messages component + Writing Room layout update (plugin repo).
1b. **B1b `actions`** (W8) and **`annex`** (W9) — no SDK change; both are declaration + component + rows.
1c. **B1c `presence`** (W10) — base section + page producer + component.
3d. **B3d Messages turn line** (§3.16) — one strip; banners move to the header notice slot.
3c. **B3c Stats uplift (W7)** — `WIDGET_ID_ALIASES`, the three axes, `stat-trail` request, layouts rewritten to `stats#world`.
3b. **B3b Scene Portraits uplift (W6)** — `lastSpokeAt` + `character-images` request, the three settings, alias reads, pin migration.
4. **B4 `chronicle`** — 3 requests + page handlers + composer Lore pane shrink + docs.
5. **B5 `map-canvas` + `places`** — 1 request + renderer + Lair/Adventure layouts.
6. **B6 `crawl-map`** — stays in the Dungeon Crawler plan's P2; depends on B5's renderer.
7. **B7 `notebook`** — only if Q6 rules a store.

Each lane ends with: `sdk:build`, `sdk:test`, the widget's dom test, `widgetMounts` law, the two
exhaustiveness tests when it added a request, screenshots at 1280 and 390 ("looks decent" —
[[feedback_no_pixel_perfect_widget_styling_yet]]), and the §25 ledger row.
