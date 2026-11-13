# BRIEF s27-S3 common — the contract for S3's consumer lanes (C server, W client, G core-catalog, mundi-27a)

Every S3 lane supervisor reads this first, then its lane brief.

## Read first
`.claude/guides/multi-agent.md`; plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §27 rulings and **§29 to the end** (the S3 plan, its challenger, and the owner's rulings of 2026-11-05 late — they override §29 where they differ, incl. **"Everything in session is cast -> active card."**); `plans/REPORT-s27-S3K-2026-11-05.md` (**the SDK names you build on**, and its "Queued for" list); `plans/briefs/INVENTORY-s27-S3-2026-11-05.md` (sites by repo); `plans/briefs/BRIEF-s27-S2-common.md` "Helpers wave 1 built" (`storedSeatRef` is the ONE door; `seatOf`; `memberAsRead`; `seatCardsAsRead`/`seatMembersAsRead`); NOMENCLATURE §1, §24 and the §25 seat and S3K rows.

## What S3 is
**Consumers stop building refs or keys from card ids and read host-filled identity instead** — `ref`, `castMemberId`, `cardId` on cast entries and seat rows, `ref`/`castMemberId` on state owners, `castMemberId` on messages — so they work on today's card-keyed data **and** on S4's member-keyed data. Core keeps emitting card-form refs and keys until S4; nothing is removed (S5).
1. **Host fills, consumers read.** Lane C fills the new fields; lanes W, G and mundi-27a read them and fall back to today's card form only when a field is absent (a host before S3). SDK `castMemberId` = **the seat's cast member** (the app's `CastMemberLink.seatMemberId`), never `CastMemberLink.castMemberId`. `cardId` = the member's **active card on the timeline**.
2. **Refs in accept `seated-member:`**, translated at the door with `state/seatRefs.ts` `storedSeatRef`, so nothing stored changes form in S3 (audiences, `metadata.speaker`, form blocks, turn order stay card-form). Owners `seated_member` go through `storedSeatOwner`.
3. **Look up, never parse.** A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`.
4. **Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`).
5. **No stored key changes, no migration, no removal.** Spec hashes and goldens that move because a script or widget changed: repin with a dated comment in the lane that changed it (SDK `sdk-tests`), the app's `specHashes`/`registryHashes` repins go to the lead's grouped verification — list them.
6. **New names** qualified (R3), 🚧-marked, §25 rows in the same change. Anything users or plugin authors see that isn't ruled is a ★.
7. **Every session has a lorebook** — never write "no book".

## Shared files
`NOMENCLATURE.md` §25 (append; re-read before each edit) · `src/lib/shared/sockets/types.ts` (additive, own types) · `sockets/sessions.ts` (C only) · `../serene-pub-sdk/sdk/src/widgets.ts`: G only, the one line widening `AttendeeV1.personaRefs` (routed by the lead).

## Rules (quote into every worker brief)
CLAUDE.md Principles/Decisions/Hard rules; `tx` only inside transactions; no static `$lib/server/db` import in modules tests mock; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- *"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`."*

## Done means
Tests green; `tsc` clean on lane files. Report as your final message starting `# REPORT s27-S3<lane> (2026-11-05)`: what switched (file → field read), what still builds card form and why, changed files, tests (both shapes), repins, §25 rows, open ★, Noticed (incl. S4 items).
