# Session layout

Every session has a layout: the messages and composer in the middle, and any side panels — scene
portraits, notes, a map, a plugin's own view — arranged around them. The layout editor lets you
arrange those panels, save the arrangement as a preset, and give each panel its own look.

## Opening the editor

Hover the top navigation bar and a small **Layout** tab appears under it; click it (or Tab to it and
press Enter). The session stays live underneath while you edit. Press **Done** to leave the editor.
Everything you change is saved as you go.

The editor has three tabs.

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

## Style

Style is about how each panel looks, never where it sits. Open **Style** and **hover any panel**: a
small card fades in over it showing the panel's current style, a picker, and **New**, **Edit**,
**Clone** and **Delete**. Pick a built-in style, or press **New** to write your own — a name, CSS,
optional variables, and who may use it (**Just me** or **Everyone** on this instance). **Edit** opens
the editor anchored to that panel and **applies what you type as you type**, so you see the panel
change; **Save** keeps it, **Cancel** or Escape puts the saved style back. **Clone** copies any style
you can see into a private one you can edit. Built-in styles can be cloned but not edited or deleted.

**Messages** and **Composer** work the same way; their built-in looks (for example *Clean*, *Bubbles*,
*Novel*; *Classic*, *Minimal*, *Writer*) are just their built-in styles.

A style's CSS applies to that one panel only. Every selector you write is re-pointed at the panel's
own box, so a style cannot reach the rest of the page or another panel — even another copy of the
same panel, and never the controls used to change it. `@import` and images from other websites are
refused. `@font-face`, `@property` and `@counter-style` are stored but not applied, because they name
things for the whole page rather than for one panel. Variables are CSS custom properties and must be
written as `--name`. For a rule that should only apply in dark mode, start the selector with
`[data-mode="dark"]` — for example `[data-mode="dark"] .my-card { background: black }`.

## Move

The **Move** tab replaces the session with three grids — **Left**, **Middle**, **Right** — drawn where
the panels actually live. Messages and Composer stay in the middle.

- **Add** a panel from the tray by dragging it onto a zone, or tap it and then tap where it goes.
  Drag a panel back to the tray to remove it.
- Drag panels to move them; drag their edges to resize. Each card also has fit-width, fit-height and
  dock-top/dock-bottom buttons.
- **Anchors** pin a panel to an edge of its zone so it stays put as the window changes.
- **Pin** docks a side panel to the edge as a rail; unpinned, it opens as a flyout over the session.
- Select two or more panels and **Group** them: in the live session they become one tabbed panel.
  Grouped panels keep their state when you switch tabs.

### Previewing other screen sizes

**Screen** shows the layout as it will appear at other widths — **Compact 390**, **Cozy 640**,
**Roomy 1024**, **Wide 1440**, **Ultrawide 2560** — without resizing your window. (Above 2400 px the
side rails become two columns wide; Ultrawide previews that.) A narrower width has fewer grid
columns, so panels are squeezed to fit; that is exactly what would happen on that device.

Previewing is only a lens: switch back to **Actual** and the arrangement is restored. The same is
true of a real window: making the window narrower squeezes the layout to fit, and making it wide
again brings the arrangement back exactly — resizing never rewrites what you saved. If you *edit*
while previewing, the edit is kept — there is one arrangement for all sizes, and the editor says so
while you are in a preview.

## Phones and narrow windows

Below 1024 px the side panels are hidden and the messages take the full width. If a side has panels,
a small button appears under the navigation bar; tap it to slide that side's panels over the session.
Tap outside, press Escape, or use the close button to put them away. Panels keep their state when
they move between the side and the overlay.

## Where layouts are stored

Presets belong to you and to the session's genre, so they are available in every session of that
kind. Which preset a session uses, and its per-panel style choices, are stored per session. Guests
in a session have their own layout for it.
