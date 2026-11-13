# BRIEF s4-tidy-w4 — the view is **Characters**: the remaining labels, docs, `bottomBarLabels` removal, lorebook-cast paragraphs, regenerated docs

Supervisor: lane `s4-tidy` (seat-cast S4, wave 6). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message; do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You have no reason to run `sdk:build`.)

**Prettier:** `npx prettier --check` changed files; only `--write` the lines you changed — never reformat a whole file (a whole-file `--write` re-sorts classes and reflows markup other work owns). If a file fails only on lines you didn't touch, leave it and say so. Markdown docs: don't run prettier `--write` on them.

## The ruling (quote; never reinterpret)

Owner ★C-1 (2026-11-08): **"Characters"** — the rail item, phone label, Jump chip and page title. This reverses ruling 12's "Character cards" (2026-11-03/04) **for the view's name only — "character card" stays the item's name.** (NOMENCLATURE §23: "⚠ Only the view's name: **character card** stays the item's name.")

So the rule for every site: where the words name the **view** (a place you open: "in the Character cards view", "Open in Character cards", "Back to Character cards", a nav link, a page title, a heading that names the view) → **Characters**. Where they mean the **cards themselves** (the items: "imports character cards", "a character card of your own", "Character cards still import one at a time", SillyTavern's own cards) → keep **character card(s)**. Sentence case. It is a **session**, never a chat. Never write copy that says a session has no lorebook.

## Goal

### 1. App labels (view name → Characters)

- `src/routes/+page.svelte` ~1987: Home's section heading names the view → `Characters`. ~2005 `ListCardToggle label="Character cards"`: **keep** (it names the cards being shown as list or cards).
- Document view: `src/routes/document-view/characters/+page.svelte` ~46 title → `Characters — Document View — Serene Pub`, ~49 `<h1>Characters</h1>`; `src/routes/document-view/+page.svelte` ~243 link text; "Back to Character cards" → "Back to Characters" in `document-view/characters/{browse,new,[id]/edit,[id]/view}/+page.svelte`; `src/routes/document-view/help/+page.svelte` ~67, ~71.
- `src/lib/client/components/sessionForms/StartSessionForm.svelte` ~1001, ~1012: "…Write one in the Character cards view…" → "…in the Characters view…". **Only those two lines** — another session has a hunk in this file (`unservedWords`).
- `src/lib/client/components/modals/PersonaSelectModal.svelte` ~142: "…in the Character cards view." → "…in the Characters view."
- `src/lib/client/components/settingsTabs/UserSettingsTab.svelte` ~761: "New in the Character cards view…" → "New in the Characters view…".
- `src/lib/client/components/library/LibraryDetail.svelte` ~12 (comment) and ~148 button "Open in Character cards" → "Open in Characters".
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte` ~102 (comment) and ~1402 `title="Open this card in Character cards"` → "Open this card in Characters"; `src/lib/client/lorebooks/cast/memberPageCard.dom.test.ts` ~5 comment (and any assertion on that title).
- `src/lib/client/lorebooks/CastWorkspace.svelte` ~222 comment only.
- `src/lib/server/sockets/characters.ts` ~2137: "…resolve it from the Character cards view instead." → "…from the Characters view instead." **Only that line.**
- **Correctly left (don't change):** `conversations/AttachPicker.svelte:56`, `modals/CharacterSelectModal.svelte:273` (+ its dom test), `conversations/PersonDetail.svelte:78,182` — they label groups of cards. `server/state/resolve.ts:1352` is a quoted ruling — leave.
- Grep tests for each changed string (`grep -rn "Open in Character cards\|Character cards view\|Back to Character cards\|Open this card in Character cards" src`) and update assertions to the new words.

### 2. Delete `bottomBarLabels`

`src/lib/client/shell/bottomBarLabels.ts` (its map is now empty) and `src/lib/client/shell/bottomBarLabels.test.ts`: delete both (`rm` each by exact path). In `src/lib/client/components/Layout.svelte`: remove the import line ~86 and write `{entry.title}` at ~3476 in place of `{bottomBarText(entry.key, entry.title)}`. **Only those two lines of Layout.svelte.** Grep that nothing else imports it.

### 3. Docs (view name → Characters; items stay character cards)

Edit, applying the rule line by line: `docs/personas.md`, `docs/tags.md`, `docs/getting-started.md`, `docs/document-view.md` (~47 nav list), `docs/coming-from-sillytavern.md`, `docs/importing-from-sillytavern.md` (the table's left cell is SillyTavern's cards — keep; a link label that names the page becomes **Characters**), `docs/lorebook-cast.md`, `docs/themes-and-settings.md`, `docs/android.md` (~26 "Character cards still import one at a time" means the items — keep), `docs/upgrading-from-0.5.md`, and `docs/characters.md`: its H1 `# Character cards` → `# Characters`; ~258 "The button becomes **Open in Character cards**" → "**Open in Characters**". Check inbound anchors after the H1 change (`grep -rn "characters.md#character-cards" docs src` — none known; the build checks anchors).

**Do not touch `docs/lorebooks.md` or `docs/sessions.md`** (lane s4-fold edits them now). Instead list, in your report, every line in those two files that names the view (file:line, old text, proposed text) for the lead. Also don't touch `docs/images.md` (another worker edited it) — but list any view-name line there too.

Use `grep -rni "character cards" docs/` to find sites; also catch "Character cards view", "Character cards ›", "in Character cards".

### 4. `docs/lorebook-cast.md` paragraphs

- After the member page's tab list, or after the Cast list intro (your judgment — say where), add verbatim (lane s4-chr-view's paragraph): *"Every cast member is also listed in **Characters** on the rail. A member with a character card shares that card's row (the row wears **Card**, and its line says which lorebooks use it). A member with no card has a row of its own under **Only in lorebooks**, and members kept only in a session's notes show once **In my stories** is on in the filters. Click the row to open the member here, or use **Copy to my characters** in its **⋯** menu to make a character card of your own from it."*
- The member page now has **six** tabs (a **Gallery** tab was added after Sprites by this lane): change "It has five tabs" → "It has six tabs", and add a bullet after the **Sprites** bullet: *"- **Gallery**: the member's own pictures, in the same grid as a character card's Gallery tab. Whoever can edit the lorebook can **Upload**, **Generate portrait** and drag to reorder; anyone who can open the page can look. A member's gallery has no delete, **Set as avatar** or **Use as likeness image**: those are the card's."*
- ~49 "The copy opens in Character cards." → "The copy opens in Characters."
- If the page still says drawing sprites with a model is only on character cards (grep "only on character cards"), that is stale: lane s4-sdk2 built **Fill empty sprites** for members and this lane built **Re-express from neutral** for members. Replace that sentence with: *"**Fill empty sprites** and **Re-express from neutral** work on a member's own sets too, for whoever can edit the lorebook, when an image model is set up."* — and report the old sentence.

