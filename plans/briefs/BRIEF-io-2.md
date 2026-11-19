# BRIEF — worker task `io-2` — back the member-sheet keys out of the lorebook file (owner ruling D37a)

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-io-1-2026-11-16.md` (the lane that added the
keys), the D37 row in `plans/DISCUSS-LATER.md`. Re-verify everything in the code before editing.

Owner, 2026-11-16: "Back them out. We aren't ready to re-enable exports." Earlier, 2026-09-28: "never re-enable
export or widen its format without a new ruling".

Rules: never `git stash / checkout / restore` (the repo is not committed per lane: back out **by hand**, reading
`REPORT-io-1` for exactly what was added); `npx prettier --check` only; never commit; no migration. Lane `fnd-4`
is fixing failing tests under `src/lib/server/pipelines/` and some `sockets/*.int.test.ts`: do not touch those;
re-read any file right before editing it. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/io-2-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## Do

1. Remove the optional member-sheet keys lane `io-1` added to `ExportedBinding` (a member's own sheet and
   aliases) from the type, the writer and the reader, so the lorebook file carries exactly what it carried
   before `io-1`. Nothing else `io-1` did is removed (its round-trip test stays).
2. The round-trip test `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` and its fixture
   `sockets/fixtures/lorebook-format2-2026-11-16.json`: keep the test; the member-sheet assertions become "a
   member's own sheet and aliases are **not** carried by the file" (pin the loss, with the ruling quoted in one
   comment line stating the rule: the file's format is frozen while export is paused). Regenerate or hand-edit
   the fixture so it matches what the writer now produces; older files that carry the keys still import
   without error and the keys are ignored (one test).
3. Docs: wherever `io-1` or `doc-1` wrote that a member's sheet survives a file, correct it
   (`docs/lorebooks.md`, `docs/importing-*.md`: grep). `NOMENCLATURE.md` §25: one line recording the back-out
   (names removed), next to `io-1`'s line.
4. Append to `plans/REPORT-io-1-2026-11-16.md` a short section "Backed out 2026-11-16 (D37a)".

## Report (under 250 words)

What was removed (file:line), what the test now pins, docs touched, tests and counts with log names, anything
that could not be backed out cleanly, **Noticed, not done**.
