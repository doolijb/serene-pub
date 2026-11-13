# REPORT cv-sdk (2026-11-06)

Status question: none was relayed. The lane is built. In the SDK: the character profile shape, `CastMemberV1`, `core:query/cast-member@1`, `core:outlet/update-cast-member@1`, and `update-character@1` now names the profile fields. In the app: host bindings for the new query and outlet. I ran `sdk:build` once, while no vitest and no `vite dev` was running, and it exited 0. The whole-app `tsc` is clean (0 errors). The lane's targeted tests pass. You need to add **two pins to the app's `registryHashes.test.ts`** (below). Nothing was committed.

## Names and signatures (all 🚧, `@experimental`)

**SDK, NEW `sdk/src/characterProfile.ts`** (exported from `sdk/src/index.ts`, after `participants.js`):
- `CharacterGreeting { text; groupOnly? }`
- `CharacterCreatorNotes { text; lang?; variants }`
- `CharacterProfileV1`: the app's `shared/characters/profile.ts` field for field, with likeness and timbre as inline anonymous types (no new exported names).
- `CHARACTER_PROFILE_FIELDS`: the 17 names in the app's order.
- `CharacterProfileField`
- `CastMemberV1 { castMemberId, cardId, cardVersion: {id, number, label} | null, cardless, behindCard, follows: CharacterProfileField[], profile }`

`castMember.sdkShape.test.ts` checks that the SDK and app shapes stay identical: the runtime field lists are equal, and the profile types are equal (`expectTypeOf`).

**Contracts:**
- `castMember`, `core:query/cast-member@1` (label _Cast member_).
  - In: `scope` (`S.sessionScope`) and `member` (`S.json`).
  - Out: `main` (`S.json`, a `CastMemberV1`).
  - Not optional.
- `updateCastMember`, `core:outlet/update-cast-member@1` (label _Change a cast member_).
  - `effects: 'write'`, `review: { fields: ['changes'] }`, `timeoutMs` 10000.
  - In: `member` and `changes`.
  - Out: `main` and `castVersionId` (`S.writeResult`).
  - No event. No core genre or spec places it (P1).
- `updateCharacter`: only the doc comment changed. It now lists `name, description, personality, scenario, greetings, exampleDialogues`, says the change writes the card's current version, and says `first_mes` / `mes_example` are no longer accepted ("New names now, old removed"). Ports and review are unchanged, so its hash did not move.

**App, NEW `src/lib/server/pipelines/runtime/castMember.ts`** (a leaf; uses the global `Db`):
- `class CastMemberRefusal extends Error`
- `resolveCastMember(db, sessionId, member: unknown): Promise<number>`
  - Takes `seated-member:` or `player-seat:` (via `seatOf`), or a numeric id of a member in the session's lorebook or its overlay chain (`overlayChainOf`).
  - An overlay row is refused, as is `character:` and any other form.
- `readCastMember(db, sessionId, member): Promise<CastMemberV1>`: reads with `membersAsRead(…, { sessionId })` and builds `profile: profileOf(read)`.
- `writeCastMember(db, { sessionId, member, changes, runId?, messageId? }): Promise<{ id, castVersionId, castMemberId, coalesced }>`
  - Gate: `loreWriteRefusal` (`writes.lore`).
  - `changes` must be profile fields only. Each value is either `{ follow: true }` or a value the profile's own normaliser leaves unchanged (a greeting's `groupOnly: false` counts as absent), and the normalised value is what gets written.
  - `name` must be non-empty.
  - Guard ★cv-sdk-1 (below).
  - Then one `db.transaction(tx => writeCastVersion(tx, { …, writtenBy: run:<id> | session:<id>, session: { id, messageId } }))` call, using only `tx`. The writer routes the lore write mode itself, so Review and Off land on the overlay row. It anchors to the turn and coalesces.

## Changed files

**SDK** (`/home/jody/github/serene-pub-sdk`):
- NEW `sdk/src/characterProfile.ts`
- `sdk/src/index.ts`: one export line.
- `contracts/src/queries.ts`: `castMember`, after `castPresences`.
- `contracts/src/outlets.ts`: `updateCastMember` after `updateCharacter`, plus `updateCharacter`'s doc comment.
- `INTEGRATING.md`: new **§1k Character profile and cast members**, before §2.
- NEW `sdk-tests/castMember.test.ts` (4 tests).

