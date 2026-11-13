# BRIEF — adv-E-w1: the user docs for advanced controls

Supervisor: lane adv-E. Repo `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal

The app now has one per-user switch, **Show advanced controls**, off by default. Describe exactly what it does in the user guides under `docs/`, then run `npm run docs:build` so `src/lib/generated/docs/` matches. **No code changes.**

## What is true now (verified by the supervisor against the code; describe exactly this)

**The switch**
- One per-user switch, **Show advanced controls**, off by default. It is the **first card** on Settings › User. Its help sentence is *"More choices on sessions, lorebooks and characters. Off keeps the everyday ones."*
- It replaced *Show all character fields*: that User-tab card and the character form's inline **Show all fields** switch are gone.
- People who had *Show all character fields* on start with advanced controls on (on upgrade, and when restoring from 0.5.3). *Easy character creation* is unchanged.
- **Hidden never means changed.** A hidden control keeps its stored value and the session/book keeps using it. The switch is a preference, never a permission: it never shows anyone what their role hides. Admin and the Sampling, Models, Loadouts and Connections views are unchanged. The session settings' closed **Advanced** fold (the genre settings block) is unchanged and shows in both modes.

**The line.** Where a form hides something, one muted line at its foot reads *Some controls are hidden.* followed by the link **Show advanced controls**, which turns the switch on in place. It shows on: the session form's Settings tab (foot), the start form (book-and-rules card / rules card), Book settings, the character form (not on its Stats, Likeness or Speech tabs), and the entry editors. There is **no** such line in the **Show as** track, the message menu, the session header or the Author's note widget.

**Starting a session** (`sessionForms/StartSessionForm.svelte`)
- In the **Lorebook and rules** card, with the switch off: **Play it with** under a Freeform lorebook, the starter lorebook's rules choice, the whole **Start blank** group with its rules list, the list of what the rules tell in words, and **How strict** are hidden. Leaving the card alone still starts the session blank (in its own notes) on the preset's suggested rules or the genre's usual rules; a Freeform book plays the genre's usual rules.
- When the genre has a separate **Rules** card, it is hidden with How strict. With the switch off, the sentence saying which rules the session adopts from the lorebook or starter, and the hint *"‹Rules› keeps no numbers, so ‹preset› runs in words here."*, stay as plain text.
- Kept with the switch off: the session preset, the lorebook choice and starter lorebooks, the creation modes (**New**, **Next chapter**, …) and the start asks.

**Editing a session** (`EditSessionForm.svelte`, the **Settings** tab)
- Hidden with the switch off: **Actions**, **How replies are made**, **On revision**, **Rules options**, **Pipelines**, the **Retake ask** setting and **Session data**.
- Kept: the name, the story, the session preset switch, the genre's settings block (with its own **Advanced** fold, unchanged), routines, attributes, what your lines are called, tags; the whole Participants and Privacy tabs.
- **Where this session's story stands** is read-only with the switch off. Its owner reads *"Turn on advanced controls to change them."*; it still names the branch and spells the clock with the book's calendar. Guests see it as before.

**The session view**
- **Branch from here** is not in the message menu with the switch off (it comes back when you turn it on).
- The header's **Layout** button, *Customize layout* in the header's **⋯** menu (phone) and *Customize layout* in the full-screen corner control's **⋯** are not there with the switch off. Everyone keeps the layout they have. The channel and channel-lane settings live in the editor, so they hide with it.
- **Author's note** widget: with the switch off it shows the note only; **Messages from the end**, **Every how many replies**, their help sentence and the **Sent as** fold are hidden. Saving keeps the stored numbers. The same three settings stay in the session's settings (Story settings), which are unchanged in both modes.

**Characters and lorebooks**
- The character form shows the common fields only with the switch off (what *Show all fields* used to add stays hidden: on Profile **Version label**, **Creator**, **Category**; on Voice **Scenario**, every greeting after the first, **Example dialogues**, **Post-history instructions**; on Notes **Language** and **Other languages**). The tabs and card versions are unchanged.
- The entry fold **Regex, case, keyword chains, priority, conditions** is hidden in every entry editor. The entry still reads in exactly as its stored values say.
- Book settings hides **Rules** and **Calendar**. **Writes from sessions**, **The story's present**, *What this book holds* and *Reading into a session* stay.
- **Show as › Graph** and **Show as › Lives** are hidden, with their shortcuts **Alt+Shift+4** and **Alt+Shift+6** (the others keep their numbers: List 1, Cards 2, Tree 3, Time 5, Map 7). An address naming Graph or Lives opens **List**.
- The Cast member's **See in graph** and the **Build graph** buttons (History's scene list, a scene's editor) are hidden. Build and Extend graph live inside Show as › Graph, so a lorebook offers no way to build a graph with the switch off. In a session, the **Chronicle** widget's **Extend graph** is unchanged. Activity's graph-build rows still open the book (on List).

## Work — pages and the lines to change

Read each page around the named lines first. Say it **once per page**, plainly; no scattered "(advanced)" tags. One sentence or a short paragraph where the controls are described, ending with a link to the settings page's section.

1. **`docs/themes-and-settings.md`** — the hub.
   - In the User-tab list (:40-50), add **Show advanced controls** as the **first** bullet (before Language), and remove the **Show all character fields** bullet (:47).
   - Add a short section `### Show advanced controls` (after the list's closing "Switches save as soon as you flip them." and before `### Extension settings`) that says, briefly: what it is; off by default; the line *Some controls are hidden.* with **Show advanced controls**; hidden never means changed; a preference, not a permission (admin views unchanged); who starts with it on (former *Show all character fields*); and one bullet per area (starting and editing sessions, the session view, characters, lorebooks) each linking to the page that says more. Others link here as `./themes-and-settings.md#show-advanced-controls`.
