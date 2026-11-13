# BRIEF s27-S2-cT2-w1 — card sentence grammar, `seatCardIdOfRef` parity with `seatOf`, the missing DOM tests

Worker for lane **s27-S2-cT2** (supervisor: lane-supervisor, Opus). App `/home/jody/github/serene-pub`. You are a `lane-worker` (Sonnet). Report path: return your report as your final message (the supervisor reads it); do not write a report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal
Three fixes from the scope review of lane s27-S2-client.

### 1. Grammar in `castEditWords` (`src/lib/client/components/characterForms/castBannerWords.ts` ~161)
Today: `` `…; their ${joinWords(own)} ${own.length === 1 ? "is" : "are"} their own there)` `` — so "their greetings is their own there" (bug). Rule: use **is** only when `own` is exactly ONE word and that word is singular — one of `description`, `personality`, `scenario`, `first message`, `face`. Use **are** otherwise: `greetings`, `alternate greetings`, `example dialogues` (plural nouns), or more than one word. Keep the change tiny (e.g. a set of the singular words, or test the field rather than the word). Don't change any other wording.
Tests in `castBannerWords.test.ts` (add; existing cases unchanged): own = "greetings" alone (member follows everything except firstMessage + alternateGreetings) → "their greetings are their own there"; own = "example dialogues" alone → "are"; own = one singular (e.g. personality) → "is"; own = two singulars (e.g. personality and scenario) → "are". Read the existing `castEditWords` cases and their `member()` helper first and build on them.

### 2. `seatCardIdOfRef` mirrors `seatOf` exactly (`src/lib/client/components/sessionPage/sessionPageProjections.ts` ~89–141; edit that function, its doc comment and its `SeatRefSession` interface only)
The server rule it must mirror, `src/lib/server/sessions/seats.ts` `seatOf` (doc, verbatim):
> In each form a live seat (`removed_at` null) wins over a departed one, in either table; then the character seat over the player seat; among several, the lowest `position`, then the lowest `id` (two live seats can share a member until the boot pass settles them). An envoy seat is never returned.

