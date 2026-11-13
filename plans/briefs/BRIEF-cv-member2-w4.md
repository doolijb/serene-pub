# BRIEF cv-member2-w4 — client: the Update offer on the cast line (B1) and the admin lift list (B3)

Worker (Sonnet) for lane-supervisor cv-member2. App `/home/jody/github/serene-pub`. Use absolute paths. Hand back your report as your final message (no report file). A server worker builds the server side at the same time; you build against the **wire contract**, already written.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

**Do not run `prettier --write` on a whole file.** These files carry other lanes' uncommitted hunks; reformatting them buries the diff. Format only the lines you write.

## The contract (`src/lib/shared/sockets/types.ts`; events already in `typedSocket.ts` and `interest.ts`)
- `Sockets.Lorebooks.BindingsForCharacter.Response.members[]` gains `cardVersion`, `cardCurrentVersion` (`{id, number, label}` or null) and `behindCard`.
- `lorebooks:updateMemberToCardVersion { castId }` → `{ lorebookId, castId, moved, cardVersion, lorebookBinding }`, scoped on `lorebookId`; `:error` on refusal.
- `admin:castLiftNotes {}` → `Sockets.Admin.CastLiftNotes.Response` `{ count, members: [{ castMemberId, lorebookId, lorebookName, memberName, note: { v: 1, differences: [{ branchId, line, at: {kind:"date", date} | {kind:"before-first-change"}, appearance, fields }], mixedGreetings? } }] }`; `:error`.
- `admin:castLiftFollowGreetings { castMemberId }` → the refreshed list (same shape); `:error`.
- `Admin.Overview.Response.data.castLiftCount: number`.

