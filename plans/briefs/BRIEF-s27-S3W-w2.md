# BRIEF s27-S3W-w2 — the widget request doors take cast-member identity; the preview fixtures carry it

Worker for lane **s27-S3W** (supervisor: Opus). App `/home/jody/github/serene-pub`. You type; you decide nothing outside this brief. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`; don't run one.)
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Why (the stage, in brief)
Seat-cast programme, stage S3: **consumers stop building refs or keys from card ids and read host-filled identity instead**, so they work on today's card-keyed data **and** on S4's member-keyed data. Rules from the lane contract (quoted):
1. "**Host fills, consumers read.** … fall back to today's card form only when a field is absent." SDK `castMemberId` = **the seat's cast member**.
2. "**Refs in accept `seated-member:`** … so nothing stored changes form in S3." Owners of kind `seated_member` (id = a cast member id) are accepted; the server translates them (`storedSeatOwner`).
3. "**Look up, never parse.** … never parses a card id out of a ref or a key, and never does `Number(key)`." Formatting a known id and comparing (`` `seated-member:${m.castMemberId}` === ref ``) is fine; extracting a number from a ref is not.
4. "**Tests on both shapes:** today's data (output unchanged) and S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)."
5. "**No stored key changes, no migration, no removal.**"
6. "Anything users or plugin authors see that isn't ruled is a ★." Refusal sentences in these doors are read by widget authors: keep the existing words where a test pins them; new words go in your report, listed, so the supervisor can flag them.
CLAUDE.md: browser code runs on plain-http LAN addresses and phones — **no `crypto.randomUUID`, no `navigator.clipboard`**; it is a **session**, never a *chat*; never write "no book"/"no lorebook". Existing tests in your files stay green **unchanged**; a test you must edit is a finding — say why.

## Files owned (edit only these)
- `src/lib/client/components/sessionPage/requests/setChosenImage.ts` (+ `setChosenImage.test.ts`)
- `src/lib/client/components/sessionPage/requests/statTrail.ts` (+ test)
- `src/lib/client/components/sessionPage/requests/setTieShown.ts` (+ test)
- `src/lib/client/components/sessionPage/requests/setAttributeValue.ts` (+ test)
- `src/lib/client/components/componentEditor/previewFixtures.ts`
Everything else is read-only (`setOwnerFace.ts`, `givePiece.ts`, `setAttributeCarry.ts` were already widened by the lead — read them as the pattern). Files may be dirty with other lanes' work: edit by hunk, never reformat, never `prettier --write` an existing file.

## SDK shapes you build on (already in `@serene-pub/sdk`, read `../serene-pub-sdk/sdk/src/widgets.ts`)
- `set-chosen-image` params: `{ memberRef?: \`seated-member:${string}\`; characterRef?: string; mediaRef: string | null }` — "name one; `memberRef` becomes required in S5". ⏳ `characterRef`.
- `SessionCharacterV1`: `ref` (the seat's participant ref as the host fills it — today `character:<cardId>`, S4 `seated-member:<castMemberId>`), optional `castMemberId`, optional `cardId`.
- `SessionStateOwnerV1`: optional `ref`, `castMemberId`. `OwnerRefV1.kind` includes `'seated_member'`.
- App socket types (`src/lib/shared/sockets/types.ts`, read-only for you): `StatTrail.Params.owner.kind` already includes `"seated_member"`; `Sockets.State.StateOwnerRow` (`~16760`) does **not** yet (lane C fills owner rows' `ref`/`castMemberId`) — read `castMemberId` off a row structurally (`(o as { castMemberId?: number | null }).castMemberId`).

## 1. `setChosenImage.ts` (★S3-8 ruled: Scene Portraits keyed by cast member; parameter `memberRef`)
- Accept 🚧 `memberRef` beside ⏳ `characterRef`: `memberRef` when it is a string, else `characterRef`.
- Shape checks, before anything else (as today): a `memberRef` must be a string beginning `seated-member:` with something after it; a `characterRef` keeps today's `^character:\d+$` check. A bad or missing ref throws a sentence that still contains `character:<id>` (the existing test pins that substring) and names `memberRef` first, e.g. `set-chosen-image names a member as memberRef (seated-member:<id>), or ⏳ characterRef (character:<id>)` — drop the ⏳ glyph from the runtime sentence if it reads oddly; list the final words in your report.
- Find the member in `d.characters().members` — never parse: for `memberRef`, the member whose `ref === memberRef`, or whose `castMemberId != null` and `` `seated-member:${castMemberId}` === memberRef ``; for `characterRef`, `ref === characterRef` (today). Not found → `"that character is not in this session"` (unchanged words).
- **Store under the found member's `ref`** — the form the host emits now (card form in S3, member form after S4's flip; S4's boot pass rekeys old lines). So nothing stored changes form in S3. Update the doc comment and the `// A ref holds no =` comment to say this.
- Tests: today's (characterRef stores `character:3=…` exactly as now); a `memberRef` `seated-member:31` for a member `{ ref: "character:3", castMemberId: 31 }` stores `character:3=…`; S4 shape (member `{ ref: "seated-member:31", castMemberId: 31, characterId: 7 }` beside another member `{ ref: "seated-member:7", castMemberId: 7, characterId: 31 }`) — `memberRef: "seated-member:31"` stores `seated-member:31=…` and touches nothing of member 7; a `memberRef` naming nobody refuses; a bad memberRef shape refuses.

## 2. `statTrail.ts`
- `OWNER_KINDS` gains `"seated_member"`; the refusal sentence lists it (keep the substring `names its owner`). The owner goes to the server as given (`sessions:statTrail` reads it in through `storedSeatOwner`).
- Test: a `seated_member` owner reaches the read unchanged; today's kinds unchanged.

## 3. `setTieShown.ts`
- Accept `kind: "seated_member"` beside `session_cast` / `player_seat`; widen `TieShownWrite`'s owner kind union to match (check it still type-checks against `Sockets.State.ShowTieSide.Params`; if that type refuses `seated_member`, cast at the call with a comment and report it — the server's `state:showTieSide` handler is lane C's and is being asked to accept it).
- Keep the refusal words (`whose side` is pinned). Test: a `seated_member` side is written through as given.

## 4. `setAttributeValue.ts`
- `SESSION_LAYERS` gains `"seated_member"`; update the refusal sentence only if it names the kinds (it doesn't today — leave it).
- The owner row lookup (~96): a `seated_member` owner `{ id: M }` matches the row with `kind === "seated_member" && id === M`, **or** a row whose host-filled `castMemberId === M` (today a `session_cast` row). Today's kinds match exactly as now.
- **Write with the matched row's own `{ kind, id }`** — the owner as the page's state knows it (`session_cast` + card id today), so the store's local bookkeeping and the server see the stored form; say so in a comment. (Today's owners: the row's kind/id equal the asked ones, so nothing changes.)
- Tests: today's owners unchanged; S4 shape — rows `{ kind: "session_cast", id: 7, castMemberId: 31 }` and `{ kind: "session_cast", id: 31, castMemberId: 7 }` (colliding ids) — a `seated_member` 31 owner writes to the first row (`{ kind: "session_cast", id: 7 }`), never the second; a `seated_member` owner whose member no row carries → `"that owner is not in this session"`.

## 5. `previewFixtures.ts` (the component editor's preview data)
- `PREVIEW_CHARACTERS` members gain `castMemberId` and `cardId` (e.g. Mira: card 11 / member 41; Wren: card 12 / member 42); keep `ref: \`character:${characterId}\`` (the form a host emits today) — or take a `ref` argument; your choice, keep it obvious.
- `PREVIEW_SESSION_STATE.owners` cast rows gain `ref` and `castMemberId` matching those members (SDK `SessionStateOwnerV1` fields).
- Run the component editor tests that read the fixtures: `src/lib/client/components/componentEditor/componentEditor.test.ts` (and any other test importing `previewFixtures` — grep).

## Tests
From the app root, each file named (never pipe into `head`):
`npx vitest run src/lib/client/components/sessionPage/requests/setChosenImage.test.ts src/lib/client/components/sessionPage/requests/statTrail.test.ts src/lib/client/components/sessionPage/requests/setTieShown.test.ts src/lib/client/components/sessionPage/requests/setAttributeValue.test.ts src/lib/client/components/componentEditor/componentEditor.test.ts src/lib/client/components/sessionPage/remoteScenePortraits.dom.test.ts src/lib/client/components/sessionPage/remoteStateWidgets.dom.test.ts`
Then `npx tsc --noEmit -p .` — report errors in your files; list others' separately (the old `arrangeCanvas.dom` error is known).

## Report (final message)
Changed files; each door → what it now accepts and what it stores/sends; the exact new refusal sentences; tests run with counts (both shapes); any existing test you had to edit and why; tsc result; assumptions; Noticed, not done.
