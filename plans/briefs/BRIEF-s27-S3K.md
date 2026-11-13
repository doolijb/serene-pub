# BRIEF s27-S3K — the SDK learns the cast member (seat-cast programme, stage S3, first lane)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md`; plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §27 rulings, **§29 (the S3 plan) and every bullet after it** — the challenger's five objections and the **owner's rulings of 2026-11-05 late** (they override §29 where they differ), including **"Everything in session is cast -> active card."**; `plans/briefs/INVENTORY-s27-S3-2026-11-05.md` §1 and §5; `../serene-pub-sdk/INTEGRATING.md` by section (§1c, §1d, §1f); NOMENCLATURE §1, §24 and the §25 seat rows. Lane id **s27-S3K**. One or two workers (Sonnet). SDK repo `/home/jody/github/serene-pub-sdk` — **never `git checkout` / `restore` / `stash` there; most of it is uncommitted.** Concurrent lanes **s27-S2b** and **s27-S2c** edit the app only; don't touch the app except as allowed below.

## What S3 does (owner: removal in S5, after the flip)
S3 **adds**; nothing is removed or renamed away. Old forms stay, marked ⏳ "removed in S5".
1. **Grammar** (`sdk/src/participants.ts`): `ParticipantRef` / `ParsedParticipantRef` gain 🚧 `seated-member:${number}`; `parseParticipantRef`, `formatParticipantRef`, `isParticipantRef`, `canonicalParticipantRef` handle it; error sentences name it. `character:` stays, ⏳.
2. **Owner kinds:** `OwnerRefV1.kind` (`widgets.ts`) and `TurnOwner.kind` (`turnLock.ts`) gain 🚧 `seated_member`; `session_cast` ⏳.
3. **Cast entries** (ruled 11-05: "cast entries carry `castMemberId` + optional `cardId`"): `SessionCharacterV1` — `ref` widens to `ParticipantRef`, adds `castMemberId: number | null` and `cardId: number | null` (the member's **active card on the timeline**; `characterId` ⏳); `SessionCastV1` rows (`participants.ts` ~385–430) `sessionCharacters[]` / `sessionPersonas[]` gain host-filled `ref`, `castMemberId`, `cardId`; `ConversationCastV1` gains `ref` + `castMemberId`; `AttendeeV1.personaRefs` widens to `ParticipantRef[]`; `SessionSceneImageV1.ref` widens.
4. **Owners (★S3-2 ruled):** `SessionStateOwnerV1` gains `ref` + `castMemberId`.
5. **Messages (★S3-3 ruled: `castMemberId` only, no speaker ref):** `MessageV1`, the lane `latest`, and `TurnHistoryMessage` (`turnOrder.ts`) gain `castMemberId: number | null`. `senderRefOf` / `spokenRefsSince` take an optional cast lookup (castMemberId → the seat's `ref`) and prefer it, falling back to today's card form; a test on S4-shaped history (member refs, `player-seat:` for carded player seats) and on today's shape (unchanged output).
6. **Sprite choices (★S3-4 ruled: "Cast member id, cascade to a card based on active card on the timeline and cast member configuration"):** `sprite-choices@1` (`shapes.ts` and its contract) names `castMemberId`; the card the art comes from is documented as a cascade (the member's own sets per its configuration, else the card active on the timeline); `characterId` ⏳ (S5).
7. **Scene Portraits (★S3-8 ruled):** `set-chosen-image` gains `memberRef` (a `seated-member:` ref); `characterRef` ⏳ (accepted until S5). The widget's help text in `core-catalog/src/registry/widgets.ts` (~506–519) is lane G's — leave it.
8. **Docs:** `contracts/src/queries.ts` `session-state@1` prose (each `cast.byId` entry carries `ref`, `castMemberId`, `cardId`; translated kinds add `seated_member`), `CastChangePayload.ref` doc (`events.ts` ~1480, already stale), `INTEGRATING.md` §1c/§1d/§1f, every 🚧/⏳ mark.
9. **Tests:** `sdk-tests` for the grammar (round trips, refusals), the owner kinds, `turnOrder` both shapes, and the `@1` shape additions. Run `npm run sdk:test` (from the app root). Golden or hash tests that move because of type-only changes: say so; core-catalog content does not change in this lane.
10. **Build:** when the lane's tests pass, check `pgrep -af "vite dev"` and `pgrep -af vitest`; if no serene-pub dev server and no vitest runs, run `npm run sdk:build` from the app root, then `npx tsc --noEmit -p .` in the app (the app must still compile — additive types). If a dev server is up, report "blocked on your dev server" and stop before the build.

## Files owned
`../serene-pub-sdk/sdk/src/**` (the files above), `../serene-pub-sdk/contracts/src/**` (the docs/types above), `../serene-pub-sdk/INTEGRATING.md`, `../serene-pub-sdk/sdk-tests/**` (new and the grammar/turn-order tests), the app's `NOMENCLATURE.md` §25 (the SDK names), the app's `src/lib/shared/sockets/types.ts` only if an SDK type change forces it (owner-kind unions gaining `seated_member`).
## Out of scope
core-catalog (lane G), the app's gates and host fields (lane C), Mundi (mundi-27a); removing any old name (S5).
## Rules (quote into every worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24 (new names qualified, 🚧/⏳ marked, §25 rows in the same change); "No @2 bumps before 0.7" — `@1` ids evolve in place; targeted tests only; never pipe vitest into `head`.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- *"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."*
## Done means
SDK tests green except the known failures (speech `deriveDontSpell`, the 1.0 surface audit / spelling-allowance / export-tag trio); `sdk:build` clean; app `tsc` shows nothing new. Report as your final message starting `# REPORT s27-S3K (2026-11-05)`: names and signatures FIRST (lanes C, G and mundi-27a build on them), changed files, tests, §25 rows, open ★, Noticed.
