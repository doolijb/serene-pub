# BRIEF playtest2-L2-w1 — client readers name a cast member by their own name in the book

Lane `playtest2-L2` · worker w1 · report `plans/REPORT-playtest2-L2-w1-2026-11-04.md` (if the harness refuses the write, put the full report in your final message).

## Background (read, do not edit)
`src/lib/shared/lorebooks/memberIdentity.ts` is the ONE reader of what a cast member is called in a book (ruled 2026-11-04): `memberNames(member, card)` → `{ name, nickname }`, `memberShownName(member, card, fallback)` = nickname || name || fallback after the member's own, `withMemberNames(card, member)` (same object when no own names), `hasOwnNames`, `memberFaceMediaId(member, card)`. The session payload carries `castNames` (card id → `{ ownName, ownNickname }`) and `castFaces` (card id → file id) for members of the session's book. The client helpers are in `src/lib/client/components/sessionPage/projections/characters.ts`: `castNameOf(session, cardId, card, fallback)` and `castFaceOf(session, cardId, { full? })` → URL or null. A member row (lorebook binding / cast row) carries `ownName` / `ownNickname` itself.

Rule **R1 (NOMENCLATURE §1): one word, one meaning — and here, one rule.** Every reader goes through the helper above; never write a second `ownName ?? …` rule anywhere. **Keep each reader's own choice** between the plain name and nickname-or-name: where it read `card.name`, read `memberNames(member, card).name`; where it read `nickname || name` / `resolveCharacterName`, read `memberShownName(member, card, sameFallback)` (or `castNameOf` where you have the session, not the member row). A persona (a character someone plays, `sessionPersonas`) keeps the card's own name and face, exactly as `memberOf` in `projections/characters.ts` does.

## Goal — change only the expression that names / draws the member
1. `src/routes/sessions/[id]/+page.svelte`
   - `participantOf` (~line 740): for a `character:<id>` ref that is a seated session character (in `session.sessionCharacters`, not only a persona), name = `castNameOf(session, id, who, who.name ?? "")`, avatarUrl = `castFaceOf(session, id, {}) ?? avatarSrc(who) ?? null`; a persona ref stays as today. Find the page's session variable (`session` / `data.session`) by reading the file.
   - The `<TurnPicker … candidates=…>` call (~line 952): pass candidates whose `character:<id>` entries are named through `castNameOf(session, id, { name: c.name, nickname: c.nickname }, c.name)`, with the nickname cleared so TurnPicker's own `c.nickname || c.name` label shows that name. **Do NOT edit `TurnPicker.svelte`** — lane T is editing it right now.
   - The `<PickSpeakerModal … sessionCharacters=…>` call (~line 976): pass the seats with each `character` shown as the member: `withMemberNames(cc.character, session.castNames?.[cc.characterId])` and, when `session.castFaces?.[cc.characterId]` is a number, `avatarMediaId` set to it. Then `PickSpeakerModal.svelte` needs no change (its `nickname || name` at ~158 and its search read the shown card). Verify that by reading it; only if it truly can't work that way, edit its name expression at ~146/158 instead.
   - Re-read the exact lines immediately before each edit; another lane may be editing the page. Use Edit, never Write, on this file.
