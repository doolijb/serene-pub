# BRIEF — `s4-f-client-w2` — state owners, request doors and socket types read member form (2026-11-08)

Supervisor: lane `s4-f-client` (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34, the seat flip). You are one of two workers; w1 owns `seatIdentity.ts`, `sessionPageProjections.ts`, `+page.svelte`, `roundWaiting.ts`, `attendance.ts`, `characters.ts`, `turnFlow`, `pressRouting` — don't touch them.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Context — what the flip changes on the wire

The server is about to stop emitting card-form state owners and refs (lane s4-f-emit beside you; lane s4-f-door built the server side behind a switch, `src/lib/server/state/memberForm.ts`, off until the lead turns it on). With the switch on (read `src/lib/server/sockets/state.ts` ~620–690 for the exact owner rows):
- a character seat's owner row: `kind: "seated_member"`, `id` = its cast member id, `key` = the name slug (`castKey(member.name)`), `ref: "seated-member:<id>"`, `castMemberId`;
- a **carded** player seat's owner row: `kind: "player_seat"`, `id` = seat id, `key: "player_seat:<seatId>"` (**not** a name slug any more — f-door: "with the switch on, a carded player seat's owner row in `state:*` payloads keys as `player_seat:<id>` (not a name slug) — check every widget/client reader that matches owner rows by slug and switch it to `ref` / `key`"), `ref: "player-seat:<id>"`;
- a card-less player seat: as today (`player_seat`, key `player_seat:<id>`).
- `state.cast.byId` keys: `seated_member:<castMemberId>` for a character seat, `player_seat:<seatId>` for every player seat (`src/lib/server/state/keys.ts` `castMemberKey`); each entry carries `ref` and `castMemberId`. `state.cast[<slug>]` is still filled by name slug — two seats can share a slug (a K-2 card in both seats; two people with one name).
- With the switch off (today, and live servers in between): `session_cast` owners by card id, slug keys, `ref: "character:<cardId>"`, byId keyed by card id. **Both forms must work** — build and test against member-form fixtures AND keep every card-form test green.

## Rules (quoted; each is binding)

