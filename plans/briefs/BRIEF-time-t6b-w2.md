# BRIEF — worker `time-t6b-w2`: the host module that decides what a character witnessed (pure core + one loader + tests)

Supervisor: lane `time-t6b` (report to it). Repo: `/home/jody/github/serene-pub` (the app).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. **Never `prettier --write`.**

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (**You do not run `sdk:build` at all**: the supervisor does.)

Never `kill -9`. Never `git checkout`/`restore`/`stash` in either repo. Another session shares this checkout and is
editing `src/lib/server/pipelines/prompt/` and `pipelines/entities/`: touch only the files under Files owned. It is
a **session**, never a *chat*. Never write the phrase "no lorebook" (every session has a lorebook).

## Goal

One module (P2: it owns the decision) that, for one cast member's own turn, says which messages of a history read
and which earlier-scene summaries that member witnessed. A later worker wires it into the two node bindings
(`core:query/session-history@1`, `core:query/earlier-scenes@1`); **you do not touch `bindings.ts`**.

## The rule (owner rulings; quote them in the module's header comment as the rule, not the story)

Owner 2026-11-14: "Unknown content is left out of the prompt; the model is never told what a character does not
know." ★6: "where one model voices everyone, nothing can be left out." Owner 2026-11-15: "a mixture of per scene, per
location (when available)"; "if a cast member responded at all within a scene's messages … they were present. We can
filter and qualify further depending on their location. I.e. they responded and then left the room."; on Bench:
"unreliable … still considers them in scene" — **Bench plays no part**; "a per character filter on what gets put
into their context." These replace the 2026-11-14 "Presence is per message, never per scene".

For a reply spoken by **one cast member on its own turn**:

1. **By scene:** a scene is witnessed by a member that **spoke at least once in it**: it is the `cast_member_id` of
   a live line in the scene's whole range. Hidden lines (`is_hidden`), rewound lines (`rewind_ordinal` set: also
   hidden), still-generating rows (`is_generating`) do not count; swiped-away versions are not rows (a row's speaker
   is its current `cast_member_id`). Its own lines are always kept. Messages in no scene are kept. An **open scene**
   (opened, not closed: the one the reply is written in) is witnessed by the speaker.
2. **By place, when a cast-level slot is named:** a message is witnessed when the member's value of that slot **in
   force at that message** equals the message speaker's value in force at it. References compare by `entryId`;
   words trimmed and case-folded. A message whose speaker has no value (or no speaker), or where the member has no
   value, falls under rule 1. Where both values exist, rule 2 decides (both ways: it can keep a line rule 1 would
   leave out, and leave out one rule 1 would keep). The member's own lines are always kept.
3. **Scene summaries:** a closed scene's summary is kept when the member witnessed (by rules 1 and 2) the scene's
   last live line, or more than half of its live lines; else left out. A scene with no live line is kept.
4. A turn that is not one cast member's (no character id, a value that is not one positive integer, a character
   whose seat has no cast member, an envoy or narrator) reads everything.

"Spoke in the scene" is judged over **each scene's whole range**, never from the history window: a member who spoke
only in lines older than the window still witnessed the scene.

## How the data is stored (verify each before relying on it)

- A message's speaker: `session_messages.cast_member_id` (`db/schema.ts` ~2983–2991). The speaking character
  (`$.input.characterId`, a card id) maps to a member through `seatOf(db, sessionId, \`character:${id}\`)`
  (`sessions/seats.ts` ~1989; returns `ResolvedSeat`, ~1939, with `castMemberId`) — the same rule
  `messages/store.ts` `speakerMemberOf` (~146) stamps rows with. That is the one mapping.
- Scenes: `schema.scenes` (~4840–4960). A range scene holds the lines of its `channel` lane by id from
  `openedAtMessageId` to `closedAtMessageId` inclusive (open-ended while `closedAtMessageId` is null); a
  tick-selection scene (both null) holds `selectedMessageIds`. Ranges never overlap on a lane. A line belongs to a
  scene only when `canonicalChannel(row.channel) === scene.channel` (`messages/channels.ts` ~145). Copy the reading
  in `scenes/liveScenes.ts` `liveRangeLineIds` (~351–397): one read of the session's scenes, one read of the lines
  from the earliest opening, matched in memory. Read only the columns you need (`id`, `channel`, `castMemberId`,
  plus the live/visible filters in the `where`: `is_hidden = false`, `is_generating = false`,
  `liveMessageWhere()` from `messages/liveHistory.ts`). Tick-selection scenes: their `selectedMessageIds` that are
  live and visible. **No query per message, no query per scene.**
