# BRIEF — worker task `kn-6-fix2` — the Apply review stays reachable for the lorebook's owner

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-kn-6-2026-11-17.md` (incl. its "Scope review and
fix task" section), `docs/lorebooks.md` (Apply / Take back; a shared lorebook). Re-verify every file:line.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only; no migration. Inside `db.transaction` only `tx`. Comments state the rule, not the
story. Lane `gs-2c` (`lorebooks/ownBook.ts` `isSessionMember` / `ownBookAccessFor`, `cast/characterRows.ts`,
`sockets/entries.ts`, notes entry points, guest tests) and task `gs-2b-fix` (`sockets/sessions.update.ts`
positions, seat components, `EditSessionForm.svelte` heading, document-view session edit page,
`SessionsSidebar.svelte` label) are editing: do not touch those. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-6-fix2-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .`.

## The problem

Task `kn-6-fix` made the Apply review (`src/lib/server/sockets/sessions.overlay.ts`: items, applied batches,
`mayApply`, `appliesItself`; `SessionViewPanel.svelte`: the card shows only when `isOwner`) the **session
owner's only**, under the owner's ruling "A guest neither opens nor edits the notes" (2026-11-16). But Apply
writes into the **lorebook**, and for a lorebook the session's owner does not own, only the **lorebook's owner**
may Apply (`notOwner` for anyone else; lane `kn-6` report, "Shared lorebook"). If the lorebook's owner is in
the session as a guest, they were the only person who could carry held changes into their own lorebook, and
they now see nothing: held changes on such a session could never be applied.

## First establish (report it)

1. Can a session play on a lorebook its owner does not own (a lorebook shared with them)? Cite where a session
   is allowed to attach it (`sockets/sessions.create.ts` `checkLorebookOwnership` and the share rules).
2. In that case, before `kn-6-fix`: who could see the review, who could Apply, who could Take back
   (server checks, file:line), and whether the session's owner (not the lorebook's) could do either.
3. After `kn-6-fix`: who can.

## Then fix (only if 1 is yes and nobody but a guest lorebook-owner could Apply)

The rule: **the review is for the people who may act on it**: the session's owner (as now) and the **owner of
the lorebook the session plays on, when they are in the session**. Every other guest gets nothing (as
`kn-6-fix` built). Server: the non-owner branch in both handlers and `tellApplyMoved` lets the lorebook's owner
through; client: the card shows for `isOwner || ownsThisSessionsLorebook` (find the cheapest fact the client
already holds: `mayApply` from the reply is enough: show the card when the reply carries items or
`mayApply`). Tests: lorebook-owner guest sees items and can Apply; an ordinary guest gets nothing (serialised
reply); session owner unchanged. Update the docs sentence `kn-6-fix` wrote ("only the session's owner sees the
card") to the rule above.

If 1 is no (a session can only play on its owner's own lorebooks), change nothing and say so.

Append the outcome to the "Scope review and fix task" section of `plans/REPORT-kn-6-2026-11-17.md`.

## Report (under 250 words)

Answers to 1–3 with file:line; what changed or why nothing did; tests and counts with log names; `tsc`.
