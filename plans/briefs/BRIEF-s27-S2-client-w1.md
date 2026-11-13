# BRIEF s27-S2-client-w1: the card shows where it lives, and the bindings payload's `memberName` is fixed

Lane **s27-S2-client** (supervisor: Opus), worker **w1** (Sonnet). App `/home/jody/github/serene-pub`. Your report goes to your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Background
A character **card** seeds a **cast member** in each lorebook it is in; while linked, the member reads the card's fields unless it tells a field in its own words (its **retold** fields, NOMENCLATURE §8). Owner direction 2026-11-05: *"We can list lorebooks a card is linked in from their profile."* The card editor already shows a cast line, _In 2 lorebooks:_ … (`characterForms/castBannerWords.ts`, the `castLine` snippet in `CharacterForm.svelte` ~2100–2125, fed by `lorebooks:bindingsForCharacter`). The payload's `members[]` rows already carry `followsCard: RetoldField[]` (the fields that member still reads from the card) and `memberName`.

## Items
1. **Fix `memberName` on the server** — `src/lib/server/sockets/lorebooks.ts`, `lorebookBindingsForCharacterHandler` (~1325–1400). Only these lines: the `characters.findFirst` `columns` gain `name: true, nickname: true`; the members map's `memberName` becomes `memberShownName(b, character)` (import `memberShownName` from `$lib/shared/lorebooks/memberIdentity`; drop the `ownNameValue` import only if nothing else in the file uses it). That is the one name rule `memberAsRead` reads by (own name/nickname over the card's, then `resolveCharacterName`: nickname || name). It no longer uses the binding's synced `name` copy, which can be empty after a failed sync. Touch nothing else in that file (it is shared with other lanes; re-read the hunk right before editing; never run prettier on it).
2. **Existing test that follows the payload** — `src/lib/server/lorebooks/retold.int.test.ts`, test "sockets > updateBinding refuses a malformed retold…": its `toEqual` on the banner member lists 4 keys; S2core added `followsCard` and `memberName`. Add those two keys with the values the fixture produces (run it, read the received object, confirm they are right by the rule above). Change nothing else in that file.
3. **New int test** for the handler's `memberName`: (a) a member with `own_name` → its own name (and an own nickname wins over it, by `memberShownName`); (b) a member whose synced `name` is `""` and no own names → the card's shown name (card nickname if it has one, else its name). Put it in a new file `src/lib/server/sockets/lorebooks.memberName.int.test.ts`, following the setup of an existing int test that calls `lorebookBindingsForCharacterHandler` (grep `bindingsForCharacter` under `src/lib/server/**/*.int.test.ts`; S2core added one). Int tests that touch the DB get a 60 s timeout.
4. **One cast line component.** Move the `castLine` snippet's markup out of `CharacterForm.svelte` into a new `src/lib/client/components/characterForms/CastLine.svelte` (props: `members: CastBannerMember[]`; it reads `getContext("panelsCtx")` itself and opens a member exactly as `openCastMember` does today; renders nothing when `castBannerWords(members)` is null). Keep the `data-cast-line` attribute, classes, title text and aria-label byte for byte. `CharacterForm.svelte` renders `<CastLine members={castMembers} />` where the snippet was rendered. Extend `CastBannerMember` with `followsCard: CastBannerRetoldField[]` and `memberName: string` (both on the wire already).
5. **The line on the card's profile/view** — `src/lib/client/components/characterForms/CharacterViewPanel.svelte`: ask `lorebooks:bindingsForCharacter` for the shown card the same way CharacterForm does (`requestWithInterest`, the `characterId` check in the handler, reset to `[]` when the id changes) and render `<CastLine>` directly under the hero's name/subtitle area (find `DetailHero` usage; put it right after the hero, inside the same column, before the tabs). ★ placement (built as recommended; the supervisor flags it).
6. **The editing sentence** — pure words in `castBannerWords.ts`, new export `castEditWords(members): string | null`, rendered in `CharacterForm.svelte` in edit mode directly under the `<CastLine>` as `<p class="text-surface-600-400 text-xs" data-cast-edit-note>{sentence}</p>` (only when non-null).
   Rules:
   - Only members with `followsCard.length > 0` count (editing changes them). None → `null` (a card whose every field is retold everywhere shows no sentence; a card in no lorebook shows none).
   - Group those members, in payload order of first appearance, by (`memberName`, the set of `followsCard`). Each group says `{memberName} in {book names}` with book names joined "A", "A and B", "A, B and C" (no Oxford comma). Groups are joined the same way.
   - A group whose `followsCard` holds all 7 fields (`description, personality, scenario, firstMessage, alternateGreetings, exampleDialogues, face`) gets no parenthetical. Otherwise it gets ` (their {followed}; their {retold} {is|are} their own there)`, where `{followed}` is its `followsCard` and `{retold}` the other fields of the 7, each listed in `FIELD_ORDER` with `RETOLD_FIELD_WORDS`, joined "a", "a and b", "a, b and c"; **except** when both `firstMessage` and `alternateGreetings` are in the same list they are said once as `greetings` at `firstMessage`'s place. `is` for one field (greetings counts as one), `are` for more.
   - The sentence: `Editing this changes ` + groups + `.`
   - Examples (tests must pin these): two members named Bianca in "Porto Alto" and "The Shared House", both following everything but personality → `Editing this changes Bianca in Porto Alto and The Shared House (their description, scenario, greetings, example dialogues and face; their personality is their own there).` One member following everything → `Editing this changes Bianca in Porto Alto.` Bianca in Porto Alto following all, Bee in Lisbon following only description → `Editing this changes Bianca in Porto Alto and Bee in Lisbon (their description; their personality, scenario, greetings, example dialogues and face are their own there).`
   - Copy is ★ (built as recommended; the supervisor flags it). Sentence case, no other words.
