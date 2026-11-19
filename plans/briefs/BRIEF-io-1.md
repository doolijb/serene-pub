# BRIEF — build lane `io-1` — a lorebook survives export and import whole (programme 0.6)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then `docs/lorebooks.md`
(§"Creating, importing, duplicating and deleting" and the paragraphs on lines / timelines, dated links and
knowledge ties: ~118 says knowledge ties "travel with the lorebook when it is exported, imported, duplicated or
copied without its timeline"), `NOMENCLATURE.md` §1 and the lorebook group section, and the last two migrations'
tables (`drizzle/0166_*.sql`, `0167_entry_knowledge.sql`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Tests
only as `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/io-1-<n>.log 2>&1"`,
one run at a time (other lanes run tests and `sdk:build`: wait with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`).
Type checks with `NODE_OPTIONS=--max-old-space-size=10240`. The SDK is not touched. Inside `db.transaction` use
only `tx`. No full run, no `npm run build`.

## Owner

Programme 0.6 (2026-11-15, the lead's list the owner told to build): "a test that exports a lorebook with lines,
dated links, knowledge ties and marks, imports it, and compares everything; fix what is lost (links' dates and
lines today)." Standing: 0.6 is in users' hands (a file exported by an earlier 0.6 build must still import; a
changed file format carries a version and reads the old one).

## Build

### A. Inventory (supervisor, read-only; file:line in the report)

The export writer and the import reader of a Serene Pub lorebook file (`sockets/lorebooks.ts`,
`sockets/import.ts`, `utils/lorebookImportMapper.ts`, `library/writes.ts`, anything they call), the file's
version field, and the same for **duplicate** and **copy without its timeline** (the docs name them together).
Then a table: every column of every table that belongs to a lorebook (entries and their versions / marks
including `not_common_knowledge`, lines / branches, entry dates and line placement, links with their dates,
lines and `knowledge_kind`, places, history days, scenes and summaries, cast members, annex documents, calendar,
story clock, rules, tags, cover, book settings) × whether export writes it, import restores it, duplicate
copies it. Mark each gap: **lost**, **by design** (quote the doc line that says so, e.g. what an overwrite lists
as not brought back), or **unclear**.

### B. The round-trip test

One integration test that builds a lorebook exercising every row of the table (at least: two lines with a
branch point, entries dated on different lines, a link with a date and a line, a knowledge tie of each kind, an
entry marked not common knowledge, a place with ways, a history day, a scene with a summary, a cast member, the
calendar and clock, rules), exports it through the real export path, imports the file through the real import
path as a **new** book, and compares the two books field by field after mapping ids (a helper that normalises
ids and timestamps; never compare by position alone). The comparison lists every difference, so a future column
that is not carried fails the test by name: add a guard that fails when a lorebook-owned table gains a column
the comparison does not know (follow how `declaredReads` / schema-pinning tests do it here).
The same comparison for **duplicate**. For **overwrite an existing book** only what the docs promise.

### C. Fix what is lost

Every gap marked **lost** is fixed in the writer and the reader (links' dates and lines are known losses), with
the file's version raised only if an old reader would misread the new file; **a file written before this lane
still imports** (a test with a fixture captured from today's export before any change: capture it first).
Gaps marked **unclear**: do not fix; list them as ★ with a recommendation. Gaps **by design**: leave, and check
the import's "what the file can't bring back" list says so; if the list misses one, report it (wording is ★).

### D. Docs

`docs/lorebooks.md`: correct any sentence the inventory proves untrue; no new feature text.

## Files owned

The export / import / duplicate code paths found in A and their tests; the new round-trip test and fixture;
`docs/lorebooks.md`. Not `sockets/sessions.ts` or its `sessions.*.ts` modules, not `pipelines/runtime/*`, not
`lorebooks/entryKnowledge.ts` (other lanes).

## Stop and ask when

CLAUDE.md §Decisions applies; a loss cannot be fixed without changing the file format in a way an older build
cannot read **and** no version field exists; a fix would change what an import does to an existing book.

## Done means

The round-trip, duplicate, old-fixture and guard tests green with the existing import / export tests, in the
capped form; `tsc` 0 errors; `npm run check` 0 errors in this lane's files (errors in another lane's in-flight
files are named, not fixed).

## Report

Final message = the report (lead saves `plans/REPORT-io-1-<date>.md`): the table (compact: only rows with a gap,
plus counts), what was fixed and how, the format version, open ★, **Noticed, not done**. Under about 700 words.
