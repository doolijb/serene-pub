# BRIEF — worker `timeline-c-w2` — server: the timeline default resolver, session create, the start form's data, the clock reply

Supervisor: lane `timeline-c` (brief `plans/briefs/BRIEF-timeline-c.md`). Report to
`plans/briefs/REPORT-timeline-c-w2.md` (write it last; if the write is refused, put the whole report in your final
message).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A new session whose lorebook is its own notes gets notes with or without a timeline according to its preset and
genre. Nothing else about session creation changes. The start form's preset rows carry the resolved default; the
session's clock reply says whether its lorebook keeps a timeline.

Owner rulings this builds (verbatim):
- 2026-11-13: "By default, Story Minimal will use an undated book. Messages will just display real time. All other
  Story presets will continue defaulting to timelined storybooks." Minimal on a timelined lorebook advances story
  time "as it does today". "the time incriment should be a property of whether the lorebook has it's own calendar
  or if the session is following real time."
- 2026-11-14 ("Lets go with all your recommendations"): Chat and Guide undated like Minimal; the Lair and Dungeon
  Crawler timelined as today.
- 2026-11-14: "preset may override the genres default, but not it's mandate".
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- 2026-11-05: "There's always a lorebook." Never write "no lorebook" in code, comments, test names or the report;
  say "a session whose lorebook is its own notes".
- 2026-11-13: "Do not provide SDK api for this yet": no pipeline, outlet or plugin API reads or sets the switch.

## Background you need

- The switch: `lorebooks.timeline_enabled`, read **only** through `src/lib/server/lorebooks/timeline.ts`
  (read the whole file, 198 lines; it is a leaf module: schema, drizzle and shared helpers only — keep it so).
