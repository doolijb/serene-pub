# PLAN — What to fix before 0.6.0 — 2026-10-30

**Status: BUILT 2026-10-30 (uncommitted); owner items open, see §10.** Owner go the same day ("comb through it, fix any issues or gaps and then
implement"), as Opus supervisors per domain with Sonnet workers. §10 says what is being built, what the
review changed, and what still waits on an owner ruling. Every item comes from the 2026-10-30 competitive review
(floor, ceiling, SDK), summarised in memory `project_competitive_gaps_ledger`. Each says what we
found, where, what to do, how big it is (S/M/L), and when it has to land. Owner decisions are ★,
collected in §9 with a recommended default for each.

Companion: `plans/PLAN-serene-packages-2026-10-30.md` (the `.serene` package seams, ★P1 decides
0.6 or 0.7).

## 0. Owner's words (2026-10-30)

> Okay, write a plan with the things that need to be fixed prior to 0.6, i probably wont pay for
> signing yet, unless it's under $50 a year. Draft up the .serene seams as well.

Target: 0.6.0 in late November.

## 1. Calendar (proposed, ★R1)

- **RC1: Monday 2026-11-16.** Pre-release databases are disposable and the migration chain is
  squashed at RC1 (memory `feedback_prereleases_disposable_squash_at_rc1`). After RC1 every
  migration is permanent, so anything that changes schema or stored data lands **before RC1**.
- **0.6.0: Monday 2026-11-30.** Two weeks of soak on RC builds. Only fixes after RC1.
- That leaves about two weeks of feature work. Work already in flight (§7) competes for it, so this
  plan parks everything that isn't a fix (§8).

Each item below is tagged **before RC1** (touches schema, stored data or a format) or **before
final** (code, copy, docs, CI).

## 2. Verify first: possible release blockers

### A1. Server memory growth · before RC1 · S to verify, unknown to fix

**Found.** Life-sim walk run 5 (`~/.claude/plans/briefs/mundi-status.md`, E-M1 run5 notes): the
dev server died out of memory at a 6144 MB heap twice (about minute 22 and minute 28), was
restarted at 9216 MB, and reached 10 GB RSS. The run log says page loads leak about 1.5 GB each in
the dev server.

**Do.** Repeat the same walk against a production build (`npm run build`, then the built server)
with heap snapshots after 1, 5 and 20 page loads.
- If memory grows: find and fix it before RC1. A pub runs for weeks.
- If it doesn't: it's Vite dev-mode SSR. Write that into the contributor notes and close it.

**Found 2026-10-30 (lane V, `REPORT-readiness-laneV-2026-10-30.md`):** page loads don't leak (150 loads of the
production build plateau at 1.1–1.2 GB RSS; heap flat), but the out-of-memory crash **is a production bug**:
a plugin frame press in a busy session makes `routines/queue.ts` `drain()` spin, because `waitQuiet`'s
`sessionEventsIdle` resolves at once when the event chain is empty, so timers never run and the busy run never
ends; the heap grows 0.4–0.6 GB/s to 6 GB. Fix: yield on the 200 ms beat whenever nothing is pending (lane R,
before RC1). Separately: each press costs 12–17 s of near-100% CPU in database queries (parked, perf).

### A2. The capability checklist nobody has ticked · before final · S

**Found.** `TESTING-CHECKLIST-0.6.0.md` has 71 boxes and none ticked. The release plan warned
that feedback windows pass unused without a named place to send results
(`../serene-pub-sdk/plans/07-RELEASE-PLAN.md` §0e).

**Do.** Name the place: a GitHub issue form (`.github/ISSUE_TEMPLATE/capability-report.yml`) linked
from the top of the checklist and from the next pre-release's notes. The app already marks unconfirmed capabilities **Assumed**, so an
unticked item is disclosed, not hidden. Nothing here blocks the release unless a tester finds a
real failure.

## 3. The floor: a new player's first hour

### B1. Windows signing for free: SignPath Foundation · before final · S (+ approval lead time)

**Within budget ($0):** the SignPath Foundation signs open-source Windows builds for free. Its
conditions (to re-read on signpath.org before applying):
- an OSI-approved licence (AGPL-3.0 qualifies);
- no proprietary components in what is signed;
- builds from a public repository, signed from CI (releases already build on GitHub, memory
  `project_app_releases_build_on_github`);