## Files owned (edit only these)
- `src/lib/client/components/characterForms/CastLine.svelte`, `castBannerWords.ts` (the `CastBannerMember` type gains the three fields), and — only to re-ask the cast line after an update — the `bindingsForCharacter` hunks of `CharacterForm.svelte` and `CharacterViewPanel.svelte`.
- `src/lib/client/lorebooks/cast/CardUpdateOffer.svelte` (built by an earlier worker; you may add an optional `onUpdated?: (reply) => void` prop and nothing else).
- `src/lib/client/admin/sections/overview/Page.svelte` (the Data card's line) and `src/lib/client/admin/sections/data/Page.svelte`, plus new files under `src/lib/client/admin/sections/data/` (e.g. `CastUpgradeCard.svelte`, `castUpgradeWords.ts`).
- `src/lib/client/components/Layout.svelte` — only `HANDLED_ERROR_EVENTS`: add `lorebooks:updateMemberToCardVersion:error`, `admin:castLiftNotes:error`, `admin:castLiftFollowGreetings:error` with a comment saying the views say them inline (without this, Layout's catch-all toasts them a second time).
- New test files.

## Files readable
`src/lib/client/lorebooks/cast/CardUpdateOffer.svelte` and `cardUpdateWords.ts` (reuse them as they are), `src/lib/client/components/characterForms/cardVersionWords.ts` (`versionLabelText`), `castLine.dom.test.svelte.ts` and `characterViewCastLine.dom.test.svelte.ts` (how the cast line is mounted in tests), `src/lib/client/admin/adminHealth.svelte.ts`, `src/lib/client/utils/awaitReply.ts`, `src/lib/client/sockets/interest.svelte.ts` (`useInterest`, `requestWithInterest`), `src/lib/shared/lorebooks/storyDate.ts` (`formatDate(date, calendar?)` — free-form without a calendar), STYLE-GUIDE §6.11 (admin pages: the Overview is an index of cards; Data and backups is a settings form, one column of `.panel-card` cards, one topic per card).

## What to build
### B1 — the cast line's offer
- Under the cast line (not inside its `<p>`), one `CardUpdateOffer` per member with `behindCard` and a `cardCurrentVersion` (`castId`, `lorebookId`, `memberName`, `cardVersion`, `cardCurrentVersion`). The line itself is unchanged. Plan §32 §9: "**Update ‹member› to card v2** appears per member: on the member page, on `CastLine` and on the Characters row." The cast line is worn by both the card editor and the card's profile in the Characters view, so this covers both; do not touch the Characters sidebar list.
- After a successful update the cast line is asked again (re-run the parent's existing `requestWithInterest` ask — e.g. an `onChanged` prop on `CastLine` that the parents use to re-trigger their effect), so the offer disappears.

### B3 — the admin list
- **Overview** (`overview/Page.svelte`): on the **Data and backups** card, when `ov.data.castLiftCount > 0`, one more line, tone `primary`, that is a link to `/admin/data#cast-upgrade`: _1 cast member reads differently since the upgrade_ / _N cast members read differently since the upgrade_. Not a Needs-you item. A line with its own link may need an optional `href` on the page's local `Line` type.
- **Data and backups** (`data/Page.svelte`): a `.panel-card` with `id="cast-upgrade"`, shown only when the list is non-empty, asked with `admin:castLiftNotes` on mount (`useInterest` / `requestWithInterest`, as the admin sections do). Title **Since the upgrade**; one sentence: _These cast members read a little differently than before the upgrade to character versions._ Then one row per member:
  - _Bianca in Porto Alto_ (`memberName in lorebookName`).
  - One line per difference: _On main, from ‹date›, reads the description and greetings differently than before the upgrade._ — `On main` for `branchId: null`, else `On ‹line›`; with a life point: _On main, from ‹date›, at life point 34, reads …_; `before-first-change`: _On main, before their first change, reads … differently than before the upgrade._ Dates through `formatDate(date)` (free-form; the list has no calendar). Fields in words, joined with commas and _and_: name, nickname, aliases, summary, description, personality, scenario, greetings, example dialogues, post-history instructions, creator notes, strokes, face, likeness, voice (for `timbre`), sprite set, extensions.
  - With `mixedGreetings`: _Their greetings became their own list, because only some of them were told in their own words before._ and a tonal button **Follow the card's greetings** → `awaitReply` on `admin:castLiftFollowGreetings` (`errorEvent` its `:error`); disabled while waiting; the reply replaces the list; a refusal shows inline under the button.
  - All of these words are provisional (★, cv-client's proposal; the button's words are ruled). Keep them in `castUpgradeWords.ts` (pure, unit-tested).

## Rules (quoted by the supervisor)
- CLAUDE.md standing ruling: "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." — no toasts from the new code; failures inline.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- STYLE-GUIDE §6.1: "One primary button per surface … Secondary actions are tonal." §9: real buttons and links with accessible names; never an interactive inside an interactive; nothing hover-only; 44px touch targets. §10: sentence case; a button says what happens; "Help is one sentence."; "Counts live in the copy where they help … not as badges."
- "Members never see or touch model plumbing" — n/a; the list is admin-only (the server enforces).
- Every session has a lorebook — never write "no book". It is a **session**, never a *chat*.
- Nomenclature R1/R3: no new user-facing word beyond the ones above; any other → stop and report.
- Decide implementation inside this scope and name each choice; anything beyond → stop and report.

## Tests (Done means)
- Cast line DOM test (extend `castLine.dom.test.svelte.ts` or a new file): a behind member shows the offer under the line with _Update ‹name› to card v1.1_; a member on the current version shows none; a reply makes the parent ask again (or the `onChanged` callback fire).
- `castUpgradeWords.test.ts`: each sentence form (main / a line, a date, a life point, before the first change, the field words and joining, singular/plural count line).
- A DOM test of the Data card: rows and sentences from a list; **Follow the card's greetings** emits `admin:castLiftFollowGreetings` with the id; the reply replaces the list; an `:error` shows inline; no toaster call; the card is absent with an empty list.
- An Overview DOM or unit test for the line (shown at count > 0 with its link, absent at 0) — use the existing admin view test fixture if one fits (`src/lib/client/admin/adminView.dom.test.svelte.ts`).
- Run, `--maxWorkers=2`, never piped into `head`:
  `npx vitest run src/lib/client/components/characterForms src/lib/client/admin src/lib/client/lorebooks/cast --maxWorkers=2`
  and `npx tsc --noEmit -p .` (no errors in your files; list others). List `/tmp/serene-pub-vitest-*` before and after; delete only your own, by name.

## Report (final message)
Names and signatures first; changed files; tests with counts; the provisional words (★); choices you made; anything you stopped on; Noticed, not done.