and its SQL orders by `coalesce(position, 0)`, then `id`, for live first (character then player), then departed (character then player). Today's client sorts character seats (live before departed), and only if none falls back to persona seats — so a **departed character seat beats a live persona seat** (wrong), a null position sorts as the payload index (wrong: null is 0), ties go to payload order (should be the seat's `id`), envoy seats are not skipped explicitly.
New behaviour for `seated-member:<memberId>`: gather every seat of both tables whose `castMemberId === memberId`, skipping a character seat with an `envoySlug` set (add optional `envoySlug?: string | null` and `id?: number | null` to the `sessionCharacters` row type and `id?: number | null` to `sessionPersonas` in `SeatRefSession` — structural, optional, so the page's session and fixtures still fit). Sort: live before departed (`removedAt` truthy = departed); then character before player; then `position ?? 0`; then `id ?? 0`; (Array sort is stable, so payload order breaks remaining ties). Return the first seat's card id (`characterId` / `personaId`), or null if that is null/absent or no seat matches. The server's `cardFormRefInCast` (`src/lib/server/pipelines/prompt/seatCards.ts` ~268–307) is the same sort over a `session_cast` read — read it as the model. `character:<id>` stays a pass-through (returns the id). Update the doc comment to state the order and that it mirrors `seatOf` and must change with it.
Existing tests in `sessionPageProjections.seatMember.test.ts` must stay green **unchanged** (they have no `id`s, so ties keep payload order). Add a new `describe("seatCardIdOfRef keeps seatOf's order", …)` to that file mirroring `src/lib/server/pipelines/prompt/seatCards.test.ts` lines 181–270 (`cardFormRefInCast keeps seatOf's order`): live player beats departed character; live character beats live player whatever the position; lowest position with null as 0; ties by lowest seat `id` (put the higher id first in the array so payload order would give the wrong answer); an envoy seat (envoySlug set, same member) is never picked; a departed character with a null `characterId` picked → null (as `seatOf` would return its null card).

### 3. DOM tests
(a) Retitle in `src/lib/client/components/characterForms/castLine.dom.test.svelte.ts`: test `"a card in no lorebook renders nothing"` → `"a card in none of your lorebooks renders nothing"`; also its file header comment "nothing for a card in no lorebook" → "nothing for a card in none of your lorebooks". (Project rule: never write "no lorebook" in code, comments, tests or copy.)
(b) New DOM test for **the editor's sentence**: `CharacterForm.svelte` renders, in edit mode, under `<CastLine>` a `<p … data-cast-edit-note>{castEdit}</p>` where `castEdit = castEditWords(castMembers)` and `castMembers` comes from the reply to `requestWithInterest("lorebooks:bindingsForCharacter", { characterId }, handleCastBindings)` (handler ignores a reply whose `characterId` differs). First try mounting the real `CharacterForm.svelte` (mode `"edit"`, a `characterId`) with the socket and interest modules mocked — the pattern is `src/lib/client/admin/sections/plugins/providedBooks.dom.test.svelte.ts` (hoisted `listeners` map; `vi.mock("$lib/client/sockets/loadSockets.client")`, `vi.mock("$lib/client/sockets/interest.svelte", …)` exporting `declareInterest`, `requestWithInterest`, `useInterest`; `vi.mock("$app/environment")`; a toaster mock). Read the form's props and its onMount/effects to see what else it asks for (`characters:get` etc.) and feed what it needs. Cases: a card in one book whose member follows some fields → the sentence names the member and book; in two books → names both books; one whose every field is retold (`followsCard: []`) → no `[data-cast-edit-note]`. Timebox this: if after a fair try the whole form cannot mount in happy-dom (imports that crash, unreasonable mocking), STOP and report what blocks it — do NOT create a wrapper component or edit `CharacterForm.svelte`; the supervisor decides.
(c) New DOM test for **the profile line**: `CharacterViewPanel.svelte` (props `characterId`, `onEdit`, `onSession`; it emits `characters:get` via `useTypedSocket` from `$lib/client/sockets/typedSocket` — note a different module path from the form's — and declares `characters:get#<id>` interest; it asks `lorebooks:bindingsForCharacter` via `requestWithInterest`), rendering `<CastLine members={castMembers} />` under the hero only when `castMembers.length > 0`. Cases: with one member → `[data-cast-line]` shows "In 1 lorebook:" and the book's name; with none → no `[data-cast-line]`. Same timebox/stop rule.
Name new files `castEditNote.dom.test.svelte.ts` and `characterViewCastLine.dom.test.svelte.ts` in `src/lib/client/components/characterForms/`.

## Files owned (only these)
- `src/lib/client/components/characterForms/castBannerWords.ts` (`castEditWords`'s verb only)
- `src/lib/client/components/characterForms/castBannerWords.test.ts` (add cases)
- `src/lib/client/components/characterForms/castLine.dom.test.svelte.ts` (the retitle)
- new `src/lib/client/components/characterForms/castEditNote.dom.test.svelte.ts`, `characterViewCastLine.dom.test.svelte.ts`
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` (`seatCardIdOfRef`, its doc and `SeatRefSession` only)
- `src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts` (add the describe)

## Files readable
Anything. Especially `src/lib/server/sessions/seats.ts` (~850–975), `src/lib/server/pipelines/prompt/seatCards.ts` (~240–307), `seatCards.test.ts` (~181–270), `CharacterForm.svelte`, `CharacterViewPanel.svelte`, `CastLine.svelte`.

## Out of scope
Any edit to `CharacterForm.svelte`, `CharacterViewPanel.svelte`, `CastLine.svelte`, other files, NOMENCLATURE, STYLE-GUIDE (the supervisor does those). No copy changes beyond is/are. Don't reformat files: `castBannerWords.ts` and `sessionPageProjections.ts` were not prettier-clean at HEAD — leave the rest of the file as it is; new files should be prettier-clean (`npx prettier --check <file>`).

## Rules (quoted)
- CLAUDE.md: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE R3 "qualify, never the bare noun"; no new exported name (none is needed).
- "Never write 'no book'/'no lorebook'" — in code, comments, tests or copy.
- Never pipe vitest into `head`. Heavy DOM tests: a failing `assert` on a happy-dom element has OOM-killed VS Code — assert on `textContent` / `querySelector(...) === null`, not on elements via `expect(el).toEqual`.

## Stop and ask when
Mounting a component needs an edit to it; a test that exists must change; a name is new; anything outside the files above.

## Done means
Green, by file: `npx vitest run src/lib/client/components/characterForms/castBannerWords.test.ts src/lib/client/components/characterForms/castLine.dom.test.svelte.ts src/lib/client/components/characterForms/castEditNote.dom.test.svelte.ts src/lib/client/components/characterForms/characterViewCastLine.dom.test.svelte.ts src/lib/client/components/sessionPage/` ; `npx tsc --noEmit -p . 2>&1 | grep -E "characterForms|sessionPageProjections"` empty. Report: changed files, tests run with counts, how each DOM test mounts (real component or blocked, and why), Noticed-not-done.
