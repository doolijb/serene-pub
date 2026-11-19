# BRIEF — build lane `gs-1` — prompts are read by the session's owner in a session and by administrators outside one; a guest gets none (owner ruling D58, the part already ruled)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then row D58 and D61 in `plans/DISCUSS-LATER.md`,
`plans/INVENTORY-guest-and-member-surfaces-2026-11-16.md` §1, §2, §4, §6, §8 (**re-verify every file:line**),
`plans/INVENTORY-prompt-rows-2026-11-16.md`, the HELD section at the end of `plans/briefs/BRIEF-ss-3a.md`,
`plans/REPORT-kn-5-2026-11-16.md` (the panel's read / write code changed today), `docs/sessions.md`,
`docs/pipelines.md`, `docs/group-sessions.md`, `STYLE-GUIDE.md` (read-only in words), `NOMENCLATURE.md` §1, §24.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`. Never commit. No
migration. Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/gs-1-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.
Other work in flight: lane `tl-4` (`sockets/import.ts`, three functions in `lorebooks/ownBook.ts`, history
retrieval, SDK Dungeon Crawler files) and fix task `lb-1-fix` (lorebook delete paths, `plugins/providedBooks.ts`,
`library/writes.ts`, `LorebookActions.svelte`): do not edit their files; re-read any file right before editing.

## Owner

2026-11-16 (rulings page, D58): "The session's owner picks and may read the wording; a guest sees nothing;
outside a session only an administrator". "There should be a preview button for prompts, etc." "Guests can only
see the session detail view, and manage cast/cards they own." This **narrows** the ratified panel rule
(2026-09-30, `pipelines/config/panel/scopes.ts` comment: "Prompts stay visible because wording is the one thing
that is genuinely theirs to change for a session; outside a session their panel is a reading surface"): quote
both in NOMENCLATURE §25 and rewrite that comment to state today's rule.

**Not ruled yet (rulings page G1–G7, D61): do not build, do not pre-empt:** what else a guest sees (the Edit
session tabs, participants), the session's notes, the new guests-may-add switch, card-less seats, Prompt details
(the compiled prompt), an administrator inside someone else's session, the SDK's template exposure. Where one
of these touches code you edit, keep today's behaviour and list it.

## Build (server first; the client only stops asking for what it will not get)

1. **Who is who, in one place.** One server function answers, for a person and an optional session, which of
   three they are for prompts and pipeline configuration: the session's **owner** (`sessions.user_id`), an
   **administrator**, or neither (a guest of the session, or a member outside any session). Use the existing
   `sessionAccess` / `viewerFor` (`sockets/pipelines.ts` ~130–155); do not add a parallel notion. An
   administrator who is not the session's owner keeps exactly what they get today (G6 is open).
2. **`pipelines:list`, `pipelines:get`, `pipelines:promptWording`** (`sockets/pipelines.ts`; the panel's
   `visibleTo`, `config/panel/scopes.ts` 59–60):
   - **no session in the request:** administrators only. A non-admin gets the handler's existing refusal for an
     admin-only read (find the sentence used by its sibling admin-only events; same reply shape and error
     event, so Layout's handling is unchanged). Check every caller in the client: a non-admin page that calls
     these outside a session (the session start form's preset preview? the Pipelines card?) must be found and
     either given what it needs through a session-scoped read or shown to be dead.
   - **in a session:** the session's owner gets the panel rows the ruling gives them: prompt rows (names,
     descriptions, the pick) **and the wording** (`pipelines:promptWording` for prompts that panel offers);
     everything that was administrator-only stays so. A **guest gets no prompt row, no prompt name, id or
     wording, and no pipeline card content**: the reply for a guest carries nothing they can read prompts from
     (an empty / refused reply in the handler's existing manner, not rows marked read-only).
   - `pipelines:promptWording` checks the same rule itself (not only "that view offers it").
3. **`sessionPipelines` and the Edit session Pipelines card** (`sessions/sessionPipelines.ts`,
   `EditSessionForm.svelte` ~2949): a guest is sent no pipeline list for the card and the card is absent
   (nothing rendered, no disabled controls). The derived settings form already sends a guest no groups: verify.
4. **The owner's preview.** Where the owner picks a prompt today (the derived settings form's one prompt row,
   and the Pipelines card's rows under advanced controls) there is a **Read the wording** control opening the
   existing `PromptWordingDialog`; the settings form's row has none today: add it there, same component, same
   words. (Rows for every model call are a later lane; this is only the preview on rows that exist.)
5. **Docs and names:** `docs/sessions.md`, `docs/pipelines.md`, `docs/group-sessions.md` (who reads prompts);
   `NOMENCLATURE.md`: rows **session owner**, **guest**, **member** with charters (what each may see of prompts
   and pipelines; what is still open, marked 🚧), §25 with both rulings quoted and the 2026-09-30 line marked
   superseded for prompts.

## Tests

Server, for each of the three events: admin outside a session (as today); non-admin outside a session
(refused, nothing leaked in the error); owner in own session (prompt rows + wording; no connection / sampling /
loadout rows, as today); guest in a session (no prompt id, name, description or wording anywhere in the reply:
assert on the serialised reply); an administrator in someone else's session (unchanged: pin today's
behaviour and name the test "unchanged until G6 is ruled"); `promptWording` with a forged prompt id; the card's
list for a guest. Client DOM: a guest's Edit session shows no Pipelines card; the owner's settings-form prompt
row has **Read the wording**. Find and re-pin tests that pin the old "any member reads prompts" rule (old → new).
`tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/sockets/pipelines.ts` (the three handlers, `viewerFor`), `pipelines/config/panel/scopes.ts`
(`visibleTo` and its comment), `sessions/sessionPipelines.ts`, the client callers of those three events,
`EditSessionForm.svelte` (the Pipelines card's mount only), the settings form's prompt row
(`SessionSettingsForm*.svelte` / `sessionSettingsForm.ts`) for the preview control, their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a non-admin flow outside a session genuinely needs one of the three reads to work
(name it: e.g. the start form); closing the guest's read would also hide something the ruling lets a guest keep
(the session detail view, their own cast); the owner's wording read would expose a prompt marked hidden from
owners (keep it hidden and report).

## Report

Final message = the report (lead saves `plans/REPORT-gs-1-<date>.md`): the rule per event (table: who → what);
client callers found; tests re-pinned (old → new); what was left for G1–G7; sentences and names (★);
**Noticed, not done**. Under about 550 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **The role is computed beside `Viewer`, never inside it.** A guest's writes are refused today only because
   `viewerFor` returns no `sessionId` for a non-owner (`sockets/pipelines.ts:143`), which makes
   `writeScopeFor` pick the configuration scope (`config/panel/scopes.ts:30`) and `resolveWriteScope` refuse a
   non-admin (81–86). **`Viewer.sessionId` stays owner-only.** Do not put a guest's session on `Viewer`: that
   would let a guest's prompt write through the prompts-only check (scopes.ts:91) and flip an administrator in
   someone else's session from configuration writes to session writes. Tests: a guest's `pipelines:setOption`,
   `setOptions`, `clearOption` stay refused; an administrator who is not the owner still writes at
   configuration scope (unchanged until G6).
2. **`pipelines:list` is not gated.** It returns slug, name, version, event, enabled and taxonomy only, no
   prompts (`config/panel/read.ts` 219–235), and a member flow needs it (`PipelineReviewModal.svelte` 50–56,
   mounted for everyone at `Layout.svelte:3850`). Step 2 covers `pipelines:get` and `pipelines:promptWording`
   only.
3. **A non-admin caller outside a session exists:** `src/lib/client/lorebooks/GraphsWorkspace.svelte` shows
   "Graph build pipeline settings" to anyone who can edit the lorebook (1261–1272) and mounts
   `PipelineConfigOptions` with no `sessionId` (1745; also `onRaiseCeiling` ~1700). Once `pipelines:get` is
   administrators-only outside a session, that button is shown only to an administrator; a non-admin sees
   nothing there (not a disabled button). This is a visible change that follows directly from "outside a
   session only an administrator": build it, own that file for this one condition, and report it as ★.
4. **Step 3, the right files:** there is no `sessions/sessionPipelines.ts`; the card's list is sent by
   `sessionsPipelinesHandler` (`sockets/sessions.pipelines.ts` 1097–1110): gate **there** (the session's owner
   or an administrator get the list; a guest gets none) and own that handler. On the client `isGuest` also
   covers an administrator who is not the owner (`EditSessionForm.svelte` 571–572): the card is absent for
   `isGuest && !isAdmin`; re-derive `settingsHides` (617–620). "No pipeline card content" means the Pipelines
   card only: swap cards (`sessions:pipelineCards`, `sessions.pipelines.ts:536`) stay as they are (G1).
5. **Step 4, the preview, decided:** the settings-form row's **Read the wording** offers exactly the prompts
   that row lists (its `listPrompts` pool, `sessions/settingsForm.ts` 836–850, which already leaves hidden
   prompts out for a non-admin unless one is in force; a hidden prompt in force is listed and therefore
   readable, as the panel already allows through `option.value`: R54, 2026-10-21, hides prompts only in the
   picker). `PromptWordingDialog` needs a panel `option` and a `slug`: give the server read
   (`pipelines:promptWording`) a second accepted address (the settings form's address id for that row, checked
   against that row's pool and the session's owner) rather than faking a panel option; one small prop change
   in the dialog. Not a stop-and-ask.
6. **Docs must not overclaim:** Prompt details (`sessions:promptTokenCount`, `sessions.messages.ts`
   2089–2094) still shows a guest the compiled prompt, wording included, until G5 is ruled: the docs say what
   is true, and the report lists it under "left for G1–G7".
