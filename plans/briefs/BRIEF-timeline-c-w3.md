# BRIEF — worker `timeline-c-w3` — client: the start form's timeline offer, its New lorebook dialog, and the reading's clock

Supervisor: lane `timeline-c` (brief `plans/briefs/BRIEF-timeline-c.md`). Report to
`plans/briefs/REPORT-timeline-c-w3.md` (write it last; if the write is refused, put the whole report in your final
message).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The start form offers to switch a lorebook's timeline on when the chosen preset expects one; a lorebook made from
the start form asks; `SessionLorebookReading` shows no clock when the lorebook keeps no timeline.

Owner rulings this builds (verbatim):
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created."
- 2026-11-14: "preset may override the genres default, but not it's mandate".
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- Standing: "Genres expect, never lock. A genre states what it plays best with (fit, recommendations, "why"
  sentences); a pipeline whose shape is missing degrades in words." Starting the session without switching is
  always allowed.
- 2026-11-05: "There's always a lorebook." Never write "no lorebook" anywhere (code, comments, test names,
  report); say "a session whose lorebook is its own notes".
- Members never see model plumbing (not touched here).

## What the server now gives you (built and tested)

- Each row of `sessionPresets:list` carries `timelineDefault?: boolean` (`Sockets.SessionAdmin.PresetRow`,
  `src/lib/shared/sockets/types.ts`): whether a new session on this preset starts its notes with a timeline, the
  mandate and the preset's override already resolved. Read it; never re-derive it on the client.
- Each `lorebooks:list` row carries the column `timelineEnabled` (rows are whole `SelectLorebook`s), `bookAccess`
  (`"owner" | "shared" | "admin"`), `provided`, `readOnly` (see `Sockets.Lorebooks.List.Response`, types.ts
  ~8386–8420).
- `lorebooks:update` with `{ lorebook: { id }, timelineEnabled: true, requestId }` switches it (owner only); on
  success the server answers `lorebooks:update` and re-sends `lorebooks:list` to the owner
  (`sockets/lorebooks.ts` ~1158–1170), so the start form's row updates by itself. Refusal on
  `lorebooks:update:error`. Copy the call shape from `src/lib/client/lorebooks/time/TimelineCard.svelte` ~39–68
  (`awaitReply` with `errorEvent`, `fallbackError`, `match`/`matchError` on `requestId`). The refusal shows in
  place; never call `toaster` (Layout already toasts `:error` events — a known double, ★T-B2; report it, don't fix).

## Build

`src/lib/client/components/sessionForms/StartSessionForm.svelte` is a shared file: small edits, re-read right
before each edit, never reformat. Line numbers are approximate.

1. **The New lorebook dialog asks.** The mount (~3400–3405) gains `asksTimeline`. `createLorebook` (~939–977)
   takes `timelineEnabled?: boolean` in `details` and sends it on `lorebooks:create` when the dialog set it (the
   dialog sets it only on the Blank way; the kit way sends nothing). The dialog's switch starts **off** (its own
   default, `NewLorebookDialog.svelte` ~69, ~115). Presetting it to the preset's default would need a new prop on
   that dialog, which is **not** your file: do not edit it; the supervisor queues it.
2. **The offer.** Shown under the **selected** lorebook's row only, in both row snippets: `bookPickRow` (~2614–2716;
   put it after the "Play it with" block ~2698–2713, before `surfacedStartChoice`) and `plainBookRow` (~2950–2982,
   before `surfacedStartChoice`). Shown only when the chosen preset's `timelineDefault === true` **and** that
   lorebook row's `timelineEnabled === false`. Never when the preset's default is false or absent, the lorebook
   keeps a timeline, or nothing is chosen. Three cases (decide in one small `$derived` or helper; name it):
   - **copy mode** (`flow.mode === "new-world"`, which every shared lorebook is started in): the original is
     never touched. Sentence, then 🚧 *You can switch it on in the copy's Book settings.* No button.
   - **the person's own lorebook attached directly** (not copy mode; `bookAccess === "owner"`, no `readOnly`, no
     `provided`): sentence and the button 🚧 **Switch the timeline on** (disabled while saving; on success the
     offer goes because the re-sent list row now says on; a refusal shows as one line under it).
   - **anything else attached directly** (a provided or read-only lorebook): sentence, then 🚧 *Story time won't
     move in this session.* No button.
   The sentence (🚧): *This lorebook keeps no timeline. ‹Preset name› plays best with one.* — ‹Preset name› is the
   chosen preset's name (`flow.preset?.name`). Muted `text-xs` like the rows' other lines (`text-surface-600-400`);
   the button follows the file's existing small-button pattern (look at neighbouring buttons; `btn btn-sm …`).
   Give the block a `data-` hook (e.g. `data-timeline-offer`) for tests. Starting without switching stays allowed:
   nothing about Start changes.
