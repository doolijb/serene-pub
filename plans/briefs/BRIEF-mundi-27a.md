# BRIEF mundi-27a — Mundi reads identity, not card ids (seat-cast S3, the port's read side)

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-s27-S3-common.md` first, then `~/.claude/projects/-home-jody-github-serene-pub/memory/project_mundi_port_permission_2026_10_27.md`. Lane id **mundi-27a**. One or two workers. Repo `/home/jody/github/mundi-sp` (never `git checkout`/`restore`/`stash` there; never commit). It links the SDK by symlink — build against the current `dist`. No Mundi names go into the serene-pub repo.

## Items (inventory §3)
1. **One helper** reads the host's identity fields (cast entry `ref` / `castMemberId` / `cardId`, `who.user.ref`, a message's `castMemberId`) and replaces every `Number(id)` / template-ref / `byId[String(cardId)]` / `names[String(m.characterId)]` site: `src/genre/newGame.ts` ~38/~93–100, `src/world/deriveBook.ts` ~300–307 `avatarsOf`, `src/engine/save.ts` ~173/~186/~249/~310/~355, `src/engine/relationships.ts` ~337–353, `src/engine/phone.ts` ~205, `src/pipelines/talkActions.ts` ~139, `src/pipelines/turns.ts` ~106/~127/~137, `src/engine/presence.ts` ~50, `src/pipelines/scenes.ts` ~57, `src/nodes/sceneBlocks.ts` ~135, `src/pipelines/judge.ts` ~157, `src/pipelines/diary.ts` ~31/~71, `ui/src/library.ts` ~86/~362, `ui/src/log.ts` ~65, `ui/src/phone/contacts.ts` ~121.
2. **Saves:** the annex's `avatars` values are read as v1 card ids resolved through each entry's `cardId`; a **v2 reader** (member ids through `castMemberId`) ships now, no writer (★S3-5: the writer and the save upgrade are mundi-27b in S4). An unknown id re-resolves by its avatar tag (`extensions.mundi.avatar`) — S4's branch remap mints new member ids. Phone lanes keep `phone:<cardId>` in S3 (S4 decides).
3. **Tests:** the port's test suite on both shapes (today's card-keyed host data unchanged; S4-shaped member-keyed data); `tsc -p tsconfig.check.json`; re-package the zip as the port's release script does and record the sha.

## Files owned
`/home/jody/github/mundi-sp/**`. CHANGELOG entry in the port.