**App** (`/home/jody/github/serene-pub`):
- NEW `src/lib/server/pipelines/runtime/castMember.ts`, `castMember.int.test.ts` (8 tests) and `castMember.sdkShape.test.ts` (2 tests).
- `src/lib/server/pipelines/runtime/host.ts`, two hunks:
  - `case "cast_member"` at ~5712, in the read switch.
  - `case "core:outlet/update-cast-member"` at ~10891, in the commit switch. It passes `turnMessageId ?? turnMessageOf(scope.runId)`, then calls `lorebookReads.clear()`.
  - Both map `CastMemberRefusal` to `HostScopeError`.
- `src/lib/server/pipelines/runtime/bindings.ts`: two bindings, at ~4654 and ~8757.
- `src/lib/server/pipelines/runtime/bindingTypes.ts`: **one line** `| "cast_member"` in `HostTable` (~241). ⚠ This file is not named in my brief. The new read can't be typed without it. Nobody else had it modified, and the hunk is one line. Revert it if you'd rather own it.
- Briefs: `plans/briefs/BRIEF-cv-sdk-w1.md` and `BRIEF-cv-sdk-w2.md`.

## Tests
- `npm run sdk:test`, after the build: 4408 run, 4406 pass, **2 fail, both from other lanes' uncommitted work** and outside my files:
  - `deriveDontSpell.test.ts`: `shared/speakMessage.ts` uses `($: any)` and builder callbacks typed `any`.
  - `surface.test.ts` "every export is tagged": `CREATE_SESSION_PERSONA_DESCRIPTION_MAX` and `CREATE_SESSION_PERSONA_NAME_MAX` are untagged.
  - The new `castMember.test.ts` passes. **No SDK golden moved**: the coreCatalog registry digest `b937273e348af471` still passes, so I re-pinned nothing.
- App, with `--maxWorkers=2`, after the build:
  - All pass: `castMember.int.test.ts` (8), `castMember.sdkShape.test.ts` (2), `versionsWriter.guard`, `frozenColumns.guard`, `bindingCompat`, `readsPairing`, `declaredReads`, `specHashes` and `bootstrap.int`.
  - `registryHashes.test.ts` fails as expected: "records every type this build publishes".
- `npx tsc --noEmit -p .`: 0 errors.
- Prettier: my new files and `bindingTypes.ts` are clean. `host.ts`, `bindings.ts`, `queries.ts`, `outlets.ts` and `INTEGRATING.md` were already failing whole-file checks, and I left them alone because other lanes' lines are in them.
- No `/tmp/serene-pub-vitest-castmember-*` dirs were left behind, and I deleted none.

## For the lead: pins to add (`src/lib/server/pipelines/boot/registryHashes.test.ts`, `PUBLISHED_HASHES`)
```
// New 2026-11-06 (cv-sdk, character versions wave 3): one cast member as the session reads it, and a session's story write to one (review on `changes`).
"core:query/cast-member@1": "2a6634b9c55be",
"core:outlet/update-cast-member@1": "b14c341a7644",
```
- `specHashes`: no repins (no spec places the new definitions).
- `update-character@1`: its pin is unchanged (only display text changed).

## For the lead: NOMENCLATURE §25 rows (I don't own NOMENCLATURE; queued, append verbatim or reword)
- `| (new) | 🚧 **`core:query/cast-member@1`** (_Cast member_) — one cast member as the scope session reads them; `member` = `seated-member:<id>` · `player-seat:<id>` · a cast member id of the session's lorebook or its own notes; out `main` = 🚧 **`CastMemberV1`** `{castMemberId, cardId, cardVersion, cardless, behindCard, follows, profile}` (`@serene-pub/sdk`; host: `pipelines/runtime/castMember.ts` `readCastMember` over `membersAsRead`) | plan §32 §10 / §33; lane cv-sdk 2026-11-06 |`
- `| (new) | 🚧 **`core:outlet/update-cast-member@1`** (_Change a cast member_) — `member` + `changes` `{[character profile field]: value \| {follow: true}}` (review on `changes`); one story write through `writeCastVersion` (anchored to the turn, coalesced, routed by `writes.lore` and the lore write mode); out `castVersionId`; no core genre places it; no event yet | plan §32 §10 / §33; lane cv-sdk |`
- `| the character profile lived only in the app | `CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`, `CharacterProfileField`, `CharacterGreeting`, `CharacterCreatorNotes` are now also exported by `@serene-pub/sdk` (`sdk/src/characterProfile.ts`), mirroring `shared/characters/profile.ts` field for field (`castMember.sdkShape.test.ts` pins it) | lane cv-sdk |`
- `| `update-character@1` `changes`: name, description, personality, scenario, first_mes, mes_example | the character profile names: name, description, personality, scenario, greetings, exampleDialogues; `first_mes` / `mes_example` removed (owner "New names now, old removed") | §33.6; SDK docs lane cv-sdk (host: cv-writers) |`

