# BRIEF — adv-F-w1: session forms (start form's hidden rules text; owner-aware read-only reading)

Supervisor: adv-F. Repo `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); don't write a report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The per-user **advanced controls** switch (`showsAdvancedControls(settings)`, off by default) already hides rules controls in the start form and makes *Where this session's story stands* read-only in the edit form. Finish three things lanes B and C left:

### Rules the work applies (quoted)

- Plan rule (`plans/PLAN-advanced-controls-2026-11-10.md` § The rule this plan applies): *"With advanced controls off, the controls that tune how a session … works are hidden … It never hides: … anything that explains a refusal. Wherever a form hides something, one line says so and turns the switch on in place. … Hidden never means changed. A hidden control keeps its stored value, and the session keeps using it."*
- ★adv-B-1 (ruled 2026-11-10): *"with the switch off, the start form keeps the adopted-rules sentence and the preset hint as plain text. The hidden line shows only when a rules choice or How strict would actually have rendered."*
- ★adv-B-2 (owner, 2026-11-10, "Owner-aware wording"): *"when the owner sees Where this session's story stands read-only only because advanced controls are off, the closing sentence is 'Turn on advanced controls to change them.' Guests keep 'The session owner chooses both.'"*
- CLAUDE.md: browser code runs on plain-http LAN and phones — no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` is not reactive — use `SvelteSet`/`SvelteMap`. It is a **session**, never a chat.
- No new names beyond the prop `lockedByAdvanced`. No new copy beyond the two sentences quoted here. Reuse existing classes (`text-surface-600-400 mt-1 text-xs` etc.) — no new styles.

### 1. `src/lib/client/components/sessionForms/StartSessionForm.svelte`

