# BRIEF playtest2-W-w2 — "Character cards" (item 12, scope A + B labels and three docs)

Lane `playtest2-W` (supervisor) · worker `w2` · report: `plans/briefs/REPORT-playtest2-W-w2.md`

## Goal — the owner ruling (2026-11-04), build exactly this
Ruling: *"12 Rename: **Character cards** (sentence case), scope A+B (labels, docs, canon rows); phone bar shows **Cards** with the full name in `aria-label`; route `/characters` kept; rail icon kept."* Plus ★12e (recommended, taken by the lead): Home's section heading and `docs/characters.md` H1 → *Character cards* (slug kept).
Vocabulary: the VIEW is **Character cards**; one item in it is a **character card**; bare **card** only where the screen already says it. Inside a session or a lorebook, **character** stays (the cast's *Characters* list, *Pick a character*, *Add characters*). *Character Card V3* keeps its capitals (a format name). Sentence case: *Character cards*, never *Character Cards*; mid-sentence as a view name it stays capitalised like other view names (*in the Character cards view*, as *in the Lorebooks view*).
**Stays, never renamed (wire / internal, R4):** route `/characters`, view key `characters`, `CharactersSidebar.svelte` and every component/file name, socket events `characters:*`, tables, jump kind `character`, localStorage keys, `{{char}}`, the rail icon `Icons.UsersRound`. Only label TEXT changes.

## The edits (re-read each file right before editing; line numbers may have moved)
**A. The view's name and references**
1. `src/lib/client/components/Layout.svelte` ~:685 — `rightNav.characters.title: "Characters"` → `"Character cards"` (this is the rail, the Views sheet, the view header and Focus title). Do NOT touch `CONTENT_ORDER`, `rightNavOrder`, `BOTTOM_BAR_VIEWS` or any order array.
2. **Phone bottom bar** (`Layout.svelte` ~:3412–3470, `bottomBarEntries`): the visible label under the icon reads **Cards** for the `characters` entry; its `aria-label` stays the full title (*Character cards*), which it already is (`aria-label={… entry.title}`). Do it with a small pure helper in a NEW file `src/lib/client/shell/bottomBarLabels.ts`: `export const BOTTOM_BAR_SHORT_TITLES: Readonly<Record<string, string>> = { characters: "Cards" }` and `export function bottomBarText(key: string, title: string): string` (the short title, else the title). In the bar's `<span class="text-meta leading-none">` render `{bottomBarText(entry.key, entry.title)}`. A short doc comment on the helper: the bar's 64px buttons can't fit *Character cards* at 11px; the full name stays the button's `aria-label` (it contains the visible word, WCAG 2.5.3). New test `src/lib/client/shell/bottomBarLabels.test.ts`: `characters` → "Cards"; another key → its title.
3. `src/lib/client/accessibility/AccessibleShell.svelte` ~:263 — nav label `"Characters"` → `"Character cards"`.
4. `src/lib/client/components/sidebars/CharactersSidebar.svelte`: ~:534 jump scope `label: "Characters"` → `"Character cards"`; ~:1357 `<ViewToolbar label="Characters">` → `"Character cards"`; ~:1504 `<ListCardToggle … label="Characters" />` → `"Character cards"`; ~:1541 `aria-label="Characters list and card drop zone"` → `"Character cards list and drop zone"`; ~:1582 the ungrouped `characterRows(…, "Characters")` label → `"Character cards"`. Nothing else in the file.
5. `src/lib/client/shell/jump.svelte.ts` ~:99 — `KIND_SCOPE_LABELS.character: "Characters"` → `"Character cards"` (the comment above says the chip's word is the rail item's word). Update `src/lib/client/shell/jump.test.ts` only where it asserts this label.
6. `src/routes/characters/+page.svelte` — `<title>Characters — Serene Pub</title>` → `Character cards — Serene Pub`.
7. Home `src/routes/+page.svelte` — **the ONE section heading only** (~:1958, `<h2 id="home-characters">Characters</h2>`) → `Character cards`. Another lane edits a call site in this 3,700-line file: re-read the exact lines, Edit only that heading text. Leave the `ListCardToggle label="Characters"` beside it (the supervisor queues it).
8. Document View: `src/routes/document-view/characters/+page.svelte` (`<title>` and `<h1>`), `src/routes/document-view/+page.svelte` ~:243 link text, the four *Back to Characters* links (`document-view/characters/new/+page.svelte`, `.../browse/+page.svelte`, `.../[id]/view/+page.svelte`, `.../[id]/edit/+page.svelte`) → *Back to Character cards*, `src/routes/document-view/help/+page.svelte` ~:67 `title: "Characters"` and ~:71 `label: "Characters"` → `"Character cards"` (leave the description sentences). NOT `document-view/sessions/new` or `sessions/[id]/edit` (`<label>Characters</label>` there is the cast — stays).
9. `src/lib/client/components/sessionForms/StartSessionForm.svelte` ~:737 and ~:748 — *Write one in the Characters view, then come back.* → *Write one in the Character cards view, then come back.* NOT ~:1455 (`aria-label="Characters"`, the cast; pinned by `startSessionCast.dom.test`).
10. `src/lib/client/components/modals/PersonaSelectModal.svelte` ~:142 — *…flag a character as a persona in the Characters view.* → *…in the Character cards view.* Leave ~:234.
11. `src/lib/client/components/library/LibraryDetail.svelte` ~:133 *In your characters* → *In your character cards*; ~:148 *Open in Characters* → *Open in Character cards*. Update `src/lib/client/components/library/libraryDetail.wizardPick.dom.test.ts` (~:91–106 asserts *In your characters*) and the doc comment in `src/lib/client/wizard/wizardCharacterStep.svelte.ts:10` that quotes the label.
12. `src/lib/client/components/settingsTabs/UserSettingsTab.svelte` ~:710 help *New in the Characters view opens a quick creator…* → *New in the Character cards view opens a quick creator…*.
13. `src/lib/server/sockets/characters.ts` ~:1643 error string *…resolve it from the Characters view instead.* → *…from the Character cards view instead.*
**B. Other lists of library cards**
14. `src/lib/client/components/conversations/AttachPicker.svelte` ~:56 `label: "Characters"` → `"Character cards"`.
15. `src/lib/client/components/conversations/PersonDetail.svelte` ~:78 and ~:182 — read what they list first. If they list the person's library cards (not a session cast), → `"Character cards"`; if a cast, leave them and say so.
(`src/lib/shared/plugins/declaredPermissions.ts` is stay-out: the supervisor queues it.)
**Docs (re-read first; the docs build fails on a broken anchor, so never change a heading other than the H1, and never a link target)**
16. `docs/characters.md`: H1 `# Characters` → `# Character cards`; ~:19 *Open **Characters** on the rail* → *Open **Character cards** on the rail*; ~:207 *in Characters* → *in Character cards*; ~:213 *The button becomes **Open in Characters*** → ***Open in Character cards***; ~:275 *their Characters view* → *their Character cards view*. Leave *## Characters in sessions* (a heading; anchors) and every sentence about the person.
17. `docs/sessions.md` — only where *Characters* names the view: ~:138 *their card opens in the [Characters](./characters.md) view* → *[Character cards](./characters.md) view*; ~:702 *[Characters](./characters.md) and [Personas]…* → *[Character cards](./characters.md) and …*. NOT ~:20 (the cast) or ~:547 (turn order's *Characters*).
Finally grep `src/` for any test asserting the old strings you changed (e.g. `rg -n "Back to Characters|In your characters|Open in Characters|Characters view|\"Characters\"" src --glob "*.test.*"`) and update only those assertions.

## Files owned (only these)
The files named in 1–17, the new `src/lib/client/shell/bottomBarLabels.ts` + its test, and the tests named.

## Out of scope
Scope C (what an item is called inside the view — Export/Copy/Share wording, *Browse characters*, *Copy to my characters*, empty states); any route, key, component or file rename; the rail icon; other docs (the supervisor queues them); `NOMENCLATURE.md` / `STYLE-GUIDE.md`; screenshots.

## Stop and ask (in your report) when
A label lives only in a stay-out file; a string is ambiguous between the view and the cast; a test pins something outside your files.

## Done means
Green: `src/lib/client/shell/bottomBarLabels.test.ts` (new), `src/lib/client/shell/jump.test.ts`, `src/lib/client/shell/railDots.test.ts`, `src/lib/client/components/library/libraryDetail.wizardPick.dom.test.ts`, `src/lib/client/components/sessionForms/startSessionCast.dom.test.svelte.ts`, plus every test file your grep found asserting a changed string.

## Rules every worker of lane playtest2-W follows (quoted by the supervisor)

Verbatim (from `.claude/guides/multi-agent.md`):
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

Also:
- Never `git checkout`, `git restore` or `git clean` in either repo (`../serene-pub-sdk` is mostly uncommitted).
- **Another programme's lanes edit `src/lib/client/**`, `src/routes/**` and `docs/**` right now.** Re-read every file immediately before each edit (line numbers here may have moved). Use Edit, never Write, on an existing file. Edit only the lines your brief names.
- **Stay out entirely:** `src/lib/shared/sockets/types.ts`, `src/lib/client/**/navigation.ts`, the `CONTENT_ORDER` and `rightNavOrder` arrays in `Layout.svelte`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `src/lib/client/components/host/RemoteWidget.svelte`, the remount block (`remountKey` / `copiesLanded`) in `SessionLayoutRender.svelte`, `server/plugins/**`, `src/lib/shared/plugins/**`, `sessions/settingsForm.ts`, `db/defaults.ts`, `core-catalog/src/loadouts.ts`, `src/lib/generated/**` (generated). If you need a change there, put the exact edit in your report instead.
- **Names (NOMENCLATURE R1–R6):** one word, one meaning; qualify, never the bare noun; it is a **session**, never a *chat*. Do not invent a name the brief doesn't give you; if you must (a helper, a test id), list it in your report under *New names*.
- **STYLE-GUIDE §10 Writing:** sentence case everywhere; a button says what happens; help is one sentence; labels are nouns, hints are sentences. **§9:** every interactive element has an accessible name; icon-only buttons carry `aria-label`; nothing is hover-only.
- **0.6 is in users' hands:** no stored data changes; a stored blank keeps meaning what it means. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- **Svelte 5:** `$state(new Set())`/`new Map()` aren't reactive on mutation (use `SvelteSet`/`SvelteMap`). `socket.off(event)` always with its handler. Views never call `toaster`.
- **DB:** inside `db.transaction(async (tx) => …)` use only `tx`.
- **Tests:** only the files your brief names (plus ones you add). Never a full `npm test`, `npm run check`, project-wide `tsc`, or whole `sdk:test`. Run vitest exactly as:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-W-<worker>-<n>.log 2>&1; echo exit=$?'`
  then read the log (grep for `Test Files`, `Tests`, `FAIL`). Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.
  SDK tests run from `/home/jody/github/serene-pub-sdk/sdk-tests` as one file at a time in the same capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file> > <scratchpad>/playtest2-W-<worker>-sdk-<n>.log 2>&1; echo exit=$?'`.
  If an app test needs the rebuilt SDK dist: `pgrep -af "vite dev"`; if none, `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build` from `/home/jody/github/serene-pub`.
- **Prettier:** `npx prettier --check <file>` on files you changed; if a file was already prettier-dirty before you, leave the rest of it alone.
- **Report:** write it to the path in your brief: Changed files (both repos, with what changed) · Tests run (exact command, pass/fail counts) · New names · Anything you could not do and why · Noticed, not done. Never fix things outside the brief in passing.
