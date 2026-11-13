# BRIEF playtest3-L3-w2 — the *Use from card* toggle on a cast member's Name and Nickname

Lane `playtest3-L3`, worker 2 of 2. Supervisor: playtest3-L3. Report: your final message (changed files, each test command with pass/fail counts, prettier results, anything you could not do, Noticed-not-done). Worker 1 edits `castOwnNames.ts` and several test files at the same time (`memberIdentity.test.ts`, `castPool.test.ts`, `castOwnNames.int.test.ts`, `retold.int.test.ts`, `sessionPageProjections.castNames.test.ts`, `rowProjection.castNames.int.test.ts`) — never touch those. Lane W4 edits widget settings files — none of yours.

## Goal — the owner's ruling, verbatim (★L-3b, 2026-11-04)
"a *Use from card* toggle on each of Name and Nickname in `CastMemberForm.svelte`. On (the default for a field with no own value): the card's value reads through and the field shows it read-only; stored NULL. Off: the field is the book's own value, which MAY be blank — an own empty **Nickname** means *no nickname in this book* (the member shows by name), an own empty **Name** is refused (*A cast member's name in this book must be text.*, `OWN_NAME_NOT_TEXT`). … The rule stays `nickname = ownNickname ?? card.nickname` with `""` → none. Update … `memberDraft.ts` (the toggle's state), the form DOM test, docs (`lorebook-cast.md`: the toggle; *Use from card* on means the card's; off and blank means none)."
And ★L-3 (same day): "an own name alone keeps the card's nickname, which `resolveCharacterName` prefers when one word is shown; a person who wants the new name shown gives the book a nickname".

The supervisor has ALREADY changed `src/lib/shared/lorebooks/memberIdentity.ts` (do not edit it): `ownNameValue(v)` is now `typeof v === "string" ? v.trim() : null` — `""` is KEPT as an own empty value, no longer folded to null. The server (`normaliseOwnNames`, worker 1) stores `null` as null, a trimmed nickname as is (`""` included), and REFUSES a blank `ownName` with `OWN_NAME_NOT_TEXT`.