- MFA for everyone on the project, on SignPath and GitHub;
- a published code-signing policy page;
- the certificate is issued to **SignPath Foundation**, which shows as the publisher (★S2).

**Over budget:**

| Option | Cost |
| --- | --- |
| Azure Artifact Signing (was Trusted Signing) | $9.99 a month, about $120 a year |
| Certum Open Source Code Signing | from €69 |
| Apple Developer Program (macOS) | $99 a year |

**Do.**
1. Apply now (★S1); the approval time is not published.
2. Confirm the Windows bundle holds only open-source parts: launcher, Node runtime, app.
3. Add the signing step to the release workflow, gated on repository variables/secrets so it is skipped
   until the SignPath project exists (`signpath/github-action-submit-signing-request`).
4. Write the policy page.
5. Update `docs/install.md` Windows step 4: the warning may still appear on early downloads while
   the certificate builds reputation, so word it as "may".

macOS stays unsigned: `docs/install.md` already has the two-step unblock and the `xattr` line.

### B2. A free first reply without a graphics card · before final · S (option a)

**Found.**
- AI Horde in Serene Pub is images only: `CONNECTION_TYPE.HORDE` resolves to
  `imageAdapters/HordeAdapter` (`src/lib/server/adapters/registry.ts:242`).
- `docs/connect-a-model.md:36` says the hosted path is "Make an account, add credit, copy a key".
- OpenRouter's `:free` models need no credit: 50 requests a day and 20 a minute without a
  purchase, 1,000 a day after a one-time $10. The free list changes over time.

**Do (★F1).**
- **(a)** Say so in `docs/connect-a-model.md` and on the wizard's online-service checklist: an
  account and a key with no credit gets free models, about 50 replies a day. Put free models first in
  the picker when the key has no credit: OpenRouter's `GET /api/v1/auth/key` answers `is_free_tier`, and free
  models carry the `:free` suffix with zero prices in `/api/v1/models`.
- **(b)** An AI Horde text connection, a sibling of the image adapter: no account at all, replies
  from a volunteer queue. M.
- Recommended: (a) for 0.6, (b) after.

### B3. Answer the hardware questions for the person · before final · M

**Found.** `docs/connect-a-model.md:45-46` has the person pick a KoboldCPP build by hardware and
answer **How much memory does this machine have?** The server detects neither: the only hardware
fact is `recommended_vram` on each recommended row (`src/lib/server/connections/recommendedGguf.ts:40`).

**Do.** Detect the GPU vendor and its memory:
- `nvidia-smi` on NVIDIA;
- `rocm-smi` on AMD where present;
- system memory on Apple Silicon (unified);
- otherwise CPU only, with `os.totalmem()`.

Use the result to preselect the build and the memory answer, and say why, per
`feedback_pickers_explain_why`: *Picked because this computer has an NVIDIA card with 12 GB.* The
person can still change both. This is the detection slice of `PLAN-local-hardware-2026-10-28`
only; the graphs and allotment stay parked (§8).

### B4. Something to play without the internet · before final · M (mostly writing)

**Found.**
- Core ships two primers, **Vis Itineris** (a d20 starter world) and **Blank**
  (`../serene-pub-sdk/core-catalog/src/registry/primers.ts`). No character ships.
- The wizard's character step offers the **Library** (online), **Import a card** or **Create one**
  (`docs/getting-started.md` §4).
- So a first Story session needs the internet or writing by hand, and the only shipped world plays
  dice rules, the wrong first impression for Story.

**Do (★F2).** Ship one starter character and one small Freeform starter world, in our own words:
- the character is offered first on the wizard's **Pick a character** step and is **created only when
  picked** (nothing is seeded at boot: `feedback_never_seed_fixed_ids`);
- the world shows as a starter lorebook marked *Comes with Serene Pub*.

## 4. Data and formats that freeze at RC1

### C0. The squash itself · at RC1 · L (gap found in review)