- A parallel worker is adding to the SDK (not built yet): `GenreDecl.timeline?: 'required'` and
  `PresetDefaults.timeline?: boolean`; the core catalogue's Lair and Dungeon Crawler declare `timeline:
  'required'`, Story Minimal `defaults: { timeline: false }`. Story, Lair and Dungeon Crawler have
  `keepsTime: 'story'`; Chat and Guide `'real'`. **Do not import the new SDK types**: type the resolver
  structurally so it compiles against today's dist.
- Core preset rows get their `defaults` re-forced from the catalogue at boot when they differ
  (`src/lib/server/pipelines/registrations/project.ts` ~114–141, called from `pipelines/boot/bootstrap.ts` ~461);
  admin copies (`isImmutable` false) are never touched.

## Build

1. **`timelineDefaultFor(genre, preset)`** in `src/lib/server/lorebooks/timeline.ts`, exported, doc comment 🚧.
   Signature (structural): `genre: { timeline?: unknown; keepsTime?: unknown } | null | undefined`,
   `preset: { defaults?: unknown } | null | undefined` → `boolean`. Rule, in this order:
   a genre that does not resolve (null/undefined) → `true`; `genre.timeline === 'required'` → `true`; the
   preset's `defaults.timeline` when it is a boolean → that; else `genre.keepsTime === 'story'`.
   The header's reader list gains it; it reads no column.
2. **`insertOwnBook`** (`src/lib/server/lorebooks/ownBook.ts` ~199–241): one optional row field
   `timelineEnabled?: boolean` — the notes' switch when they overlay nothing; ignored when `overlayOf` is set
   (notes over a lorebook copy that lorebook's switch, as today). Absent = the column's default, as today. Change
   nothing else in the file; the other callers (`ownBook.ts` ~160, ~285, ~753, ~1249; `sockets/import.ts` ~1347,
   ~1498) stay as they are.
3. **Session create** (`src/lib/server/sockets/sessions.ts`, a shared file: small edits, re-read right before
   editing, never reformat). In the preset block (~1078–1126) keep the loaded preset row's `defaults` in one new
   local beside `presetSwaps` etc. At the `insertOwnBook` call (~1595–1602, inside `db.transaction`; use only
   `tx` there), when `row.lorebookId == null` pass
   `timelineEnabled: timelineDefaultFor(getGenre(row.genreId), { defaults: <that local> })` (`getGenre` is already
   imported at the top, ~12; a session created with no preset passes `null` for the preset). Unchanged on purpose:
   an attached lorebook, the `new-world` copy, the starter-kit copy (`startKit`), `next-chapter` (always attaches a
   lorebook, ~915–960) and `branch` (~896). Nothing about an existing session or lorebook changes.
4. **The start form's data**: `buildSessionPresets` (`src/lib/server/sockets/sessionAdmin.ts` ~706–780) adds
   `timelineDefault: timelineDefaultFor(getGenre(r.genreId), r)` to each listed row (beside `asks`, `derived`). Not
   on single rows a write answers with. `keepsTime` itself is not sent.
5. **Types** (`src/lib/shared/sockets/types.ts`):
   - `PresetDefaults` (~4079–4088): `timeline?: boolean` with a one-line doc (🚧 see the SDK's `PresetDefaults`).
   - `PresetRow` (~4090+): `timelineDefault?: boolean` — 🚧 whether a new session on this preset whose lorebook is
     its own notes starts them with a timeline, resolved on the server (`timelineDefaultFor`); carried by
     `sessionPresets:list` only.
   - `StoryClock.Reading` (~4609–4624): `timeline: boolean` — 🚧 whether the book the session reads keeps a
     timeline (its attached lorebook's switch, else its notes').
6. **The clock reply** (`src/lib/server/sockets/storyClock.ts`, `readSessionStoryClock` ~69–115): the main return
   adds `timeline: reading?.timelineOff !== true`; the early return (no row or no book) adds `timeline: true` (a
   missing book reads as on, the rule `timelineOf` states). Every other place that builds a `Reading` must carry it
   too (tsc will show them).

## Tests (new files unless named)

- `src/lib/server/lorebooks/timelineDefault.test.ts` — the table: unresolved genre (with a preset saying false) →
  true; required genre + preset false → true; required + preset true → true; story genre + preset false → false;
  story + preset true → true; story + nothing → true; real + nothing → false; real + preset true → true; none →
  false; `keepsTime` left out → false; a non-boolean `defaults.timeline` is ignored.
- Extend `src/lib/server/sockets/storyClock.timeline.int.test.ts`: the reply carries `timeline: true` on a
  lorebook with the switch on and `false` with it off (an attached lorebook, and a session whose lorebook is its
  own notes).
- `src/lib/server/sockets/sessions.timelineDefault.int.test.ts` — session create (copy how
  `sessions.genreParity.int.test.ts` or `sessions.dungeonCrawlerPersona.int.test.ts` create sessions on a core
  preset): with the session's lorebook its own notes, Story Minimal, Chat's presets and Guide → notes
  `timeline_enabled` false; Story Living, Rule Based, the Lair's and Dungeon Crawler's presets → true; Story
  Minimal and Living on an attached lorebook with the switch on, and with it off → that lorebook's switch unchanged;
  a `sessionPresets:list` reply carries `timelineDefault` false for Story Minimal, Chat and Guide presets and true
  for the others. An int test that opens a DB inside an `it` takes a 60 s timeout.
- `src/lib/server/pipelines/registrations/project.timelineDefault.int.test.ts` — `projectRegistrations`: the
  first run leaves Story Minimal's core row with `defaults.timeline === false`; a second run changes nothing (the
  whole row equal before and after, and the run reports no change for it); an admin's copy of Story Minimal made
  before the first run (a non-immutable row with the old `defaults`) is untouched by both runs. Copy the boot or
  seed setup an existing `registrations/*.int.test.ts` uses.

**Order:** the last two files need the new SDK built. Write all code and all four test files first. Run the first
two and `tsc`. Then check whether the built catalogue has the new declarations:
`grep -c "timeline" /home/jody/github/serene-pub-sdk/core-catalog/dist/seed/presets.js` (find the right dist path
if that one is wrong) and the same for the genres registry. If the build has them, run the last two files and the
regression set below; if not, stop and report those as written and not run (the supervisor runs them after the
build).

Regression set (after the build): `src/lib/server/lorebooks/ownBook.timeline.int.test.ts`,
`src/lib/server/lorebooks/timelineCopies.int.test.ts`, `src/lib/server/sockets/storyClock.int.test.ts`,
`src/lib/server/sockets/sessions.genreParity.int.test.ts`, `src/lib/server/sockets/sessions.dungeonCrawlerPersona.int.test.ts`,
`src/lib/server/sockets/sessions.taskReply.int.test.ts`, `src/lib/server/sockets/presetBindings.int.test.ts`.
These already fail and are not yours (don't fix; report if one fails **differently**):
`sockets/presetFallback.int`, `sockets/sessionAdmin.presetActions.int`, `sessions/genreFieldDefaults.int`,
`entities/sessionGenres.int`, `sockets/sessions.forms.int` (one test).

How to run (from `/home/jody/github/serene-pub`, one run at a time; first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows nothing — another session shares this checkout —
and wait if one is up; never `pgrep -f "vitest run"` in a loop):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-c-w2-<n>.log 2>&1"`
Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors
expected). Not `npm run check`, not `npm test`.

## Files owned (edit only these)

`src/lib/server/lorebooks/timeline.ts`, `src/lib/server/lorebooks/ownBook.ts` (`insertOwnBook` only),
`src/lib/server/sockets/sessions.ts` (session create's notes insert and the one local only),
`src/lib/server/sockets/sessionAdmin.ts` (`buildSessionPresets` only), `src/lib/server/sockets/storyClock.ts`,
`src/lib/shared/sockets/types.ts` (the three fields), the four test files above.

## Out of scope — never built

Any admin screen or setting for a preset's timeline default; any pipeline, outlet or plugin API over the switch;
changing an existing session's or lorebook's switch; the one-time pass (`timelinePass.ts`); a migration or boot
pass; the client; the SDK.

## Stop and ask (in your report, then stop) when

A migration or boot pass seems needed; resolving the default would change an existing session or lorebook; a
change outside Files owned seems needed; a new name beyond the four here (`timelineDefaultFor`,
`insertOwnBook`'s `timelineEnabled`, `PresetRow.timelineDefault`, `StoryClock.Reading.timeline`) seems needed.

## Rules (quoted from CLAUDE.md and the lane brief)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't build in this task at all.)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never `git checkout` / `restore` / `stash`" in either repo. Never `prettier --write` a directory or glob. Never `kill -9`. Never edit server files while a dev instance is booting.
- "Migrations are generated only"; this task expects none. "Never seed a row at a hardcoded id."
- "Sockets: an event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload."
- It is a session, never a chat (except chat-completions wire vocabulary). No other product's name in any file.
- "Comments state the rule, not the story (a ratchet test counts phrases such as "no longer")."
- Mark every new name and sentence 🚧 and list it in your report.
- Decide implementation inside this scope and name each choice in your report.

## Report

Changed files; each test run (files, pass/fail counts, log path); what you could not run and why; every name added
(🚧); Noticed, not done.