- Owner ruling ★K-1 (2026-11-08): "`cast.byId` key `seated_member:<id>` (mirrors `player_seat:<id>`; a stale card-key reader finds nothing rather than the wrong person)." Lead's brief: "never parse a key — K-1 keys are opaque". Look an owner/entry up by what it carries (`ref`, `castMemberId`, `key` as an opaque string), never parse an id out of a ref or a key. Card ids and member ids share one number range — every fixture must make a card id and a member id collide on purpose (card 7 ≠ member 7).
- Owner ruling ★K-2 (2026-11-08): a member may hold a character seat AND a player seat; each seat is its own owner with its own values. A lookup by `castMemberId` alone can find the wrong one of the two — prefer `ref`, then the row's own `kind`+`id`.
- f-sdk (wave 1) on the SDK side: "`player_seat` owners matched by `ref` only (never `castMemberId`: a member holding both seats would get the player seat's stats)".
- `shared/sockets/types.ts` owner unions must accept `seated_member` / `player_seat` wherever a payload carries an owner.
- ⏳ marks a card-form path kept until S5; 🚧 marks provisional names. Keep both markers accurate in the comments you touch; fix any comment in your files that says "card form until S4", "lacks `seated_member` until lane C widens it", or "never stored in S3" where it is no longer true — say what holds from the flip on.
- CLAUDE.md: browser code — no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` is not reactive — use `SvelteSet`/`SvelteMap`. Socket results are toasted only by the domain context (never `toaster` in these files). It is a **session**, never a chat.
- Decisions: decide implementation inside your files and name each choice in your report. **Do not** add new exported names, settings, events or payload fields, and do not change any refusal sentence a plugin author sees. If something needs one, stop and say so in your report.

## Files owned (edit only these)

- `src/lib/client/components/sessionPage/projections/sessionState.ts` + `sessionState.test.ts`
- `src/lib/shared/sockets/types.ts` (comments and owner/op unions only)
- `src/lib/client/components/sessionPage/requests/{setAttributeValue,setAttributeCarry,setOwnerFace,givePiece,statTrail,setTieShown,setChosenImage}.ts` + their `.test.ts` (create a test file only where one is missing and the door has member-form logic to pin)
- `src/lib/client/components/sessionPage/collects.ts` + `collects.test.ts`

Readable: anything — `src/lib/client/state/sessionState.svelte.ts` (the store; `owners` keyed by `owner.key`), `src/lib/client/components/sessionPage/projections/seatIdentity.ts` (`castEntryOf`, `castEntryOfMember` — w1 may be editing seatIdentity's message helpers; you only call these two), `src/lib/server/sockets/state.ts`, `src/lib/server/state/keys.ts`, `src/lib/shared/state/ledgerLines.ts`.

## Tasks

1. **`sessionState.ts` `castOf`**: find each cast owner row's entry by its host-filled `ref` first (`castEntryOf(byId, o.ref)`), then today's lookups (`player_seat` → `byId[o.key]`; `seated_member` → `cast[o.key] ?? castEntryOfMember(byId, o.id)`; `session_cast` → `cast[o.key]`). Drop the `(o.kind as string)` cast and its stale ⏳ comment now that `StateOwnerRow.kind` carries `seated_member`. Check the rest of the file for anything that matches owner rows by slug or assumes a carded player seat is `session_cast` (e.g. the `seat` flag, `mine`, face lookups) and make it read `ref` / `kind` / `key`.
2. **The six request doors** (`setAttributeValue`, `setAttributeCarry`, `setOwnerFace`, `givePiece`, `statTrail`, `setTieShown`): each accepts `seated_member` / `player_seat` owners already. Check each one's row lookup against the member-form owner rows above: a widget may name a seat as `{kind: "seated_member", id: <member>}`, as `{kind: "player_seat", id: <seat>}`, or (⏳, an old tab or plugin) as `{kind: "session_cast", id: <card>}`. The row found must be the asked seat's, never the other seat of a K-2 member — e.g. `setAttributeValue`'s `castMemberId === owner.id` fallback must not land on the member's player-seat row: an exact `kind`+`id` row wins, then a row whose `ref` is `seated-member:<id>`, and the `castMemberId` fallback may only match a non-`player_seat` row (a `seated_member` owner names a character seat). A ⏳ `session_cast` owner after the flip matches no member-form row; the server's door translates one (`src/lib/server/sockets/state.ts` ~225–260, `seatedOwnerAtDoor`), but the client doors that look the row up locally will refuse it first. Don't build a card→seat translation on the client: report, per door, whether a `session_cast` owner is refused locally after the flip, and leave it (the lead decides). Change only what is wrong; report each door's verdict.
3. **`setChosenImage.ts`**: `memberRef` (`seated-member:<castMemberId>`) is matched by `m.ref === named || castMemberId formats to it`. With a K-2 member in both seats, two `characters.v1` members can carry that `castMemberId`; the character seat's member (`ref` equal to `named`) must win. Make the match prefer an exact `ref`, then the castMemberId format. Keep the refusal sentence as is.
4. **`collects.ts`**: `holdsOf` reads `castEntryOf(byId, ref)` — add a member-form test (byId keyed `seated_member:<id>`, entries carrying `ref`) and change nothing unless it fails.
5. **`shared/sockets/types.ts`**:
   - Every union where a payload carries a state owner (grep `"session_cast"`) accepts `seated_member` and `player_seat`; list each union you checked.
   - `StateOwnerRow` docs: `key` (a carded player seat's is `player_seat:<id>` from the flip), `ref` / `castMemberId` host-filled on `seated_member` too; refs are member form from the flip.
   - `Sessions.Get.Response` seat rows (~4757–4771): the `ref` doc says what it is from the flip (`seated-member:<castMemberId>` / `player-seat:<id>`; ⏳ `character:<cardId>` before). `castFaces` / `castNames` / `castSpriteSets` "keyed by the card the seat holds until S4" → ⏳ until S5 (card→seat lookups on card columns stay until S5, plan §34.1).
   - The `State.Owner` doc on `seated_member` ("never stored in S3") → stored from the flip.
   - The ledger `library.op` union (~17154) lists `"attach-lorebook"`: f-sdk asked to narrow it "if no stored-row reader needs it — check `ledgerLines`". `src/lib/shared/state/ledgerLines.ts` still reads old `"attach-lorebook"` rows (⏳, rows written before 0.6 removed the op) and those rows reach the client in this payload — so **keep it**, with a ⏳ comment saying so. (Supervisor's decision; report it.)

## Tests (Done means)

- `sessionState.test.ts`: member-form owner rows (a `seated_member` row, a carded `player_seat` row keyed `player_seat:<id>`, a K-2 member in both seats with one name slug) each get their own seat's values; card-form rows still pass.
- Each changed door's test: a member-form owner finds the asked seat's row; a K-2 member's `seated_member` owner finds the character seat's row, not the player seat's.
- `setChosenImage.test.ts`: K-2 member — the exact `ref` wins.
- `collects.test.ts`: member-form `holdsOf`.

Run, capped, logged to the scratchpad (never pipe vitest into `head`):

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/components/sessionPage/projections/sessionState.test.ts src/lib/client/components/sessionPage/collects.test.ts src/lib/client/components/sessionPage/requests/setAttributeValue.test.ts src/lib/client/components/sessionPage/requests/statTrail.test.ts src/lib/client/components/sessionPage/requests/setTieShown.test.ts src/lib/client/components/sessionPage/requests/setChosenImage.test.ts <any new door test files> --maxWorkers=2 > \$S/s4-f-client-w2-tests.log 2>&1; echo test-exit=\$? >> \$S/s4-f-client-w2-tests.log"
```

Don't run tsc/check yourself; the supervisor does.

**Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit (`types.ts` is 18k lines: never `--write` it whole). If a file fails the check only on lines you didn't touch, leave it and say so.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never edit a server file.

## Report

Return in your final message: changed files; each door's verdict (changed / fine, why); every union checked in `types.ts`; each implementation choice; tests run with pass/fail counts; anything that needed a file you don't own under **Needs another file**; **Noticed, not done**.