The 2026-10-19 ruling (`feedback_prereleases_disposable_squash_at_rc1`) makes RC1 a change, not a date:
squash migrations `0094+` into one (keeping `0000`–`0093` byte-identical and the `0095` attic stash), add the
boot refusal for a ledger holding pr-era migration names (else the lower-index chain is silently skipped), and
verify a 0.5.3 pre-upgrade backup restores and upgrades on RC1 (`reference_real_data_upgrade_check`). Plan
this as its own lane in the week of 2026-11-09; nothing else in this plan touches schema.

### C1. Rule on card stats · before RC1 · per that plan

`plans/PLAN-card-stats-removal-2026-10-29.md` is PROPOSED with ★C1–C5 open. Part A deletes rows
through migration 0134, so it is before-RC1 work if it goes ahead.

Either way, `docs/stats-and-states.md` "Where a value comes from" still teaches "the card is the
template", although sheets have done nothing since 2026-10-23. The docs must match the ruling.

### C2. Lorebook export · before final · M (option a)

**Found.** **Export… (paused)** is greyed out (`src/lib/client/lorebooks/LorebooksWorkspace.svelte:1483`,
`LOREBOOK_EXPORT_PAUSED`), "while the lorebook format settles" (`docs/lorebooks.md:279`). A
character card can already carry a book's main line without branches or dated changes
(same page), so a flattening path exists to build on.

**Do (★E1).**
- **(a)** Ship a SillyTavern World Info export of the main line as it stands now. It is lossy:
  branches, amendments, dated values and the places graph don't travel. The dialog says so in one
  sentence. It commits nothing about the native format.
- **(b)** A native export. That is a format commitment, and it belongs with the SDK freeze in 0.7,
  possibly as a `.serene` package holding a lorebook (see the package plan, §4 there).
- **(c)** Stay paused and say so in the release notes.
- Recommended: (a).
- **Review 2026-10-30:** (a) conflicts with the owner's 2026-09-28 ruling (`project_lorebooks_audit_rulings_2026_09_28`,
  item 1: "No exports yet… never re-enable export or widen its format without a new ruling"). Not built; stays
  (c) until the owner rules again. The 09-28 note also left "card export embedding a lorebook" open.

### C3. The `.serene` package format · per ★P1

See `plans/PLAN-serene-packages-2026-10-30.md`. Reading packages in place needs no migration:
`plugin_files.stored_at` is free text, so a new `'package'` value fits as it is. So it isn't tied
to RC1. The draft recommends 0.7, with the HTTP upload (K6 there) as the one piece worth pulling
forward if plugins surface in 0.6 (★D1).

## 5. Plugins and the SDK promise

### D1. Plugins ship switched off · before final · S–M (option b)

**Found.**
- `docs/environment-variables.md:78`: `SP_PLUGINS_ENABLED`, "Releases ship with it off".
- `docs/plugins.md`: installed plugins "do nothing" until the pub turns them on.
- The life-sim port, the SDK's best proof, therefore needs a server environment variable. That's a
  wall for anyone who doesn't use a terminal.

**Do (★D1).**
- **(a)** Keep it off, and ship a `0.7.0-pre1` channel beside 0.6 with plugins on
  (`07-RELEASE-PLAN.md` §0).
- **(b)** Add a switch in **Admin › Plugins**, off by default. It does what the variable does, and
  the variable still forces either way when set. Installing already takes an admin and a permission
  review, so the variable is a second gate only someone at a terminal can open. Check whether the
  sandbox starts only at boot; if so, the switch says *Takes effect after a restart*.
- **(c)** On by default.
- Recommended: (b).
- **Review 2026-10-30:** (b) conflicted with the owner's 2026-08-17 decision in `07-RELEASE-PLAN.md` §0
  (`0.6.0-beta` off, `0.7.0-pre1` exposed). **Owner, same day: "Let's switch plugins on. We won't ship 0.7
  pre-release side by side after all."** RULED (c) with (b)'s switch: on by default, an Admin › Plugins
  switch, the variable forces when set. Lane P builds it, and pulls the package plan's K6 (HTTP upload)
  forward with it.

### D2. Publish what the SDK promises before 1.0 · before final · S

