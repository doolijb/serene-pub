# BRIEF — lane `tl-3a`, worker 2 — the new default in the SDK comments, docs and NOMENCLATURE

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there).
Supervisor: lane `tl-3a`. You do not read the lane brief; this one carries what you need.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You change **comments and Markdown only**: no `sdk:build`, no tests, no vitest. Never `git checkout / restore /
stash` in either repo (most of the SDK is uncommitted). Never `prettier --write`. Read files by line range; never
load `NOMENCLATURE.md` whole (it is 4,300+ lines with very long rows: use `grep -n` then `sed -n 'Np'`, and edit
with exact strings).

## Goal — the rule to write down

Owner, 2026-11-16: "If the genre/preset supports undated, use undated by default." Asked whether that includes
Story: "Yes, story as well". Earlier, still standing (2026-11-14): "preset may override the genres default, but
not it's mandate".

This **supersedes** the owner's 2026-11-14 ruling (`plans/PLAN-entry-time-and-lines-2026-11-14.md` 37–38):
"By default, Story Minimal will use an undated book. Messages will just display real time. All other Story
presets will continue defaulting to timelined storybooks." The part "Messages will just display real time" still
stands: it is what an undated Story session shows.

**As built (worker 1 changes `timelineDefaultFor`, `src/lib/server/lorebooks/timeline.ts`):** a new session
whose lorebook is its own notes starts them **without** a timeline, unless its genre declares the **timeline
mandate** (`timeline: 'required'`: the Lair and Dungeon Crawler) → with one; or its preset's
`defaults.timeline` is a boolean → that value. A genre that does not resolve still starts them with one
(unchanged; awaiting the owner — mark it 🚧). `keepsTime` no longer picks the default: it still feeds ruleset fit
(`rulesetFit`), and the one-time boot pass over **existing** lorebooks (`timelinePass.ts`, unchanged: existing
sessions and lorebooks keep their switch; owner 2026-11-16 "Go with the safest option for existing lorebooks").
Every shipped preset of Story (Minimal, Living, Rule Based), Chat and Guide now starts without; Story Minimal's
`defaults: { timeline: false }` stays (explicit, same as the default). No shipped preset says `true`. An
administrator's copy of any Story preset now starts without one too.

What a Story session on undated notes shows (already built and documented in `docs/lorebook-time.md` §"A
lorebook's timeline" and §"What you won't see" — link there, don't restate it all): messages show their real
time; no clock moves (the round's, **Note what changed**'s, **After a rest**'s, **Time passes…**, which is
refused with *This lorebook has no timeline, so its story time doesn't move.*); no history day is kept (*This
lorebook has no timeline, so no history is kept.*); the Chronicle shows scenes only (*This lorebook keeps no
timeline, so there are no story dates here.*); scenes are still kept. To keep story time, the session's notes'
**Timeline** switch is in Book settings, or the session starts on a lorebook that keeps one. Nothing is refused
in ordinary play.

## Rules (quoted)

- CLAUDE.md: "It is a **session**, never a *chat*." · "`docs/<area>.md` … update it in the same change when
  behaviour moves." · NOMENCLATURE: "When you add or rename a term, record it in **§25 Change ledger** in the
  same change." · R3 "qualify, never the bare noun" (write **timeline mandate**, a lorebook's **Timeline**
  switch, never a bare _timeline_ for the mandate). · R6 "mark ⏳ transitional / 🚧 provisional vocabulary"
  (keep the existing 🚧 marks). No new names are introduced by this change; do not invent any.
- `docs/*.md` voice: plain present tense, second person, UI labels in **bold**, quoted UI sentences in
  *italics*; keep each page's existing heading anchors (other pages link to `#a-timeline-for-a-new-session`,
  `#a-lorebooks-timeline`, `#the-basics`).
- Don't touch copy strings in code (`description:` strings in presets, genre `about`): report any that the new
  default makes false instead.

## Edit

1. **SDK `sdk/src/genres.ts`** ~236–241: the `keepsTime` comment (it does not pick the timeline default any
   more) and the `timeline` comment — it says today "the default is derived from `keepsTime` — `'story'` starts a
   new lorebook with a timeline; `'real'`, `'none'` or left out starts none": correct it to the rule above. The
   short `GenreProps` comments ~458–461 if they now mislead.
2. **SDK `sdk/src/announce.ts`** ~330–337 `PresetDefaults.timeline`: "Left out = the genre's default (a genre
   that keeps story time defaults to one)" → left out = none, unless the genre requires one.
