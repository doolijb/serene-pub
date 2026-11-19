# INVENTORY — what a guest and a member reach today (D58; read-only, 2026-11-16)

Paths under `src/lib/server/` unless `client/` (`src/lib/client/`) or `sdk:` (`../serene-pub-sdk/`). Builds on
`INVENTORY-prompt-rows-2026-11-16.md` and `BRIEF-ss-3a.md` HELD (not repeated). Re-verify every file:line.
In flight elsewhere: lorebook delete paths, the knowledge judge, the Pipelines panel's knowledge control
(`PipelineConfigOptions.svelte` lines may move), `sockets/import.ts`.

**Short answer:** a guest gets all of **Edit session** (three tabs, mostly read-only), the Pipelines card's prompt
names and wording (advanced on), the compiled prompt through Prompt details, and read **and write** on the
session's own notes. Cast is the one place a guest acts: they add only cards they own and remove only their own.
Card-less cast members are the exception: any guest may seat any member. Nothing stores "guests may manage
their own cast". Outside a session the client doors are admin-only. At the server only `pipelines:list` /
`get` / `promptWording` answer any member. The SDK already **refuses** (not ignores) templates and variable
layouts at owner reach, and the write matrix keeps both off the session layer.

## 1. Roles and "multiplayer" today

| Fact | Where |
|---|---|
| Owner = `sessions.user_id`; guest = a `session_guests` row; `hasAccess` = either. No admin exception | `utils/sessionAccess.ts` 14–45; `messages/permissions.ts` 102–109 |
| Client `isGuest` = "not the owner" (an admin who is not the owner counts) | `client/components/sessionForms/EditSessionForm.svelte` 571–573 |
| `viewerFor`: owner → session scope; **anyone else, guest or admin, → config scope** (an admin writes pub-wide from inside a session card) | `sockets/pipelines.ts` 130–155 |
| Multiplayer switches: accounts on (system); genre `members: 'solo'\|'group'` (`sdk:sdk/src/genres.ts` 235; `sessions/members.ts` 12–24; addGuest refuses solo, `sockets/sessions.ts` 1267–1271); owner adds and removes guests (`sockets/sessions.ts` 1233–1250, 1382–1396) | — |
| `session_guests.is_player` (player / watcher, default true; no UI writer, read by hand edits) | `db/schema.ts` 4243; `state/handEdits.ts` 151–160 |
| **No** per-session visibility, sharing or invite column. The **Visibility** tab is "what this session sees of your data" | `SessionVisibilityPanel.svelte` 1–60 |

## 2. A guest in a session (✓ allowed by D58 · ✗ not allowed · ? unclear)

| Surface | Guest gets | Enforced | D58 |
|---|---|---|---|
| Session page (messages, composer, widgets) | Full, own lines' verbs | `canActOnMessage` (`messages/permissions.ts`) | ✓ |
| Edit session tabs (Participants / Settings / Visibility) | All three; banner "You're a guest…" | Client only (`EditSessionForm` 660, 2226–2233) | ✗ (except cast) |
| Name, tags, lorebook line, scene settings | Read-only / disabled | Client 2253, 2768, `SessionTags.svelte` 56; server ignores non-owner fields (`sockets/sessions.update.ts` 130–137) | ✗ |
| Genre, preset, settings form, On revision, Rules options, actions card | Hidden | Client 2273, 2847, 2872, 2898, 2929, 2791; settings form refuses (`sessions/settingsForm.ts` 1111–1114) | ✓ |
| Swap cards (`sessions:pipelineCards`) | Read-only, advanced on | Client `canEdit={!isGuest}` 2804–2810; read `hasAccess` (`sockets/sessions.pipelines.ts` 543); rebind owner-only (574) | ✗ |
| **Pipelines card** (`sessions:pipelines`, `pipelines:get`) | Prompt rows read-only, **Read the wording**, advanced on | `sessions:pipelines` `hasAccess` (sessions.pipelines.ts 1100); `get` no role check (`sockets/pipelines.ts` 278–287); `visibleTo` (`config/panel/scopes.ts` 59–60) | ✗ |
| `pipelines:promptWording` | Any offered prompt's text | Only "offered by the view" (`sockets/pipelines.ts` 305–363) | ✗ |
| Prompt details (`sessions:promptTokenCount`) | The compiled prompt | `hasAccess` only; admin check commented out (`sockets/sessions.messages.ts` 2090–2093, 2115); opener `SessionHostViews.svelte` 564–580 | ✗ |
| Run inspector, explain | Refused | `receiptsAdminOnly` (`sockets/pipelines.ts` 3129, 3359, 5037) | ✓ |
| `pipelines:artifactRuns` | The runs behind a reply | Test `pipelines.artifactRuns.int.test.ts:243` | ? |
| Annex panel | Only if admin | Client 3009 | ✗ for an admin guest |
| Layout (`sessions:panelLayout:*`) | Own per-user layout; may not publish | `hasAccess` (`sockets/sessions.layout.ts` 248, 496–504); `layoutPresets.int.test.ts:739` | ✓ |
| Session notes | **Read and write** | `lorebooks/ownBook.ts` 602–621; `utils/ownedBook.ts` 53–64 | ? |
| Timeline / reading | Read-only | Client 2740, 2752 | ✓ |
| Turns | Continue; own entry; own lane | `sockets/sessions.turns.ts` 95, 134, 298, 348; retake and Narrator owner-only (507, 696) | ✓ |
| Actions | By each action's audience | `pipelines/entities/sessionActions.ts` 11, 139 | ✓ |
| Benched seats | Own only | `sockets/sessions.participants.ts` 601, 656, 661 | ✓ |
| Guests card | Visible, controls disabled | Client 2486–2495; server owner-only | ? |

