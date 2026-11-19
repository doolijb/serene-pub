# BRIEF — worker `gs-3b-w2` (client): a guest picks a card someone shared with them in Edit session

Repo `/home/jody/github/serene-pub` (app). The SDK repo is read-only. Supervisor: lane `gs-3b`.
Re-verify every file:line below before you edit: these files changed today.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: run **no git command that changes the index or the working tree**. **Never run prettier with `--write` and never pipe prettier's output into a file.** No `npm run build`, no full test run.

## What the server already does (built by `gs-3b-w1`, do not change it)

`sessions:update` takes a one-shot field (`src/lib/shared/sockets/types.ts`, `Sockets.Sessions.Update.Params`):
```ts
sharedCardSeats?: Array<{ characterId: number; kind: "character" | "player" }>
```
For each, the server copies the shared card into a **new card-less cast member of the session's notes** (unlinked) and seats the caller on it: kind `character` = an AI-played character seat they seated; kind `player` = a card-less player seat they play, named as the card. After the save the session reply carries that seat like any other card-less seat (a `castMemberIds` member, or a named player seat). A shared card id must **never** go in `characterIds` or `personaIds` (refused: "you can only add characters you own").

## Rules (quoted)

- Owner 2026-11-16 (G3): "Guests can't choose directly from the owners card list, but can choose from shared cards from other users, shared cards are copied into the lorebook unlinked." Owner 2026-10-12 (Q3): a shared character is "read and copy, never use-as-cast".
- **For guests only** (lane correction): the session **owner's** pickers keep stripping shared rows (`withoutShared`) exactly as today. Only a guest (`isGuest`, `EditSessionForm.svelte` ~751) whose saved *bring their own* switch is on (`canBringOwn` ~764) gets the shared group, and only in a section the genre shows (`showCharactersSection` / `showPersonasSection` ~355–362).
- STYLE-GUIDE §6.4 **Shared rows**: "what another person shared with the reader lists last, under the group label _Shared with you_, its second line _From *owner*_ in place of the row's own blurb". The second line is `sharedFromLine(row)` (`src/lib/shared/utils/sharedRows.ts`); split rows with `splitSharedRows` from the same file. Group labels are `ListGroupLabel`.
- STYLE-GUIDE §10: sentence case; help is one sentence. §9: every interactive element is a real button/input with an accessible name; never an interactive inside an interactive.
- Sockets rule (CLAUDE.md): views never call `toaster`; `socket.off(event)` always with the handler. `$state(new Set())` is not reactive: use `SvelteSet` / `SvelteMap` if you need one.

## Build

1. **`CharacterPickRow.svelte`** (`sessionForms/`): a row with `isSharedWithMe` shows `sharedFromLine(row)` as its second line instead of `characterSummary(…)`. Nothing else changes (shared rows reach no other picker, so other callers are unaffected).
2. **`modals/CharacterSelectList.svelte`** + **`modals/CharacterSelectModal.svelte`**: additive props only (they are also used by `StartSessionForm`, `CastWorkspace`, `ReassignSessionParticipantModal`; defaults must keep them exactly as today): `sharedCards?: Row[]` (default `[]`) and `onSelectShared?: (row) => void`. When `sharedCards` has rows that match the search, the list shows them **last** under `<ListGroupLabel label="Shared with you" />`, then one muted help line ★ *Picking one puts a copy in this session; the original stays as it is.* (same markup as the existing *Picking one adds someone new to the story.* line), then the rows. A shared row is always a single press (`kind="button"`) calling `onSelectShared(row)`, in single and multi mode alike (it is never ticked into `onMultiSelect`). The grouped layout must show when only shared cards are offered; the empty state must not show while a shared row is offered.
3. **`modals/PersonaSelectModal.svelte`**: same two props. Its own list keeps `withoutShared`. The shared group shows below its list (ignoring **Show all characters**: a shared card's persona flag is its owner's), with the same label, help line and press → `onSelectShared(row)`. Keep the existing empty state for its own list when it is empty but shared rows exist (render the shared group anyway).
4. **`EditSessionForm.svelte`**:
   - `handleCharactersList` (~1975): keep `characters = withoutShared(…)`; also keep the shared rows in a new `$state` (`sharedRows`). Offer `sharedToOffer = isGuest && canBringOwn ? sharedRows : []` (derived), minus the cards already picked for that kind.
   - A draft list `sharedPicks = $state<{ kind: "character" | "player"; card: SeatCard-like row }[]>([])`. `onSelectShared` from the Characters picker adds `{ kind: "character", card }`; from the persona picker `{ kind: "player", card }` (skip a duplicate of the same kind and id) and closes the picker.
   - `data` (the `$effect` ~960–1005) gains `sharedCardSeats: sharedPicks.map((p) => ({ characterId: p.card.id, kind: p.kind }))`, so `isDirty` (~442) counts a pick; `canSave` floors (~455–465) count picks of each kind (character picks toward the characters floor, player picks toward the personas floor). Add the field to the `data` / `originalData` type (~212–255).
   - The save payload (~1600–1665): `...(sharedPicks.length ? { sharedCardSeats: … } : {})`, sent by a guest; shared ids never in `characterIds` / `personaIds`.
   - Clear `sharedPicks` where the form reloads from the session (next to `handoverDraft.clear()`, ~1971), so after a save the copy shows as the saved seat and is never sent twice.
   - Pass `sharedCards={sharedToOffer…}` + `onSelectShared` to the `CharacterSelectModal` (~3466) and `PersonaSelectModal` (~3496). The owner passes nothing.