## Tasks
1. **`src/lib/client/lorebooks/cast/memberDraft.ts`** — the toggle's state lives in the draft as null:
   - `MemberDraft.ownName: string | null` — `null` = *Use from card* on (the card's reads through); a string = off, the book's own.
   - `MemberDraft.ownNickname: string | null` — `null` = on; a string = off; `""` (off, blank) = no nickname in this book.
   - `memberDraftOf(row)`: `ownName: ownNameValue(row.ownName) || null` (a blank own name is never stored; reads as on), `ownNickname: row.ownNickname ?? null` (a stored `""` reads as off + blank).
   - `memberPatch` keeps `ownName: ownNameValue(draft.ownName)`, `ownNickname: ownNameValue(draft.ownNickname)` (null stays null; text trimmed, `""` kept). Update the doc comments on the interface and on `memberPatch` ("blank = null = the card's" is no longer true).
   - No other new exports, flags or fields.
2. **`src/lib/client/lorebooks/cast/memberDraft.test.ts`** — fix what the change breaks (line ~225 `memberPatch({ ...d, ownName: "  " }, true).ownName` is now `""`, refused by the server) and add: on (`null`) patches `null`; off + blank nickname patches `""`; `memberDraftOf` reads a stored `""` nickname as `""` and a `null` as `null`; `sameMemberDraft` tells `null` from `""` apart for the nickname.
3. **`src/lib/client/lorebooks/cast/CastMemberForm.svelte`** (linked-member branch, ~lines 561–600, and the save buttons):
   - Under each of the **Name** and **Nickname** labels, a Skeleton `Switch` labelled **Use from card**, built exactly like the retold switch in the same file (~888–903: `Switch.Control class={switchClass}`, `Switch.Thumb`, `Switch.Label` with an `sr-only` prefix — here `<span class="sr-only">Name:</span>` / `<span class="sr-only">Nickname:</span>` — then the visible text `Use from card`, `Switch.HiddenInput`; `name="castOwnName-{member.id}-fromCard"` / `castOwnNickname-…-fromCard`). Keep the label on its own line (that file's walk note: the panel is 240–320px wide). Checked when the draft's field is `null`.
   - Switching **on** sets the draft field to `null`. Switching **off** sets it to the card's current value (`card?.name ?? ""` / `card?.nickname ?? ""`) so the field does not jump to blank; the person then edits or clears it. (Supervisor's decision; do not add anything else.)
   - The input keeps its id (`castOwnName-{member.id}` / `castOwnNickname-{member.id}`). On: `disabled`, `opacity-60`, `value` = the card's value (nickname placeholder `The card has none.` when the card has none — the copy the retold textarea already uses), not bound to the draft. Off: `bind:value` to the draft field (a string then; use a `{#if}`/`{:else}` pair of inputs or a getter/setter — your choice, keep it simple and typed).
   - Remove the old nickname placeholder that depended on `draft.ownName` (the "empty while a Name is typed" rule — ★L-3 reversed it).
   - Save is disabled while Name is off and blank, on all three save controls (~1177 *Save as of*, ~1231 the menu item, ~1254 *Save*): add `(member.linked && draft.ownName !== null && !draft.ownName.trim())` beside the existing `(!member.linked && !draft.name.trim())`. No new copy, no toast, no error line (the server refusal covers other paths).
   - `ownNamesDirty` keeps comparing with `ownNameValue` (it now tells `null` from `""`); make it type-check with the nullable fields.
   - Update the component's doc comment (~40–42: "blank = the card's" → *Use from card* on = the card's, off = the book's own; an own empty nickname = none). The help line *Shown in this book only; the card keeps its own.* stays as it is.
   - No new strings other than **Use from card** and the sr-only prefixes. No toggle on Face.
4. **`src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts`** — fix the cases the change breaks: "a linked member: Name / Nickname inputs with the card's values as placeholders…" (now: both switches checked, inputs disabled showing the card's values), "the nickname placeholder is empty while a Name is typed" (replace: with an own name typed, the Nickname field still shows the card's nickname, ★L-3), "typing a name and pressing Save hands onSave ownName; clearing it hands null" and "clearing an own name saves null" (now: switch Name off, type, Save → `ownName` "Veritas", `ownNickname` null; switching Name back on → Save hands `ownName: null`). Add: Nickname switched off and cleared → Save hands `ownNickname: ""`; a stored `ownNickname: ""` draws the Nickname switch unchecked with an empty input; Name off and blank → Save disabled. Keep the existing helpers (`linked(...)`, `type(...)`) and the moment/dated-save and no-card cases working. Toggling a Skeleton Switch in happy-dom: click its hidden input or `Switch.Control` the way other DOM tests in this repo do (`grep -rln "HiddenInput\|role=\"switch\"\|data-scope=\"switch\"" src --include=*.dom.test.ts`, e.g. `retoldBlock.dom.test.ts`).
5. **`docs/lorebook-cast.md`** line 34 (the **Name**, **Nickname** and **Face** bullet): replace "Clear a field to use the card's again." with the toggle, in the doc's voice (second person, plain). Suggested text — keep it this short:
   "Name and Nickname each have a **Use from card** switch. On, the field shows the card's value and follows the card. Off, the field is this book's own. Someone shown in one word is shown by their nickname, so a new name alone still shows the card's nickname: give them a nickname too, or switch Nickname off and leave it empty for no nickname in this book. A name can't be left empty; switch **Use from card** back on instead."
   Keep the rest of the bullet. Grep the doc for any other line that promises "clear" / "blank reads as the card's" and fix it the same way.

## Files owned (only these)
`src/lib/client/lorebooks/cast/memberDraft.ts`, `src/lib/client/lorebooks/cast/memberDraft.test.ts`, `src/lib/client/lorebooks/cast/CastMemberForm.svelte`, `src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts`, `docs/lorebook-cast.md`.

## Files readable
Everything. `memberIdentity.ts` (do not edit). `AI-TEMP/skeleton-llms-svelte.txt` for Switch: `grep -n "^# Switch" AI-TEMP/skeleton-llms-svelte.txt`, then `sed -n` that section only.

## Out of scope — never built
A stored marker column; a migration; a toggle on Face; any reader change; new copy beyond **Use from card**; edits to any file not listed above (`NOMENCLATURE.md`, `sockets/lorebooks.ts`, `castOwnNames.ts` included).

## Stop and ask when
Something here cannot be built as written (say what and why); anything needs a new name, setting, string or migration; a test's intent cannot be kept.

## Rules your work depends on (quoted)
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." "It is a **session**, never a *chat*."
- STYLE-GUIDE: "A Skeleton **Switch** keeps its filled primary track when on." "**The title is the control's label**: a field label, switch label or segmented label that would repeat it is kept for a screen reader only (`labelHidden`, `sr-only`), never drawn twice." "A field's hint is its **placeholder** when it describes what to type … never a third line under the box."
- Memory: "Heavy DOM tests: a failing `assert` on a happy-dom element has OOM-killed VS Code" — assert on strings/booleans you pull out (`el.value`, `el.disabled`, `!!el`), never `expect(element)` diffs.
- Re-read every file immediately before editing it (other agents edit the same tree). Use Edit, never Write, on existing files.
- Formatting: `npx prettier --check <file>` on each file you touched — never `--write`. Fix flagged formatting by hand with Edit.

## Done means
Green, each run with the command below: `src/lib/client/lorebooks/cast/memberDraft.test.ts`, `src/lib/client/lorebooks/cast/castMemberForm.dom.test.ts` (plus `retoldBlock.dom.test.ts` and `memberPage.dom.test.ts` in the same folder, to show nothing else broke); the new cases above present and passing; `npx prettier --check` clean on your files. No `svelte-check` or `tsc` (project-wide); rely on the tests and careful typing.

Run vitest ONLY as (one log name per run, n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-L3-w2-<n>.log 2>&1; echo exit=$?'`
then read the log (grep it). Never pipe vitest into `head`. Never a full `npm test`, `npm run check`, or project-wide `tsc`.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an SDK build.)