## 3. Cast management by a guest

| Verb | Event | "Own" means | Where |
|---|---|---|---|
| Add character / persona | `sessions:update` (`characterIds`, `personaIds`) | `characters.user_id` = me | `sessions.update.ts` 670–685, 895–910 |
| Add persona from the composer | `sessions:addPersona` | same | `sessions.participants.ts` 50–75 |
| Seat a **card-less** cast member | `sessions:update` (`castMemberIds`) | **no ownership check**, `seatedBy` = me | `sessions.update.ts` 797–835 |
| Remove | `sessions:update` | card owner, or `seatedBy` | 697–720, 841, 920–951. Others' rows are skipped silently |
| Reassign a removed seat | `sessions:reassignRemovedParticipant` | removed card's owner | `sessions.participants.ts` 275, 402 |
| Bench / bring back | `sessions:setCastSeatEnabled` | card owner or `seatedBy` | 601–661 |

The owner can already add and remove guests, bench any seat (`removeGuest` benches the guest's player
seats, `sessions.benchedSeats.int.test.ts:288`), keep a channel to themselves, and set the sheet hand-edit levels.
The owner **cannot** add a guest's persona (must own it). A guest's client shows every cast row and remove
button (`SessionCharacters`, props 2328–2345, no owner filter). Only player seats filter by `mine`
(`SessionPersonas.svelte` 197–199).

**Where a per-session switch could live.** No existing field: `SessionSettingsV1` is the derived per-run
document, not stored. Options: a `sessions` column (generated migration plus a second-boot test);
`sessions.metadata` (core's settings json, keys `playerLabel`, `scenes`, each with its own `jsonb_set` writer,
`db/schema.ts` 2641–2651, no migration); per guest on `session_guests` (the `is_player` precedent, migration).
The read belongs in the three add paths above and in `addPersona`.

## 4. Outside a session (non-admin member)

| Surface | Client | Server |
|---|---|---|
| Pipelines, library, scripts | `/pipelines*` → `/admin/*` (`routes/pipelines/+page.ts`); admin shell `goto("/")` (`client/admin/+layout.svelte` 20); library 520 | **`pipelines:list`, `pipelines:get` (any slug), `pipelines:promptWording` unchecked** (`sockets/pipelines.ts` 260–363); library / preview / validate admin-only (`libraryGate` 1454; 1347; 1639) |
| Prompt and template writes | — | Prompts admin-only (`config/panel/write.ts` 241–247); templates refused at non-admin (`write.ts` 170–174 → `scopes.ts` 94–99) |
| Variable layouts | — | Admin-only (`sockets/pipelinesVariableLayouts.ts` 18, 48) |
| Connections, sampling, models, loadouts | Rail items admin-only (`client/components/Layout.svelte` 1025–1040) | Every handler checks `isAdmin` (`connections.ts`, `samplingConfigs.ts`, `loadouts.ts`, `connectionDefaults.ts`, `completionTemplates.ts`) |

## 5. "User-surfaced" in the SDK

- **Ways to reach the owner:** field `reach: 'owner'` (`sdk:sdk/src/settings.ts` 194–205; genre fields default
  owner, pipeline settings admin, `sdk:sdk/src/exposure.ts` 193–217); node `expose.session: true` (plain params
  on non-model steps, `settingsForm.ts` 609–614); `expose.promptReach: 'owner'` (`sdk:sdk/src/builder.ts` 511–518,
  591–599); `expose.swaps`; `advanced: true` is a fold, not permission. The P5 warning (no purpose / group /
  reach) is **not built** (no match in `sdk:sdk/src`).
- **Slot kinds and session reach:** `WRITE_MATRIX` (`sdk:sdk/src/config.ts` 439–469): prompts, params,
  settings, sampling → session; **template, variables, scripts, loadout → preset / genre only**; connection →
  preset. Field types carry no template reference (`settings.ts` 73–157).
