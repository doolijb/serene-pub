# Session layout

Every session has a layout: the conversation (in the middle unless you move it), and any other
widgets — scene portraits, notes, a map, a plugin's own view — arranged around it. The layout editor
lets you arrange those widgets in any column, save the arrangement as a preset, and give each widget
its own look.

## The widgets Serene Pub ships

**Messages** is the conversation — the message log and the field you write into, one widget. It
starts in the middle, and like every widget it can go in any column (see
[Moving the conversation](#moving-the-conversation)). A layout can place a second copy of it for one
channel (the Lair's Sanctum panel; see [below](#a-second-messages-widget-for-one-channel)). Beside
it, these are the widgets built in. Add any of them from the tray on the **Move** tab.

| Widget              | What it shows                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Scene Portraits** | The cast in the scene, or the two images you pin from a message avatar, with an optional mini stat bar row.  |
| **Stats**           | One card per cast member: bars, chips and lines you can edit. See [Stats and states](./stats-and-states.md). |
| **World State**     | The session's world stats (weather, time, place) as an editable strip or list.                               |
| **Lore entries**    | The session's lorebook entry by entry: how often each was read, pin or turn one off. See [Lorebooks](./lorebooks.md#what-a-session-has-read). |

An admin can also write widgets of their own, or clone one of these and change it; once switched
on, they sit in the same tray. See [Component authoring](./component-authoring.md).

Stats and World State are empty unless the session tracks stats: its genre's own, or — where the
genre allows it — its world's or ones added for the session (see
[Stats and states](./stats-and-states.md#what-a-session-tracks)). A session of the standard Chat genre has none, so they show a line saying so rather than an
empty frame.

The **Inventory** widget is removed for now. A layout or preset that placed it — Adventure and
Lair both did — opens without it: the widgets around it keep their places, and nothing is drawn
where it was. What people carry is still tracked; see
[Stats and states](./stats-and-states.md#in-a-session).

Scene Portraits draws one of two things, and its **Show** setting picks which. **Pinned** is the
two images you pin from a message avatar, which is what a Chat session has. **Scene** is the cast:
every character in the session, each with their picture — their current sprite, if they have
sprites and **Show sprites** is on — their name and (with **Show stat bars** on) their bars. **Include your persona** adds the persona *you* are playing to that row — the one
you are writing as, not whichever persona happens to be listed first — so two people in one session
each see their own. A genre that docks the widget beside the conversation usually asks for
**Scene**, so a new session opens showing who is there rather than an empty frame.

Clearing a pinned portrait with its **×** clears the pin itself, so the composer's **Pinned images**
panel empties that side too, and a reload keeps it cleared. Pins are kept in this browser, per
session. If a change you make here is refused
(someone else's character, say), the reason shows as a line at the top of this widget, not in any
other widget.

## Opening the editor

Press **Layout** at the right end of the session header. The editor's toolbar takes the header's
place across the top of the window, and the Jump pill steps aside until you leave (Ctrl K still
opens it). An open sidebar closes too — the editor lays its zones out across the whole window, and a
sidebar would cover the left one — and comes back, on the same tab and with everything in it, when
you leave the editor. The session stays live underneath while you edit. Press **Done** to keep what
you did, or **Cancel** to put back the layout you opened the editor on — widgets added or removed
included.

The editor has three tabs: **Presets**, **Settings** and **Move**.

## Presets

A preset is a saved arrangement for this *kind* of session (its genre). The **Default** preset is
built in and cannot be changed. To make your own:

1. Arrange the widgets the way you want them on the **Move** tab.
2. On **Presets**, type a name and press **Save preset**. (Pressing **Done** with a name typed also
   saves.)

Your presets appear beside Default with a schematic preview. Click one to apply it. Hover a preset
you made for **Rename** and **Delete**; deleting a preset that other sessions are using tells you how
many, and those sessions fall back to Default. Built-in presets have no rename or delete.

**Reset to default** discards your arrangement for this session.

A preset can also carry widget settings, so a genre's own layout arrives configured: the adventure
layout asks Scene Portraits for the scene and for stat bars, for example. Those are the starting
point, not a lock. Change one in the widget's settings and your value wins from then on.

## Settings

Everything about one widget is in that widget's settings. Open **Settings** and **hover any widget**
(or Tab to it): a **Settings** button appears over it. Press it and the widget's settings open in a
window of their own, titled with the widget's name — *Messages settings*, *Scene Portraits settings*.
Everything in that window changes that widget and nothing else, and it applies as you change it, so
there is nothing to save: **Close**, the **×**, a click outside or Escape puts the window away and
returns you to the button you pressed. A widget with many settings scrolls inside the window; on a
phone the window fills the screen.

### What every widget has

**Title** is what the widget is called on screen. Type your own and the widget's title bar, the layout
editor's cards and the panels list all use it; clear the box and the widget goes back to the name it
came with.

**Card** draws the widget in a card: a surface, a border and a title bar with its name. It is off by
default, so a widget sits flush in its place in the layout and looks like part of the session. A
widget you open for a moment over the session, such as a tucked panel, a panel that opens over the
others, or the panels sheet on a phone, always has its card, whatever this setting says.

**Lane** appears on a widget that follows a channel — a cell phone, a mission list, a side
conversation. A channel can carry several conversations at once, numbered from 1, and the lane is
which of them this widget shows. Lane 1 is the channel's default, and a widget left there shows the
channel as it comes. Put two copies of the same widget in the layout on different lanes and each one
follows its own conversation.

### What a widget adds

Below those, a widget shows whatever settings it declares — a portrait widget's size, a notes widget's
font. A widget that declares none shows nothing here, so the window never offers a control with nothing
behind it. Settings a widget marks as behaviour sit under **Behaviour**, folded away until you open
it.

Only what you change is kept. A setting left as the widget ships it is not stored at all, so a widget
whose default changes in a later version follows the new one; **Reset** in the window drops your
changes for that widget in one go. A setting a widget stops offering is dropped the next time Serene
Pub starts.

### Style

Style is about how each widget looks, never where it sits. The **Style** section of the same window
shows the widget's current style, a picker, and **New**, **Edit**, **Clone** and **Delete**. Pick a
built-in style, or press **New** to write your own — a name, CSS,
optional variables, and who may use it (**Just me** or **Everyone** on this instance). **New** and **Edit**
open the style editor in the same window, which moves to the side of the screen away from the widget
and drops its shade, and **applies what you type as you type**, so you see the widget change — a ring
marks which widget it is. **Save style** keeps it; **Cancel** or Escape puts the saved style back and
returns to the widget's settings (a second Escape closes the window). **Clone** copies any style
you can see into a private one you can edit. Built-in styles can be cloned but not edited or deleted.

**Messages** has the same settings window as every other widget; its built-in looks (*Stage*, *Bubbles*,
*Novel*, *Compact*, *Dreamlit Cameo*) are just its built-in styles. *Dreamlit Cameo* sets each line
on a soft glass card with the speaker's portrait large and unframed along its edge, fading into the
card; in a narrow widget the portrait sits faintly behind the text. How the composer itself is
drawn is not a style but a setting on the same widget — **Composer** (*classic*, *minimal* or
*writer*) in its **Settings** section, alongside which end of the log it sits at and which parts of
a message are shown.

A style's CSS applies to that one widget only. Every selector you write is re-pointed at the widget's
own box, so a style cannot reach the rest of the page or another widget — even another copy of the
same widget, and never the controls used to change it. `@import` and images from other websites are
refused. `@font-face`, `@property` and `@counter-style` are stored but not applied, because they name
things for the whole page rather than for one widget. Variables are CSS custom properties and must be
written as `--name`. For a rule that should only apply in dark mode, start the selector with
`[data-mode="dark"]` — for example `[data-mode="dark"] .my-card { background: black }`.

## Actions in the composer

Some genres contribute actions: things you press rather than type. An adventure session has
**Look**, **Rest** and **Time passes**; a Chat session has its narrator. They live behind one quiet
word above the message field, **Actions**: click it and the chips open beneath it, wrapping to as
many lines as they need, and stay open until you click **Actions** again or press Escape while
one of them has focus. The genre's quick actions come
first as chips, then a **More** menu holding every other enabled action (with a **New** mark on any
you have not met), then the turn controls. A genre that contributes none still shows the label for
the turn controls; a session with nothing to offer grows no label at all. The **Show the Actions
label** setting hides it. Every composer action is also a slash command — see [Slash
commands](./sessions.md#slash-commands).

## Actions for widgets

A widget — core's or a plugin's component, or a plugin frame — receives the session's actions on its data envelope as
`actions.v1`, keyed by venue: each venue is `{ primary, overflow }`, every entry carrying its key,
the spec that contributed it, name, description, icon, slash name, audience, whether the viewer may
act (and, when it is greyed out, why), and whether it is new to them. A widget draws the venues it wants — its own controls from
`widget`, a message's menu from `message` — and invokes one by its **identity**, `<spec
slug>#<key>` (`acme:spec/roll#roll`, or `core#extend` for one of Serene Pub's own verbs), with
`invoke(id, { messageId?, payload? })`; a bare key (`roll`) is accepted while only one action
carries it. The host resolves it to the declaration and routes it: one of Serene Pub's message
verbs — extend, regenerate, edit, stop, branch, swipe, hide, delete — to the same handler the
message row uses, everything else through the audited fire that a chip takes, naming the
declaration so the server checks *that* action's audience and runs *that* pipeline. That is the
very same fire, not a copy of it: a press inside a widget starts a named run, so Cancel reaches it
in the moment before its first progress report, and an action with a window of its own — the
narrator's — opens that window exactly as the chip does. A reference no venue lists, or a bare key
several actions share, is refused rather than fired. A frame gets the
same rows as `{ t: "actions" }` over its port and invokes with `{ t: "invoke", key, messageId?,
payload? }`. A widget that ignores the section loses nothing; one that draws its own control
gains a contributed action without a line of host code.

One limit on a **frame**: the verbs that change a message — hide, regenerate, extend, delete,
edit, swipe — need a person behind them. A frame may invoke one only while a person is
*currently* in it: the browser's own activation flag is set — a real, recent click or key press
somewhere — **and** the frame is the page's current focus, both at once. Activation inside the
frame itself sets that flag on the whole page and moves the page's focus onto the frame, which is
as close as the host can see into a sandboxed frame it cannot otherwise read. Where your browser
does not yet support that check (Firefox, as of writing) the host falls back to the older rule:
focus must have entered the frame within the last five seconds and not left again. An invoke on
load, on a timer, or after focus has moved back to the page is refused with a warning in the
console and nothing fires. Three of them ask first as well: delete opens the same confirmation
the message row does, and regenerate and extend — both spend tokens — put a question to you
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
layout to each widget component and each widget frame, so `actions.v1` is populated wherever a widget
is drawn in a session, and `invoke` resolves against the same table the message row uses. A widget
mounted outside a session has no venues; its `actions.v1` is empty and its `invoke` refuses by
name, which is the right answer there. A widget a plugin declares for itself is seated like any
other, under an id prefixed with the plugin's own, so two plugins that both ship a **Map** never
collide; a widget a genre declares keeps its plain name.

A widget also hears what happens to the messages it can see: one row edited, deleted or streaming
in, and a generation starting or ending, each as an event scoped to the widget's channels. What it
never hears is a selection, because the session tracks none that the event could describe.

## What the Messages widget offers

Messages is the one widget with settings about the conversation itself:

- **Composer** — how the field is drawn: *classic* (the card), *minimal* (a single-line pill) or
  *writer* (a tall editor set in the prose face for long turns). Send, Preview and More are the
  same in all three.
- **Composer position** — *bottom* or *top*. The who-is-due line and any notices move with it.
- **Line width** — *Full* (the default) or *Comfortable*. Full runs the messages and the composer
  across the whole width the widget is given, however wide the window. Comfortable keeps them to an
  easy reading length (about 640px of text), centred on the session, with the rest of the panel
  around them.
- **Message order** — *Newest at the bottom* (the default) or *Newest at the top* (new replies keep
  the top pinned and older messages load as you scroll down).
- **Show messages** / **Show composer** — hide either half. A widget with only its composer shrinks
  to the card; one with only its log is a reading pane.
- Under **Behaviour**: **Show avatars**, **Face beside each line** (the character's avatar, or the
  sprite that line showed), **Show times**, **Show scenes and dates**, **Who is due next** (who
  speaks next, who speaks after them too, or nothing — see
  [Sessions](./sessions.md#who-is-due-next)), **Show the Actions label**, and **Channel** (below).

### A second Messages widget for one channel

A session can have more than one channel: the Lair has the story and the **Sanctum**, your talk with
the Castellan. A layout can give such a channel a panel of its own by placing a second copy of the
Messages widget with its **Channel** setting on that channel. The Lair's own layout does this: its
right column holds the dungeon's state and, under it, the Sanctum.

- **A copy with a channel** shows that channel's messages and nothing else, titled with the channel's
  name (*Sanctum*). What you write in it goes to that channel, its **Continue** continues that
  channel, and its turn controls are that channel's own (the Sanctum offers Continue and Narrate, not
  Pick who speaks or Regenerate the last turn).
- **A copy with no channel** — the story's own log — shows every channel no copy has
  taken. So with one Messages widget, nothing changes: it is the whole session, and its channel strip
  switches between the channels. With the Sanctum copy placed, the story's log is the story alone and
  has no channel strip.
- **If every copy has a channel** — you removed the story's log and kept the Sanctum — the first copy
  also shows every channel no copy has taken, after its own, so the story never disappears from the
  session.
- Each copy has its own settings and its own style. The Sanctum copy opens with the single-line
  composer; change it from its own settings without touching the story's. Unstyled, a copy wears the
  same style as the conversation.
- On a phone the copy is one of its side's views, opened from the panels menu like any other widget.

A layout names a copy by the widget's id, `#`, and a name of its own: `messages#sanctum`. That id is
what its settings and style are stored under.

With a background image set in your theme settings, the conversation sits on one translucent
panel over the image so the prose always has a ground, and your own turns and the composer stay
opaque inside it.

## Move

The **Move** tab covers the session with three grids — **Left**, **Middle**, **Right** — drawn where
the widgets actually live. Any widget can go in any of them, Messages included. The session itself goes on running
underneath: switching between Presets, Settings and Move — or leaving the editor — never reloads a
widget or throws away what you had typed in one.

- **Add** a widget from the tray by dragging it onto any of the three zones — the middle included —
  or tap it and then tap where it goes. Drag a widget back to the tray, or use the **×** on its card,
  to remove it. The last Messages widget has a lock where its × would be: a session needs one.
- Drag widgets to move them; drag their edges to resize. Each card also has fit-width, fit-height and
  dock-top/dock-bottom buttons.
- A zone with no free cell says **Full** in its title bar. A widget **dragged** onto it still snaps
  back to where it came from — but **adding one from the tray makes room**: the biggest card in the
  zone gives up rows from its bottom edge, keeping its top, until the new widget fits. A zone whose
  cards are all as short as they go stays exactly as it is, and Full still means full. This is
  mostly about the middle, which Messages usually fills edge to edge.
- **Anchors** pin a widget to an edge of its zone so it stays put as the window changes. Where the
  layout has to fall into a single column (see below), an anchor becomes an order instead: anchored
  to the top it goes first, to the bottom it goes last.
- Select two or more widgets and **Group** them: in the live session they become one tabbed panel.
  Grouped widgets keep their state when you switch tabs.
- **Pin** keeps a group open. Each group in a side column is its own panel: pinned, it is open
  from the start and holds its height when you open something else; unpinned, it waits as an icon
  in the slim rail at the column's outer edge. Click an icon to open that group and click it again
  to put it away. A single widget is a group of one, so this is how every side panel behaves — and
  turning more of them on only ever adds another icon to the rail. The pin belongs to the widget
  group rather than to the whole column, and it is saved with the layout — so it comes back on
  reload and travels with a preset, while which groups you happen to have open does not.
- If the column has no room left beside the pinned groups, the one you just opened comes out over
  the session at full height instead of squeezing everything thinner. Click away, press Escape, or
  click its icon again to close it. **Alt+[** opens every group that fits; **Alt+]** sends them all
  back to the rail.

A widget you cannot see yet — waiting in the rail, behind another tab of its group, or on a side a
phone keeps hidden — does not load until you first open it, so a layout with many widgets costs
nothing for the ones you never look at. Once it has been shown it stays loaded: closing it again
only hides it, and it keeps its state for when you come back. The conversation always loads at once.

### Moving the conversation

The conversation is a widget like any other: drag the Messages card into the left or right column
and press **Done**, and it stays there — after a reload, in a saved preset, everywhere the layout
goes. Put a map, the world state or a plugin's board in the middle instead, or set the Lair's
Sanctum in the middle and the story beside it.

Two rules keep a layout usable:

- **A session needs one Messages widget.** You can move it anywhere, but the last one has no ×. With
  a second copy placed (the Lair's Sanctum), either one can go. If a layout somehow places none, the
  session puts one back in the middle.
- **The middle is never left empty.** Done refuses with *Put a widget in the middle, or move one
  back.* — an empty middle is almost always a move you have not finished.

Moving the conversation into a side changes what a phone and Stage only show: they show the
conversation, wherever it sits (see [Stage only](#stage-only) and
[Phones and narrow windows](#phones-and-narrow-windows)). In a side the conversation takes that
side's width, and its settings — Line width included — work the same there.

### Previewing other screen sizes

**Screen** shows the layout as it will appear at other widths — **Compact 390**, **Cozy 640**,
**Roomy 1024**, **Wide 1440**, **Ultrawide 2560** — without resizing your window. (Above 2400 px the
side rails become two columns wide; Ultrawide previews that.) A session is not capped at Ultrawide:
on a wider screen, such as a 3840 px 4K monitor, the zones use the whole width. A narrower width has fewer grid
columns, so widgets are squeezed to fit; that is exactly what would happen on that device.

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

Widgets you placed side by side stay side by side while there is room for them. When there is not —
a narrow column, a narrow window, a phone — they fall into a single column instead, one under the
other, in the order they were arranged: down the layout, then across it. Anchors become that order
(top-anchored first, bottom-anchored last) because a single column has no left and right to pin to.
It is the same layout, stacked, not a second layout you have to keep: widen it again and the columns
come back.

This is decided per column, against the widgets in it rather than against the window — a side column
in a narrow browser window can fall into one column while the messages beside it do not.

## Widgets fill their space

Every widget takes the whole width its place in the layout gives it: the messages and the composer,
the stats cards, the scene's portraits, the lore list. On a wider window a stats or lore widget lays
its cards out in columns instead of stretching one card across the panel. Nothing is held narrow
behind your back — if you want the conversation at a reading width, that is its **Line width**
setting (above).

## An empty side keeps its column

A side with nothing in it does not disappear. The Left side of a fresh session, or a side whose last
widget you moved away in the editor, stays in the session as an empty column: a quiet, slightly
tinted strip exactly as wide as that side's first widget will be. The column you see in the
editor's **Move** tab is still there when you press **Done**, and adding a widget later does not shift
the conversation. There is nothing to click in it; widgets go in from the editor.

An empty column only takes room the rest of the layout can spare. On a narrower window it goes before
anything else does: the conversation and the sides that hold panels keep their room, and the empty
column steps aside well before those sides would tuck. When both sides are empty, both columns stay
or both go, so the conversation stays centred. A tucked or hidden side keeps no empty column, and a
tucked empty side has no icons, because there is no panel to open. On a phone an empty side is simply
not listed in the panels menu.

## The conversation stays centred

When the conversation is in the middle, it sits in the middle of the session whatever the sides hold. When both sides show a
column, a panel or an empty one, the conversation is already centred between them. With **Line width**
set to *Comfortable*, when one side is wider than the other (for example, one side's empty column had to
step aside on a narrower window), the conversation panel widens toward the lighter side by the
difference and its text column shifts to match, so on a wide screen the messages and the composer are
exactly centred. At *Full* the
messages simply span the panel from side to side. The extra width only ever comes out of room the conversation
does not need: on a window too tight to centre fully, it centres as far as it can without narrowing
the text column.

The conversation panel is what grows with the window. The side panels keep their usual width however
wide the window gets, and every extra pixel goes to the middle: the messages fill it (at
*Comfortable*, the text column keeps its reading width, centred as above, and the rest of the middle
is the conversation panel around it). Only on a
window too tight for the sides and a full-width text column do the sides give way — first by
tucking (below).

The whole conversation panel scrolls, not just its text column: wherever the panel is wider than the
column (the room that centres it, a narrow window with the sides put away, a phone, the glass
panel's edges), the mouse wheel works over the space beside the messages too, and the scrollbar
sits at the panel's edge. The panel reaches all the way to the side panels, so there is no empty
strip anywhere between them and the messages where the wheel does nothing.

## Tucked sides

When the session itself gets too narrow for its side panels and a full-width text column — most
often because a sidebar view is open beside it on a medium screen — the sides **tuck**: each side
keeps only its slim column of icons, the panels are put away, and the conversation takes the width.
It is the session's own width that decides, not the window's, so opening or closing a sidebar view
tucks and untucks the sides. The point where it happens comes from the layout itself: the width the
side panels take when docked, plus the conversation's text column (640 px of prose and its avatar
margin).

While tucked, click a panel's icon to bring just that panel out over the session, beside its icon.
One panel is out at a time — clicking another icon, on either side, puts the first away. Click the
icon again, click outside, or press Escape to put it away; Escape and the icon return focus to the
icon. The panels keep running while they are tucked, and widen the session again and they are docked
exactly as you left them — which ones were open, and which were pinned.

Tucking is a desktop behaviour. Stage only still hides the sides entirely, and below 1024 px the
phone layout below applies instead.

## Stage only

With stage only on (**Ctrl + .**, or **⌘ + .** on a Mac, on a desktop-width window) the session shows
just the conversation: both sides, any strips, every open panel, flyout or drawer, and every other
widget in the middle — Scene Portraits included — are hidden, and the messages take the whole space.
That is true wherever the conversation sits: moved into a side, it is that side's messages that take
the space, and the middle is hidden with everything else. With more than one Messages widget, it is
the story's own log (the first one with no channel).
Nothing is changed or reloaded while it is on: turn it off and the layout comes back exactly as it
was, every widget still running. It does not apply while the layout editor is open.

## Phones and narrow windows

Below 1024 px the side panels are hidden, the messages take the full width, and nothing is ever
side by side. There is no rail down here: the **panels button** beside the navigation menu is the
rail. Tap it for a list of everything on the sides — icon, name, which side it is on, and a pin on
the ones that are pinned — and tap a name to slide that side over the session with it open. Tap
outside, press Escape, or use the close button to put it away.

The messages on a phone are the conversation wherever the desktop placed it. If you moved it into a
side, the phone still opens on the conversation; that side's other panels stay in the panels menu,
and the middle's widgets join the menu too, marked **Middle**, opening as a panel of their own.

In that overlay each panel is as tall as it needs to be, up to the height of the screen, and the
list scrolls; tap a panel's title bar to fold it away to that bar, and again to open it. Which
panels arrive open is what you pinned. Widgets keep their state throughout — when they move between
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
- **Add** at the top of a side list opens a picker; the **×** on a row removes that panel. The last
  Messages widget shows a lock instead: a session needs one.
- The gear on a row opens that widget's settings — the same window the desktop's **Settings** button
  opens, filling the screen.
- The bar at the foot holds **Presets** (apply a saved layout, or save this one), a reset button,
  **Cancel** and **Done**. Cancel puts back the layout you opened the editor on, widgets added or
  removed included. Done refuses a layout with nothing in the middle, as it does on a desktop.

It is the same layout, so everything done here is what a desktop opens: reordering trades two
widgets' places and leaves the rest of the arrangement alone. Moving a widget past a row it was
sharing is the one change that does more — it takes a row of its own, which is what this screen was
already drawing it as, and widening the window will not put it back beside its neighbour.

To try this from a desktop, open **Move** and pick **Compact** or **Cozy** under Screen.

## Where layouts are stored

Presets belong to you and to the session's genre, so they are available in every session of that
kind. Which preset a session uses, its per-widget style choices, and each widget's settings are stored
per session. Guests in a session have their own layout for it, and their own widget settings.