## Open ★
- **★cv-sdk-1, what a run may not change** (built conservatively, provisional). `update-cast-member@1` refuses a change that would make `faceMediaId`, `likeness.imageMediaId`, `timbre.voice` or `timbre.narrationVoice` differ from what the session reads now. Unchanged values and `{ follow: true }` pass.
  - Why: a media id from a run could point at any `files` row, including another person's. `timbre.voice` is admin-only (`canPickVoice`, A1).
  - Recommendation: keep the refusal until a file-ownership check exists for faces and likeness images.
  - Trade-off: a genre cannot give a cast member a generated portrait through this outlet.
- **★cv-sdk-2, copy** (provisional; for the owner's wave-3 copy batch):
  - Labels: _Cast member_ and _Change a cast member_.
  - Refusal sentences (the host prefixes each with `<node key>: `):
    - `'<ref>' is not seated in this session.`
    - `'<ref>' voices no cast member in this session.`
    - `Cast member <n> does not exist.`
    - `Cast member <n> is this session's notes on cast member <m>; name cast member <m> instead.`
    - `Cast member <n> is not in this session's lorebook.`
    - `A cast member is named by a seated member ('seated-member:<id>'), a player seat ('player-seat:<id>') or a cast member's id.`
    - `Cast member <id> is not in this session's cast.`
    - `'changes' must be an object of character profile fields.`
    - `'changes' names nothing to change, so there is nothing to write.`
    - `'<key>' is not a character profile field, so this write does not change it.`
    - `A cast member's 'name' must be a non-empty text.`
    - `'<key>' is not in the shape a character profile keeps for it; give it as the profile reads it, or { follow: true }.`
    - `A face / A likeness image / A voice is chosen by a person, not by a run, so this write does not change it.`
    - The `writes.lore` refusal is `loreWriteRefusal`'s own sentence.
- **★cv-sdk-3, plugins can read `timbre.voice` and `narrationVoice`.** The query's `profile` shows these voicebank slugs, because the shape matches the app exactly as ruled. They aren't connections, so R53 doesn't apply, but they are admin-chosen. Recommendation: leave them visible. Alternative: blank both in the query's output.

## Decisions I made (inside scope)
- The host logic lives in a new module, so `host.ts` only gets two thin cases.
- `member` is one `S.json` port on both the query and the outlet, not a new shape.
- `character:` refs are refused, because the brief lists only the three forms.
- A departed seat still resolves.
- Overlay row ids are refused, with a sentence naming the member to use instead.
- A `timbre` change that omits a voice the member has counts as changing the voice, so it is refused.
- The writer's own errors (for example a follow on a card-less member, or no turn) propagate unchanged.

## Noticed, not done
- No run artifact is recorded for a cast-version write. `receipts.ts` `RunArtifact.kind` has no cast-version kind, and adding one is a new name. The run receipt won't list the change.
- The outlet emits no socket update. An open member page or cast panel may not refresh until something else updates it. `ties.ts`'s cast-state write has the same gap.
- `profileOf` accepts any object for `creatorNotes`, `likeness` and `timbre` without checking the members. So the outlet's shape check is shallow for those three fields.
- SDK `widgets.ts`: the applet request `update-character` still takes `firstMessage`, the old name. It wasn't in this brief, but the owner's "new names now" ruling likely covers it.
- §32 §10's `unseatedRefusal` helper and the rewording of host refusals (~2618 / ~2806 / ~7354, `NOT_IN_CAST`) aren't in this brief and aren't built.
- `guides/forms-and-effects.md` §writes.lore could mention that cast members are part of the lore a `lore: false` genre never writes.