7. **Docs** — `docs/characters.md`, the paragraph starting "A card is a starter" (~line 90): say the same line now shows on the character's profile too, and that the edit form says under it which cast members editing changes and which of their parts are their own (one or two sentences, user-facing, plain; quote the sentence shape in italics as the paragraph does). Never write "no lorebook"/"no book".
8. **Tests**
   - `castBannerWords.test.ts`: add `castEditWords` cases (the three examples; none counting → null; empty/null members → null). Existing cases unchanged.
   - New DOM test `src/lib/client/components/characterForms/castLine.dom.test.svelte.ts` (find an existing `*.dom.test.svelte.ts` in `characterForms/` — e.g. `VoiceTab.dom.test.svelte.ts` — and follow its mount/render setup): `CastLine` renders the lead and book names for a card in one book and in two; renders nothing for `[]`. If mounting `CharacterViewPanel`/`CharacterForm` is impractical, test the sentence via `castEditWords` and the line via `CastLine` and say so.
   - Run: `npx vitest run src/lib/client/components/characterForms src/lib/server/lorebooks/retold.int.test.ts src/lib/server/sockets/lorebooks.memberName.int.test.ts` (never piped into `head`). All green; existing tests unchanged except item 2's expectation.
   - `npx tsc --noEmit -p . 2>&1 | grep -E "characterForms|sockets/lorebooks|retold.int|memberName"` → nothing. `npx prettier --check` on new files only.

## Files owned (edit only these)
`src/lib/client/components/characterForms/{castBannerWords.ts,castBannerWords.test.ts,CastLine.svelte,castLine.dom.test.svelte.ts,CharacterForm.svelte,CharacterViewPanel.svelte}`, `src/lib/server/sockets/lorebooks.ts` (item 1's lines only), `src/lib/server/lorebooks/retold.int.test.ts` (item 2 only), `src/lib/server/sockets/lorebooks.memberName.int.test.ts` (new), `docs/characters.md` (that paragraph).
Readable: anything. Not `src/lib/shared/sockets/types.ts` (the supervisor already updated `memberName`'s doc there), not NOMENCLATURE (the supervisor writes §25).

## Rules (quoted from CLAUDE.md, NOMENCLATURE, the lane contract)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new setting, flag, event or exported name beyond `castEditWords` and the `CastLine` component.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." (Use `requestWithInterest` as CharacterForm does; no toasts.)
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- NOMENCLATURE R1 one word one meaning; R3 qualify; it is a **session**, never a chat. Copy: "Labels are sentence case. Buttons say what happens." (STYLE-GUIDE §1.8.) Muted 12px help line = `text-surface-600-400 text-xs` (as the cast line).
- "Every session has a lorebook … Never write "no book", "no lorebook", "bookless", "reads no lorebook" in code, comments, tests or copy."
- Int tests touching the DB: 60 s timeout. Never pipe vitest into `head`.
- No static `$lib/server/db` import in a module a test mocks; pass `db`.

## Stop and ask (in your report) when
A test outside item 2 must change; a new name beyond the two above seems needed; the handler needs more than the lines in item 1.

## Report
Changed files, tests run with counts, decisions you took, Noticed-not-done.
