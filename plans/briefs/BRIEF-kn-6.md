# BRIEF — build lane `kn-6` — a knowledge tie play writes off Full is offered in Apply (owner ruling D41)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (docs / one comment only).
Supervisor: read `.claude/guides/multi-agent.md`, then row D41 in `plans/DISCUSS-LATER.md` (ruled),
`plans/REPORT-kn-4b-2026-11-16.md`, `plans/REPORT-kn-5-2026-11-16.md` (hand-tie precedence),
the "Cold review corrections" of `plans/briefs/BRIEF-kn-5.md` (the part cut out as C), `docs/lorebooks.md`
(Apply / Take back ~304; knowledge), `NOMENCLATURE.md` §1, §24 and rows **Apply**, **Take back**, **held
change**, **known**, **hand tie** (~379: "Only Apply settles", 2026-11-11).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. **No
migration** (stop and report if one is needed). Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-6-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`, no
`sdk:build` (docs only in the SDK).

## Owner

2026-11-16 (D41): "Offer it in Apply". 2026-11-16 (D39): "A hand tie always wins over what play wrote".
2026-11-11 (S3): "Only Apply settles". P2: the module that owns the data owns every write.

## What exists (verify)

A knowledge tie play writes (`was_told`, `has_been_there`; `noteEntryKnowledgeWrite`, `host.loreWrites.ts`
~957) goes to the lorebook on Full; otherwise it is written to the session's notes and is never applied:
`lorebooks/ownBook.ts` ~1598 excludes rows with a knowledge kind from the overlay's links
(`isNull(knowledgeKind)`). Links apply by **moving their row** (`ownBook.ts` ~1905–1910: the same row keeps its
id; `cause.moved` is recorded), which `takeBackApply` and the imprint check (`lorebooks/imprints.ts` ~656–671:
"An applied change is the lorebook's … no message or run takes it back"; an imprint of a row carried out of the
notes is dropped) rely on. Apply has a settle cap (`ownBook.ts` ~2466–2481) and an automatic Apply when a scene
closes (`applyHeldAutomatically` ~2909). A play tie in the notes is told from a hand tie by its kind.

## Build

1. **A play tie held in the notes is a row of the Apply review**, worded by its reason in the review's existing
   sentence style (★: *‹member› was told ‹entry›* / *‹member› has been to ‹entry›*), listed with play's other
   held changes; only for play kinds: relax the `isNull(knowledgeKind)` filter at ~1598 for `was_told` /
   `has_been_there` and nothing else (a hand tie set in the notes is never offered).
2. **Apply moves the row, it does not insert a copy.** Add a move function owned by
   `lorebooks/entryKnowledge.ts` (P2; name by §24) that the Apply code calls: it re-checks that the member and
   the entry exist in the lorebook and that **no active hand tie** exists there for the pair (D39), then moves
   the row with the same `moved` record links leave. When the check fails the row stays held and the review
   says why in words on that row (★: e.g. *Not applied: ‹Knows / Kept from› is set by hand for ‹member› and
   ‹entry›.*). A second live play tie of the same reason already in the lorebook for the pair: the held row is
   dropped as already true (say so on the row, or count it in Apply's result the way a duplicate link is: find
   and follow).
3. **Before Apply** the tie works as that session's own knowledge, as today, and **Back or a swipe removing the
   reply removes it** (imprints), as today. **After Apply it is the lorebook's**: Back cannot remove it; **Take
   back** of that Apply moves it back to the notes with everything else that Apply carried. Test each.
4. **The cap and the automatic Apply count ties** like any other held change (`ownBook.ts` ~2466–2481, ~2909):
   verify what the cap counts and include tie rows; a scene close's automatic Apply carries them when the
   lorebook's mode makes Apply automatic (state exactly when that is).
5. **A shared lorebook the session's owner does not own:** follow what the review already does for links there
   (find; report).
6. **Words and docs:** `docs/lorebooks.md` (Apply now lists what characters came to know; the precedence with a
   hand tie), `docs/pipelines.md` (the outlet's routing: "offered in Apply"), SDK `INTEGRATING.md` §1p and the
   guide's knowledge section (replace "never applied"), the receipt of `note-entry-knowledge` when it holds a
   tie (★ if its sentence changes), `NOMENCLATURE.md` §25.

## Tests

Held → shown in the review with its sentence → Apply → the row is in the lorebook with the same id and the
session no longer counts it twice → known to that member in another session on that lorebook; refused under a
hand tie (stays held, words on the row); duplicate; Take back returns it; Back before Apply removes it; Back
after Apply does not; the cap; automatic Apply on scene close; hand ties in the notes never offered. Both
prompt baselines unchanged. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/lorebooks/ownBook.ts` (the overlay's review, Apply, Take back, cap and automatic Apply, **for
tie rows only**), `lorebooks/entryKnowledge.ts` (the move function), `lorebooks/imprints.ts` (only if a tie's
imprint needs the same carried-out rule links have), the Apply review's client rows, `host.loreWrites.ts`
(the receipt words only), their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration is needed; the review's row model cannot carry a non-link row
without a visible layout change beyond one more row kind; Take back cannot return a tie.

