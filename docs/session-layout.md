# Session layout

Every session has a layout: the conversation in the middle, and any side panels — scene
portraits, notes, a map, a plugin's own view — arranged around it. The layout editor lets you
arrange those panels, save the arrangement as a preset, and give each panel its own look.

## The panels Serene Pub ships

**Messages** is the conversation — the message log and the field you write into, one panel, always
in the middle. Beside it, these are the panels built in. Add any of them from the tray on the
**Move** tab.

| Panel               | What it shows                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Scene Portraits** | The cast in the scene, or the two images you pin from a message avatar, with an optional mini stat bar row.  |
| **Stats**           | One card per cast member: bars, chips and lines you can edit. See [Stats and states](./stats-and-states.md). |
| **Inventory**       | Who is carrying what, with a group for what nobody is carrying. Drag an item to hand it over.                |
| **World State**     | The session's world stats (weather, time, place) as an editable strip or list.                               |

Stats, Inventory and World State are empty unless something declares stats: a genre, an
extension or an administrator. A standard chat session has none, so they show a line saying so
rather than an empty frame.

Scene Portraits draws one of two things, and its **Show** setting picks which. **Pinned** is the
two images you pin from a message avatar, which is what a chat session has. **Scene** is the cast:
every character in the session, each with their picture, their name and (with **Show stat bars**
on) their bars. **Include your persona** adds the persona you are playing to that row. A genre that
docks the panel beside the conversation usually asks for **Scene**, so a new session opens showing
who is there rather than an empty frame.

## Opening the editor

Press **Layout** at the right end of the session header. The editor's toolbar takes the header's
place across the top of the window, and the Jump pill steps aside until you leave (Ctrl K still
opens it). An open sidebar closes too — the editor lays its zones out across the whole window, and a
sidebar would cover the left one — and comes back, on the same tab and with everything in it, when
you leave the editor. The session stays live underneath while you edit. Press **Done** to keep what
you did, or **Cancel** to put back the layout you opened the editor on — panels added or removed
included.

The editor has three tabs: **Presets**, **Settings** and **Move**.

## Presets

A preset is a saved arrangement for this *kind* of session (its genre). The **Default** preset is
built in and cannot be changed. To make your own:

1. Arrange the panels the way you want them on the **Move** tab.
2. On **Presets**, type a name and press **Save preset**. (Pressing **Done** with a name typed also
   saves.)

Your presets appear beside Default with a schematic preview. Click one to apply it. Hover a preset
you made for **Rename** and **Delete**; deleting a preset that other sessions are using tells you how
many, and those sessions fall back to Default. Built-in presets have no rename or delete.

**Reset to default** discards your arrangement for this session.

A preset can also carry panel settings, so a genre's own layout arrives configured: the adventure
layout asks Scene Portraits for the scene and for stat bars, for example. Those are the starting
point, not a lock. Change one on the panel's own card and your value wins from then on.

## Settings

Everything about one panel lives on the panel. Open **Settings** and **hover any panel**: a small card
fades in over it, and everything on that card changes that panel and nothing else.

### What every panel has

**Title** is what the panel is called on screen. Type your own and the panel's title bar, the layout
editor's cards and the panels list all use it; clear the box and the panel goes back to the name it
came with.

**Lane** appears on a panel that follows a channel — a cell phone, a mission list, a side
conversation. A channel can carry several conversations at once, numbered from 1, and the lane is
which of them this panel shows. Lane 1 is the channel's default, and a panel left there shows the
channel as it comes. Put two copies of the same panel in the layout on different lanes and each one
follows its own conversation.

### What a panel adds

Below those, a panel shows whatever settings it declares — a portrait panel's size, a notes panel's
font. A panel that declares none shows nothing here, so the card never offers a control with nothing
behind it. Settings a panel marks as behaviour sit under **Behaviour**, folded away until you open
it.

Only what you change is kept. A setting left as the panel ships it is not stored at all, so a panel
whose default changes in a later version follows the new one; **Reset** on the card drops your
changes for that panel in one go. A setting a panel stops offering is dropped the next time Serene
Pub starts.

### Style

