# BRIEF cv common — character versions, S4 stage 1 (owner GO 2026-11-05 late)

Every character-version lane supervisor reads this first, then its lane brief.

## Read first
`.claude/guides/multi-agent.md`; plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` **§32 (design v3) and §33 (the settled deltas — §33 wins where they differ)**, and every owner ruling between §30 and §33 (quote them in your work where you apply them); `plans/briefs/INVENTORY-s27-S4-member-parity-2026-11-05.md`; NOMENCLATURE §1, §24, §25 (cast member, retold, cast amendments, seats, `memberAsRead`); `CLAUDE.md` Hard rules.

## The design in one paragraph
One table `character_versions`: a version belongs to a card (an authored release, `number` + `label`) or a cast member (evolution: book line, day-grain date, life point = `personal_position`, turn tie, `write_order`, `retired_order`). Every version holds a complete 🚧 **character profile** (`CharacterProfileV1`: name, nickname, aliases, summary, description, personality, scenario, **greetings** `{text, groupOnly?}[]`, example dialogues, post-history instructions, **notes** `{text, lang?, variants}`, strokes, face, likeness, timbre, sprite set, extensions) with `follows[]` naming the fields read from the parent card version. A reading picks ONE row (`versionInForce`). Story writes coalesce per (target, line, session, turn, day, hour, minute, life point). Branches ride the parent's line until their first book write; descendants are protected by the session cut + write-order mark + the retire mark. Acting rights follow `session_characters.seated_by_user_id`; what a seated person *is* follows cast → active card.

## Rules (quote into every worker brief)
CLAUDE.md Principles/Decisions/Hard rules: migrations **generated** (`db:generate`, or against a scratch dir: `SERENE_PUB_DATA_DIR=<scratch>/gen-data npx drizzle-kit generate --config ./src/lib/server/db/drizzle.config.ts --name <name>`), the index above the highest applied (0145 today — check `drizzle/meta/_journal.json`), never hand-edit a generated file except a data-free CHECK the generator can't express (say so); never seed fixed ids; `tx` only inside transactions; no static `$lib/server/db` import in modules tests mock; a stored-data change ships a boot pass + a second-boot no-op test; NOMENCLATURE §25 rows in the same change (append; re-read before each edit); every session has a lorebook — never write "no book"; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- *"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`."*

## Done means
Tests green; `tsc` clean on lane files. Report as your final message starting `# REPORT cv-<lane> (2026-11-05)`: names and signatures first, changed files, tests, §25 rows, open ★, Noticed.