## Report

Final message = the report (lead saves `plans/REPORT-kn-6-<date>.md`): the review row and its sentences (★);
the move function; refusals; Back / Take back as built; the cap and automatic Apply; **Noticed, not done**.
Under about 550 words.

## Cold review corrections (2026-11-17) — these rule over the text above

Line drift in `lorebooks/ownBook.ts`: the links filter is at ~1628 (`standaloneLinksOf`), the link move at
~2366–2410, the settle cap ~2497–2515, automatic Apply ~2939 (it runs **only on Full**, ~2963), Take back reads
`moved.historyEntryId` ~2836.

1. **A tie is its own row kind, not a link row.** Relaxing the filter at ~1628 would feed ties into the
   `kind: "link"` rows (~1797–1806), print the raw type ("Ana was_told Tavern", `linkTitlesOf` ~1668–1672),
   move them through the links loop's `alone` path (~2349–2356, picked by `chosenLinkIds` ~2027) **without the
   hand-tie check**, and show them in the applied list as "· link" (~3243–3260; `SessionViewPanel.svelte:769`).
   Build one more row kind for a knowledge tie (server and `src/lib/shared/sockets/types.ts` ~7920, which this
   lane owns for that one kind; client `SessionViewPanel.svelte` ~683–769): its own sentence, its own applied
   label, and kept out of `alone`. This is the "one more row kind" the brief's stop condition allows.
2. **A held tie that a hand tie overrules is dropped as superseded, not kept.** Held rows cap Apply's settle
   line (~2497–2512) and the automatic settle (~3086–3092); a hand tie never goes away by itself, so a refused
   tie held forever would pin the line. The judge already lets the hand tie win, and the write already refuses
   under one (`host.loreWrites.ts` ~1063). So: when the review is built (or Apply runs) and an active hand tie
   exists in the lorebook for the pair, the held play tie is **removed from the notes and counted in Apply's
   result as superseded** (★ wording, in the manner a duplicate is counted: find it), and it never caps the
   settle line. No "Not applied" row that can never be resolved.
3. **The move carries the tie's dating and line exactly as a link's does.** Reuse or factor the link loop's
   code (~2366–2410): a dated row moves onto the lorebook's day for the same date or onto no day; `branchId`
   becomes the reading's line; `moved.historyEntryId` is recorded for Take back. State in the tests that "known
   in another session on that lorebook" holds for a session on the **same line**.
4. **Duplicates match live ties only:** `findLinkedThatWay` ignores `status` (`relationshipGuards.ts` 219–236):
   for a tie, only a `status = 'active'` twin counts as already true.
5. **"Never applied" is already false in one case: pin it and correct the words.** The riding query
   (~2327–2331) has no knowledge-kind filter, so ties on entries that were **born in the notes** already move
   with their entry when it is applied, hand ties included. Keep that; pin it with a test; correct the receipt
   at `host.loreWrites.ts` 958–960 and the docs to say: a tie on a notes-born entry goes with the entry; a tie
   on a lorebook entry is offered in Apply.
