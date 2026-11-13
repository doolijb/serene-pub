# BRIEF shelf-C-w1 — docs/connections.md and STYLE-GUIDE §6.3/§6.4 for the Tidy shelf

You are a `lane-worker` under the `shelf-C` supervisor. Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` (items 11–12). Sources: `plans/REPORT-shelf-A-2026-11-08.md` and `plans/REPORT-shelf-B-2026-11-08.md`, their **For shelf-C** sections. The supervisor has checked them against the code; the facts below are the checked version — where this brief and a report differ, this brief wins.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The two documents describe what was built, exactly as built. Nothing else changes.

## Files owned (the only files you may edit)

- `docs/connections.md` — §§ _The Models view_ (L28), _Models, top to bottom_ (L32), _The models list_ (L41), _Get a model_ (L63), _Downloads_ (L98), and any other line in this file the change makes false (grep it for "four rows", "**Change**", "sorted by name", "pill").
- `STYLE-GUIDE.md` — §6.3 (L775–851) and §6.4's group-label paragraph (L958–963) only.

## Files readable

The plan, both reports, and to confirm wording: `src/lib/client/components/connections/{ModelsListView.svelte,modelsList.ts,modelsGroupBy.ts,ModelRow.svelte,MattingModelRow.svelte,ModelFinderView.svelte,FinderModelPage.svelte,QuantPicker.svelte,finder.ts}`.

## Rules (quoted from CLAUDE.md, the lane brief and the guides)

- docs: _"user-facing, plain, second person, present tense, matching the file's existing voice; bold for controls, italics for on-screen sentences; no file paths or code names. Admin-only facts stay stated as such."_ Italics are `_like this_` and bold `**like this**` (prettier rewrites `*x*`). One paragraph per line, as the file already does (it does not hard-wrap).
- STYLE-GUIDE: _"state each rule with its date (2026-11-08) and where it applies, in the guide's existing voice; never invent a class string — copy the ones in the reports and confirm them in the code."_ STYLE-GUIDE prose is hard-wrapped at about 100 columns, like its neighbours.
- CLAUDE.md: _"It is a **session**, never a *chat* — except in chat-completions wire vocabulary."_ (**Chat** as a kind of model / the scope label is fine — it already is in this file.) Never use the word _Library_ for the Models list (it is taken, NOMENCLATURE §26). Never _job_ as a user-facing word.
- ★B-2 (a _Base model_ fact) is open with the owner: document the facts strip **without** it.
- Do what was asked at the size asked. Do not touch other sections, other files, code or tests. Anything else wrong goes in your report under **Noticed, not done**.
- Never run `npx prettier --write` on a whole file: these files carry other people's uncommitted work. Check only.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## The facts, as built (checked against code)

### Models list (lane A)

- **Model scope** popout (the toolbar's filter icon button, accessible name _Model scope_): seven radios each with its count — **All**, **Chat**, **Images**, **Embeddings**, **Entities**, **In a loadout** (models a loadout is set to run on — a loadout's current pair names it; a loadout merged into another doesn't count), **On disk** (a model of an _On this machine_ connection that it still lists; for a local ONNX model, once it is downloaded). The narrowing in force shows as one chip with **×** (unchanged).
- Under a hairline in the same popout, a 12px muted label **Group by** and a second radio group: **Where it lives** · **What it can do** · **Connection**. Default **Where it lives**. Remembered in this browser (like the memory size). Choosing one closes the popout. It is **not** a narrowing: no chip, and it does not light the trigger.
- **Where it lives**: **On this machine** then **Services** (the Connections index's two groups). The background remover is the last row of _On this machine_.
- **What it can do**: one heading per kind, in this order: **Chat**, **Images**, **Embeddings**, **Entities**, **Speech**, **Transcription**; then any other kind a model can do (only for a model that can do none of those six), under that kind's name; then **Cut-outs**, holding the background remover. A model that can do several of the six is listed under each.
- **Connection**: one heading per connection, named by the connection; those _On this machine_ first, in the Connections view's order, then services; then **Built in**, holding the background remover.
- In every grouping the **last** heading is **Can't be used right now**: models switched off, no longer listed, or able to do nothing a default loadout runs. Each says why on its facts line: _Switched off_, _No default loadout can run this model_; a model no longer listed already has its _No longer listed_ badge.
- Inside a heading, models sort by name. A heading with nothing to show is not drawn (the remover's heading always is, admin only).
- **Sizes**: the headings on the _On this machine_ side (the _On this machine_ heading; each local connection's heading under **Connection**) show, at the right in muted text, the total size of the models whose size is known (e.g. _23.4 GB_); omitted when none is known. audio.cpp models now show their size; Ollama rows end their facts line with _lives in Ollama_.
- **Folding**: a **service** connection (the _Services_ side) with **more than 12** models starts folded **every time you open the view** — no setting. Only its models that a loadout uses stay in sight, and a line after the heading's rows says what is hidden, with **Show**:
  - in **Where it lives**: the connection's name, then _312 models · 1 in a loadout_;
  - in **Connection**: under that connection's heading, _312 models · 1 in a loadout_;
  - in **What it can do** and in **Can't be used right now**: _+ 300 on OpenRouter_ in each heading where rows are hidden.
  - The _· 1 in a loadout_ part appears once the loadouts have loaded.
  - **Show** opens that service under every grouping, until you leave the view.
  - Typing in the filter box shows everything: folds are ignored while it has text.
- **Downloads button**: while anything is downloading, the toolbar's action row gains an icon button with a download arrow and the count (**↓ n**), titled _Downloads_; it opens the Downloads list, as the tray's **View** does. The tray at the foot stays.
- **Background remover inside a group** (admin only): its row reads _Background remover_, with the model's name on its state line. When the list shows no groups (no models yet, or nothing matches the filter), it stands on its own under its own _Background remover_ heading, as before.

### Get a model (lane B)

- From the top: the search box, then **one sentence**, then the results. The sentence replaces the old **For** row, **Download to** row and the landing/memory line: _[Chat] models for [KoboldCPP] · sized for [8 GB]_.
- Each bracketed part is a button that opens a short list of choices (a popover of radios): what the model is for (**Chat**, **Images**, **Embeddings**, **Entities**, **Speech**, **Transcription**), where it downloads to (your KoboldCPP, Ollama, audio.cpp, or a local ONNX connection — only programs Serene Pub can download into; never an online service; **Speech** goes to audio.cpp, or to KoboldCPP for the speech models made for it; **Transcription** to audio.cpp), and the memory size (_How much memory does this machine have?_ — 4 GB, 8 GB, 12 GB, 24 GB+, **Not sure**). Picking closes the list.
- A part the door already fixed, or that has only one choice, is plain words, not a button.
- For a local ONNX connection the _· sized for […]_ part is left out (ONNX models run on the processor).
- With nothing that can hold that kind of model, the sentence reads _[Chat] models · sized for [8 GB]_ and a card under it says _Nothing here can hold a chat model yet._, with a button to add KoboldCPP (or audio.cpp) run by Serene Pub where that would help.
- A destination that can't take files right now (a local ONNX connection on a device that can't run them) stays in the list, dimmed, its reason in its tooltip; picking it shows the reason on a line under the sentence, and every **Get** is greyed out. Lines under the sentence also say when your KoboldCPP isn't set up or switched on yet, and, until you choose a memory size yourself, why Serene Pub guessed the one it shows.
- The memory size can also be changed from **⋯ › Change memory tier** in the finder's header (when it opens as a pane). The old _where files land_ line and its **Change** are gone from under the sentence: where files land is now on the model page's footer (below).
- **The model page** (admin only, like all of Get a model): pressing a result's **name** opens that model's page inside the finder; **Back**, or Escape, returns to the results with your search and your place in the list kept. **Get** on a result still opens the file list under that row, as before.
  - Its title is the model's name; under it the owner and _Recommended_ or _Hugging Face_, and the tier chip.
  - Then the description, then the facts that are known — **Parameters**, **Context** (such as _32k tokens_), **Licence**, **Languages** (the first three, then _+2 more_), **Downloads**, **Updated** — a missing one is left out, never shown as unknown.
  - Then the _You have this on …_ line.
  - When the files go to KoboldCPP or Ollama, the page reads the model's facts and its file sizes from Hugging Face as it opens: _Reading the repo from Hugging Face…_, then the facts; if it can't, one sentence says why (e.g. _Hugging Face would not answer for that repo._, _Rate limited. Please wait a moment and try again._). Those facts are kept for a day.
  - Then the files, headed _Pick a size_ (or _Choose a precision_), the recommended one already chosen (else the largest that fits your memory size, else the first); each with its size and fit, and a bar for how much of your memory size it takes (no bar under **Not sure**, or where the size isn't known).
  - At the foot: _To KoboldCPP · ‹where the files land›_ and **Download ‹file name›** — or the **On disk** / **Pulled** badge when the destination already has it, or a progress bar and **Cancel** while it arrives.
  - An Ollama library name with no files says _Ollama's library lists no quants for this name._, and **Download** pulls the name the list gives. A repo that lists no files keeps **Download** greyed out (_That repo lists no files to get_ on hover).
- **Downloads** (§ Downloads): the Models toolbar's **↓ n** (_Downloads_) button opens the same list as the tray's **View**.

## STYLE-GUIDE additions (§6.3, §6.4) — each dated 2026-11-08, citing nothing but the guide's own voice

1. **§6.3, after the filter-popout paragraph (L800–807): a second, non-narrowing radio group.** A popout may carry one second radio group that changes how the list is shown rather than what it keeps (the Models list's **Group by**, 2026-11-08): under a hairline (`border-surface-200-800 my-1 border-t`), a 12px muted label (`text-surface-600-400 px-2.5 pt-1 pb-0.5 text-xs`) naming the radiogroup (`aria-labelledby`), rows like the narrowing's (`role="radio"`, `h-9`, checked `sidebar-row-active`). It shows no chip and never lights the trigger; picking closes the popout; the choice is remembered per browser.
2. **§6.3, toolbar: an icon button may carry a count** (2026-11-08): a live count beside its glyph, such as the Models list's **↓ n** (title and `aria-label` _Downloads_, shown only while something is arriving), is `btn h-10 min-w-10 gap-1 px-2.5 preset-tonal-surface` with the count `text-sm tabular-nums` — 40px tall like every toolbar icon button, wider only by its number. Where it goes: the action row's secondary icon buttons.
3. **§6.3: the sentence menu** (2026-11-08, Get a model). One wrapping `text-sm` line that reads as a sentence, each choosable part a trigger: `inline-flex min-h-9 items-center gap-0.5 rounded-base px-2 font-medium preset-tonal-surface pointer-coarse:min-h-11` — the chosen label and a 14px chevron, never gold or filled; `aria-label` _‹Question›: ‹choice›_ (_For: Chat_, _Download to: KoboldCPP_, _Memory tier: 8 GB_). Each opens a `Popover` in a `Portal`, placement `bottom-start`, holding one `role="radiogroup"` named for the question, `role="radio"` `h-9` rows, the checked one `sidebar-row-active`; picking closes it. A part that is fixed or has one option is plain `font-medium` text with no chevron. A disabled option stays pickable, dimmed, its reason in `title`; once chosen its reason shows on a muted `text-xs` line under the sentence, which wraps and is never truncated. Use it where three or fewer linked choices read naturally as one sentence; it replaces stacked pill rows.
4. **§6.3, after "Escape over an in-view sub-route is Back": the finder model page is an in-pane level** (2026-11-08). A level drawn inside a pane (Get a model's model page) replaces the pane's whole content under its own `PanelNavHeader`, its title the thing's name and **Back** always drawn; focus moves to its heading; Escape is Back (the same rule as above); Back returns to the level below with its query, scroll and focus on the opener restored. Its one filled primary sits in a footer pinned under its scroller (`border-t`, `pt-3`), never in the header.
5. **§6.4, the group-label paragraph (L958–963): extend the list of trailing texts** with _a size total_ (the Models list's _On this machine_ heading and local connection headings, 2026-11-08: the summed known size of its rows, such as _23.4 GB_, passed as `trailing`; drawn only on the local side and omitted when no size is known).

Confirm every class string above in the code before writing it (grep `ModelsListView.svelte`, `ModelFinderView.svelte`, `FinderModelPage.svelte`). If one differs, use the code's and say so in your report.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, you would need a name or a word not in this brief or the reports, or the code disagrees with a fact above in a way that changes behaviour. Write it in your report rather than deciding.

## Done means

- Both files edited in the named sections only; `git diff -- docs/connections.md STYLE-GUIDE.md` shows nothing outside them except lines this change made false (list those).
- Prettier: these files already fail. Before editing, run `npx prettier --stdin-filepath <f> < <f> | diff - <f> | grep -c '^[<>]'` for each and note the count; after editing, the count must not grow from **your** lines (a changed line inside a block that already failed is fine; say which).

## Report

Return it as your final message: changed sections per file, prettier counts before/after, anything you couldn't confirm in code, **Noticed, not done**.
