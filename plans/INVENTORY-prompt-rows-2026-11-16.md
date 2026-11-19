# INVENTORY — a prompt row per model call, two views (programme 2.2; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `client/` (`src/lib/client/`) or `sdk:` (`../serene-pub-sdk/`). Re-verify every file:line.

**Short answer:** the Settings tab has two prompt surfaces today. The derived form (`SessionSettingsForm`, for the
owner, advanced on or off) shows **one** prompt row in all shipped data: Story's reply, the only step declaring
`expose.promptReach: 'owner'`. The **Pipelines** card (advanced only) gives a non-admin a Prompt for every agent,
but only for the reply, enabled actions and the create spec: no routines, no other events. Both write the same
`registrations.values` address. Order within a spec is cheap (node `position`, as the executor runs it). Order
across pipelines is not stored anywhere.

**Rulings.** Owner 2026-11-15: "making sure prompt choices are easilly accessible for all session owners in each
of the sections/pipelines. For advanced users/admins, lets also give the sections two views, normal another toggle
to display the settings in order of operation, sectioned in the card by their nodes." Ruled 2026-11-15 evening
("Yes, I agree with you."): ★S3-a, the owner's prompt choice is on by default for every model call; `promptReach`
becomes redundant (`PLAN-session-settings-cleanup-2026-11-15.md` 265–278). This narrows 2026-10-12 ("never …
prompts, in any form") to a pick, never the text (memory, update 2026-11-15). ★S4-a (switch label; one per tab vs
one per section) is **not** in the ruled list. The programme row says "one switch for the tab" (`PLAN-programme` :110).

## 1. The derived form's prompt rows (`sessions/settingsForm.ts`)

| Point | Today |
|---|---|
| Who | Owner only; a guest gets no groups (1111–1114); an admin in their own session sees everything (`viewer` 1170) |
| Which calls | Only `prompts-ref` decls whose node has `expose.promptReach === 'owner'` (559–563). Shipped: Story reply's `context` (`sdk:core-catalog/src/genres/story/respond.ts` 1129–1132) |
| Row | Label "Prompt" (no call name), the fixed description (744–745), enum of the pool (`listPrompts` by node type + slot + spec, 736); hidden prompts left out for non-admins unless in force; admins see "(hidden from owners)" (737, 749) |
| No row | No visible prompt in the pool (738); the whole card is dropped when there are no plain settings and no prompt decls (564) |
| Lock | `settingLocksOf`: read-only at the lock's value, "Set by the session's preset/genre." (718–761) |
| Placement | After the group's plain rows (prompt loop after the plain-row loop, 600–716). No `advanced` flag, so the row sits in front (`client/components/sessionForms/sessionSettingsForm.ts` 100–105) |
| Stale text | Header says prompts are "never in the form" (39–40). The refusal calls prompts an administrator's (1240) |

Mounted for a non-guest whatever the advanced switch (`client/…/EditSessionForm.svelte` 2872). The Pipelines card
is `advanced && sessionPipelines.length` (2949) and is shown to guests too (`isGuest` = not the owner, 571–573;
pinned by `editSessionAdvanced.dom.test.svelte.ts:333`).

## 2. Enumerating model calls; what order exists

- **A model call** = an oracle owning a person-facing connection or sampling slot (`modelCallsOf`,
  `pipelines/config/panel/groups.ts` 362–378). Speech sampling and transcription do not count (352–359). The form
  uses its own rule, `MODEL_SLOTS` (settingsForm.ts 98, 607).
- **The call is not where its prompt is stored.** `generate-text` has no prompts slot. Its prompt is the paired
  assemble step's (`sdk:contracts/src/oracles.ts` 492–504). The panel pairs them into one **settings group**
  (UI: *agent*; groups.ts 1–35). `shared/calls.ts` builds every shipped call as context → transcript → prompt →
  oracle (1–10, 242, 284).
- **Within a spec:** the executor sorts nodes by `position` (`sdk:sdk/src/executor.ts` 1253). Clauses run as levels;
  writes wait in declaration order (2297–2320). Clause kinds: `gather` · `each` · `loop` · `junction`
  (`sdk:sdk/src/builder.ts` 312). The panel's decls arrive in the same spine order (`declarations.ts` 1100–1118), each
  with a step heading (1120–1129). `planGroups` sorts calls by position (groups.ts 140–143); a junction gives one
  group per branch (*Reply · prose*).
- **Across a session's pipelines:** the form ranks reply 0 · other events 1 · actions 2 · routines 3 (settingsForm.ts
  1141–1153). That is a reading order, not a run order. Material for a real one: registration `order` on one
  trigger (`sdk:sdk/src/registrations.ts` 141–142) and the event map's `causes` edges (outlet → event via
  `causedBy`; `pipelines/entities/eventMap.ts` 1–45, scope by session 78–82). Routines on cadences have no causal
  place.
- **Routines:** `dutyParamsOf` reads duty switches, not prompts (`routines/sessionRoutines.ts` 62). Routine specs
  get form cards like any registration.

## 3. What the panel already computes