5. **`SessionCharacters.svelte`** (AI-played group) and **`SessionPersonas.svelte`** (the viewer's own group only): new props `sharedPicks: Row[]` and `onRemoveSharedPick: (id: number) => void`. Draw each pending pick under the seats already there as `CharacterPickRow kind="chosen"` (its second line reads *From ‹owner›* by step 1), with one **Remove** icon button in `actions` whose `aria-label` follows the existing remove buttons' pattern in the same file (e.g. "Remove ‹name›"). No bench, drag, reorder or **Played by** on a pending pick. A viewer's own Personas group shows when it holds a pending pick (extend `holds` / `shown`). Add no other sentence.

## Files owned (edit only these)
`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `SessionCharacters.svelte`, `SessionPersonas.svelte`, `CharacterPickRow.svelte`, `editSessionForm.ts` (types only, if needed), `src/lib/client/components/modals/CharacterSelectModal.svelte`, `CharacterSelectList.svelte`, `PersonaSelectModal.svelte`, and one new test file `src/lib/client/components/sessionForms/editSessionSharedCards.dom.test.svelte.ts`. Not yours: every server file, `StartSessionForm.svelte`, `shared/sockets/types.ts`, docs, NOMENCLATURE. A diagnostics lane may be live in `RunProgressCard.svelte`: never touch it.

## Tests
New `editSessionSharedCards.dom.test.svelte.ts`, modelled on `editSessionGuestSeats.dom.test.svelte.ts` (its mocks, `listeners`, `emitted`, how it mounts the form as a guest and feeds `characters:list`). Cases:
1. A guest, bring own on, in a genre with personas and characters: `characters:list` carries one own card and one shared card (`isSharedWithMe: true, ownerName: "Ana"`). The persona picker shows the group **Shared with you** with the row reading *From Ana*; the own list does not contain the shared card.
2. Picking it adds a pending row in the guest's Personas group reading *From Ana*; Save emits `sessions:update` with `sharedCardSeats: [{ characterId, kind: "player" }]` and the id in neither `personaIds` nor `characterIds`.
3. The Characters picker: same group; a pick saves as `kind: "character"`.
4. **Remove** on a pending pick drops it: Save sends no `sharedCardSeats` (and an untouched form is not dirty).
5. Bring own off (saved switch): no shared group in either picker. The session's owner: no shared group in either picker.

Then run these existing DOM files (no edits expected; if one needs re-pinning, say which line and why): `editSessionGuestSeats`, `editSessionSeatGroups`, `editSessionSaveParity`, `editSessionCastMembers`, `editSessionPlayerSeats`, `editSessionGuestView`, `editSessionBench`, and `startSessionCast` (it uses `CharacterSelectModal`).

How to run, one at a time, always with paths:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-3b-w2-<n>.log 2>&1"
```
Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed VS Code: keep DOM assertions on text/attributes, run DOM files in batches of at most 4. At the end: `NODE_OPTIONS=--max-old-space-size=10240 npm run check` once, reporting errors in your files only.

## Stop and ask (in your report; do not decide) when
Any new sentence or label beyond the ★ help line and the existing "Shared with you" / "From ‹owner›"; a change outside your files; a server change.

## Done means
New DOM file green; the listed existing files green; `npm run check` 0 errors in your files; `npx prettier --check` on your touched files (report; do not fix files that already failed before you).

## Report (final message, under ~400 words)
Changed files; per Build step what you did and any deviation; tests with counts and log paths; check result; prettier result; anything stopped; **Noticed, not done**.