### 5. Regenerate docs

`cd /home/jody/github/serene-pub && npm run docs:build > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w4-docs.log 2>&1; echo exit=$?` — it regenerates `src/lib/generated/docs/**` and checks links/anchors. Must be clean; fix any broken link/anchor you caused. If it fails on something you didn't cause, report it.

## Files owned (edit only these)

Every app file named in §1 and §2 (only the lines named), `src/lib/client/shell/bottomBarLabels.ts` + `.test.ts` (delete), the docs named in §3/§4 (not `lorebooks.md`, `sessions.md`, `images.md`), `src/lib/generated/docs/**` (regenerated by the script only), tests asserting the changed strings.

## Out of scope

NOMENCLATURE.md and STYLE-GUIDE.md (the supervisor holds canon), any rewording beyond the view name and the paragraphs above, renaming code identifiers.

## Stop and ask (report and stop that part) when

a line is genuinely ambiguous between view and item (list it with your recommendation); a change would reach a file not listed; a test needs more than a string update.

## Tests — how to run

Only targeted files, capped, logged:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w4-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-tidy-w4-tests.log'`
Never pipe vitest into `head`. Run: `memberPageCard.dom`, any test asserting a changed string, any Layout/bottom-bar DOM test (`grep -rln "bottom" src/lib/client --include=*.dom.test*`), `charactersSidebar.dom`, LibraryDetail tests, any docs test (`grep -rln "generated/docs" src --include=*.test.ts`).

## Done means

`grep -rn "Character cards" src docs --include=*.svelte --include=*.ts --include=*.md | grep -v generated/` shows only: the kept item/group labels listed above, `lorebooks.md`/`sessions.md` (listed for the lead), and quoted rulings; `docs:build` exit 0; targeted tests green; prettier clean on your lines.

## Report (final message)

Changed files (one line each); every kept "Character cards" site with why; the lorebooks.md/sessions.md/images.md lines for the lead; where you put the paragraph; tests with counts; docs:build result; Noticed, not done.
