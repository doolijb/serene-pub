# BRIEF pl2 — a place's world value lives in the notes' overlay when the session can't write its book (owner ruling ★pl-1, 2026-11-05)

You are a `lane-supervisor` (fresh, Opus). Read `.claude/guides/multi-agent.md` first, then this brief, then `plans/REPORT-pl-2026-11-05.md` (the ★pl-1 finding and the "Noticed" residual), `plans/REPORT-m3b-V2-2026-11-05.md` (landing rule, read order), plan §24's last bullets and §26's last bullets (the rulings), `src/lib/server/rulesets/ties.ts` (~385 `rowForSide`; ~443 the T3 ★5 design note; ~986 the rule-fed overlay `extra_json.ruleFed.entryFields[<book entry id>]` on the notes' own row — read who writes it, who reads it, how Apply to the lorebook / Share as a lorebook / Clone with changes treat it), `src/lib/server/state/worldScope.ts`, `state/owners.ts` `resolutionChain`, `state/write.ts` (`isOwnBookOwner`, `assertOwnBookWriter`). Lane id **pl2**. Two workers at most (Sonnet). Work from `/home/jody/github/serene-pub`. Other programmes edit this tree (lane **sl** in the SDK may `sdk:build` — wait and re-run if a test fails on an SDK dist import; lane **ed** follows in `state/**`): re-read a shared file before every edit; additive hunks; never reformat a file dirty at HEAD.

## Ruling
★pl-1 (owner, 2026-11-05): **"In the notes' overlay, like the rules' place fields."** In a session that can't write its book (`keepsValuesInOwnBook`), a world-scope attribute value on a place of the attached book (`session_location` mapped to the book's place, or an explicit `location` owner on that book) is kept in **the notes' overlay keyed by the book's place id** — the same overlay the rules' place fields use, extended to attribute values — **never a copied entry** (★T3-5, 2026-10-23, stands). Reads take the overlay's value first, then the book's. The attached book gains nothing.

## Items
1. **Where the value is stored.** Decide inside scope between (a) the existing `extra_json` overlay map (a sibling key beside `ruleFed.entryFields`, e.g. per entry id → slot → value) and (b) `attribute_values` rows whose owner is the notes' book with a place key — **only if** the table can carry a (book, entry id) owner without a migration; prefer (a) if (b) needs one. Name what you chose and why; a new 🚧 name per NOMENCLATURE §24 for the key. Dated history: say whether values there join the session's dated history the way `attribute_values` rows do (Back/Forward must undo a place change like any other value — test it); if (a) cannot be dated without a parallel mechanism, stop and name it as a ★ (do not build a second history).
2. **Write path** (`worldOwnerOf` + the write module): the `keepsValuesInOwnBook` branch routes place owners to the overlay; writer-first via `assertOwnBookWriter` — and fix pl's residual (owner kinds other than `session`/`session_cast` fall through to `attachedOrOwnBookOf`, which calls `ownBookFor` before any writer check).
3. **Read path** (`resolutionChain` / `chainFor` / whatever reads place values for the sheet and the prompt): overlay first, then the book.
4. **Carry**: what Share as a lorebook, Apply to the lorebook and Clone with changes do with the overlay today for rule-fed fields — do the same for values (if they carry it, carry values; if not, say so).
5. **Tests** (int, 60 s timeouts, `state/worldScope.int.test.ts`): a member's session on a shared book — a place value lands in the overlay, reads back, a second write updates, the shared book gains nothing, Back undoes it; the owner's own book — unchanged; a guest's refused place write makes nothing (incl. the residual).
6. **Docs/vocabulary**: `docs/lorebooks.md` (Session notes keep a member's changes to places), NOMENCLATURE §25 row.

## Files owned
`src/lib/server/state/**`, `src/lib/server/rulesets/ties.ts` (the overlay's reader/writer only — additive), `src/lib/server/lorebooks/ownBook.ts` (additive: the carry, if needed), `docs/lorebooks.md`, `NOMENCLATURE.md` (§25 row).
## Out of scope
No copied entries; no new history mechanism (★ if needed); no SDK edit; no migration (★ if (b) needs one — then use (a)).
## Rules (quote into the worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; `tx` only inside `db.transaction`; targeted tests only; never pipe vitest into `head`; 60 s int timeouts; delete only your own `/tmp/serene-pub-vitest-*` dirs by name.
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
## Done means
Tests green (incl. the m3b-V2/pl tests in `worldScope.int`); `tsc` clean on lane files. Full report in your hand-back (the lead saves it to `plans/REPORT-pl2-2026-11-05.md`).