Style is about how each panel looks, never where it sits. The **Style** section of the same card
shows the panel's current style, a picker, and **New**, **Edit**, **Clone** and **Delete**. Pick a
built-in style, or press **New** to write your own — a name, CSS,
optional variables, and who may use it (**Just me** or **Everyone** on this instance). **Edit** opens
the editor anchored to that panel and **applies what you type as you type**, so you see the panel
change; **Save** keeps it, **Cancel** or Escape puts the saved style back. **Clone** copies any style
you can see into a private one you can edit. Built-in styles can be cloned but not edited or deleted.

**Messages** wears the same card as every other panel; its built-in looks (*Stage*, *Bubbles*,
*Novel*, *Compact*, *Dreamlit Cameo*) are just its built-in styles. How the composer itself is
drawn is not a style but a setting on the same panel — **Composer** (*classic*, *minimal* or
*writer*) in its **Settings** section, alongside which end of the log it sits at and which parts of
a message are shown.

A style's CSS applies to that one panel only. Every selector you write is re-pointed at the panel's
own box, so a style cannot reach the rest of the page or another panel — even another copy of the
same panel, and never the controls used to change it. `@import` and images from other websites are
refused. `@font-face`, `@property` and `@counter-style` are stored but not applied, because they name
things for the whole page rather than for one panel. Variables are CSS custom properties and must be
written as `--name`. For a rule that should only apply in dark mode, start the selector with
`[data-mode="dark"]` — for example `[data-mode="dark"] .my-card { background: black }`.

## Actions in the composer