3. **`SessionLorebookReading.svelte`** (`src/lib/client/components/sessionForms/`): one new optional prop
   `timeline?: boolean` (default `true`), doc comment 🚧: whether the lorebook keeps a timeline; off, the reading
   shows the line picker only. With it false: no "Story clock" `Select` (~263–271), no followed-present line
   (~272–279, including "Nothing on this line is dated yet…"), no own-clock fieldset (~280+); the **Line** select
   stays. Don't change what the component binds or saves.
   Mounts:
   - start form (~2397–2402, the surfaced book's branch-off): pass the row's switch
     (`timelineEnabled !== false`, from the row of `bookId`).
   - `EditSessionForm.svelte` (~3311 attached, ~3323 own notes) — **the mount's props only**, nothing else in that
     file: attached → that lorebook's row in the form's `lorebookList` (~172, ~1642–1645), `timelineEnabled !==
     false`; own notes → only if the form already holds a value for the notes' switch (look; e.g. a held notes row
     or reading). If it holds none, pass nothing and say so in the report — do not add a read.

## Tests (DOM, beside the files; copy the setup of an existing `startSession*.dom.test.svelte.ts` and
`editSession*Reading*.dom.test.svelte.ts`)

- New `startSessionTimelineOffer.dom.test.svelte.ts`: the offer for an own lorebook attached directly (the
  sentence names the preset; pressing the button emits `lorebooks:update` with `timelineEnabled: true`; a
  `lorebooks:list` push with the row on removes the offer; a refusal shows its sentence in place); copy mode (copy
  sentence, no button); a provided lorebook (story-time sentence, no button); absent when the preset's
  `timelineDefault` is false, when it is absent, and when the lorebook keeps a timeline. The New lorebook dialog
  opened from the start form shows **Keep a timeline** on the Blank way, and `lorebooks:create` carries
  `timelineEnabled` as set.
- `SessionLorebookReading` with `timeline={false}`: no Story clock select, no followed line, the Line select
  present; with it true (or left out) as today (extend an existing reading test or add
  `sessionLorebookReadingTimeline.dom.test.svelte.ts`).

How to run (from `/home/jody/github/serene-pub`, one run at a time; first check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows nothing — another worker and another session share
this checkout — and wait if one is up; never `pgrep -f "vitest run"` in a loop):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-c-w3-<n>.log 2>&1"`
Run your new tests plus the existing `startSessionModes`, `startSessionBookSources`, `startSessionRules`,
`editSessionLorebookLine`, `editSessionOwnNotesReading`, `editSessionGuestOwnNotesReading` DOM tests. Never pipe
vitest into `head`. A failing assert on a big happy-dom element can eat memory: keep asserts on small strings and
booleans. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (0 errors expected). Not
`npm run check`, not `npm test`.

## Files owned (edit only these)

`src/lib/client/components/sessionForms/StartSessionForm.svelte`, `src/lib/client/components/sessionForms/createSession.svelte.ts`
(only if the offer needs it), `src/lib/client/components/sessionForms/SessionLorebookReading.svelte`,
`src/lib/client/components/sessionForms/EditSessionForm.svelte` (the two mounts' props only), the new test files,
and an existing reading test you extend.

## Out of scope — never built

Editing `NewLorebookDialog.svelte`, `Layout.svelte`, `TimelineCard.svelte` or any lorebook screen; any server file;
any admin screen or setting; switching a lorebook on by itself; anything on the session page.

## Stop and ask (in your report, then stop) when

A change outside Files owned seems needed (beyond the dialog prop already queued); a name, label or sentence beyond
the ones above seems needed; the offer can't tell the three cases apart from the row's fields.

## Rules (quoted from CLAUDE.md, STYLE-GUIDE §10 and the lane brief)

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't build in this task at all.)
- "Sockets: one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." (The form already imports a `uuid()` helper; use it.)
- STYLE-GUIDE §10: "Sentence case everywhere." "A button says what happens." "Help is one sentence. A second sentence is a docs link's words, a field's `title`, or gone." (The offer's two sentences are the lead's wording; report it as a ★ against this rule, don't reword.)
- It is a session, never a chat. No other product's name in any file. "Comments state the rule, not the story (a ratchet test counts phrases such as "no longer")."
- Never `git checkout` / `restore` / `stash`. Never `prettier --write` a directory or glob. Never `kill -9`.
- Mark every new name, label and sentence 🚧 and list it in your report. Decide implementation inside this scope
  and name each choice.

## Report

Changed files; each test run (files, pass/fail counts, log path); every name, label and sentence added (🚧); the rule
you used for the three cases; what the edit form's own-notes mount got; Noticed, not done.
