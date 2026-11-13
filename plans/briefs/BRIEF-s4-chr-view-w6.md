# BRIEF — lane `s4-chr-view`, worker w6 — docs and STYLE-GUIDE for the Characters view (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## What changed (write the docs from this; another worker is wiring the code at the same time, exactly to this spec)

Owner rulings (quote, never reinterpret):
- **★C-1 (2026-11-08) → "Characters"**: the rail item, phone label, Jump chip and page title are **Characters**; this "reverses ruling 12's "Character cards" of 2026-11-03/04 for the view's name — "character card" stays the item's name".
- 2026-11-05 (refined the same day): "Give each character badges: card, cast." → "the cast badge is probably redundant, any card that's been used will be a cast" → **one badge, Card**, plus a **reach line**: _In 2 lorebooks_ / _Not in a lorebook yet_ / _In ‹book›_ / _In ‹session›'s notes_.
- Memory rule "There is ALWAYS a lorebook": a session's own book is its **notes**; never write that a session has no lorebook.

The view, as built:
- **One row per character**: one of your character cards (with every cast member linked to it), a card someone shared with you, someone else's card that a lorebook you can read uses, or a **cast member with no character card**.
- A card's row wears one badge, **Card**; the card's tags sit behind a **+N** after it (hover shows them). A cast member with no card has no badge, and its face falls back to its initial.
- The line under the name: the summary (for a shared card, _From ‹owner›_), then the **reach line**: _Not in a lorebook yet_, _In ‹lorebook›_, _In ‹session›'s notes_, or _In N lorebooks_.
- **Groups**, in order: your characters (no header), your folders, **Only in lorebooks** (cast members with no card, and other people's cards you see because a lorebook you can read uses them), then **Shared with you** last.
- **Filters** (the sliders button): **Show** — All, Favorites, Personas, or a tag (Favorites and Personas are your own cards); **Card** — All, Has a card, No card; **Words** — All, Follows its card, Has its own words; **Lorebook** — one of your lorebooks (yours, shared with you, or provided); **Story** — one of your sessions (shown while In my stories is on); and the **In my stories** switch: _Also list characters kept only in your sessions' notes._ Each filter in force shows as a chip under the search box with an **×**. Cast members kept only in a session's notes stay hidden until **In my stories** is on.
- The search box matches **names and tags** (no longer descriptions).
- **Favorites no longer sort to the top**: the list is in name order (it loads a page at a time); use the Favorites filter.
- The list loads in pages: scroll to the end, or press **Load more**.
- **Clicking**: your own card, or a card shared with you, opens its page as before. A cast member's row — and someone else's card that only reaches you through a lorebook — opens that cast member in **Lorebooks**.
- The **⋯** menu: your cards keep View, Edit, Use as persona / Not a persona, Set as default persona, Move to folder…, Export, Delete. A shared card: View, **Copy to my characters**, Export. A cast member, or someone else's card from a lorebook: View, **Copy to my characters** (a new character card of your own, of what it shows now; no link back).
- The phone bottom bar now says **Characters** (the short label **Cards** is gone); the Jump chip reads **Characters** while the view is open.

## Files owned (edit only these)

- `docs/characters.md` — every place that names the VIEW says **Characters** (e.g. "Open **Character cards** on the rail" → "Open **Characters** on the rail", "Open in Character cards" stays only if the button still says it — it's outside this lane, so write what the button says today: check `src/lib/client/components/library/LibraryDetail.svelte`). Keep "character card(s)" where the item is meant. Rework **Find a character** (~line 48) and **Favorites, folders and tags** (~102) to the view above; add the rows/badge/reach line/groups/filters/In my stories/Load more/clicking/Copy; update "Sharing a character" (~281: "appears in their Characters view under **Shared with you**"). The H1 `# Character cards`: change it to `# Characters` only if nothing outside this file depends on the H1 text (grep `src/lib/client` and `docs/` for "Character cards" as a docs title/link, e.g. the docs index, help router, docsJump); if something does, leave the H1 and report the site.
- `docs/getting-around.md` — the view's name at ~12, 18, 22, 34, 160, 215–216 (the Jump chip now reads **Characters**) and ~237 (the bottom bar: read `src/lib/client/components/Layout.svelte` for the five bottom-bar items and write them as they are; Characters is no longer shortened).
- `STYLE-GUIDE.md`:
  - Where it names the view (~10, 437, 484 _Characters, still open_, 513, 551, 553, 890, 920, 982, 1366 — check each: only where the VIEW is meant; ~2174 is a person's cards tab in Messages — the item — leave it).
  - §6.4 (~886): add a short paragraph for the **Characters** row: one row per character; a card row's one chip is the **Card** badge (`Badge` `sm`, surface), its tags behind the `+N` with their names in the `title`; a cast member with no card has no chip and an initial face; the meta line's lead is the summary (a shared card's _From ‹owner›_) and its fact is the reach line (the four wordings); the groups' order (own rows, folders, _Only in lorebooks_, _Shared with you_). Name the component `CharacterRowItem` (🚧).
  - §6.3 (~775): one paragraph after the "second radio group" paragraph: a popout may carry several narrowing groups (the Characters view, 2026-11-08: Show, Card, Words, Lorebook, Story), each under a hairline and its 12px muted label naming its `radiogroup`, picking closes the popout; and one **switch** row at its foot for a widening (_In my stories_, `role="switch"`, a muted help line), which doesn't close it; every narrowing or widening in force is its own dismissible chip, and the trigger is lit while any is.
  - §5.1 (~437) the rail list: "Character cards — personas included —" → "Characters — personas included —".
- Read anything; edit nothing else. `docs/lorebook-cast.md` and `docs/sessions.md` belong to another lane — don't touch them.

## Rules you must follow (quoted)

- CLAUDE.md: "**`docs/<area>.md`** … user-facing behaviour. … update it in the same change when behaviour moves." "**`STYLE-GUIDE.md`** … update it in the same change when a rule moves."
- STYLE-GUIDE §10 Writing (read it, ~line 2316) — sentence case, plain words, second person in docs.
- "It is a **session**, never a *chat*."
- No other-project references in the repo.
- Write only what the spec above says the view does; don't invent features. If the spec leaves something unclear, write the plain version and list the question in your report.

## Done means

The edits above; `grep -n "Character cards" docs/characters.md docs/getting-around.md STYLE-GUIDE.md` shows only item uses (list each remaining hit and why in your report). `npx prettier --check` the three files — if a file already failed before you (`git show HEAD:<file> | npx prettier --stdin-filepath <file> --check`), don't reformat it; otherwise only `--write` if the failure is in your lines. No tests.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

Final message: changed files with the sections touched, remaining "Character cards" hits and why, questions, Noticed-not-done.
