# BRIEF — lane `doc-1`, worker w1 — check docs pages against the code

Repo `/home/jody/github/serene-pub`. Supervisor: lane `doc-1` (`plans/briefs/BRIEF-doc-1.md`). Report: your final message (format at the end).

## Your pages (whole pages, in this order)

- `docs/connections.md` (22741 words, 940 lines)

## Check these first on your pages (recent work the pages should already reflect; verify, do not assume)

- Model plumbing: what a member (non-admin) can see or do on connections / models / loadouts vs an administrator.
- Exact labels of every button, tab, dialog and badge the page names (Connections view, Models view, Admin › Overview **Needs you**).
- Defaults and numbers (timeouts, ports, limits, context sizes) against the adapter / connection code.

## Goal

Every checkable statement of behaviour on your pages is true of the code today. False sentences are fixed in
the docs only; code that looks wrong is reported, never changed. Owner, programme 0.7 (2026-11-15): "each
`docs/*.md` page checked against its feature; false statements fixed (two found on 2026-11-15: locked
settings, Tone 'Before you start')."

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**This lane adds:** you run **no tests, no builds, no `sdk:build`, no `tsc`, no `npm run check`, no
`prettier --write`** at all (other lanes are running them). Never `git checkout` / `restore` / `stash` / `clean`
in either repo. No `pkill`.

## Files owned

Only the pages listed under **Your pages** above. Nothing else: no code, no other docs page, no
`src/lib/generated/`, no SDK file, no NOMENCLATURE / STYLE-GUIDE.

## Files readable

Everything in `/home/jody/github/serene-pub` and `/home/jody/github/serene-pub-sdk` (read only).
UI strings are inline in `src/lib/client/**/*.svelte|.ts`; server refusals and labels in `src/lib/server/**`
and `src/lib/shared/**`; genre / preset / pipeline / setting declarations (labels such as **Tone**, defaults,
presets, step labels) in the SDK: `../serene-pub-sdk/core-catalog/src`, `../serene-pub-sdk/sdk/src`,
`../serene-pub-sdk/contracts/src` (never their `dist/` or `node_modules/`).

**Reading discipline (hard):** never read a whole large source file. Locate with grep first, then read line
ranges (`Read` with `offset`/`limit`, or `sed -n 'a,bp'`). Search example:
`grep -rn --include=*.ts --include=*.svelte "Exact label" src ../serene-pub-sdk/core-catalog/src ../serene-pub-sdk/sdk/src`.
The shell's `grep` is ugrep and prints **nothing** for a file it thinks is binary: before you conclude
"this string / feature does not exist", confirm with `command grep -ra "…" src` too. An empty grep is not proof.

## The method (from the lane brief, verbatim where quoted)

1. Read the page in sections. "For each **checkable statement of behaviour** (a default, a limit, a number,
   what a button does, who may do it, where a control lives and what it is called, what happens on import /
   delete / upgrade), find the code that decides it ... and compare. Labels and sentences quoted in a page must
   match the UI string exactly." (Bold or italic words in a page are usually quoted UI strings: grep them.)
2. Classify each mismatch:
   - "**the page is wrong** and the code is plainly intended → fix the sentence (smallest edit that makes it
     true; keep the page's voice; no new sections, no feature tours);"
   - "**the code looks wrong** (the page states the intended behaviour, e.g. it matches a ruling or a
     NOMENCLATURE row) → do not edit either; report it as a possible defect with file:line;"
   - "**cannot tell** → report, edit nothing."
3. "Also fix on sight, in docs only: a retired word (§23), 'chat' used for a session, a dead link between docs
   pages, a control named differently in two pages (use the UI's string)."
   - Links between pages are `./other.md#anchor`. The anchor is GitHub's slug of the heading
     (`github-slugger`: lower-case, punctuation other than `-`/`_` dropped, spaces to `-`, a repeated heading
     gets `-1`). Check that the page and heading exist.
4. "Depth over breadth is not wanted here: every page gets a pass; a page too long to finish is reported as
   'checked to line N'." Give each page a full pass at a steady pace; don't spend an hour on one paragraph.

**How to edit (other lanes edit some docs pages at the same time):** use the `Edit` tool only, never `Write`
on a docs page and never a shell rewrite (`sed -i`, `perl -i`). Re-read the exact paragraph right before each
edit and make **single-sentence edits**; never rewrite a section. If `Edit` says the file changed, re-read
that paragraph and redo the one edit.

## Rules your edits must keep (quoted)

- CLAUDE.md: "It is a **session**, never a *chat* — except in chat-completions wire vocabulary." ("Chat"
  survives only as the display name of the standard genre, **Chat**.)
- CLAUDE.md standing ruling: "**Members never see or touch model plumbing** — connections, models, sampling,
  loadouts. The admin provides a working environment through session presets." A page telling a non-admin
  member to pick a model or connection is wrong unless the code shows otherwise; report it.
- STYLE-GUIDE §10: "Sentence case everywhere" · "One name per thing, across the whole flow: the thing you
  open is a session, never a chat; one installation of Serene Pub is a **pub** (_your pub_, _this pub_;
  capitalised only where a sentence or label starts), never an _instance_ or a _server_" (the *server* is still
  the Node process / machine, e.g. "The server did not answer").