`flows.ts` lists what a step or group receives and carries out (wiring, not order; admin payload only,
`read.ts` 391–393). Settings groups are in spine order, Prompt first (`STYLE-GUIDE.md` §6.17). The run inspector
orders by a past receipt's `seq` (`client/components/pipelines/inspector/receiptView.ts` 284–328). That works per
run only, not for a form. **Reusable:** `planGroups`/`modelCallsOf` for "one row per call, named as the agent", and
the `declarations` spine order plus `pipeline_nodes.position` for the ordered view. The form already reads
`declarations()` (settingsForm.ts 543–557). `stepOfField` keeps a field's step server-side only (828–834); the
socket `Field` carries the address, not the heading or position (`shared/sockets/types.ts` 5958).

## 4. Storage and run time

One store: the session's registration row, `values[nodeKey][slot] = promptId`, written for **every** registration
key of the pipeline (`patchSessionRow`, settingsForm.ts 777–787, loop at 779). The leftover override row is cleared (788–804).
The panel writes the same place (`config/panel/write.ts` 64–73). The run reads session > preset > genre > instance
> declared, skipping a locked address (`config/world.ts` 993–1018), then leftover rows (1062–1075). A prompts slot
with nothing set falls to its pool's default (`defaultPromptFor`, 1139–1200). So any `prompts-ref` already has a
place to write. `writeGenreFields` is not involved (genre fields only).

## 5. A per-tab view switch, remembered per user

- **Per account:** a `user_settings` column plus a `userSettings:update…` socket, read via `userSettingsCtx`
  (`showAdvancedControls`, `db/schema.ts` 159–160; `client/components/settingsTabs/UserSettingsTab.svelte` 441–445;
  `client/advancedControls.ts`). Needs a generated migration.
- **Per browser:** `createViewMode` stores in localStorage, guarded (`client/utils/viewMode.svelte.ts` 13–58), behind
  `ListCardToggle` (Sessions, Characters, Connections).
- Control: a segmented control, `role="group"`, `aria-pressed` (STYLE-GUIDE §6.5, 1281–1292). Read-only reads as a
  value plus words, never a disabled control (§6.17).

## 6. Calls with no selectable prompt

Transcription (auxiliary), tool or MCP oracles, and any plugin call with no paired `prompts-ref`: its agent has
no Prompt in front. Honest words available: the agent's name, its purpose (`expose.purpose`, groups.ts 417), and
"no prompt to choose". All prompts hidden → no row today (settingsForm.ts 738).

## 7. Open questions (options the code makes cheap)

1. **Row unit:** per agent (`planGroups`, matches Admin) or per `prompts-ref` decl (today's form loop). They differ
   where one assemble step feeds junction branches.
2. **"Normal" order:** today plain rows come first, then the prompt. S3 says Prompt first.
3. **Routine and other-event pipelines:** in the form (rank 1, 3) but not in the Pipelines card
   (`entities/sessionPipelines.ts` 97–127). Rows there are new owner reach.
4. **Cross-pipeline "order of operation":** keep the rank, derive from event-map `causes` plus registration
   `order`, or order only inside each card (S4's wording: "in the card by their nodes").
5. **Conditional or repeated calls:** junction → labelled alternatives (as the panel does). `each`/`loop` → one row
   plus words. A call switched off by an admin → read-only row, or none.
6. **The Pipelines card's prompt row** for non-admins: remove it (S3 "consolidates") or keep it.
7. **A guest with advanced on** gets the cards read at config scope (`sockets/pipelines.ts` 141). Prompts are visible
   to any role (`config/panel/scopes.ts` 59–60), with **Read the wording** (`PipelineConfigOptions.svelte` 1168–1188).
   Per code, not walked.
8. **Switch persistence:** per account (migration) or per browser. Gated by Show advanced controls (owner's
   "for advanced users/admins").

## 8. Tests pinning today

- `sessions/settingsForm.int.test.ts`: :106 owner "never plumbing"; :397 plumbing refused; :758 and :784 prompt row
  under a lock; :846 guest; :1103–1104 "offered among the pool's prompts an administrator has not hidden; stored on
  the session's registration; never the text"; :1440 no owner field folded.
- `config/panel/index.int.test.ts`: :252 prompt fronted; :337 non-admin prompts only; :377 writable in own session;
  :406 refuses non-prompt writes; :698 hidden prompts (R54). `groups.int.test.ts`: :109, :117, :161, :231, :400.
  `sessionValues.int.test.ts`: :194, :269–312.
- `client/…/sessionSettingsForm.dom.test.ts` :231, :249, :309. `editSessionAdvanced.dom.test.svelte.ts` :302–341.
- SDK: `sdk-tests/stepLabel.test.ts` 137–145 (promptReach validation); `sdk-tests/coreCatalog.test.ts` ~957 and
  `boot/specHashes.test.ts` :200 (hashes moved by R54).

Noticed, not done: `docs/sessions.md` 590–602 does not say the Pipelines card needs advanced controls. NOMENCLATURE
has no row for **prompt row** or **model call** (the **settings group** row at :266 and **prompt reach** at :281
cover them).
