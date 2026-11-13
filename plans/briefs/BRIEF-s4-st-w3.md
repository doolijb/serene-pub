# BRIEF s4-st-w3 — mundi-27b: Mundi's save writer (annex v2) (lane s4-st, wave 5) — 2026-11-08

Supervisor: lane `s4-st`. Repo: **`/home/jody/github/mundi-sp`** (the Mundi port, AGPL). Use absolute paths. Report in your final message: changed files, tests run with results, tsc result, decisions, open questions (★ with one recommendation + trade-off), Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`. Never commit in either.
- You do **not** run `sdk:build`, `npm run package` or `npm run build` (the supervisor packages). Never edit `/home/jody/github/serene-pub-sdk/**` or anything in `/home/jody/github/serene-pub/**`.

## Read first

- `/home/jody/github/serene-pub/plans/briefs/BRIEF-mundi-27a-common-rules.md` — the port's rules from the read side (the ONE door `src/engine/identity.ts`, "host fills, consumers read", "look up, never parse", tests on both shapes, the mirror contract, the file style). Everything there still applies, except that **you now write v2**.
- `/home/jody/github/serene-pub/plans/REPORT-mundi-27a-2026-11-05.md` — what 27a switched and why.
- `src/engine/identity.ts` (whole), `src/engine/save.ts` (`MundiAnnex`, `hudOf`, `writesOf`), `src/genre/newGame.ts` (`avatarsOf`, `newGameArgsHandler`), `src/world/deriveBook.ts` (`avatarsOf`), `src/engine/relationships.ts` (`newGameHandler`), `src/engine/phone.ts` (`phoneLaneOf`, `avatarOfLane`).

## Rulings (quote, never reinterpret)

- ★S3-5 (owner 2026-11-05, as recommended): "Mundi annex v2: avatar → `castMemberId`, phone lanes keep their v1 numbers, reader in S3 and writer in S4."
- Plan §29 "Save upgrade (annex v1→v2) → S4, as mundi-27b": "card-less seats, the first case v1 can't express, appear only in S4"; "**Back/Forward** restore v1 annexes, so the reader stays **dual until 0.7**"; "Branch risk: `sessions/branch.ts:145` copies annexes verbatim … Mundi must re-resolve an unknown id by its avatar tag (`extensions.mundi.avatar`)."
- S4 is live in the host (2026-11-08): every `cast.byId` entry carries `ref` (`seated-member:<id>` / `player-seat:<id>` / envoy), `castMemberId`, `cardId` (null when card-less). Starters now copy people **card-less** (2026-11-05: "every starter copies people card-less"), so a session started from a starter copy of Mundi's world has residents with `cardId: null` and **no card at all** (no `extensions.mundi.avatar` anywhere — the example-name bridge is the only tag left).
- Every session has a lorebook — never write "no book" in a comment, copy or test name. It is a **session**, never a chat.

## Goal

1. **The writer.** A new game writes a **v2** annex — `version: 2`, `save.avatars` values are cast member ids (`memberOfEntry`) — whenever the host fills `castMemberId` on the session's cast entries (a host from S3 on). A host that fills none (pre-S3) still gets v1 exactly as today (byte-identical). One rule, in `identity.ts` (the one door), used by both `avatarsOf` (`genre/newGame.ts`, `world/deriveBook.ts`) and `relationships.ts newGameHandler` (today it hard-codes `version: 1` twice) — so the args' numbers and the handler's version can never disagree. In v2 a **card-less** resident is an avatar (today v1 leaves it out); an entry whose `castMemberId` is null has no number and is left out. Decide how the handler learns the version (recompute from `state` with the same rule, or carry it on the args) and name the choice; don't add an SDK/host field.
2. **The upgrade.** `writesOf` today writes the annex back "at the version it read". Upgrade a v1 annex to v2 at write time **only when it is lossless**: every avatar resolves (`avatarEntryOf`) to an entry with a `castMemberId`, and that entry's active card (`cardOfEntry`) **equals the v1 number** — so every phone lane (`phone:<cardId>`, in v2 read as the entry's active card, `avatarCardOf`) keeps its v1 number, as ★S3-5 rules. Otherwise keep writing v1 (today's behaviour; the reader stays dual). The `hud.cast` mirror's row key is the annex number (`String(annexAvatars(annex)[avatar])`) — after an upgrade it is the member id, which the frame already reads for v2 (`ui/src/core/store.ts` `cardIdOfAvatar` reads the row's `cardId`); check the frame needs no change and say so (or change it, with a test).
3. **Branches.** An unknown v2 member id re-resolves by the avatar key (`entryByAvatarKey`: an example person by name through the world; any other key as the seat's `ref`) — 27a built this; prove it for S4 data: a v2 annex whose numbers name no current entry, residents card-less (`cardId: null`, no card), examples matched by name.
4. **Docs/comments:** `MundiAnnex.version`'s comment ("🚧 2 … read only … no Mundi writes it yet"), `identity.ts`'s head comment (the writer comes with S4 → it is here), `avatarsOf`'s comments ("the values are card ids (the new game still writes a v1 annex)"). The CHANGELOG 0.2.0 "Ready for Serene Pub's cast members" bullet: replace "(none is written yet)" with one plain sentence that new games now name their people by cast member, so people with no character card take part, and an older save switches over the next time it is saved when nothing would move. **Do not** touch the install line (the supervisor writes size and sha after packaging).

## Not yours — stop and ask (★ in your report, don't build)

- **A phone lane for a card-less resident.** In v2 a lane is `phone:<the entry's active card>`; a card-less resident has none, so no lane (27a's "no card means no lane"). Choosing a lane number for them is a save-format decision the plan doesn't make. Leave `phoneLaneOf` returning null for them; write a test that pins today's null; and give your recommendation (e.g. a `save.lanes` map kept per avatar, never re-derived) with its trade-off.
- `presence.ts`'s `characterId` output and `open-character` (card id ports, ★S3-6 "keep them as card ids and decide at S5") — a card-less resident has no card there; list what degrades, don't change it.
- Anything a player sees beyond the CHANGELOG sentence; any new annex key; any change in `/home/jody/github/serene-pub*`.

## Files owned

`/home/jody/github/mundi-sp/src/**`, `/home/jody/github/mundi-sp/ui/src/**` (only if the frame needs it), `/home/jody/github/mundi-sp/test/**`, `/home/jody/github/mundi-sp/CHANGELOG.md` (the one bullet). Nothing under `dist/`, `assets/books/`, `ui/mundi.{js,css}` (regenerated by packaging).

## Done means

- New/extended tests (both shapes: a pre-S3 host with no identity fields → v1 byte-identical; an S4 host → v2): `test/engine/identity.test.ts`, `test/genre/newGame.test.ts`, `test/world/deriveBook.test.ts`, `test/engine/relationships.test.ts`, `test/engine/save.test.ts` (upgrade lossless → v2 with member ids and the same lanes; drifted active card or a member-less avatar → stays v1; a v2 annex is written back as v2), `test/engine/phone.test.ts` (carded v2 lane = same number; card-less → null, pinned), the branch re-resolve case.
- Whole port suite green: `cd /home/jody/github/mundi-sp && npx vitest run` (27a baseline 678/678 — report before/after counts; do not pipe into head).
- `npx tsc --noEmit -p tsconfig.check.json` clean.