- NOMENCLATURE R1 "One word, one meaning." R3 "Qualify, never abbreviate to the bare noun (`entry type`,
  never `type`)."
- NOMENCLATURE §23 retired words you are most likely to meet in prose (never reintroduce one; replace with
  the live word): **chat** (the object) → **session** · **instance / server / installation / install** (for one
  installation, e.g. _this instance_, _Instance settings_, _Server default_) → **pub** · **thinking** (the
  model's reasoning trace, the **Thinking** fold) → **reasoning** · **Attach / Detach** a lorebook, **Read into
  this session**, **Stop reading** → retired: a session keeps the lorebook it started with (the book lock);
  building on notes elsewhere is **Share as a lorebook** · **Point in the story** → **Story clock** ·
  **sampling preset** → **sampling config** · **personas** as a separate library → a persona is a character
  flagged as a persona · **World bar**, **moment banner** → the **moment bar** · **turn style** (Lair) ·
  **group reply strategy** · **character visibility** (_Full Info_ / _Name Only_ / _Hidden_) · **trigger** (what
  starts a run) · **stage** as a step of a run → **step** · **capability default**, **chat default**,
  **Set as default** (Models) · **Your layouts** / **Shared with you** (Layouts tab groups) · **zone pin**,
  **anchor**, **Fit width**, **Move** tab, **Grid** (layout editor) · **dice line**, **Show dice**, **Rules and
  dice** · **unknown entries** / _Entries not known_ · **visibility grade** · **relativeDate** and free-form
  bound words (_under 1 year ago_) → **date delta** · **Delete** as a built-in every genre offers.
  When a word looks suspect, `grep -n "word" /home/jody/github/serene-pub/NOMENCLATURE.md` and read that
  §23 row (§23 is lines ~1484–1715; read only the matching row).

## In flight in other lanes: report, never edit

- **ss-2a / ss-2b** (session settings store): where a session's pipeline step values and genre settings are
  stored, which form writes them (the derived settings form vs the Pipelines card), and which one wins. A
  statement about that → "in flight (ss-2a)", no edit.
- **io-1** (lorebook export / import, editing `docs/lorebooks.md`): what export, import, duplicate and
  "copy without its timeline" carry. A statement about that → "in flight (io-1)", no edit.
- **fnd-2d** splits `src/lib/server/sockets/narrativeGraph.ts` into `narrativeGraph.*.ts` with no behaviour
  change: line numbers there may move while you read; cite what you saw.

## Stop and ask when (report it; do not decide)

"A fix would need more than a sentence or two; a page describes a feature that does not exist at all (report;
do not delete the section); two pages contradict each other and the code supports neither." Also: a fix would
need a new name or new UI copy that doesn't exist in the code. CLAUDE.md §Decisions: findings outside your
pages go under **Noticed, not done**, never fixed in passing.

## Done means

Every page in **Your pages** has had a full pass (or is reported "checked to line N"). No tests (this lane runs none).

## Report (your final message; under ~800 words; no file dumps)

Per page:
- `docs/<page>.md` — statements checked: N · status: done | checked to line N
- **Fixed:** `L<line>` "old words" → "new words" — code: `path:line` (one line each; quote only the changed words)
- **Possible code defects:** page says X; code does Y (`path:line`); which a ruling / NOMENCLATURE row supports
- **Cannot tell:** statement (line) — why
- **In flight:** statement (line) — lane
- **Stop-and-ask:** item — why

Then **Noticed, not done** (outside your pages), and the answer to any relayed status question in one line.
