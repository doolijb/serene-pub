# BRIEF — worker `time-t7c-w2`: docs, names and one help sentence for the History day's distance from now

Repos: `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK). Absolute paths only. Supervisor: lane `time-t7c`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no build and no test run: this brief is text only. Do not run vitest.)

Also: never `git checkout` / `restore` in either repo; never `kill -9`; another session shares this checkout and these files carry its uncommitted hunks, so make **small `Edit` replacements only**, never rewrite a file, never run prettier `--write`; no other product's name in anything you write; it is a *session*, never a *chat*; never write "no lorebook".

## What was built (by another worker, in parallel; describe it, do not touch code)

- A **History day** in the prompt says how far it is from the story's now, beside its date in the key: `"412-03-03 (2 days ago)"`, `"Year 409 (3 years ago)"`, `"412-03-07 (in 2 days)"`. A day on the clock's own date says nothing more.
- Only with a **story clock set** (the session's own clock or the line's stored clock). With no clock (the present comes from the newest history entry), the Timeline off or no book, nothing changes.
- Story time only; units are years, months or days (the coarsest that differs); nothing under a day.
- **Free-form book:** says nothing when the span cannot be known without a calendar — when a finer part runs backwards across a coarser boundary (Year 7 month 11 → Year 8 month 2 shows no distance; Year 7 month 3 → Year 9 month 5 shows *2 years ago*). A declared calendar counts by its month lengths and leap day.
- The value is 🚧 **`relativeDate`**: a second root of the History variable (`core:var/history@1`), a record keyed exactly like `history`, value `"2 days ago"` / `"in 2 days"`. The `history` record itself is unchanged.
- The **shipped** History layouts (*Titled JSON block* and *JSON*) write it; they refresh on boot. A layout an admin duplicated earlier keeps its text and shows no distance until its author adds it. The Handlebars line, inside `{{~#each history~}}`:

  ```
  {{#if (lookup ../relativeDate @key)}}"{{{@key}}} ({{{lookup ../relativeDate @key}}})"{{else}}{{{jsonValue @key indent=0}}}{{/if}}:{{{jsonValue this indent=0}}}{{#unless @last}},{{/unless}}
  ```
  The Liquid equivalent (being verified by a test; the supervisor will correct it in the docs if the test changes it):
  ```
  { {%- for pair in history %}{% assign ago = relativeDate[pair[0]] %}{% if ago %}"{{ pair[0] }} ({{ ago }})"{% else %}{{ pair[0] | jsonValue: indent: 0 }}{% endif %}:{{ pair[1] | jsonValue: indent: 0 }}{% unless forloop.last %},{% endunless %}{% endfor -%} }
  ```
  The key is written inside literal quotes only when a distance exists, because core makes those keys (digits, `-`, `Year`, ` (2)`) and the words are `<n> <unit>`.
- **Budget:** the added words are layout text and are not counted, as headings are not. No accounting change.
- No template helper was added.

## Rulings to honour (quoted)

- Owner 2026-11-15: "decay is an arbitrary multiplier against recal rank, never a fucking value we include in the context, at least not in core." The distance **has nothing to do with Decay**; say so where Decay is described.
- Owner 2026-11-13: Decay is "a value between 0 and 1 … Modders can query and calculate against that number how ever they want, or ignore it out-right".
- New names and copy are **proposals** (🚧), not ruled: mark them so.

## Files owned (edit only these)

1. `/home/jody/github/serene-pub/docs/context-templates.md`
   - "The variables" (~190), the `history` bullet: add one sentence: 🚧 with a story clock set each day also says how far it is from the story's now, beside its date (one example), with a link to the new subsection.
   - A new subsection under "Variable layouts…" (before "Reading a shipped layout", ~264), e.g. `#### How far a history day is from now 🚧`: what `relativeDate` is (a value beside `history`, keyed the same; absent with no clock, a key absent on the clock's own date and where a free-form span can't be known), what the shipped layouts print (the three examples above), that a layout you duplicated earlier shows no distance until you add the line (give the Handlebars line and the Liquid one), that the words are not counted in the budget (as headings aren't), and that it never reads Decay.
2. `/home/jody/github/serene-pub/docs/lorebook-time.md`
   - The present's list (~214–218, "the date the session's model is told it is"): add that, with a clock set, each history day the model reads says how far it is from that date (*2 days ago*, *in 2 days*) 🚧, and nothing with no clock set.
   - "The calendar" (~159–176): one sentence: in a free-form book a history day says nothing where the distance can't be known without a calendar (the Year 7 month 11 / Year 8 month 2 example); a calendar counts it.
   - "Beginning and decay" line 83: replace "The rate is stored, shown, copied and exported, but recall doesn't use it yet; the row says so." with: the rate is stored, shown, copied and exported; core never ranks by it and never puts it in the prompt; a pipeline can use it to rank the entry lower in recall (link the SDK guide's *Make living entries fade in recall*, the way `docs/pipelines.md` links it — grep for `fade in recall`); the row says so.
3. `/home/jody/github/serene-pub/src/lib/client/lorebooks/time/BeginningDecayRow.svelte` line ~337: *Stored now; recall does not use it yet.* → 🚧 *A pipeline can use this to rank the entry lower in recall; core does not.* (the text only; no markup change).
4. `/home/jody/github/serene-pub/NOMENCLATURE.md` (read §1, §24 first):
   - The **Decay** row (line 384): **Purpose:** a multiplier against recall rank that pipelines may use (the SDK guide's recipe, *Make living entries fade in recall*); **it never puts anything in the prompt**. **Does not own:** core's recall ranking (core does not rank by it) and anything in the prompt (a History day's distance from now is `relativeDate`, §15, which never reads it). Replace the *Stored now; recall does not use it yet.* 🚧 mention with the new sentence above (🚧, proposed 2026-11-15). Keep every other clause.
   - §15, after the 🚧 **earlier scenes** row (~1009): a new row 🚧 **`relativeDate`** (the History variable's second root) with its charter (P6): **Built 2026-11-15 (lane time-t7c; no migration).** Purpose: a History day's distance from the story's now, in words (`2 days ago`, `in 2 days`), so the model reads an old fact as old (owner 2026-11-13 "A time delta is better I think"; measured 2026-11-15, plan §7 3/3b). Owns: the words, computed by Assemble from the History allocation's date and the story time it already holds, and nothing else. Does not own: the History date's own format (the order key), the `history` record (unchanged), Decay (never read), dated lore entries other than History (not exposed; owner's question), the budget (layout words are uncounted). ⚠ Not `since` (taken twice); not *distance* (place distances are planned); R3: always the `relativeDate` root of the History variable, never a bare "relative".
   - §25, at the end: a dated entry `**2026-11-15 (lane time-t7c — owner rulings 2026-11-15 "decay is an arbitrary multiplier against recal rank, never … a value we include in the context", "The time detla isn't complicated…"; 🚧 provisional names and copy, the lead's proposal, not ruled).**` listing: 🚧 `relativeDate` (root on `core:var/history@1`); internal `relativeDateWords`, `relativeDatesOf`, `orderedEntries`, the sibling-root constant (the supervisor will fill in its exact name: write `RELATIVE_DATE_ROOT` and the supervisor corrects it), the file rename `lastTrue.ts` → `storySpan.ts`; `renderVariable`'s `siblings` argument and `prepareExplicitLayouts`' `siblingsOf`; `scopeRootFor` reads the first root when the key is not in the scope; the Decay row's new purpose; the help sentence. Match the shape of the neighbouring entries.
5. `/home/jody/github/serene-pub-sdk/guides/time.md`, section *Make living entries fade in recall* (~214): one sentence that the distance a History day shows in the prompt (`relativeDate` on `core:var/history@1`) is independent of Decay: it never reads the rate, and the rate never reaches the prompt.

Not owned (report, don't edit): `src/lib/client/lorebooks/BulkTimeDialog.svelte` (~307) carries the same old sentence; any other doc.

## Style

Docs: plain sentences, bold for UI labels, italics for quoted copy, no marketing, no other product's name. Read the neighbouring paragraphs and match them. `STYLE-GUIDE.md` copy rules apply to the one UI sentence (grep its copy section).

## Done means / report

`npx prettier --check` on the `.svelte` file (report the result; a pre-existing failure from someone else's hunk is fine, say so). Final message: each file and section you changed, with the exact new sentences (verbatim) for ruling; anything that did not fit; **Noticed, not done**. Under about 500 words.