Some genres contribute actions: things you press rather than type. An adventure session has
**Look**, **Rest** and **Time passes**; a chat session has its narrator. They live behind one quiet
word above the message field, **Actions**: click it and the chips open beneath it, wrapping to as
many lines as they need, and stay open until you click **Actions** again or press Escape while
one of them has focus. The genre's quick actions come
first as chips, then a **More** menu holding every other enabled action (with a **New** mark on any
you have not met), then the turn controls. A genre that contributes none still shows the label for
the turn controls; a session with nothing to offer grows no label at all. The **Show the Actions
label** setting hides it. Every composer action is also a slash command — see [Slash
commands](./sessions.md#slash-commands).

## Actions for widgets

A widget — native or a plugin frame — receives the session's actions on its data envelope as
`actions.v1`, keyed by venue: each venue is `{ primary, overflow }`, every entry carrying its key,
function, the spec that contributed it, label, icon, slash name, audience, whether the viewer may
act, and whether it is new to them. A widget draws the venues it wants — its own controls from
`widget`, a message's menu from `message` — and invokes one by its **identity**, `<spec
slug>#<key>` (`acme:spec/roll#roll`, or `core#continue` for one of Serene Pub's own verbs), with
`invoke(id, { messageId?, payload? })`; a bare key (`roll`) is accepted while only one action
carries it. The host resolves it to the declaration and routes it: one of Serene Pub's message
verbs — continue, regenerate, edit, stop, branch, swipe, hide, delete — to the same handler the
message row uses, everything else through the audited fire that a chip takes, naming the
declaration so the server checks *that* action's audience and runs *that* pipeline. That is the
very same fire, not a copy of it: a press inside a widget starts a named run, so Cancel reaches it
in the moment before its first progress report, and an action with a window of its own — the
narrator's — opens that window exactly as the chip does. A reference no venue lists, or a bare key
several actions share, is refused rather than fired. A frame gets the
same rows as `{ t: "actions" }` over its port and invokes with `{ t: "invoke", key, messageId?,
payload? }`. A widget that ignores the section loses nothing; one that draws its own control
gains a contributed action without a line of host code.

One limit on a **frame**: the verbs that change a message — hide, regenerate, continue, delete,
edit, swipe — need a person behind them. A frame may invoke one only while a person is
*currently* in it: the browser's own activation flag is set — a real, recent click or key press
somewhere — **and** the frame is the page's current focus, both at once. Activation inside the
frame itself sets that flag on the whole page and moves the page's focus onto the frame, which is
as close as the host can see into a sandboxed frame it cannot otherwise read. Where your browser
does not yet support that check (Firefox, as of writing) the host falls back to the older rule:
focus must have entered the frame within the last five seconds and not left again. An invoke on
load, on a timer, or after focus has moved back to the page is refused with a warning in the
console and nothing fires. Three of them ask first as well: delete opens the same confirmation
the message row does, and regenerate and continue — both spend tokens — put a question to you
before they run. Stop and branch are not gated, and a contributed action is judged by its own
audience on the server, as it is from any chip.

Be clear about what that gate is. It is a mitigation against a widget acting unprompted, not a
permission check and not proof that you meant the action: it knows only that a person appears to
be in the frame right now (or, on the fallback, entered it a moment ago). The authority is the
server, which judges every message write against *your* permissions on that message exactly as
it does for a click on the row — a frame acts with its viewer's permissions and never more, and a
widget can do nothing through you that you could not do yourself. A click elsewhere on the page,
even though it sets the same activation flag, does not count as being in the frame — the focus
check is what tells the two apart.

Every mount is handed the venues the same way: the page holds them once and passes them down the
layout to each native widget and each panel frame, so `actions.v1` is populated wherever a widget
is drawn in a session, and `invoke` resolves against the same table the message row uses. A widget
mounted outside a session has no venues; its `actions.v1` is empty and its `invoke` refuses by
name, which is the right answer there. A widget a plugin declares for itself is seated like any
other, under an id prefixed with the plugin's own, so two plugins that both ship a **Map** never
collide; a widget a genre declares keeps its plain name.

A widget also hears what happens to the messages it can see: one row edited, deleted or streaming
in, and a generation starting or ending, each as an event scoped to the widget's channels. What it
never hears is a selection, because the session tracks none that the event could describe.

## What the Messages panel offers

Messages is the one panel with settings about the conversation itself:

- **Composer** — how the field is drawn: *classic* (the card), *minimal* (a single-line pill) or
  *writer* (a tall editor set in the prose face for long turns). Send, Preview and More are the
  same in all three.
- **Composer position** — *bottom* or *top*. The who-is-due line and any notices move with it.
- **Message order** — *oldest first* (newest at the bottom, the default) or *newest first* (newest
  at the top; new replies keep the top pinned and older messages load as you scroll down).
- **Show messages** / **Show composer** — hide either half. A panel with only its composer shrinks
  to the card; one with only its log is a reading pane.
- Under **Behaviour**: **Show avatars**, **Show times**, **Show scenes and dates**, **Show who is
  due next**, **Show the Actions label**.

With a background image set in your theme settings, the conversation sits on one translucent
panel over the image so the prose always has a ground, and your own turns and the composer stay
opaque inside it.

## Move

The **Move** tab covers the session with three grids — **Left**, **Middle**, **Right** — drawn where
the panels actually live. Messages stays in the middle. The session itself goes on running
underneath: switching between Presets, Settings and Move — or leaving the editor — never reloads a
panel or throws away what you had typed in one.

- **Add** a panel from the tray by dragging it onto any of the three zones — the middle included —
  or tap it and then tap where it goes. Drag a panel back to the tray to remove it.
- Drag panels to move them; drag their edges to resize. Each card also has fit-width, fit-height and
  dock-top/dock-bottom buttons.
- A zone with no free cell says **Full** in its title bar. A panel **dragged** onto it still snaps
  back to where it came from — but **adding one from the tray makes room**: the biggest card in the
  zone gives up rows from its bottom edge, keeping its top, until the new panel fits. A zone whose
  cards are all as short as they go stays exactly as it is, and Full still means full. This is
  mostly about the middle, which Messages usually fills edge to edge.
- **Anchors** pin a panel to an edge of its zone so it stays put as the window changes. Where the
  layout has to fall into a single column (see below), an anchor becomes an order instead: anchored
  to the top it goes first, to the bottom it goes last.
- Select two or more panels and **Group** them: in the live session they become one tabbed panel.
  Grouped panels keep their state when you switch tabs.
- **Pin** keeps a group open. Each group in a side column is its own panel: pinned, it is open
  from the start and holds its height when you open something else; unpinned, it waits as an icon
  in the slim rail at the column's outer edge. Click an icon to open that group and click it again
  to put it away. A single panel is a group of one, so this is how every side panel behaves — and
  turning more of them on only ever adds another icon to the rail. The pin belongs to the panel
  group rather than to the whole column, and it is saved with the layout — so it comes back on
  reload and travels with a preset, while which groups you happen to have open does not.
- If the column has no room left beside the pinned groups, the one you just opened comes out over
  the session at full height instead of squeezing everything thinner. Click away, press Escape, or
  click its icon again to close it. **Alt+[** opens every group that fits; **Alt+]** sends them all
  back to the rail.

### Previewing other screen sizes

**Screen** shows the layout as it will appear at other widths — **Compact 390**, **Cozy 640**,
**Roomy 1024**, **Wide 1440**, **Ultrawide 2560** — without resizing your window. (Above 2400 px the
side rails become two columns wide; Ultrawide previews that.) A narrower width has fewer grid
columns, so panels are squeezed to fit; that is exactly what would happen on that device.

**Rails** draws the side columns the way a session draws them — pinned groups docked, the rest as
icons — so you can open, close and pin groups and see what each width does before you live with it.
Each preset previews that device's height as well as its width, because whether a group can open
beside the pinned ones depends on how tall the column is.

**Compact** and **Cozy** are below the width where side panels exist at all, so they preview the
editor those screens get — the ordered lists described under *Editing on a phone*. **Grid** appears
beside Rails there and draws the cell grid at that width instead, for when what you want to see is
how the columns clamp.

Previewing is only a lens: switch back to **Actual** and the arrangement is restored. The same is
true of a real window: making the window narrower squeezes the layout to fit, and making it wide
again brings the arrangement back exactly — resizing never rewrites what you saved. If you *edit*
while previewing, the edit is kept — there is one arrangement for all sizes, and the editor says so
while you are in a preview.

## One column

Panels you placed side by side stay side by side while there is room for them. When there is not —
a narrow column, a narrow window, a phone — they fall into a single column instead, one under the
other, in the order they were arranged: down the layout, then across it. Anchors become that order
(top-anchored first, bottom-anchored last) because a single column has no left and right to pin to.
It is the same layout, stacked, not a second layout you have to keep: widen it again and the columns
come back.

This is decided per column, against the panels in it rather than against the window — a side column
in a narrow browser window can fall into one column while the messages beside it do not.

## Phones and narrow windows

Below 1024 px the side panels are hidden, the messages take the full width, and nothing is ever
side by side. There is no rail down here: the **panels button** beside the navigation menu is the
rail. Tap it for a list of everything on the sides — icon, name, which side it is on, and a pin on
the ones that are pinned — and tap a name to slide that side over the session with it open. Tap
outside, press Escape, or use the close button to put it away.

In that overlay each panel is as tall as it needs to be, up to the height of the screen, and the
list scrolls; tap a panel's title bar to fold it away to that bar, and again to open it. Which
panels arrive open is what you pinned. Panels keep their state throughout — when they move between
the side and the overlay, when they fold, and when the layout falls into one column.

## Editing on a phone

Down here the editor is what the screen is: **Middle**, **Left** and **Right** as three lists, one
row per panel, in the order they are drawn. There is no grid to drag on, because there is nothing
side by side to drag into.

- **Reorder** with the up and down arrows on a row, or press and hold its handle and slide.
- A row marked **First** or **Last** is anchored to the top or bottom of its zone; on one column
  that is all an anchor means. Moving a row past that mark takes the anchor with it.
- **Pin** is on each side row: pinned, the panel is open from the start and keeps its height;
  unpinned, it waits in the panels menu.
- A row that is a tab group lists its tabs underneath, in tab order, with the same arrows.
- **Add** at the top of a side list opens a picker; the **×** on a row removes that panel.
- The paint-drop button opens that panel's settings and style full screen — the hover card the
  desktop uses has nothing to hover here.
- The bar at the foot holds **Presets** (apply a saved layout, or save this one), a reset button,
  **Cancel** and **Done**. Cancel puts back the layout you opened the editor on, panels added or
  removed included.

It is the same layout, so everything done here is what a desktop opens: reordering trades two
panels' places and leaves the rest of the arrangement alone. Moving a panel past a row it was
sharing is the one change that does more — it takes a row of its own, which is what this screen was
already drawing it as, and widening the window will not put it back beside its neighbour.

To try this from a desktop, open **Move** and pick **Compact** or **Cozy** under Screen.

## Where layouts are stored

Presets belong to you and to the session's genre, so they are available in every session of that
kind. Which preset a session uses, its per-panel style choices, and each panel's settings are stored
per session. Guests in a session have their own layout for it, and their own panel settings.
