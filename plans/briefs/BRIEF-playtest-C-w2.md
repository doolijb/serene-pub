# BRIEF playtest-C-w2 — docs: Get a model is a pane of the Models view (item 20)

Supervisor: lane `playtest-C`. Report back in your final message (no report file). Work in
`/home/jody/github/serene-pub`. Use absolute paths. Docs only; another worker is changing the code
at the same time — do not touch any code file.

## Goal
**Get a model** (the model finder) stops being a dialog over the Models view and becomes the view's
detail pane: beside the list at desk, replacing the list in the dock and at half width with **Back**
to return, the same way a model's own settings open. Pressing **Get** keeps it open. Set up chat
still embeds it as its Model step (unchanged). The quant picker and **Add a model by name** stay
dialogs. Make the docs say so, with exactly these edits.

### `docs/connections.md`
1. Line 34 (Models, top to bottom › The toolbar): replace
   `**Get a model** opens the [model finder](#get-a-model) as a dialog.`
   with
   `**Get a model** opens the [model finder](#get-a-model) beside the list.`
2. Line 67 (Get a model's door list): replace
   `- **The Models view.** **Get a model** on the toolbar opens it as a dialog.`
   with
   `- **The Models view.** **Get a model** on the toolbar opens it.`
3. Line 72, the sentence `Getting a model doesn't close it: the downloads tray shows the progress. It has four rows:` —
   put this new paragraph immediately before it (its own paragraph, blank line between):
   `The finder is part of the Models view, not a window over it, so your models stay in sight while you search. It opens beside the list, as a model's own settings do; in the dock and at half width it replaces the list, and **Back** returns to it; in Focus the list stays as a column on the left. Picking a model in the list puts that model in its place.`
   Leave the `Getting a model doesn't close it…` sentence as it is.
4. Check line 518's **Get more…** sentence ("switches to the Models view with [Get a model](#get-a-model) open…") still reads true — it does; leave it. Change nothing else in the file.

### `STYLE-GUIDE.md` — one paragraph, §5.2 Views (no new section, no heading)
Insert this paragraph immediately after the paragraph that begins `The list is the fixed column
(\`listWidth\`) and the detail takes the room` and ends `…a portrait grid with its filters in a row
from there.` (around line 568), before `Where the reader should choose how wide the editor is`:

```
**A tool in the detail pane** (Models, 2026-11-04). The Models view's detail pane holds a model's
own view or **Get a model**, the model finder, and every door into the finder opens it there: the
toolbar, a runtime's **Get more…**, a loadout's **Get a model…**. It is a pane, never a dialog over
the view, so the library stays beside it at desk and compact swaps it in like any detail. It opens
under a `PanelNavHeader` with **Back** at every width, as a model's view does, focus moves to its
heading, and everything under the header is one scroller. Pressing **Get** never closes it; the
downloads tray shows the progress.
```

## Files owned (edit only these)
- `docs/connections.md` (the three edits above only)
- `STYLE-GUIDE.md` (that one paragraph only)

## Rules (quoted)
- STYLE-GUIDE §10: sentence case; plain words; *"One name per thing … the thing you open is a
  session, never a chat"*.
- CLAUDE.md: docs are user-facing behaviour; update them in the same change. `STYLE-GUIDE.md` is
  shared: edit only the one paragraph.
- Keep the existing line wrapping style of each file (connections.md: one paragraph per line;
  STYLE-GUIDE: hard-wrapped near 100 columns).

## Done means
`git diff -- docs/connections.md STYLE-GUIDE.md` shows exactly these edits and nothing else. No
tests to run. Report the final diff hunks' line numbers.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Never `git checkout`, `git restore` or `git clean`. Don't run prettier over `STYLE-GUIDE.md` or the docs.