- **Rules-card path** (~3108-3312, `{#if advanced} <section … start-rules-heading> … {:else} <AdvancedHiddenLine class="px-1" /> {/if}`). With the switch off:
  - render, as plain text where the card was, the adopted-rules sentence (`rulesAdoptedLine`, `data-rules-from-lorebook`, keep its attributes) when `rulesAdoptedLine` is set, and the preset hint (`data-testid="start-rules-preset-hint"`, same copy as the card's) when `presetRigourUnplayed`. Each under its existing condition. Keep the existing `data-*` / `data-testid` hooks so tests find them.
  - render `AdvancedHiddenLine` only when, with the switch on, the rules list (rendered when `!rulesAdoptedLine`) or How strict (`!flow.rigourLocked && asksHowStrict(rulesOffer) && howStrictChoices(rulesOffer, rulesNow?.value).length > 1`) would have rendered. A small `$derived` (e.g. `rulesCardHides`) beside `bookPickHides` (~1373) is fine; give it a one-line doc comment like its neighbour's.
- **Book-pick path:** the How strict card (~2881 `{#if advanced && (presetRigourUnplayed || howStrictShown)}`): with the switch off, render the preset hint (same copy, same testid) as plain text when `presetRigourUnplayed`. Then in `bookPickHides` (~1373-1400) change the last line `return presetRigourUnplayed || howStrictShown` to count only `howStrictShown` (the preset hint is no longer hidden). Leave every other clause of `bookPickHides` alone.
- Don't touch the payload or `createSession.svelte.ts`.

### 2. `src/lib/client/components/sessionForms/SessionLorebookReading.svelte`

- One new optional prop `lockedByAdvanced?: boolean` (default `false`), with a doc comment in the style of `readOnly`'s: an owner who sees the reading read-only only because advanced controls are off (🚧 2026-11-10).
- When `readOnly && lockedByAdvanced`:
  - the closing sentence of the read-only paragraph ends *"Turn on advanced controls to change them."* instead of *"The session owner chooses both."* (the rest of the paragraph unchanged);
  - the clock is spelled with the book's calendar (`spell(clock)`, i.e. `formatDate(clock, calendar)`) instead of `formatDate(clock, null)`;
  - the branch shows by its name (`branches.find((b) => b.id === branchId)?.name`), falling back to *"A branch of this lorebook"* only while the lines haven't arrived;
  - that needs `time.listen`: change the listen effect's guard so it returns early only for `readOnly && !lockedByAdvanced`. (This also lets the existing deleted-line repair effect run for this case, exactly as it does in the editable view; that is intended.)
- Guests' read-only branch (`readOnly && !lockedByAdvanced`) is byte-for-byte unchanged in what it shows and in not listening.

### 3. `src/lib/client/components/sessionForms/EditSessionForm.svelte` — only the two mounts

At ~2884 and ~2895 add `lockedByAdvanced={!isGuest && !advanced}`. Nothing else in this file.

### 4. Tests

- `startSessionAdvanced.dom.test.svelte.ts`, switch off: assert that the starter-kit picker, the creation-mode picker and a start ask render (look at `startSessionModes`, `startSessionAsks`, `startSessionBookSources` tests in the same folder for fixtures and selectors); that the adopted-rules sentence and the preset hint stay (Rules-card path, and the preset hint in the book-pick path); that there is **no** hidden line when the card held only text (adopted rules, How strict not asked); and that the line still shows when a real choice was hidden.
- `editSessionAdvanced.dom.test.svelte.ts`: owner with the switch off sees *"Turn on advanced controls to change them."*, the branch name and the calendar-spelled clock (feed `time.listen`'s replies the way the file's existing fixtures feed sockets — find how `BookTime` listens in `src/lib/client/lorebooks/time/bookTime.svelte.ts`); a guest still sees *"The session owner chooses both."* and "A branch of this lorebook", and asks for nothing.
- Assert on strings, counts and booleans (`textContent`, `querySelector(...) !== null`, `.length`). **Never hand a DOM node to an assertion** (a failing `expect(node)` on a happy-dom element has OOM-killed VS Code).

## Files owned (edit only these)

- `src/lib/client/components/sessionForms/StartSessionForm.svelte`
- `src/lib/client/components/sessionForms/SessionLorebookReading.svelte`
- `src/lib/client/components/sessionForms/EditSessionForm.svelte` — the two mounts only
- `src/lib/client/components/sessionForms/startSessionAdvanced.dom.test.svelte.ts`
- `src/lib/client/components/sessionForms/editSessionAdvanced.dom.test.svelte.ts`

## Files readable

Anything. Useful: `src/lib/client/advancedControls.ts`, `src/lib/client/components/AdvancedHiddenLine.svelte`, the other `startSession*.dom.test.svelte.ts` / `editSession*.dom.test.svelte.ts` files, `src/lib/client/lorebooks/time/bookTime.svelte.ts`, `src/lib/shared/lorebooks/storyDate.ts`.

## Out of scope (never build)

Anything else in these files; other lanes' files (characters, lorebooks, the SDK, envelope, Header); docs and NOMENCLATURE; the Branch flash before the first actions push. Note findings under **Noticed, not done** in your report.

## Stop and ask when

A new name, copy, setting or data change seems needed; the conditions above don't match the code; anything outside the owned files must change. Stop and say so in your report instead of deciding.

## Formatting and hazards (verbatim lane rules)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- **Never run `prettier --write` on a file**; these files hold other sessions' uncommitted work. Format only your own hunks by hand (tabs, the file's existing style).
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no SDK work; don't build.)
- Never `git checkout`, `restore` or `clean` in either repo.
- Never pipe vitest into `head`. Run app vitest in a capped scope:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
- Scratch files start with `adv-F-w1-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad`.

## Done means

- `src/lib/client/components/sessionForms/startSession*.dom.test.svelte.ts` and `editSession*.dom.test.svelte.ts` green (run them in the capped scope above; two batches is fine).
- `npx prettier --check` on the files you touched shows no new problems in your hunks (say if the file was already unclean).
- Report: the diff summary per file, tests run with counts, anything you assumed, **Noticed, not done**.
