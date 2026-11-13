# BRIEF s22-C-w1 — the book pick on the start form (UI + DOM tests)

Lane s22-C, worker 1. Supervisor wrote this; report back as your final message (changed files, tests run with counts, anything you could not do, questions).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
On **Start a session**, for a genre whose shape has a lorebook step (`flow.shape?.lorebook`) AND a rules offer (`flow.rulesOffer`), replace today's two cards — **Lorebook** (~line 1861) and **Rules** (~1992, which also holds How strict) — with ONE card, 🚧 **the book pick**, listing in three groups: the person's lorebooks, a blank start on each rules choice, and the starter lorebooks. Every row says how well its rules fit the genre. **How strict** moves to its own card right after, unchanged in behaviour. Nothing new is sent: Start still sends today's three shapes.

Owner rulings this implements (quote, do not reinterpret):
- Owner 2026-11-05: "merge ruleset selection into lorebook selection, so starting a new [own book] is choosing a ruleset blank book or a primer to start. Lorebooks and rulesets should both show ruleset compatibility with the genre/preset."
- **Rulesets are stateless** (11-05): a "blank book of a ruleset" is the session's own book made on that ruleset — today's request shape (no `lorebookId` + `primaryRuleset`).
- **★§22-1 (11-05): fix7 stands** — a book on **Freeform** (`BOOK_DEFAULT_RULES`) brings no rules of its own: its row keeps a rules choice under it ("‹book› with ‹ruleset›"); a book that names a ruleset fixes the rules. (Same for a starter lorebook on Freeform — today's test "a starter lorebook on Freeform brings none either" stays true.)
- **★§22-2 (11-05): `rulesets: { only }` stays a lock** — the offer already lists only those; a book/starter bringing other rules is refused by the server, so its row is greyed with the reason (below). Fit words come from `rulesOffer.choices[].fit` (today's).
- **Challenger 1: merge only where the genre declares `shape.lorebook`.** A genre with no lorebook step (Dungeon Crawler) keeps today's Rules card untouched. **How strict is a session setting, never the book's**: its own field after the pick, under `rigourFor` / `rigourLocked` exactly as today.
- **Challenger 2: the three rows are today's three request shapes** — existing book → `lorebookId` (attached, never cloned); blank → no book + `primaryRuleset`; starter → `starterKit`. `buildCreatePayload` does not change.

## Files owned (edit only these)
- `src/lib/client/components/sessionForms/StartSessionForm.svelte` — SHARED and dirty at HEAD: another lane (m3b-F) edits picker words and the lead edited the applet confirm helpers at the top of the script today. **Re-read the exact region immediately before every edit; additive/targeted hunks only; never reformat the file; never run `prettier --write` on it.**
- `src/lib/client/components/lorebookForms/StarterKitPicker.svelte` — at most two new OPTIONAL props; with neither passed it must render exactly as today (the New lorebook dialog uses it).
- `src/lib/client/components/sessionForms/startSessionRules.dom.test.svelte.ts` (update tests whose markup moved; add the new ones), `src/lib/client/components/sessionForms/startSessionApplet.dom.test.svelte.ts` (one additive test for the confirm line; dirty at HEAD — additive only).

## Files readable
`createSession.svelte.ts` (the store — do NOT edit; the supervisor already added what you need, below), `src/lib/shared/rulesets/rulesOffer.ts`, `src/lib/client/lorebooks/starterKitCards.ts`, `STYLE-GUIDE.md` §6.4 (the "pick-one list" and "New lorebook's two ways" paragraphs), other `sessionForms/*.dom.test.svelte.ts` for patterns.

## What the store gives you (already in `createSession.svelte.ts`)
- `export type BookPickKind = "book" | "blank" | "starter"`
- `export function bookRulesFit(offer: GenreRulesOffer, primaryRuleset: string | null | undefined, genreName?: string | null): { rulesId: string | null; choice: RulesChoice | null; refusal: string | null }` — `rulesId` null = Freeform (brings none); `choice` = the offer's row for those rules (name, `fit`, `recommended`) or null when the offer doesn't list them; `refusal` = the sentence when an `only` genre can't take them (row disabled).
- `flow.bookPick` (derived): `{ kind, rulesId, rulesFromBook } | null` — null when the genre has no lorebook step or no rules offer.
- `flow.pickBlank(rulesId)` — sets no book, no starter, `rulesPick = rulesId`. The component must also clear its own `kitCardId` (as `chooseLorebook` does).
- Unchanged: `flow.rulesPick`, `rulesNowId`, `rulesShown`, `adoptedRules`, `lorebookRules` (still set by the component's `$effect` from the chosen book/kit), `rigour`, `rigourLocked`, `rulesFixed`, `presetRigour`.

## The card (copy below is the supervisor's recommendation; build it exactly — the owner rules it later as ★)
Drawn when `flow.mode !== "branch" && flow.mode !== "next-chapter" && showLorebook && rulesOffer` (call it `bookPickShown`). When it is not drawn, today's Lorebook card and today's Rules card render EXACTLY as now (Dungeon Crawler; Chat/Guide have a lorebook step but no rules offer → today's Lorebook card with **None**; next-chapter → today's Rules card). Keep both old cards' markup for those paths.

- `<section class={CARD_CLASS} aria-labelledby="start-book-pick-heading" data-book-pick>`; heading `<h3>` **Lorebook and rules**; line (`text-xs` muted, as today's): *The world the session reads, and the rules it plays by.* In `new-world` mode keep today's extra line. Then `rulesOffer.playsBestWith` line when present (keep `data-rules-plays-best-with`). When `flow.rulesFixed`: *The rules can't be changed after the session starts.* (keep `data-testid="start-rules-fixed"`).
- **Group 1, *Your lorebooks*** (group label `<p id=… class="mt-3 text-chip font-medium">`, a `role="radiogroup"` labelled by it): one row per `lorebookOptions` entry (same row markup as today's book rows: glyph, 15px name, check when chosen, `sidebar-row-active`), plus a second 12px muted line from `bookRulesFit(rulesOffer, l.primaryRuleset, genreName)`:
  - rules listed by the offer: *Rules: ‹name›*, then the star (`Icons.Star`, `aria-label="Recommended for this genre"`) when `choice.recommended`, then the rating word (`RATING_WORD`) when `choice.fit`; under it the fit `reason` when the rating is below great (as today's Rules rows do);
  - rules not listed and no refusal: *Rules of its own*;
  - refusal: the row is `disabled` + `aria-disabled`, greyed like today's Incompatible rules rows, and the line is the refusal sentence;
  - Freeform (`rulesId === null`): *Freeform: brings no rules of its own*. When this row is chosen, **unfold under it** (inside its `<li>`, indented) a label *Play it with* (`<p id=…>`) and the rules rows (the same band rows as today's Rules card: bands *Great · Perfect* / *Ok · Good* / *Poor* / *Incompatible* via `rulesBands`, star, rating, reason/subtitle, Incompatible disabled, admin **Why?**) as a radiogroup labelled by it; a row there is chosen when `rulesNow?.value === r.id`, and picking it calls `chooseRules(r.id)`. Container `data-book-rules-under`.
  - With no lorebooks: today's *You have no lorebooks yet. This genre can start without one.* and the **Create a lorebook** button, unchanged. (The Create action stays on the card exactly where it is today.)
  - Keep `data-lorebook-option`-style hooks you need for tests (add `data-book-row={l.id}` on each book button).
- **Group 2, *Start blank*** — NOT drawn in `new-world` mode (today's None is hidden there too). Label *Start blank* and one muted line *No lorebook: the session keeps its world in its own notes.*; then the rules band rows (the same snippet as the unfold — write it ONCE as a `{#snippet}` taking a "chosen" predicate and an onpick) where a row is chosen when `noLorebookChosen && rulesNow?.value === r.id`, and picking calls `touch()`, `kitCardId = ""`, `flow.pickBlank(r.id)`. Keep `data-rules-choice={r.id}` / `data-rules-rating` on these rows (existing tests use them); the unfold's rows get `data-book-rules-choice={r.id}` instead so the two never collide. The genre's default is pre-selected because nothing is chosen and `rulesNowId` falls back to `rulesDefault` — a person who touches nothing sends today's payload.
- **Group 3, *Start from a starter lorebook*** (only when `kits?.length`, as today; same label, same `StarterKitPicker`, same `KIT_SESSION_NOTE` line): pass the picker the fit words per kit from `bookRulesFit(rulesOffer, kit.rulesId, genreName)` — rules listed: *Rules: ‹kit.rulesName› · ‹Rating›* (+ star when recommended); Freeform: *Freeform: brings no rules of its own*; refusal: disabled with the sentence. When a Freeform kit is chosen, the same *Play it with* unfold shows (under the picker, after the note, or under the chosen row if your prop allows — your call, say which).
- **Under the card**: the chosen rules' `fit.inWords` list (today's `data-rules-in-words` markup), for whatever rules are in force (`rulesNow?.value`), including a book's own.
- `genreName`: `flow.genre?.name` (the expression the form already uses).

### StarterKitPicker props (optional; your names, say them in the report)
At most two: one giving a row's rules line + refusal (refusal ⇒ the row's button is `disabled`, the line shows the sentence), and optionally one snippet rendered under the chosen row. Absent ⇒ today's *Rules: {kit.rulesName}* and no disabling. `choose()` must ignore a disabled card.

## How strict card (after the book pick card, only when `bookPickShown`)
A separate `<section class={CARD_CLASS} aria-labelledby="start-how-strict-heading">` holding today's `presetRigourUnplayed` hint (`data-testid="start-rules-preset-hint"`, same words; its trailing *Pick rules with numbers for them to decide.* when the rules are not the book's) and today's How strict radios (same condition: `!flow.rigourLocked && asksHowStrict(rulesOffer) && howStrictChoices(rulesOffer, rulesNow?.value).length > 1`, same `data-how-strict`, same heading *How strict*). Draw the section only when one of the two shows. Semantics unchanged.

## Applet confirm (top of the script, `confirmFacts`, ~line 368 — the lead edited it today; re-read first)
Change only the *Lorebook:* line: when the genre has a rules offer and the chosen book is on Freeform (`bookRulesFit(...).rulesId === null`), say *Lorebook: ‹book› with ‹rules name›* (the rules in force, `rulesNow`'s name from `rulesOffer.choices`); otherwise unchanged. One additive test in `startSessionApplet.dom.test.svelte.ts`.

## Rules you work under (quoted)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope … Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration … files outside the asked area." The copy above is decided by the supervisor; any OTHER copy you'd add or change is a ★ in your report, not built. "Findings along the way go under **Noticed, not done**, never fixed in passing."
- NOMENCLATURE R3 "Qualify, never abbreviate to the bare noun." · §28: "The client never shows an SDK noun — ruleset, mechanics, rigour, repertoire, piece, compendium, bridge, parked, bestow, render depth, primer, own book, table channel." Players read **Rules**, **How strict**, **Starter lorebook**, **Session notes** / *its own notes*. §23: **"phantom" is retired** — never in code comments or copy; say *own book* in code. Never *chat* for a session.
- STYLE-GUIDE §6.4 pick-one list: "a radio list, not a grid of cards: one row per option — a radio mark, the 15px name, one 13px muted line truncated to the row — and the chosen row in `.sidebar-row-active` (tonal plus the 3px bar, never a fill), the only row that unfolds". Rows `min-h-11` (44px touch). §10: sentence case; "Help is one sentence."
- Pickers explain why: each row carries its fit rating, and below great its reason sentence.
- Sockets: views never call `toaster` and register listeners only for local state; `socket.off(event)` always with its handler. No new socket requests are needed for this task — if you think one is, stop and say so.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. No `crypto.randomUUID`, no `navigator.clipboard`.
- Svelte 5 runes; Tailwind 4; Skeleton 5. Match the file's existing classes; no new colours or utilities.
- Never send a new field to `sessions:create`; never edit server or SDK files; never edit `createSession.svelte.ts` (w2 owns its tests; the supervisor owns the store). If you need a store change, stop and report it.

## Tests (Done means)
Run ONLY: `npx vitest run src/lib/client/components/sessionForms/startSessionRules.dom.test.svelte.ts src/lib/client/components/sessionForms/startSessionApplet.dom.test.svelte.ts src/lib/client/components/sessionForms/startSessionModes.dom.test.svelte.ts src/lib/client/components/sessionForms/startSessionCast.dom.test.svelte.ts src/lib/client/components/sessionForms/startSessionAsks.dom.test.svelte.ts` — all green. Never pipe vitest into `head`. Update existing tests in `startSessionRules.dom.test.svelte.ts` whose markup moved (keep each test's intent and name; say which you changed and why). Add a `describe("Start a session › the book pick", …)` covering at least:
1. nothing touched → the payload has no `lorebookId` and `primaryRuleset` = the genre default (today's payload);
2. a book with rules of its own → its row reads *Rules: ‹name› · ‹Rating›*; picked → `lorebookId` and no `primaryRuleset`;
3. a Freeform book → *Play it with* unfolds; picking a rules row there → `lorebookId` + that `primaryRuleset`;
4. a *Start blank* row → no `lorebookId` + that `primaryRuleset`; picking a book then a blank row drops the book;
5. a starter lorebook → `starterKit` sent, no `lorebookId`; a Freeform starter unfolds *Play it with*;
6. Dungeon Crawler (no lorebook step) → today's Rules card, no `data-book-pick` (the existing test may already assert it: extend it);
7. an `only` genre → *Start blank* lists only its rules; a book on other rules is disabled with the sentence *‹Genre› plays only by ‹A or B› rules.*;
8. How strict follows the chosen rules (`rigourFor`) — a book's own rules, and a blank pick — and sits in its own card after the book pick;
9. Chat-like genre (lorebook step, no rules offer) → today's Lorebook card with **None**, no `data-book-pick`.
`npx prettier --check` on any NEW file you create (not on files dirty at HEAD).

## Verbatim lane rules
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should need no `sdk:build`.)
- Never `git checkout` / `restore` in either repo.

## Stop and ask when
CLAUDE.md §Decisions applies (new copy beyond the above, a new name/prop beyond the two StarterKitPicker props, a socket, a store change), a ★ is unruled, or a test would need a server change.

## Report
Your final message: changed files; the StarterKitPicker prop names; which existing tests you changed and why; tests run with pass counts; ★ / questions; Noticed, not done.