**Found.** NarrativeEngine (generation-1 API, additive only, enforced by a test), TauriTavern
(a tiered "Host Contract") and Marinara (a versioned capability API with engine min/max) publish a
stability statement today. The SDK has the 🚧/⏳ markers and `@1` pins, but no page that says what
they promise.

**Do.** One SDK guide page:
- what a pin like `@1` means;
- what 🚧 and ⏳ mean;
- what may still change before 1.0 (0.7);
- what never breaks (stored data is upgraded by core);
- where breaking changes are announced.

Link it from the SDK README and `docs/plugins.md`.

### D3. Make the CLI agree with itself · before final · S each

Both from the life-sim readiness list (`~/.claude/plans/briefs/mundi-readiness.md`):
- **c33.** `serene-pub check` passes a package that `serene-pub build` refuses, because check does
  no `defineExtension` evaluation and runs no compiler `E_*` findings. **Do:** check runs build's
  evaluation and findings without writing.
- **c36.** A node definition changed under the same pin is refused in a live process
  (*duplicate type id … this process already holds a different declaration*) until restart. That
  breaks the release plan's "edit-to-effect with no SP restart" bar. **Do:** a reinstall of the
  same plugin replaces its own declarations; a different owner's clash still refuses.

### D4. One docs contradiction · before final · XS

`../serene-pub-sdk/guides/extending.md:16` says a ruleset is published on a pub and "a package
can't carry one yet". `guides/rulesets.md` (§ "Shipping a ruleset in a plugin package") and the
pr-7 release notes say it can. **Do:** fix the row and point it at that section.

### D5. Two quality-bar items I couldn't find · before final · ★D2

`07-RELEASE-PLAN.md` §5 names the bar in 15 §4. Two items have no evidence in the tree:
- **Scaffold to visible render in under 60 seconds, timed in CI.**
  `sdk-tests/scaffoldPlugin.test.ts` tests the scaffold, but nothing times it.
- **The install screen prints the cannot-do list.** Nothing in
  `src/lib/client/admin/sections/plugins/` shows one; it may live elsewhere.

**Do:** find them, build them (S–M each), or strike them from the 0.6 gate by ruling.
**Review 2026-10-30:** neither exists. The cannot-do list is being built (lane P); the CI timing is struck
for 0.6 and returns with SDK 1.0 in 0.7 (recommended default taken; no owner pushback on record).

## 6. Visibility · before final · XS each, all owner actions

- **E1. Release from `main`.** The catalogue at tavernary.org shows Serene Pub's "last source
  activity" as a month ago, probably because it reads the default branch (unconfirmed). Every
  pre-release so far came from `develop`. Commits stay on your schedule; this only notes the cost.
- **E2. Catalogue card copy.** Add "installs its own model and voice" and multiplayer to the
  listing.
- **E3. A "Not in 0.6" section in the release notes.** It stops reviewers reading these as
  oversights:
  - modifiers (poisoned, resistance, proficiency);
  - an iOS app;
  - the native lorebook format;
  - (plugins are on in 0.6, ruled 2026-10-30; the `.serene` format is 0.7.)

## 7. Already in flight: these close before RC1 or move out

Status only, no new work:
- audio.cpp run by Serene Pub (`PLAN-audiocpp-managed-2026-10-28`, BUILDING).
- The model library, part 1 (`PLAN-model-library-2026-10-29`, BUILDING). Lane MV left defects V3–V7
  open (`plans/REPORT-model-laneMV-2026-10-29.md`).
- Speech defects V-4 and V-5 (memory `project_speech_plan_2026_10_28`).
- Life-sim walk run 5, step 3b, PARTIAL: **Ask them out** posts an empty **You** row and no reply.
  Triage whether that's the port or core.

## 8. Parked past 0.6

These are not fixes, so each waits:
- `PLAN-local-hardware-2026-10-28`, except B3's detection slice.
- Card stats Part B (strokes), unless ★C5 folds it in.
- Modifiers.
- A native lorebook format (with the SDK freeze in 0.7).
- The rule that plugin code never calls a model or waits for its answer (life-sim readiness c5).
  Rule on it on purpose before 1.0; it caps agent-style plugins.
- A native mobile app, and compatibility with SillyTavern extensions. Neither is planned.

## 9. Open ★ (recommended default first)

