# BRIEF cv-walkfix-w1 — the editor's sentence names only the edited version's members; the cast line re-asks after a save

Worker (lane-worker, Sonnet). Supervisor: cv-walkfix. Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

(No `sdk:build` is needed for this task — do not run one.)

## Goal

Two findings from the owner's stage-1 walk of character versions (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md`, the "Stage 1 walk" bullet near line 1428):

1. **The editing sentence** under the card editor's cast line (`castEditParts` / `castEditWords` in `castBannerWords.ts`, rendered by `CharacterForm.svelte` as `[data-cast-edit-note]`, ~line 2213) today names every member that follows any card field. It must name **only the members that read from the card version being edited** — a member pinned to v1.0 is not changed by editing v1.1. If none remain → no sentence (null, nothing rendered). **The cast line itself (`CastLine.svelte`) stays exactly as it is** — do not edit `CastLine.svelte`.
2. **Re-ask after a save.** After this form's own successful `characters:update` (an in-place version save, or **Save as new version**), the editor's cast line re-asks `lorebooks:bindingsForCharacter`, so the **Update ‹name› to card v1.1** offer (rendered inside `CastLine` when `member.behindCard`) appears without a reload. Today the staying branch of `handleCharactersUpdate` keeps the form open on the new version but never re-asks, so the members still carry the old `behindCard: false`.

## Data you have (already built, do not change)

`lorebooks:bindingsForCharacter` replies `{ characterId, lorebooks, members }`; each member (`CastBannerMember` in `castBannerWords.ts`) now carries optional
`cardVersion?: { id, number, label } | null` (the card version the member reads; `null` = reads no card version),
`cardCurrentVersion?: {…} | null`, `behindCard?: boolean`.
`CharacterForm.svelte` holds `shownCardVersionId` (the card version the form shows and a save writes; `undefined` when `characters:get` sent no `cardVersionId`).

## Decided design (follow it)

- `castEditParts(members, editedCardVersionId?: number)` and `castEditWords(members, editedCardVersionId?: number)` gain an optional second parameter. When `editedCardVersionId` is a number, a member counts only if `member.cardVersion !== undefined ? member.cardVersion?.id === editedCardVersionId : true` — i.e. a member whose reply carries no `cardVersion` field at all (an older server reply) still counts as before; a member with `cardVersion: null` (reads no card version) does not count; a member on another version does not count. When `editedCardVersionId` is `undefined`, no version filter (today's behaviour). Apply the filter **before** the existing `followsCard.length === 0` skip/grouping, so the rest of the function is unchanged. Update both doc comments to say so.
- In `CharacterForm.svelte`: `const castEdit = $derived(castEditParts(castMembers, shownCardVersionId))`.
- In `handleCharactersUpdate`: when the save is this form's own (`mine`) and `res.character` is set, bump `castAsk++` (the existing counter the cast-line `$effect` already reads) — before the staying-branch `return` and before `closeForm()`, so both paths re-ask (the close path is harmless; the effect's cleanup runs on unmount). A save from another tab (`mine` false) does not re-ask. Keep the existing comment style; add one short comment saying why.
- No new user-visible words, names, settings, events or files beyond tests. Do not touch `CharacterViewPanel.svelte`, `CastLine.svelte`, any server file, docs or NOMENCLATURE.

## Files owned (only these may be edited)

- `src/lib/client/components/characterForms/castBannerWords.ts`
- `src/lib/client/components/characterForms/CharacterForm.svelte` (only the two spots above)
- `src/lib/client/components/characterForms/castBannerWords.test.ts` (add unit cases)
- `src/lib/client/components/characterForms/castEditNote.dom.test.svelte.ts` (add DOM cases)
- `src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts` (add DOM cases)

## Files readable

Anything under `src/lib/client/components/characterForms/`, `src/lib/client/lorebooks/cast/CardUpdateOffer.svelte`, `plans/REPORT-cv-member2-2026-11-06.md`.

## Tests to add

Unit (`castBannerWords.test.ts`, inside `describe("castEditWords")` or a sibling describe):
- With `editedCardVersionId` = 2: a member on version 1 and a member on version 2 (both following fields) → only the v2 member is named.
- Only members on another version → `null`.
- A member with `cardVersion: null` → not named when a version id is given.
- A member without the `cardVersion` field → still named when a version id is given.
- No `editedCardVersionId` → unchanged behaviour (both named).

DOM (`castEditNote.dom.test.svelte.ts`, the real `CharacterForm`): extend `render` (or add a variant) so the `characters:get#7` reply can carry `cardVersions`, `cardVersionId`, `currentCardVersionId` (see how `cardVersions.dom.test.svelte.ts` shapes that reply) and members carry `cardVersion`. Cases:
- Editing v2 with Ines on v1 and Bianca on v2 → the sentence names Bianca and not Ines; the cast line (`[data-cast-line]`) still names both books.
- Editing v2 with only a v1 member → no `[data-cast-edit-note]`; `[data-cast-line]` still present.

DOM (`cardVersions.dom.test.svelte.ts`, describe "Save as new version"): make the `requestWithInterest` mock observable (e.g. wrap it in `vi.fn` or count calls for `"lorebooks:bindingsForCharacter"`), then:
- After the staying-branch `characters:update` reply (as in the existing "staying members keep the form open…" test), `lorebooks:bindingsForCharacter` is asked again; delivering a reply whose member has `behindCard: true`, `cardVersion` v1 and `cardCurrentVersion` v2 shows the Update offer (find it by its text **Update ‹name› to card …** — read `CardUpdateOffer.svelte` and `cast/cardUpdateWords.ts` for the exact words) without remounting.
- A save from another tab (`isSaving` false — the existing "a save from another tab…" test shape) does **not** re-ask.

Mind the existing mock: `requestWithInterest: (k, _p, h) => listen(k, h)` — a re-ask replaces the handler in `listeners`, so get the handler fresh after `settle()`.

## Rules that apply (quoted from CLAUDE.md / the lane contract)

- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler."
- "views register listeners for local state and never call `toaster`" — add no toaster call.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Never pipe vitest into `head`" (the SIGPIPE leaks PGlite temp dirs).

## Stop and ask when

Anything needs a new user-visible word, a server change, a file outside the owned list, or the decided design above doesn't fit the code. Write the question in your report and stop.

## Done means

All green, with `--maxWorkers=2`:

```
npx vitest run --maxWorkers=2 src/lib/client/components/characterForms/castBannerWords.test.ts src/lib/client/components/characterForms/castEditNote.dom.test.svelte.ts src/lib/client/components/characterForms/cardVersions.dom.test.svelte.ts src/lib/client/components/characterForms/castLine.dom.test.svelte.ts src/lib/client/components/characterForms/castLineOffer.dom.test.svelte.ts
```

(If the project's vitest config needs a project flag for DOM tests, check `vite.config.ts` / `vitest.config.*` for how `*.dom.test.svelte.ts` runs and use it.) Plus `npx prettier --check` on each file you edited.

## Report

Return as your final message: changed files, the new signatures, tests run with pass/fail counts, any question, and **Noticed, not done**.
