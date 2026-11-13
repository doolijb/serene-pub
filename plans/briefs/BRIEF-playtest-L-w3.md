# BRIEF playtest-L-w3 — A carded cast member's name, read-only, with Edit card / Open card (plan item 10, S version)

Supervisor: lane `playtest-L`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (no report file).

## Goal
In a lorebook's Cast, a member linked to a character card has no Name field (`CastMemberForm.svelte` ~690:
`{#if !member.linked}` hides it) and no way to reach the card to change it. By canon the name stays the card's
(NOMENCLATURE §8 *alias* row: *"A carded member's **name** is still the card's."*; the book-only name override, §0-D, is
UNRULED and must not be built). Fix, in `src/lib/client/lorebooks/cast/CastMemberForm.svelte`:

1. Keep the Name input exactly as it is for a member with no card.
2. For a linked member (`member.linked`), in the same place (an `{:else}` of that `#if`), a read-only row:
   - the label **Name** styled as the input's label is (`text-sm font-semibold`, but a `<p>`, not a `<label>` — there is no
     control to label);
   - the value: the card's name, then ` (nickname ‹nick›)` only when the card has a nickname, then a muted
     ` · from the character card` (`text-surface-600-400 text-xs` or the form's existing muted class). The card is
     `row.character` (`let card = $derived(row.character ?? null)`, ~line 112); fall back to `member.name` when `card` is
     null;
   - one button, `btn btn-sm preset-tonal-surface` like the card block's **Change** (~1001), icon 14px:
     - **Edit card** (icon `Icons.Pencil`) when the card is the viewer's own (`card.userId === userCtx.user.id`, user from
       `getContext("userCtx")`), which does
       `panelsCtx.digest.characterId = id; panelsCtx.openView("characters", { toggle: false })` — the precedent is
       `src/lib/client/components/sidebars/TagsSidebar.svelte:387-390` (it uses the ⏳ old name `openPanel`; use
       `openView`, see `PanelsCtx` in `src/app.d.ts` ~118/170). `panelsCtx` is `getContext("panelsCtx")`.
       `CharactersSidebar.svelte` ~143 consumes `digest.characterId` (opens the edit form).
     - **Open card** (icon `Icons.ExternalLink`) otherwise (someone else's card, or the owner is unknown), which does
       `panelsCtx.digest.viewCharacterId = id; panelsCtx.openView("characters", { toggle: false })` — precedent
       `src/lib/client/components/library/LibraryView.svelte:389-392`; consumed at `CharactersSidebar.svelte` ~165 (the
       read-only detail view).
     - `id` is `row.characterId ?? card?.id`; no button when there is no id.
     - Each button gets a one-sentence `title`: Edit card → *"Change the name and nickname on the character card; every
       member drawn with it follows"*; Open card → *"See the character card this member is drawn with"*.
   The card's `userId` is already in the projection: `buildLorebookBindingList` in `src/lib/server/sockets/lorebooks.ts`
   ~1150 joins `character: true` (the whole row), and the type is `character?: SelectCharacter | null`. So NO server change
   is needed — verify that in your report and do not edit the server.
3. Docs `docs/lorebook-cast.md` §"A member's page" (~line 30–36): add, just before the **Also known as** bullet, one bullet
   *"**Name**: a member with no card has their own. A member with a card shows the card's name and nickname, with **Edit
   card** to change them on your own card, or **Open card** to see someone else's."* and trim the duplicate clause from
   the **Also known as** bullet only if it now repeats word for word (keep "the card's names are added to these").

## Files owned (the only files you may edit or create)
- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`
- NEW `src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts`
- `docs/lorebook-cast.md` (that bullet)

## Files readable
Anything. DOM test precedents: `src/lib/client/lorebooks/cast/memberPage.dom.test.ts` (fake client socket, `setSocket`,
`setInterestUser`, `_resetInterestForTests`, mocks of `$app/environment` and the toaster),
`src/lib/client/lorebooks/cast/retoldBlock.dom.test.ts`, `src/lib/client/components/sessionPage/ragNotice.dom.test.ts`
(mount with `context: new Map([...])`). Mount `CastMemberForm` directly with props `member`, `row`, `lorebookId`,
`hasUnsavedChanges`, `onSave`, `onDelete`, `onLinkCharacter`, `onUnlink` (see its `Props`, ~50–80) and contexts
`panelsCtx` (a plain object `{ digest: {}, openView: vi.fn() }`) and `userCtx` (`{ user: { id: 1 } }`). `CastMember` /
`CastRow` types are in `src/lib/client/lorebooks/castPool.ts`.

## Out of scope — never build
A book-only name or nickname (§0-D, unruled); making Name a retold field; any change to the card sync
(`characterBindingSync.ts`); any server edit; renaming "character card" (item 12, unruled); anything outside Files owned
(another lane is editing widget-host / session-layout / SDK files at the same time).

## Rules your work depends on (quoted)
- STYLE-GUIDE §10: *"Sentence case everywhere"* · *"A button says what happens"* · *"Labels are nouns, hints are
  sentences"* · *"Help is one sentence. A second sentence is a docs link's words, a field's `title`, or gone."*
- STYLE-GUIDE §11: *"Every control has a name, a focus ring and a 44px target on touch."* Match the form's existing
  `btn btn-sm` buttons (they already meet the project's touch rule; do not invent new CSS).
- NOMENCLATURE §22: one icon per concept — `Pencil` for edit (precedent `ComfyWorkflowsTab.svelte:90`),
  `ExternalLink` for open (precedent: Chronicle's *Open in lorebook*, Places' *Open entry*).
- CLAUDE.md: views never call `toaster`; `$state(new Set())`/`Map` is not reactive — `SvelteSet`/`SvelteMap`; no
  `crypto.randomUUID` / `navigator.clipboard` in browser code; `socket.off(event)` always with the handler.
- The labels **Edit card** and **Open card** are new UI labels the plan names; use them exactly — no other new copy than
  what this brief quotes.
- Decisions: implementation choices inside this brief are yours — name each in your report. Anything else a user would
  see, a file outside Files owned, or an unclear reading: STOP that part and report it. Do not fix things you notice in
  passing — list them under "Noticed, not done".

## Done means — tests (all green)
New `castMemberForm.dom.test.ts`:
1. a linked member whose card is the viewer's shows the read-only *Name* row with the card's name and nickname and
   *from the character card*, NO `#castName-<id>` input, and an **Edit card** button; clicking it sets
   `panelsCtx.digest.characterId` to the card id and calls `openView("characters", { toggle: false })`;
2. a linked member whose card has another `userId` shows **Open card**, which sets `digest.viewCharacterId` and opens
   the view (and no Edit card);
3. a member with no card still shows the `#castName-<id>` input and no read-only row.
Regression, read-only: `src/lib/client/lorebooks/cast/memberPage.dom.test.ts`,
`src/lib/client/lorebooks/cast/retoldBlock.dom.test.ts`.

Run tests ONLY like this (capped scope; one log per run, numbered):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-L-w3-<n>.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into `head`. Never a full
`npm test`, `npm run check` or project-wide `tsc`. Never hand a DOM node to an assertion (compare `x === null` to `true`,
not `assert.equal(node, null)`). Format with `npx prettier --write <file>` only on the new test file, or on an owned file
only if it was prettier-clean before (`npx prettier --check <file>` first); otherwise match the surrounding style.

## Verbatim lines (multi-agent guide)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also: never `git checkout`, `git restore` or `git clean` in either repo. No SDK edits are needed for this brief.

## Report (final message)
Changed files · what you chose and why · the projection check (does the bindingList row carry `character.userId`?) ·
tests run with exact command and pass/fail counts · anything stopped · Noticed, not done. Under 500 words.