| ★ | Question | Recommended |
| --- | --- | --- |
| R1 | RC1 2026-11-16, final 2026-11-30? | Yes |
| S1 | Apply to the SignPath Foundation now? | Yes |
| S2 | The publisher reads "SignPath Foundation": acceptable? | Yes; the policy page names Serene Pub |
| F1 | Free path without a GPU: (a) OpenRouter free models in docs and wizard, (b) AI Horde text, (c) both | (a) now, (b) after 0.6 |
| F2 | Who writes the starter character and Freeform world? | Owner; or I draft and you edit |
| E1 | Lorebook export: (a) World Info of the main line, (b) native, (c) stay paused | (a) |
| D1 | Plugins: (a) off with a 0.7-pre1 channel, (b) admin switch, (c) on | **RULED 2026-10-30: (c) on by default, with (b)'s switch** |
| D2 | The two quality-bar items: build or strike for 0.6? | Build the cannot-do list; strike the CI timing until 0.7 |
| P1 | `.serene` in 0.6 or 0.7? (package plan) | 0.7 |
| C1–C5 | Card stats (that plan) | Rule before RC1 |

## 10. Implementation status (2026-10-30)

| Lane | Items | Built by |
| --- | --- | --- |
| C Connections | B2(a) free-tier hint + checklist line; B3 hardware detection and preselect | Opus supervisor, Sonnet workers |
| K Starter content | B4 Freeform starter primer + starter character (created on pick) | same |
| S SDK and CLI | D2 `guides/stability.md`; D3 c33, c36; D4 | same |
| P Plugins | D5 cannot-do list (CI timing struck); D1 plugins on + admin switch; package-plan K6 HTTP upload | same |
| W Docs and release | B1 policy page, install.md "may", gated workflow step; A2 issue form; B2 docs; E3 draft | same |
| V Verification | A1 production memory walk: no page-load leak; found the routine-queue spin (production bug) | same |
| R Routines | A1 fix: `waitQuiet` yields on the beat; real-timer regression test | same |

**Waiting on the owner:** ★R1 (calendar), ★S1/★S2 (apply at SignPath, MFA, repo variables), ★C1–C5 (card
stats), ★E1 (lorebook export: 09-28 ruling stands until changed),  ★P1 (`.serene`: 0.7 as recommended), E1/E2 (release from `main`, catalogue copy), C0 (squash lane).

### Verification (lead, 2026-10-30, after all lanes)

- `npm run sdk:build` ok. `sdk:test`: one failure, pre-existing (`core-catalog/src/shared/speakMessage.ts`
  derive-don't-spell; file last changed 10-29 19:26 by the speech work).
- `svelte-check`: 0 errors, 7 warnings in untouched files. Needs `NODE_OPTIONS=--max-old-space-size=14336`; the
  default 4 GB heap dies on this tree (`npm run check` will too until the script sets it).
- Full vitest: 20,459 passed; 23 files failed, of which 3 were lane-caused and are fixed (logbook event declared by
  the HTTP recorder; `plugins.int.test.ts` sets the flag off; three comment phrases reworded). The other 20 are
  in-flight speech / model-library / layering work from other sessions (speak oracle, `text->audio`, 0137 loadout
  voices, layouts 29 vs 28, "No Book").
- `npm run build` ok.
- Not done: lane V's production re-check of the spin fix (≥100 frame presses, heap under 0.5 GB).

## Ledger

- 2026-10-30 (end) — all lanes reported; verification above; status BUILT, owner items in §10.
- 2026-10-30 (later still) — owner: plugins on in 0.6, no side-by-side 0.7 pre-release (★D1 ruled); K6 pulled forward.
- 2026-10-30 (later) — owner go; review found two ★ that conflict with standing rulings (E1, D1) and one
  missing before-RC1 item (C0). Lanes launched; see §10 and `plans/REPORT-readiness-lane*-2026-10-30.md`.
- 2026-10-30 — written from the competitive review. Signing prices checked the same day: Azure
  Artifact Signing $9.99 a month (DevClass, 2026-01-14); Certum Open Source from €69 (shop);
  Apple Developer $99 a year. OpenRouter free limits from its free-variant docs and third-party
  summaries; re-check before writing copy.