2. `src/lib/client/components/sessionPage/messageControls.svelte.ts` `handleAvatarClick` (~251): for a non-persona, `name: castNameOf(session, char.id, char, "")` and `avatarMediaId: session?.castFaces?.[char.id] ?? char.avatarMediaId ?? null`.
3. `src/lib/client/components/sessionPage/pressRouting.svelte.ts` `collectCast` (~580): `name: castNameOf(session, cc.character.id, cc.character, cc.character.name)`.
4. `src/lib/client/lorebooks/sections/CharacterLoreEditor.svelte` `bindingLabel` (~29): `memberShownName(binding, binding.character, binding.binding)` for a carded binding.
5. `src/lib/client/components/modals/SummarizeLoreModal.svelte` (~225): the `lorebookBindings` entry's name = `memberShownName(b, b.character)`.
6. `src/lib/client/components/lorebookForms/entryManager.ts` `substituteBindings` (~118): `memberShownName(binding, binding.character, binding.binding)`.
7. `src/lib/shared/utils/characterLoreVisibility.ts`: `BindingLike` gains optional `ownName?: string | null; ownNickname?: string | null`; the `name` (~70) = `memberShownName(binding, binding.character, "this character")`.
8. `src/lib/client/lorebooks/time/worldRoster.ts` (~86): `RosterRow` gains optional `ownName?` / `ownNickname?`; a carded row is named `memberShownName(row, { name: card ?? row.name })`, so a member with own names is named by them. Then in `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (~654-667) remove ONLY the `named` workaround (rows with own names passed in as card-less) and pass `expanded` straight to `worldRoster`. Touch nothing else in that file (Edit, never Write; re-read first). Update the worldRoster file comment's "The card NAMES them" sentence only as far as it becomes wrong.
9. `src/lib/client/lorebooks/castPool.ts`: remove `CastRow.character.userId?` (~74) **only if** nothing reads it — grep `src/` for `.userId` on cast rows/members (`CastWorkspace.svelte`, `cast/*`, `castPool.ts`, `toCastMember`, tests). If anything reads it, leave it and say where.

Rows that lack `ownName`/`ownNickname` (older payloads) must read exactly as before: every new field is optional and the helper treats absent as the card's.

## Tests (add one case per reader group, beside the file)
- `worldRoster.test.ts`: a carded row with an own name is named by it; one without reads the card.
- `entryManager.test.ts`: `substituteBindings` uses the own name.
- `characterLoreVisibility.test.ts`: the label says the own name.
- `castPool.test.ts`: still green after the field removal.
- Turn picker / speaker picker / participant: these live in `+page.svelte`, which has no unit test. If the mapping is a one-liner inline, add a case to `src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts` only if it exercises the same helpers the page now calls (e.g. `castNameOf` with a candidate-shaped card, `withMemberNames` + `castFaces` on a seat). Do not create a new exported helper just to test it; do not add a new name. Say in the report how each reader is covered.

## Files owned (edit only these)
`src/routes/sessions/[id]/+page.svelte` (the three expressions above), `src/lib/client/components/sessionPage/PickSpeakerModal.svelte` (only if item 1 can't work), `messageControls.svelte.ts`, `pressRouting.svelte.ts`, `src/lib/client/lorebooks/sections/CharacterLoreEditor.svelte`, `src/lib/client/components/modals/SummarizeLoreModal.svelte`, `src/lib/client/components/lorebookForms/entryManager.ts`, `src/lib/shared/utils/characterLoreVisibility.ts`, `src/lib/client/lorebooks/time/worldRoster.ts`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (the `named` block only), `src/lib/client/lorebooks/castPool.ts`, and the test files beside them listed above.
NOT yours: `TurnPicker.svelte`, `memberIdentity.ts`, `projections/characters.ts`, `NOMENCLATURE.md`, `shared/sockets/types.ts`, anything under `server/`.

## Rules (from CLAUDE.md, quoted)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- No new identifier, field, prop, label or error string beyond the two optional `ownName?`/`ownNickname?` fields named above (they mirror the existing column names). If you think you need one, stop and say so.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "It is a **session**, never a *chat*."
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.

## Stop and ask when
A reader can't reach a member row or `castNames` without a new socket field or prop; a name is new; the change would alter what a persona shows.

## Done means
Green, run exactly like this (one run; read the log after; never pipe vitest into `head`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/lorebooks/time/worldRoster.test.ts src/lib/client/components/lorebookForms/entryManager.test.ts src/lib/shared/utils/characterLoreVisibility.test.ts src/lib/client/lorebooks/castPool.test.ts src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts src/lib/client/components/sessionPage/projections/characters.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-L2-w1.log 2>&1; echo exit=$?'
```
Also `npx prettier --check` on each file you changed (report, don't `--write` files you didn't otherwise change). Never `tsc` over the project, `npm run check`, or `npm test`.

## Report
Changed files with one line each · tests run, exact command, pass/fail counts · assumptions made · Noticed, not done.

## Verbatim lane rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an SDK build.)
