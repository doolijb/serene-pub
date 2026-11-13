# BRIEF — lane `s4-chr-view`, worker w4 — merge five lanes' queued NOMENCLATURE rows (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`), which holds `NOMENCLATURE.md` this wave. Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

Five S4 lanes built code and queued their vocabulary rows for whoever holds `NOMENCLATURE.md`. Merge them — **each row checked against the code before you write it: a row must describe what is there.** Sources (read each report's "NOMENCLATURE rows queued" section, and the parts of the report it refers to):

1. `plans/REPORT-s4-seat-2026-11-08.md` — section "## NOMENCLATURE rows queued (verbatim in substance)" (line ~35).
2. `plans/REPORT-s4-seat-live-2026-11-08.md` — "**NOMENCLATURE rows queued:**" paragraph (near the end) + its "Decisions" (what `seatedMemberIds` covers) and "Open ★" (★s4-seat-1 copy).
3. `plans/REPORT-s4-cp-2026-11-08.md` — "**NOMENCLATURE rows queued:**" paragraph (last). ⚠ Since that report the owner ruled **★cp-names-1 → "Both, via base name"** (2026-11-08): "members claim vocabulary names by their undated-Main shown name, so R1 "hybrid" 2026-09-30 holds; a dated rename is written back to `lorebook_bindings.name` for sort/search only." Check the code (`src/lib/server/annotations/index.ts` `loadVocabulary`, `src/lib/server/characters/versions.ts`, `src/lib/server/utils/characterBindingSync.ts`) to see whether that write-back is built yet; describe only what is built, and say "held back" for what is not.
4. `plans/REPORT-s4-st-2026-11-08.md` — "**NOMENCLATURE rows queued:**" paragraph.
5. `plans/REPORT-s4-bk-fold-2026-11-08.md` — "**NOMENCLATURE rows queued:**" paragraph. The fold itself is NOT built — write no fold rows.

Already merged by others — **don't duplicate** (grep first): rows from lanes s4-ner, s4-bk-lock, s4-f-sdk, s4-cl, s4-f-door, s4-f-pass, s4-f-client, s4-f-emit, s4-chr-read, s4-on (their dated bullets are at the end of the file, lines ~3728–3736; their table rows around lines ~3287–3387 and in §8/§9/§18).

## Where things go (follow the file's existing pattern exactly)

`NOMENCLATURE.md` is 3,736 lines — **never read it whole**; use `grep -n` and `sed -n` ranges.
- **Group-section rows** (a `| **term** · `code` 🚧 | Means |` row) in the section the report names: §8 Content (~line 338), §9 Session (~406), §18 Media (~1057), §24 Session data vocabulary (~1710). Amending an existing row = edit that row in place (e.g. §8 **card-less** row at ~352: s4-st says drop "(st adds `starter`)" and add the starter sentence; s4-cp says replace "Face and likeness files are not re-owned yet (★s4-cl-1)" with the re-own + 🚧 `repointCastVersionFiles` + 🚧 `facesRepointed`). Find the row by `grep -n`.
- **§25 change ledger table rows** (`| was | now |`, `_(new)_` when nothing was): append after the last S4 row — the `characters:page` row (`grep -n "the characters view read every card at once" NOMENCLATURE.md`, ~3387). One row per new concept a report lists for §25.
- **One dated bullet per lane** at the very end of the file, after the s4-on bullet, in the style of the s4-bk-lock bullet (~3728): `- **2026-11-08 (lane s4-<x> — owner ★…; plan §34.x).** …` naming the new 🚧 names and what changed. Order: s4-seat, s4-seat-live, s4-cp, s4-st, s4-bk-fold.
- Keep every table row on ONE line (the file's tables are single-line rows). Don't re-pad or reflow other rows.

## Checking against code (required for every row)

For each name you write: `grep -rn "<name>" src/lib ../serene-pub-sdk/*/src 2>/dev/null | head` — it must exist where the report says (file and kind: function, type, constant, field). If it doesn't exist, or exists under another name or file, write what IS there and list the difference in your report. If a queued row is about something not built (held back), write "held back (★…)" or leave it out and say so. Don't invent descriptions beyond what the report and the code show.

## Rules you must follow (quoted from NOMENCLATURE and CLAUDE.md)

- "A change that renames a concept updates this file **in the same change**." "Mark anything impermanent per **R6** — ⏳ transitional or 🚧 provisional."
- R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not type names · R5 reconcile vocabularies at boundaries, never merge them · R6 mark ⏳/🚧.
- §24: "Say what it is **not**, in the declaration, if a near-neighbour exists." (The reports give their ⚠ Not … lines — keep them, e.g. **carrier card** is qualified because bare "carrier" names the carrier version of `reparentFromBookPresent`; **surfaced book** is "not a starter, not session notes".)
- CLAUDE.md: "It is a **session**, never a *chat*." Memory rule "There is ALWAYS a lorebook": never write a row framing a session as having no lorebook — say own book / the session's notes / overlay.
- Owner rulings to cite where the report cites them: ★4 (2026-11-08) "background member" = **not seated in this session**; ★6 named "Take a seat" mints a card-less member; ★S2b-1 "Still theo" (the seater acts for the seat); ★S4-1 hidden carrier cards; ★5 0.6 starter-copied cards stay; ★B-3 surfaced books; ★cp-names-1 above.

## Files owned (edit only this)

`NOMENCLATURE.md`. Read anything. Another worker is writing new client files in `src/lib/client/components/...` right now, and lane s4-fixes is editing `src/lib/server/state/**`, `sockets/state.ts`, `sockets/lorebooks.ts` etc. — read-only for you. Don't add rows for lane s4-chr-view's own work (the supervisor writes those).

## Done means

All five lanes' queued rows merged (or each omission listed with its reason); `grep -c "lane s4-seat\b\|lane s4-seat-live\|lane s4-cp\|lane s4-st\|lane s4-bk-fold" NOMENCLATURE.md` shows the bullets; `npx prettier --check NOMENCLATURE.md` — if it already failed before you (check with `git show HEAD:NOMENCLATURE.md | npx prettier --stdin-filepath NOMENCLATURE.md --check`), leave formatting alone and say so; never whole-file `--write` it. No tests to run.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

Final message: per lane, the rows written (section + term) and line numbers; every queued item you changed, held back or omitted and why (with the code evidence); Noticed-not-done.
