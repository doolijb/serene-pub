# REPORT shelf-C — docs, STYLE-GUIDE and NOMENCLATURE for the Tidy shelf (A1) — 2026-11-08

Saved by the lead. Brief: `plans/briefs/BRIEF-shelf-C.md`; workers `BRIEF-shelf-C-w1.md` (docs + STYLE-GUIDE), `-w2.md` (NOMENCLATURE). Scope review: in scope; 5 findings answered once (3 fixed, 2 kept with no objection).

## Changed

- `docs/connections.md`: § Models, top to bottom (seven scope choices incl. **In a loadout** / **On disk**; **Group by**; **↓ n**; the background remover as a row in the groups); § The models list rewritten (three groupings remembered per browser, default *Where it lives*; *Can't be used right now* last with reasons; size totals; *lives in Ollama*; folds over 12 models, fold lines per grouping, **Show** across groupings, filter ignores folds); § Get a model (search box, one sentence, results; sentence parts, plain-text cases, no *sized for* for ONNX, no-destination reading, dimmed destination and reason lines; Memory size paragraph; new **The model page** block; connection-door bullet corrected); § Downloads (**↓ n**).
- `STYLE-GUIDE.md` §6.3 (dated 2026-11-08): non-narrowing second radio group (**Group by**); icon button with a count (class string from the code, `ModelsListView.svelte:356`); the finder model page as an in-pane level; the sentence menu. §6.4: size total among a group label's trailing texts.
- `NOMENCLATURE.md` §10 amended: **Models**, **model row**, **models list**, **job scope**, **model finder · Get a model**, **quant picker** (+ **fit bar**, ⚠ vs registration/template fit). New rows: **group by**, **fold** · **fold line**, **Can't be used right now**, **finder model page** 🚧, **`models:hubCard`** · **Hub card** 🚧. §25: entry *Models view tidy shelf … — 2026-11-08*, 15 rows.

Prettier: no new failures (all three files already failed before; the new §25 table is clean).

## Decisions (inside scope, accepted by the lead)

Amended **job scope** (its "five choices" became false); no separate **fit bar** row; the docs' example sentence drops the brackets; the finder model page sits in §6.3.

## Open ★

- ★B-2 (owner): a *Base model* fact on the finder model page — documented as built, without it.

## Report/code disagreements (no behaviour change)

- **↓ n** class: the code's string (with `shrink-0`) is the one documented.
- Model page footer shows the KoboldCPP-not-ready sentence in place of the landing note when not set up (`ModelFinderView.svelte:1237-1243`); docs describe where files land, and the not-ready line under the sentence.
- Fold threshold counts all a service's models; the fold line counts the rows hidden in that group under the narrowing — consistent with "counts match what Show reveals".

## Noticed, not done

- Another session's lanes (s4-cl, s4-f-sdk, "Merged by the lead") edited NOMENCLATURE during this lane; no collision.
- `docs/connections.md` says **⋯** holds only **Add a model by name**; the code also has **Set up chat** and **Defaults ledger** (predates).
- STYLE-GUIDE §6.3 filter-popout paragraph still says "lights the button tonal"; the 10-24 rule and the code use `preset-pressed`.
- STYLE-GUIDE §5.2 "A tool in the detail pane" could point to the finder model page.
- NOMENCLATURE **model finder** and **quant picker** rows still call the quant picker a dialog (inline since 11-04); **Models** row opens stale; **job scope** now holds two non-job narrowings (rename = owner's call).
- `connect-a-model.md`, `images.md` not checked for Models-view mentions.