- A slot's value over the session: `state/statTrail.ts` `statTrailFor(db, { lorebookId, sessionId, owner: { kind:
  'cast_member', id: castMemberId }, slotId, mode: 'both' })` (~228). Its `points` are the book's timeline points
  first, then the session's message points in anchor order (`anchor.messageId`, null = from the beginning). The
  value **in force at message M** = the newest message point whose `anchor.messageId` is null or ≤ M; else the
  newest timeline point; else none. A swiped or rewound reply's values are already gone there. Call it **once per
  distinct cast member involved** (the viewpoint member and the speakers of the judged lines and judged scenes'
  lines), never per message; `trail.tracked === false` means the slot is not tracked: no values (rule 1 alone, and
  say so, see the sentences). An owner the book does not hold throws in `assertOwnerInBook`: treat as no value. The
  session's lorebook is `sessions.lorebook_id`. `statTrail.ts` is **not** yours: use its exported functions only.
- Value normalisation (pure): a lore reference (`isSlotLoreRef` from `@serene-pub/sdk`: `{ entryId }`) →
  `entry:<entryId>`; a string → trimmed, lower-cased (`''` → none); a number or boolean → `String(v)`; anything else
  (a list) → none.

## Build

`src/lib/server/sessions/firsthandFilter.ts` (new). Shape (adjust names inside the file freely; these exported
names are the lane's proposal, report them):

- Pure: `firsthandWitnessed(view, line)` / `keptLineIds(view, lines)` and `keptSceneIds(view, sceneIds)` over a
  `FirsthandView` = `{ memberId, name, slotId: string | null, slotTracked: boolean, sceneOfLine: Map<number,
  number>, sceneLines: Map<sceneId, Array<{ id, castMemberId }>>, openSceneIds: Set<number>, placeAt(castMemberId,
  messageId): string | null }`. Return counts with the kept ids.
- One loader: `loadFirsthandView(db, { sessionId, characterId, slotId, lineIds?, sceneIds? })` →
  `{ kind: 'reads-all' } | { kind: 'viewpoint', view }`. `lineIds`/`sceneIds` only bound which members' trails are
  read. On the plain `db` (read-only); never the outer `db` inside a transaction.
- The receipt sentences, as exported pure functions (🚧, use exactly these):
  - lines: `1 message left out: ‹name› was not there` · `‹n› messages left out: ‹name› was not there` ·
    `No messages left out for ‹name›`
  - summaries: `1 scene summary left out: ‹name› was not there` · `‹n› scene summaries left out: ‹name› was not
    there` · `No scene summaries left out for ‹name›`
  - suffix when a slot was named but is not tracked: ` (‹slotId› is not tracked here, so by scene only)`
  - reads-all: `Reads everything: not one cast member's turn`
  `‹name›` is the member's name as the session shows it: find the existing reader (seat display name, else the card
  name; look at how `scenes/liveScenes.ts` or `sessions/seats.ts` name a seat) and say which you used.
- Comments state the rule, not the story.

## Tests (yours)

- `src/lib/server/sessions/firsthandFilter.test.ts` (pure): spoke → sees the scene; never spoke → its lines and its
  summary left out; own lines kept; open scene kept; lines in no scene kept; a member who spoke only in lines
  outside the judged lines still witnesses; with a slot: lines after it left and before it arrived are left out,
  missing values (speaker's or member's) fall back to rule 1, rule 2 can keep a line of a scene the member never
  spoke in; the summary rule (last line witnessed → kept; more than half → kept; exactly half and not the last →
  left out; empty scene → kept); the sentences (singular/plural/zero/suffix).
- `src/lib/server/sessions/firsthandFilter.int.test.ts` (PGlite, `createTestDb` from `utils/testDb`; copy fixture
  set-up from an existing scene int test such as `scenes/earlierScenes.int.test.ts` or
  `scenes/liveScenes.castMembers.int.test.ts`; 60 s timeouts: `vi.setConfig({ testTimeout: 60_000, hookTimeout:
  60_000 })`): the loader on a real session with two closed scenes and an open one; a **benched** member who spoke
  still witnesses; hidden, rewound and generating lines do not count as spoke; a line on another channel lane is in
  no main scene; a character with no seat → reads-all; with a slot tracked on cast members (declare one in the
  fixture the way existing stat-trail int tests do: find one with `grep -rln statTrailFor src/lib/server --include=*.int.test.ts`)
  the place rule applies, and an untracked slot gives the suffix. **Count the statements** the loader issues
  (wrap the test client's query method, or whatever existing tests do; say how) for: no slot; a slot with 3
  members. Report both numbers.

Run tests only in this capped form, from the app root, **strictly one vitest run at a time across everyone**: first
check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if any line shows (the lead may be running one),
wait (`timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 20; done'`)
and check again.

    systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sessions/firsthandFilter > plans/time-t6b-w2.log 2>&1"

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -n firsthandFilter`
(only errors in your files matter to you; report the total count too).

## Files owned

- `src/lib/server/sessions/firsthandFilter.ts` (new)
- `src/lib/server/sessions/firsthandFilter.test.ts` (new)
- `src/lib/server/sessions/firsthandFilter.int.test.ts` (new)

## Files readable

Anything. In particular the files named above, `db/schema.ts`, `scenes/earlierScenes.ts`, `state/statTrail.ts`,
`state/resolve.ts`, `messages/firsthand.ts` (the per-message column of another lane: **read only, never write it,
never read the column in your module**).

## Out of scope

`bindings.ts`, `host.ts`, any SDK file, docs, NOMENCLATURE; the per-message `firsthand_cast_member_ids` column;
History entries; Bench; a setting; a migration.

## Stop and ask (stop, and write it in your report; do not choose) when

- `statTrailFor` cannot answer "value in force at message M" for a member without one call per message;
- a migration, a new table or column, or a change to a file you do not own seems needed;
- the rule above is ambiguous for a case you meet (write the case).

## Report

Your final message: files with line counts, the exported names and signatures, which name reader you used, test
results (pass/fail per file), the statement counts, assumptions you made, anything noticed and not done.
