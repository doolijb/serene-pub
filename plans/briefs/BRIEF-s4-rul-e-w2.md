# BRIEF — s4-rul-e-w2 (2026-11-10) — the cast member form: card-less fields, one switch style, Speech heading

You are a `lane-worker` for lane `s4-rul-e` in `/home/jody/github/serene-pub`. Your supervisor already made two edits you build on (don't redo them): `memberPatch(draft, false)` in `src/lib/client/lorebooks/cast/memberDraft.ts` now also carries a card-less member's `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `groupOnlyGreetings`, `exampleDialogues` (helper `wordsPatch`), and `GreetingsList.svelte`'s "Group sessions only" label has `pointer-coarse:min-h-11`. Another worker (w1) is editing `memberDraft.test.ts` and a new server int test at the same time — don't touch those.

## Owner's words (never reinterpret)

- Cascade principle (2026-11-09): *"Cast by default cascades… a card is a seed, not the sole carrier… not having a card doesn't make them 2nd class."*
- 2026-11-10, on "a cast member with no card has no Description, Personality, Scenario, Greetings or Example dialogues on its form": **"Build it now"**.
- 2026-11-10: b-9 (one switch style on the member form) and b-10 (drop the Speech tab's leftover "Voice" heading) both go.

## Goal 1 — card-less members get their own text fields

File: `src/lib/client/lorebooks/cast/CastMemberForm.svelte`. Today the five card fields are drawn only for a carded member: `let retold = $derived(member.linked && card ? retoldRows(draft, card) : [])` (~594) and the `textRow` / `greetingsRow` snippets (~1270–1342) render only when `rowOf(field)` exists.

For a **card-less member** (`!member.linked`) draw, in the same places a carded member has them:
- **Profile** tab, About section, right after Summary (where the carded Description row is): **Description**.
- **Voice** tab: the same three sections a carded member gets (`<h5>Voice</h5>` with **Personality** and **Scenario**; `<h5>Greetings</h5>` with the greetings list; `<h5>Examples</h5>` with **Example dialogues**, `font-mono`), then the existing Instructions section, unchanged.

Each is a plain editable field: no switch, no **Take from card**, no kept line, no "From the card" intro (`data-cast-retold` stays absent for a card-less member). Draw them with the shared components: `ProseField` (value `draft[field]`, `oninput={(v) => setText(field, v)}`, the same `hint`, placeholder and `rows={8}` the carded row uses) and `GreetingsList` (`greetings={greetingList}`, `onText={setGreeting}`, `onGroupOnly={markGreeting}`, `onRemove={removeGreeting}`, `onAdd={addGreeting}` — the existing helpers already work on the draft and need no card). Greetings get a visible label "Greetings" pointing at the list's id, as the carded row does. Wrap each in `<div class="flex flex-col" data-own-field={field}>` (field = `description` | `personality` | `scenario` | `greetings` | `exampleDialogues`) and use ids `castOwn-{field}-{member.id}`. Keep `data-retold-field` for carded rows only (existing tests select on it). Prefer extending the existing snippets with a card-less branch over duplicating markup, if that stays readable.

A linked member whose `card` is null (not loaded) keeps today's behaviour (nothing drawn). Don't change a carded member's rows except as Goal 2 says.

No server change. If anything seems to need one, stop and say so in your report.

## Goal 2 — b-9: one switch style (retold rows use **Use from card**)

Today the retold rows (Description, Personality, Scenario, Greetings, Example dialogues) use their own Skeleton `Switch` in the `retoldControls` snippet (~1230) labelled **From the card / Retold here**, checked when the field is the member's own, plus a **Take from card** button always shown (disabled unless own and the card has text). Post-history instructions, creator notes and likeness already use `UseFromCardSwitch.svelte` (checked = follows the card).

Change `retoldControls` so the retold rows use `UseFromCardSwitch` too:
- `label={r.label}`, `checked={!r.retold}`, `onCheckedChange={(on) => toggleRetold(r.field, !on)}` — **mind the polarity**: Use from card checked = follows the card = not retold. Keep the existing `name` (`{fieldId}-retold`).
- **Take from card**: shown only while Use from card is **off** (`r.retold`), disabled when `!r.cardHasText`, same title, icon and `onclick`. While Use from card is on, no button.
- Keep the row layout (`mb-1.5 flex flex-wrap items-center justify-between gap-2`: switch left, button right). Remove the now-unused `switchClass` constant and `Switch` import only if nothing else uses them.
- `keptLine` text becomes: `Their own {r.label.toLowerCase()} is kept, set aside. Switch off Use from card to read it again.`
- `fromCardIntro` (★b-5) text becomes: `The card is a starter. Switch <strong>Use from card</strong> off on a field to tell it in this member's own words for this story; the card itself is not changed. Switching it back on keeps what you wrote here, set aside, until you switch it off again.` Keep its title "From the card", its `data-cast-retold`, and where it shows (top of Profile and Voice, carded only). Update the HTML comment above it to match.
- Every behaviour of the toggle stays: switching Use from card **off** on an empty field copies the card's text in (`setRetold`); switching it back **on** keeps the member's text (set aside), except an untouched copy, which gives back the saved value; **Take from card** copies the card's current text. `setRetold` / `takeFromCard` in `retoldRows.ts` are not to change. **The payload must be identical to today's for every state.**
- Post-history, creator notes, likeness, Name, Nickname, face and Voice (timbre): unchanged.

## Goal 3 — b-10: Speech heading

In the Speech tab (~1814–1845) drop `<p class="text-sm font-semibold">Voice</p>`. Keep the wrapper, `data-cast-voice`, the switch (its sr-only label "Voice" stays), "Uses the card's voice." and `VoiceTab`.

## Files owned

- `src/lib/client/lorebooks/cast/CastMemberForm.svelte`
- DOM tests in `src/lib/client/lorebooks/cast/`: update `retoldBlock.dom.test.ts`, `memberTabs.dom.test.ts`, `castMemberFormLater.dom.test.ts`, and any other member DOM test whose assertion the asked changes break (only the assertion, never weakening what it checks); add a new `cardlessWords.dom.test.ts`.
- Read-only: everything else. Never edit `memberDraft.ts`, `memberDraft.test.ts`, `retoldRows.ts`, `UseFromCardSwitch.svelte`, the `characterForms/` components, docs, or any server file.

## Tests to write

New `cardlessWords.dom.test.ts` (model it on `retoldBlock.dom.test.ts` / `memberTabs.dom.test.ts` mounting):
1. A card-less member shows Description on Profile and Personality, Scenario, Greetings, Example dialogues on Voice, all editable, no switch, no Take from card, no `[data-cast-retold]`, no `[data-retold-field]`.
2. Editing each (type into each textarea; add a greeting, mark one Group sessions only) then **Save** sends a payload equal to `memberPatch(<the edited draft>, false)` for those keys — at least: each of the seven keys present with the typed values (empty text → null, greetings as typed).
3. A member made card-less by a card delete (a card-less row, `characterId: null`, `character: null`, carrying the card's words in `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `groupOnlyGreetings`, `exampleDialogues`) shows those words in the fields; Save with no edit is not dirty.
4. Speech tab: no "Voice" heading text other than the switch's sr-only label (e.g. no element with text exactly "Voice" outside `.sr-only`), card-less and carded.
5. `GreetingsList`'s "Group sessions only" label carries `pointer-coarse:min-h-11`.

In `retoldBlock.dom.test.ts` (b-9): every carded retold row shows "Use from card" (checked while it follows the card, unchecked when retold); no "Retold here" / "From the card" switch labels left on rows; Take from card absent while Use from card is on, present while off, disabled when the card has none; the kept line reads "is kept, set aside"; switching Use from card off then on, and Take from card, give the **same payload as before** — assert the saved payload equals `memberPatch(setRetold(...)/takeFromCard(...), true)` computed from the same draft, or the exact objects the old tests asserted.

`memberTabs.dom.test.ts`: the card-less test "no retold rows" becomes "the five own fields are plain" (still no `[data-retold-field]`, no `[data-cast-retold]`); its payload tests must still pass (a card-less untouched form must not send the seven keys as changes).

## Rules (quoted from the project's canon)

- STYLE-GUIDE §6.4 Edit forms: *"A field's hint is its **placeholder** when it describes what to type … and its **`title`** when it explains what the field is for … — never a third line under the box."* Reuse the existing hints and placeholders; add no new hint lines.
- STYLE-GUIDE §9: *"Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers."*
- STYLE-GUIDE §6.5: the member form's strip has the card editor's tabs (**Profile** · **Voice** · **Notes** · **Likeness** · **Speech**), drawn by the same shared field components.
- CLAUDE.md: `$state(new Set())` / `new Map()` is not reactive — use `SvelteSet` / `SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a *chat*.
- Copy: use the strings in this brief exactly. Introduce no other user-visible text, setting, prop, event or name. If you think one is needed, stop and say so.
- Don't fix anything else you notice; list it under "Noticed, not done".

## Commands

- Tests, capped scope, logged (never pipe vitest into `head`):
  `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-e-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-e-w2-tests.log'`
- Run at least: `src/lib/client/lorebooks/cast/{cardlessWords,retoldBlock,memberTabs,castMemberForm,castMemberFormLater,memberOwned,memberVoice,memberPage,memberPageCard,memberPageVersions,memberCopy,memberGallery,memberSprites}.dom.test.ts` (check the real filenames with `ls`).
- Don't run tsc / `npm run check` / `npm test`; the supervisor does.
- Prettier: `npx prettier --check <file>`. **Only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. `CastMemberForm.svelte` already fails the check on two `cardOwned` lines (~629–631) that aren't yours: leave them. To format only your lines, compare `npx prettier <file> | diff <file> -` and apply just your hunks by hand.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (This lane runs no `sdk:build` at all.)
- Never `git checkout` / `restore` in either repo. Don't start a dev server.

## Report (your final message)

Changed files; for each goal what you did and the exact copy per state; tests run with pass/fail counts (log path); prettier result per file; anything you couldn't do or that needed a decision; Noticed, not done.