- **Templates and variable layouts to a non-admin: not possible today.** `MODEL_PLUMBING` names `template(s)`
  and `variables` (`exposure.ts` 108–120). `exposureFindings` refuses owner reach (135–153) at define
  (`sdk:sdk/src/descriptors.ts` 2494–2499, throws), in `validate()` (`sdk:sdk/src/registrations.ts` 810–822,
  error "exposed plumbing"), on genres (`genres.ts` 1217) and on rulesets (`rulesetSections.ts` 1600). At run
  time `ownerSees` drops plumbing (`exposure.ts` 217). The panel shows a non-admin prompts alone (`scopes.ts`
  59–60); the form reads only `params` / `settings` (`settingsForm.ts` 100, 558). Gap: plumbing is matched
  **by key**, so a param named otherwise holding a template id slips through.
- **Shipped:** no genre or preset exposes either. Owner reach: `core-catalog/src/shared/roundTick.ts` 46;
  `promptReach` only Story reply (`genres/story/respond.ts` 1132); 13 `expose.session: true` nodes, all plain.
- **"Ignore with a warning" would go** into `exposureFindings` callers, softening the three throws / errors
  above to `warn(...)` (`registrations.ts` 491) plus a drop. Today the rule is stricter: it refuses.

## 6. Prompt preview today

- **Read the wording**: read-only prompt row (`PipelineConfigOptions.svelte` 1168–1188); writable row
  "Read the prompts this step offers" (1384–1399) → `PromptWordingDialog.svelte` (Use only when `canPick`,
  2687–2695) → `pipelines:promptWording`. Reached by anyone who sees a Pipelines card (owner, guest,
  admin). The derived settings form's prompt row has no such button (no `wording` in `sessionForms/`).
- **Prompt details** (`PromptDetailsModal.svelte` 1–8, "Prompt preview" 368): the compiled draft or reply
  prompt, any member.
- No dry-run prompt preview by template (`pipelines:previewTemplate` is admin-only).

## 7. Open questions (options the code makes cheap)

1. **"Session detail view"**: the session page alone, or also **Participants**? Cast lives there today.
   Options: hide Settings and Visibility for guests (client 660); or move a guest's cast verbs into the page.
2. **Others' cast**: show it to a guest read-only, or hide it? Remove buttons on others' rows are no-ops today.
3. **Card-less members**: are they "cards they own"? Gate `castMemberIds` adds for guests, or leave them open.
4. **Switch off with a seat in place**: keep the seat (freeze adds only), bench it (the `removeGuest`
   precedent), or remove it. With the switch off, a guest with no seat can never play: the owner cannot seat
   another person's persona (§3). Is an owner-seats-for-guest path wanted?
5. **Switch home and default**: `metadata` key (no migration) or column / per guest (migration). On or off for
   existing sessions?
6. **Session notes**: guests write them today. Keep that under "a guest sees nothing"?
7. **Prompt details** for guests (compiled prompt text): refuse at `sessions.messages.ts` 2115, or strip the
   prompt and keep counts.
8. **An admin who is not the owner**: the session card writes at config scope (`viewerFor` 139–143). Keep it,
   or read-only inside another's session?
9. **"Outside a session only an administrator"**: gate `pipelines:list` / `get` / `promptWording` by
   `isAdmin` when `sessionId` is absent or not owned (one check in `viewerFor` / `buildView`).

## 8. Tests pinning today

- `sockets/sessions.participantRemoval.int.test.ts` :108 guest removing another's rejected, :137 own succeeds,
  :278, :300 reassign refusals. `sessions.benchedSeats.int.test.ts` :288, :530. `sessions.addGuestEnumeration` :52.
- `sockets/pipelines.promptWording.int.test.ts` :97, :123, :134, :159 (owner non-admin only; no guest case).
  `config/panel/index.int.test.ts` :337, :350, :377, :406, :643, :698.
- `sessions/settingsForm.int.test.ts` :846 guest; `client/…/sessionSettingsForm.dom.test.ts` :309.
- `client/…/editSessionAdvanced.dom.test.svelte.ts` :325, :333 (guest sees the Pipelines line), :455;
  `editSessionPlayerSeats.dom.test.svelte.ts` :153; `editSessionLorebookLine.dom.test.svelte.ts` :164, :169;
  `editSessionHowStrict.dom.test.svelte.ts` :216; `editSessionGuestOwnNotesReading.dom.test.svelte.ts` :173.
- `db/layoutPresets.int.test.ts` :739; `sockets/jump.int.test.ts` :211; `pipelines.artifactRuns.int.test.ts` :243;
  `pipelines.messageExplain.int.test.ts` :236; `entries.earmark.int.test.ts` :361 (guest on own notes);
  `pipelines.cancelRunAction.int.test.ts` :269, :286 (D15).
- SDK: `sdk-tests/stepLabel.test.ts` 137–145 (promptReach); exposure refusals: look for an `exposureFindings` test before changing them.

**Noticed, not done:** NOMENCLATURE has no row for **guest**, **member** or **session owner** (44 uses, no
charter). `docs/sessions.md` 612 says a guest "sees the session" but not that they see Edit session's tabs or
prompt wording.