2. **`docs/sessions.md`** — §Start a session (:13-43, the Lorebook and rules card at :24-32), §Settings (:385-405), §Rules options (:443), §On revision (:432), §Session data (:473), the message-menu table (:227) and §Branch from here (:291), §Author's note (:452-468, especially :461 *Sent as*). Also :396 already describes the **Advanced** fold — leave that fold's description as is.
3. **`docs/session-layout.md`** — §Open the editor (:17): the entry points need advanced controls; everyone keeps the layout they have.
4. **`docs/getting-around.md`** — :172-178, the full-screen corner **⋯** list: *Customize layout* is there only with advanced controls on.
5. **`docs/session-actions.md`** — :49 and the table at :107 (*Branch from here* in the floors): say once that Branch from here needs advanced controls.
6. **`docs/genre-story.md`** — the Author's note mention at :81 links to sessions.md; add nothing unless that page describes the numbers itself (check).
7. **`docs/characters.md`** — :117 (replace the **Show all fields** paragraph: with advanced controls on, the form adds …) and :123 (*With **Show all fields** off* → advanced controls off).
8. **`docs/lorebooks.md`** — :69 (the fold), :101 (Show as: Graph and Lives and their shortcuts), :119/:123 (Book settings: Rules, Calendar), :137 (mentions Graph/Lives; adjust only if it now misleads).
9. **`docs/lorebook-time.md`** — §Calendar and clock (:75-96): the calendar editor needs advanced controls; the story's present doesn't.
10. **`docs/lorebook-cast.md`** — :43 (**See in graph**), §The graph (:112-), §Building the graph from your scenes (:124-137), :167 (*Show as › Lives*), and :20.
11. **`docs/summarization.md`** — :18 (Build the graph) only if it now misleads; one clause and a link at most.
12. Then run `grep -n "Show all fields\|Show all character\|Customize layout\|Branch from here\|Graph\|Lives" docs/*.md` and handle any other place that **describes pressing** a now-hidden control. Incidental mentions (e.g. lorebooks.md:237, lorebook-time.md:124, coming-from-sillytavern.md:61 merely naming Branch from here) stay as they are. **Show all characters** (persona picker) and list **Show all** buttons are different controls and unchanged.

## Rules you must follow (quoted)

- STYLE-GUIDE §10 Writing: *"Sentence case everywhere"*; *"One name per thing, across the whole flow: the thing you open is a session, never a chat; one installation of Serene Pub is a **pub** … never an _instance_ or a _server_"*; *"No filler"*.
- CLAUDE.md: *"It is a **session**, never a *chat* — except in chat-completions wire vocabulary."*
- Owner rule: there is always a lorebook. Never write "no lorebook" as a state; a blank start keeps its world in **its own notes** (link `./lorebooks.md#your-sessions-own-notes` as the page already does).
- Follow the page's existing voice: second person, present tense, bold for UI labels, italics for quoted UI sentences, relative links `./page.md#anchor`.
- STYLE-GUIDE §6.9: pages keep plain `/docs/...`-style relative links; three admonition kinds only (`:::note`, `:::tip`, `:::warning`). Don't add an admonition for this; plain prose.
- Don't reflow or reformat untouched lines. Never `prettier --write`.

## Files owned

The docs pages listed above (and any others step 12 finds that describe a now-hidden control), and `src/lib/generated/docs/**` **only** through `npm run docs:build`.

## Files readable

Anything. The code paths named above if you need to check a detail.

## Out of scope

Any code, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, plan files, reports. Wording you think the UI itself should change: write it in your report under **Noticed, not done**.

## Stop and ask when

The page and this brief disagree about what's hidden after you check the code (say which, with file:line); you'd need a new name for something.

## Done means

- `npm run docs:build` succeeds (paste its last lines).
- Run the docs tests in a capped scope, exactly:
  `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && npx vitest run src/lib/client/components/docs/docsPlaygroundProtocol.test.ts src/lib/client/components/sidebars/helpLinks.test.ts src/lib/client/shell/docsJump.test.ts src/lib/shared/utils/docsIndex.test.ts src/lib/shared/utils/docsHref.test.ts src/lib/shared/utils/envDocsDrift.test.ts src/lib/shared/utils/docsContextTemplate.test.ts src/lib/shared/utils/docsDist.budgets.test.ts; echo test-exit=$?'`
  Never pipe vitest into `head`.
- Report: each page changed with a one-line summary per change, the build and test results, and Noticed-not-done.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Scratch files start with `adv-E-`.