3. **SDK `core-catalog/src/seed/presets.ts`** comment at ~44–51 on Minimal ("🚧 It starts a session on its own
   notes undated (`defaults.timeline: false`)"): say it is now the default and kept explicit. Do **not** change
   any `description:` string or `defaults` value.
4. **SDK `guides/genres-presets-and-routines.md`** ~139–142 and ~724–728; **`INTEGRATING.md`** (canonical, SDK
   root): `grep -n "timeline" INTEGRATING.md` and correct any place that says a story-time genre starts a new
   lorebook with a timeline (~1641–1653 only says the genre/preset "pick a new session's notes' switch": leave
   it unless it states the old default).
5. **App `docs/sessions.md`** §"A timeline for a new session" (~46–56): rewrite the first paragraph to the new
   rule (Story's presets, Chat and Guide start without, so messages show their real time; the Lair and Dungeon
   Crawler always start with one; to keep story time in a Story session, switch the notes' **Timeline** on in
   Book settings or start on a lorebook that keeps one; a session or lorebook that already exists keeps its
   switch — a Story session started before this keeps its timeline). **Delete** the sentence "An administrator's
   copy of Story **Minimal** made before this existed starts with a timeline until they set it." (false now).
   The offer paragraph: say it now shows only for a preset whose default is a timeline (today none of Story's;
   the Lair and Dungeon Crawler), keeping its existing quoted sentences unchanged. Keep "**Create a lorebook** on
   this screen asks **Keep a timeline**, off by default."
6. **App `docs/genre-story.md`**: line ~17 (the Minimal row: "A new session's own notes start without a
   timeline…" now holds for every Story preset — move that to one sentence that covers all three, e.g. under the
   preset table or in the lorebook bullet ~27, linking `./sessions.md#a-timeline-for-a-new-session` and
   `./lorebook-time.md#a-lorebooks-timeline`); add one short paragraph "Without a timeline" listing what such a
   session doesn't do (the bullets above, briefly, each with its sentence) and where to switch it on; check
   ~64 ("Each round moves the clock … 🚧 On a lorebook with no timeline no clock moves at all") stays true.
7. **App `docs/genres.md`** ~24: correct "A genre that keeps story time (Story, the Lair, Dungeon Crawler) starts
   a new session's own notes with a timeline … A preset may override that default: Story's **Minimal** starts
   without one." to the new rule.
8. **App `docs/lorebook-time.md`**: `grep -n -i "preset and genre\|new session\|own notes"`; correct any
   sentence that states the old default (~35 "decides their timeline from its preset and genre instead" may
   stay if still true). ~37 (the one-time pass) stays as it is.
9. **App `NOMENCLATURE.md`**:
   - the **Timeline** row (`grep -n "^| \*\*Timeline\*\* (a lorebook's switch)"`): its "(`lorebooks/timeline.ts`:
     a genre that does not resolve → on; `timeline: 'required'` → on; else the preset's `defaults.timeline`
     when a boolean; else on when the genre keeps story time)" → "… else off (2026-11-16, lane tl-3a)".
   - the **keepsTime** row (`grep -n "time a genre keeps\*\* (\`keepsTime\`)"`): "the genre's **default** is
     derived, with no name of its own: `keepsTime: 'story'` → a new session's notes start with a timeline;
     `'real'`, `'none'` or left out → none." → corrected: since 2026-11-16 the default is off for every genre
     without the mandate; `keepsTime` no longer picks it; and "(Story **Minimal** says `false`)" stays true.
   - **§25 Change ledger**: append one bullet at the end of the 2026-11-16 bullets (after the `tl-2d` bullet,
     same shape as it): `- **2026-11-16 (lane tl-3a — undated by default, Story included; owner 2026-11-16 "If
     the genre/preset supports undated, use undated by default." / "Yes, story as well", superseding owner
     2026-11-14 "By default, Story Minimal will use an undated book. Messages will just display real time. All
     other Story presets will continue defaulting to timelined storybooks."; no new name, no migration).**`
     then: *changed* `timelineDefaultFor`'s last step (off; was on for `keepsTime: 'story'`); `keepsTime` no
     longer picks a new session's notes' timeline; the boot pass `timeline-switch` unchanged (existing data);
     docs and SDK comments listed by file. "Messages will just display real time" still stands.

## Files owned

SDK: `sdk/src/genres.ts` (comments only), `sdk/src/announce.ts` (comments only),
`core-catalog/src/seed/presets.ts` (comments only), `guides/genres-presets-and-routines.md`, `INTEGRATING.md`.
App: `docs/sessions.md`, `docs/genre-story.md`, `docs/genres.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md`.
Nothing else. (Another lane edited `docs/sessions.md` minutes ago: read the current text before each edit.)

## Out of scope (never built)

Any code. The start form's story-time control (lane tl-3b); dating play's writes (tl-2c). Don't document either
as existing.

## Stop and ask when

A doc states something you can't confirm from the rule above or the code; a sentence would need a new name;
a shipped `description:`/`about` string is now false (report it with the sentence, don't change it).

## Done means

The listed edits; `npx prettier --check` on the changed `.ts` files (SDK: run it from the SDK package dir with
the app's prettier, e.g. `cd /home/jody/github/serene-pub && npx prettier --check ../serene-pub-sdk/sdk/src/genres.ts`
— report the result even if the file was already unformatted before you).

## Report (your final message, under ~400 words)

Each file changed with a one-line summary; every user-facing sentence you wrote in docs (quoted) so the
supervisor can mark them ★; shipped copy now false (quoted); anything noticed but not done.
