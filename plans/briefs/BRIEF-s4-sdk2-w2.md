# BRIEF s4-sdk2-w2 — Mundi: stored phone lanes (`save.lanes`) (lane s4-sdk2, wave 6) — 2026-11-08

Supervisor: lane `s4-sdk2`. Repo: **`/home/jody/github/mundi-sp`** (the Mundi port, AGPL). Absolute paths only. Report in your final message: changed files, tests run with results (before/after counts), tsc result, decisions, open ★ (one recommendation + trade-off each), Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

- Never `git checkout` / `restore` / `stash` in `/home/jody/github/serene-pub-sdk` or `/home/jody/github/mundi-sp`. Never commit.
- You do **not** run `sdk:build`, `npm run package` or `npm run build` (the supervisor packages after the SDK build). Never edit anything under `/home/jody/github/serene-pub-sdk/**` or `/home/jody/github/serene-pub/**`.
- Every session has a lorebook — never write "no book" in a comment, copy or test name. It is a **session**, never a chat.

## Read first

- `/home/jody/github/serene-pub/plans/briefs/BRIEF-s4-st-w3.md` — the previous Mundi brief (annex v2 writer); its rules still apply (the ONE door `src/engine/identity.ts`; "host fills, consumers read"; "look up, never parse"; tests on both shapes; the file style).
- `/home/jody/github/serene-pub/plans/briefs/BRIEF-mundi-27a-common-rules.md` — the port's read-side rules.
- `src/engine/identity.ts` (whole — `newGameVersionOf`, `avatarNumberOf`, `upgradedAvatars`, `avatarCardOf`, `avatarOfCard`), `src/engine/phone.ts` (`phoneLaneOf`, `avatarOfLane`, `laneName`, `laneNumber`, and every caller), `src/engine/save.ts` (`MundiAnnex`, `writesOf`, `hudOf`), `src/genre/newGame.ts`, `src/world/deriveBook.ts` (`avatarsOf`), `src/engine/relationships.ts` (`newGameHandler`), `CHANGELOG.md`.
- Every other reader of a phone lane number (grep `phone:`, `laneName`, `laneNumber`, `avatarCardOf`, `avatarOfCard`) — `presence.ts`, `ui/src/**`, pipelines in `src/pipelines/**`.

## The ruling (quote, never reinterpret)

- **Owner ★st-1 (2026-11-08) → stored lane map** in the Mundi save: "`save.lanes`, avatar → lane number, written at first contact, never re-derived; carded residents seeded with their card id; card-less residents a non-colliding number."
- The recommendation it accepted (REPORT-s4-st): "v2 gains `save.lanes` (avatar → lane number) written at first contact, never re-derived; carded residents seeded with their card id; card-less get a non-colliding number (also stops a resident's lane changing when its active card changes)."
- ★S3-5 (2026-11-05): "phone lanes keep their v1 numbers."

## Goal

1. **`save.lanes`** in the v2 annex: `Record<avatar, number>`. Written **once per avatar, at first contact** (the first time the annex is written with that avatar in it — a new game, the v1→v2 upgrade in `writesOf`, a v2 annex written back without the map or without an entry for a new avatar), and **never re-derived** afterwards (a later change of the resident's active card, a card-less → carded link, a deleted card: the number stays).
   - **Seeding:** a carded resident → its card id (the v2 active card at first contact — so an existing thread on `phone:<cardId>` stays put; for a v1→v2 upgrade that is the v1 number by `upgradedAvatars`' lossless rule). A card-less resident → a **non-colliding** number: not any number already in `save.lanes`, not any card id of any cast entry in the state, and deterministic (same state + annex → same number; name the rule, e.g. one above the highest of those). Check what lane names the host accepts (`phone:<n>`, positive integer?) and keep to it.
   - One rule in `identity.ts` (or `phone.ts`, whichever is the one door for lanes — say which), used by every writer.
2. **Readers read the map.** `phoneLaneOf` / `avatarOfLane` (and anything that builds or parses a phone lane number from an avatar) read `save.lanes[avatar]` first; fall back to today's behaviour only where the map has no entry (a v1 annex: its own number; a v2 annex written before this change: the entry's active card). A card-less resident with a map entry **gets a phone**.
3. **Flip the pinned test**: `test/engine/phone.test.ts` (~212) pins a card-less resident's phone lane to null — it now expects the stored lane. Add: a carded resident keeps its thread (same lane) when its active card changes; a card-less resident gets a lane that collides with no card id and no other lane; a second write changes nothing (the map is byte-identical); a v1 annex (pre-S3 host) is written exactly as today (no `lanes` key — byte-identical); the v1→v2 lossless upgrade seeds the map with the v1 numbers; a branch re-resolve (unknown member ids, avatar keys) keeps the stored lanes.
4. **`MundiAnnex` type + comments**: `lanes?: Record<string, number>` with a one-line comment; update `identity.ts` / `phone.ts` head comments ("a resident's lane is phone:<characterId> (no lane map)" in `phone.ts` line 3 is no longer true).
5. **The frame** (`ui/src/**`): if it computes a lane from a card id, make it read the stored lane (via the `hud` mirror or whatever it already reads) and add a test; if it needs nothing, say why.
6. **CHANGELOG** 0.2.0: one plain sentence — each person's texts keep their own thread even when their character card changes, and people with no character card can be texted. Don't touch the install line (size / sha — the supervisor writes it after packaging).

## Not yours — stop and ask (★ in your report, don't build)

- `presence.ts`'s `characterId` output and `open-character` (card-id ports, ★S3-6 "keep them as card ids and decide at S5") — list what a card-less resident lacks there, don't change it.
- Any new annex key besides `save.lanes`; anything a player sees beyond the CHANGELOG sentence; any change outside `/home/jody/github/mundi-sp`.

## Files owned

`/home/jody/github/mundi-sp/src/**`, `/home/jody/github/mundi-sp/ui/src/**` (only if the frame needs it), `/home/jody/github/mundi-sp/test/**`, `/home/jody/github/mundi-sp/CHANGELOG.md` (the one sentence). Nothing under `dist/`, `assets/books/`, `ui/mundi.{js,css}` (packaging regenerates them).

## Done means

- The tests in 3 (plus whatever the readers you touched need), on both shapes.
- Whole port suite green, in a capped scope: `cd /home/jody/github/mundi-sp && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'npx vitest run > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-sdk2-w2-tests.log'` — baseline 698/698 (s4-st); report before/after. Never pipe into `head`.
- `cd /home/jody/github/mundi-sp && npx tsc --noEmit -p tsconfig.check.json` clean.
