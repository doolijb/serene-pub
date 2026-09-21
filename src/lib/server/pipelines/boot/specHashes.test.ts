/**
 * What each core spec's slug resolves to, as a checked-in fact.
 *
 * ## What this used to be for, and what it is for now
 *
 * Seeding matched on `(slug, semver)` and **skipped on a match**, so a changed
 * pipeline published under an unchanged version reached no install that had
 * already booted: the instance kept running the old document while the code said
 * otherwise, and nothing anywhere reported it. Tests could not catch it — a
 * fresh database publishes whatever the code currently says, so every
 * integration test passed on the new shape while real upgrades silently got the
 * old one.
 *
 * Since the content-addressing ruling (2026-09-10) a version is `(spec, semver,
 * canonical hash)`: an edited document publishes as a **new row**, the slug's
 * `active_version_id` moves to it, and the row it moved off is retired for the
 * receipts that pinned it. So the silent-skip is gone, and with it the reason
 * every in-place spec edit needed a migration deleting version rows (0095, 0100,
 * 0102, 0106, 0110, 0111, 0113, 0115 — eight of them, one per edit).
 *
 * What remains is the question this file has always really been asking: **did
 * you mean to change what that pin means?** A moved hash is now shippable and
 * still has to be deliberate, which is what a recorded snapshot makes it.
 *
 * Found the hard way, and worth keeping written down. A version bump written as
 * a string replacement matched nothing, because another session had already
 * moved that spec to the version being written; the replace was a silent no-op
 * and the whole change sat behind a version that seeding skipped.
 *
 * ## When this fails
 *
 * You changed a core spec. Either bump its `*_VERSION` and add the new pin, or —
 * under the 0.6 version freeze, which is the usual case — record the new hash
 * against the existing pin, in the same commit as the edit. **No migration is
 * involved any more**; the comments below that name one are history.
 *
 * That the slug's row actually *carries* the recorded hash after a boot is
 * asserted by `contentAddressing.int.test.ts`, where a database is available.
 */

import { describe, expect, it } from "vitest"
import { canonicalHash } from "@serene-pub/sdk"
import { CORE_SPECS } from "$lib/server/pipelines/specs"

/**
 * `slug@semver` → the document's canonical hash.
 *
 * The version is *in the key* on purpose: bumping it makes a new entry rather
 * than editing one, so the diff shows a version and a shape changing together
 * instead of a hash quietly moving underneath a version that did not.
 */
/**
 * ## The one-shot rename (2026-09-16; plans/30 §U3, migration 0134) — all seventeen moved at once
 *
 * Every stored document changed words and nothing else: node kinds (`input ·
 * provider · consumer` → `inlet · oracle · outlet`) and the definition ids that
 * carry them, clause kinds (`async · map · route` → `gather · each · junction`)
 * and the `clauses` key itself, `subscribes` deleted (R-4), the inlet lock and
 * the genre surface keyed by event id, triggers saying `venue`, the taxonomy
 * `zone` culled, the tool loop keyed `tools`, and — the one semantic change —
 * the two loser lore lanes and the loser embed node reading their `params`
 * through the owner (R-7 P2). Migration 0134 rewrites every stored row to the
 * same document these hashes name; `renameMigration.int.test.ts` proves the
 * rewritten rows hash to exactly these values, and the boot after it moves each
 * slug's pointer once. The rows the pointers moved off keep their old hashes,
 * marked `renamed_at`, for the receipts that pinned them.
 */
const PUBLISHED: Record<string, string> = {
	// 1.0.0: the standard session type as a create spec (23 §7) — the F29
	// floor's shape moves from the input descriptor to this document.
	// Hash moved (R-15 *Forms*, 2026-09-17 — U5d): the genre's event surface,
	// which rides `meta.genre` on the create spec, declares
	// `core:event/form-addressed@1` (optional) — the same move for all three
	// create specs. Nothing the pipeline sends changes. (was "9bfdda8a4f589")
	"core:spec/create-chat@2.2.0": "1bc0b0f6dc8999",
	/**
	 * The guide genre (plans/29 R-18; U5g, 2026-09-16) — two new slugs, and
	 * nothing above them moves. `create-guide` carries the genre's
	 * declaration, its one envoy included, on the version row;
	 * `guide-respond` is `respond` with the lore machinery replaced by
	 * `core:query/docs-search@1`, the envoy on the inlet's `speaker`, its
	 * card on the context builder's `speaker` port, and its instructions read
	 * by `slot.prompts({ envoy: 'mascot' })` — configuration at
	 * `envoy:mascot`, never a prompt row.
	 */
	// (was "cbca3b3df89e2") — moved with the genre surface, U5d; see create-chat.
	// (was "fa7a3eb64e2a9") — moved again, R-B (2026-09-17): Guide's genre now
	// declares `writes: { lore: false, scenes: false }`. Its lorebook is the
	// documentation it answers out of, and a session about how the app works
	// opens no scene; the declaration is what the write sites refuse from.
	// `create-chat` and `adventure-create` are untouched — neither declares
	// `writes`, and a genre that says nothing still means both on.
	"core:spec/create-guide@1.0.0": "fad8888e9b78f",
	// (was "1d39898d4c7a0c") — W9 shape pins, see the note above adventure-ask.
	"core:spec/guide-respond@1.0.0": "e9e2afe8ba8fb",
	/**
	 * The Adventure genre (DESIGN-adventure-genre.md) — five new slugs, and
	 * nothing above them moves. Every node they pin is either one core already
	 * shipped or one declared beside them; no existing spec or type was edited,
	 * which is what keeps `core:spec/respond@1.20.0` on the hash it has.
	 *
	 * `adventure-respond` is the multi-agent turn: plan, narrate, one voice per
	 * speaker the planner named, then a state keeper whose changes are proposed
	 * unless the session trusts the narrator. The other three are actions on the
	 * open `session-action` slot.
	 */
	// (was "1c67b7acb698cf") — moved with the genre surface, U5d; see create-chat.
	"core:spec/adventure-create@1.0.0": "240458abb4e3b",
	// ⚠ MOVED, in place, while the genre is still unreleased: the planner and
	// the keeper now pin `core:oracle/generate-json@1` instead of
	// `generate-text` + `parse-json`, their transcript comes from
	// `core:task/prose-transcript@1`, and the narrator builds its own. A live
	// playtest showed why: asked as ordinary replies, both JSON stages wrote the
	// character's next paragraph and appended the document under it, and the
	// keeper reproduced the PLANNER's schema it had read in the transcript.
	// `core:spec/respond@1.20.0` is untouched.
	// ⚠ MOVED AGAIN, same terms: the resolver now takes the planner's document
	// on a `plan` port (its `worldHints` were required by the schema and read by
	// nobody), the voices take the state and the plan so a cast member knows
	// where they are standing, and the narrator's own assembly template is gone
	// — every variable in it was wrong, so the narrator's prompt arrived with no
	// instructions, no transcript and two `[object Object]` blocks.
	// ⚠ MOVED AGAIN, same unreleased-genre terms: the preset points the
	// planner's and the keeper's Sampling slots at the seeded Background row,
	// by seed identity (`{ seedKey: 'sampling-background' }`) because a row id
	// differs per install. The narrator and the voices are untouched: those
	// are the prose a person waits for, and they keep the session's own pick.
	// ⚠ MOVED, same unreleased-genre terms (09-B B4, 2026-09-15): the turn
	// creates its own row — a `placeholder` outlet after the inlet, `save`
	// an `update-message` filling it — and `contextBudget` shares the
	// narrator's connection for the model's own window (R-8).
	// (was "890fe65ccfdc4")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "179a33c33b9856")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1cce782246906a")
	// Hash moved (U5a, 2026-09-16): the voices' context builder takes the
	// planner's voice on `sideCharacter` (was `speaker`) — the port rename
	// on `build-side-character-context@1`, R-18 (3). Same value, same
	// prompt. (was "5822ccf7f43da")
	// (was "6471d909046c2") — W9 shape pins, see the note above adventure-ask.
	// Moved (U5f, R-15 *Staleness and order*, 2026-09-17): the keeper's
	// resolver and both `set-state` arms wire `base` from the state query's
	// `version` — the version this turn read, handed back with its deltas.
	// (was "12faeb788b2f4c")
	// Moved (W1, 2026-09-17): the voices `each` gained a per-speaker
	// character-lore lane, its own pool and its own rank, so a voice reads its
	// OWN private lore instead of every cast member's. `speaker` is the
	// reference the voice's context node already resolved. The spine's
	// character-lore lane stays the narrator's.
	// (was "1d49758bb5b83c")
	"core:spec/adventure-respond@1.0.0": "138f57a4301cd9",
	// ⚠ MOVED, unreleased-genre terms (R-8, 2026-09-15): the three actions'
	// `contextBudget` shares the writing step's connection for the model's
	// own window, like every other budget node.
	// (was "17e9e37a86a2c2")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "eb29ca84d5098")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): a `lore` concat now sits between
	// the keyword scan and `rank`, carrying the conversation's band intent
	// beside the scan's candidates — a ranker takes one list and the intent
	// needs a seat in it. (was "11669b8b5b66fd")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "15e41a328459f3")
	// (was "197bb42b7b2bb6") — W9 shape pins, see the note above adventure-ask.
	// Hash moved (plans/31 V2, 2026-09-17): every action spec below lost
	// `contributes.actions[].function` — the key is the identity, and the
	// compiled document carries one word for it. Content of the
	// contribution, not of the run. The 28 old hashes are in git.
	"core:spec/adventure-look@1.0.0": "fb15c2d04afa8",
	// ⚠ MOVED, in place, on the same unreleased-genre terms: Rest and Time
	// passes ask `core:oracle/generate-json@1` for the keeper's own shape
	// instead of parsing prose out of a prefilled reply.
	// (was "eaa7a41b6cd8c" — R-8, see `adventure-look`)
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "1dea5cfc5a78d2")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "4e32a33712802")
	// (was "3755831896611") — W9 shape pins, see the note above adventure-ask.
	// (was "1a5601d7f3d4c") — `base` wired, U5f; see adventure-respond.
	"core:spec/adventure-rest@1.0.0": "1594b5fa34f7cc",
	// (was "135459cfe7c4c0" — R-8, see `adventure-look`)
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "e1c078298920d")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "17168783bd30d0")
	// (was "1173a06c378df0") — W9 shape pins, see the note above adventure-ask.
	// (was "283effed6289d") — `base` wired, U5f; see adventure-respond.
	"core:spec/adventure-advance-time@1.0.0": "c9dfbd1a0aa41",
	/**
	 * Forms (plans/29 R-15 *Forms*; 30 §U5d, 2026-09-17) — five new slugs,
	 * and the three create specs above move with their genre surface. The
	 * three `answer-form-*` are one graph published once per shipped genre
	 * (a preset binds a spec locked to its genre): `form-addressed` inlet →
	 * history + cast → the addressee's card → `form-context` → prose
	 * transcript → assemble (inline template) → `generate-json` against the
	 * form's schema → `answer-form`, which fires the block's action as the
	 * addressee. `adventure-ask` is the worked form — the narrator puts a
	 * question with choices to one of the cast — and `adventure-answer` is
	 * what its options fire, by a click or by the answer pipeline.
	 */
	/**
	 * ## The W9 shape pins (2026-09-17, U5d review) — fourteen moved at once
	 *
	 * `validate()` had never run over the catalog, and when it did (it runs
	 * at `saveDocument` now) thirteen shipped specs carried a 01 §3 finding:
	 * `session-history@1` DECLARED `context-candidates@1` on `main` and
	 * `messages` while PUBLISHING transcript rows — every one of them wires
	 * `history.messages` into `process-messages` / `prose-transcript` /
	 * `query-windows` / a turn strategy, which take `messages@1`. The
	 * declaration was wrong, not the rule: the port now says `messages@1`
	 * (the intent rides `band` alone, as it always did), `vector-search@1`'s
	 * `vectors` says `json@1` (a list of query vectors, which is what
	 * `embed-text@1` publishes and the host reads). An edge's compiled
	 * `shape` is part of the document, so every spec reading history moved;
	 * `adventure-answer` moved for its `form` venue (S1) and the answer-form
	 * specs for the outlet's timeout and two new out-ports (W2). Nothing the
	 * runs send changes. (W9 had also made `messages@1` assignable to
	 * `context-candidates@1` one way; the fix pass withdrew it — R-a — since
	 * no shipped spec wires the transcript as candidates, no pin moved.)
	 */
	// (was "b2c4f4431d9a2") — W9 shape pins, see the note above adventure-ask.
	"core:spec/adventure-ask@1.0.0": "f223539fbe04a",
	// (was "1387dc7a4901d6") — W9 shape pins, see the note above adventure-ask.
	"core:spec/adventure-answer@1.0.0": "11363c44f7099c",
	// (was "a2ddb2700ce09") — W9 shape pins, see the note above adventure-ask.
	"core:spec/answer-form-chat@1.0.0": "4398d5e3dcebc",
	// (was "b89f3d6c0484b") — W9 shape pins, see the note above adventure-ask.
	"core:spec/answer-form-adventure@1.0.0": "837f6311648d6",
	// (was "1ddc286846b82d") — W9 shape pins, see the note above adventure-ask.
	"core:spec/answer-form-guide@1.0.0": "1ff7e25eba1d7a",
	"core:spec/create-chat@2.1.0": "ea80f2679383c",
	"core:spec/create-chat@2.0.0": "a6281141b21ea",
	// 1.16.0 / 1.10.0: the three lore gather branches and the narrator's trigger query
	// wire `params: slot.params()`. The executor resolves only the slots a
	// node's config names, so until now their declared parameters — Scan
	// Depth, Max Recursion Depth, Retrieval Mode — were handed over as
	// `undefined` on every run. The bump is what carries the wiring to an
	// install: seeding matches on (slug, semver), which is exactly what this
	// file exists to make loud.
	// 1.17.0: the three lore gather branches stop going through
	// `core:task/merge-candidates@1`, whose reciprocal-rank `presetScore`
	// overrode every signal weight downstream — the branches are disjoint, so
	// there was nothing for rank fusion to fuse and each entry ranked by its
	// position in its own list. `core:task/concat-candidates@1` instead.
	// 1.11.0: the narrator gets a `contextBudget` node, so `rank` has a budget
	// to select against. Without one `availableTokens` was 0 and the narrator
	// retrieved no lore at all.
	// 1.18.0: `core:query/entity-search@1` joins the three lore gather branches and is
	// concatenated **last**, so an entry the keyword scan already found keeps
	// its keyword signals and the new mechanism only ever adds rows no key reached.
	// It ships inert — both its caps default to 0, which is off — so the bump
	// carries the node to an install without changing any prompt until somebody
	// raises one.
	// 1.19.0: the fourth mechanism. `core:query/vector-search@1` has been built,
	// bound and tested since the decomposition and was wired into no shipped
	// spec at all; it joins the three lore gather branches and the entity mechanism at
	// `concat-candidates`, contributing `signals.semantic` as a **score
	// component** rather than an ordering to be fused. Its own `async` block
	// after `gather` — chains of a parallel block cannot read each other, and
	// the embed Provider on the spine would halt the debug preview. Ships off:
	// `vector-search.maxEntries` defaults to 0.
	// 1.20.0: the fifth mechanism. A `names` block — `mention-spans` → `embed`
	// → `entity-link` — and a `loreLinked` concatenation `rank` now reads
	// instead of `lore`. The mechanism matches the scene's *descriptions* ("the
	// captain") to an entry's *names* (Captain Vell) in a second vector space,
	// and it may only reorder: `entity-link` takes the candidate list on an
	// in-port and returns it enriched, with the unenriched list concatenated
	// behind it, so every way the mechanism can produce nothing lands on exactly what
	// the ranker would have seen without it. Ships off — `maxMentions` is 0, on
	// the first node of the chain, so nothing is read and nothing is embedded.
	//
	// ⚠ **1.20.0 and 1.11.0 moved WITHOUT a version bump, and that is the
	// exception this file's own rule names, not a breach of it.**
	//
	// The version freeze ruled for the 0.6 pre-release — "no SDK spec bumps;
	// all stay a hard 1 until 0.7.0" — leaves editing in place as the only way
	// to ship a spec change. The hazard the freeze creates is exactly the one
	// this file exists to catch: seeding matches on (slug, semver) and, on a
	// match, updates only the display name, so an in-place edit reaches NO
	// database that has already seeded and is invisible on a fresh test one.
	//
	// So the edit is paired with `drizzle/0095_prompt_format_reprojection.sql`,
	// which deletes the published `pipeline_spec_versions` rows for these two
	// pins so boot republishes them. **A moved hash here with no such migration
	// is still the failure this file is for** — updating a line to make the
	// suite green is only correct alongside the re-projection that carries the
	// change to an install.
	//
	// What moved: the `prompt` step gained `connection: slot.connectionOf(
	// "generate")`, so the render finally learns the wire format it is
	// rendering for. Nothing supplied it before — every prompt went out Vicuna
	// whatever the connection said, and the receipt reported the format that
	// was not used.
	// ## The narrator split, and the third in-place edit — answer 3 again
	//
	// `core:spec/narrate-character@1.0.0` is a NEW spec, which is the easy half:
	// a slug seeding has never seen publishes normally, and no migration is
	// involved. It is listed here for the same reason every other pin is —
	// the second test below refuses a published version this table does not
	// record.
	//
	// ⚠ `core:spec/narrate@1.11.0`'s hash MOVED, again without a bump, and
	// again paired with a migration — `drizzle/0100_narration_split_reprojection`
	// deletes its published `pipeline_spec_versions` row so boot republishes it.
	// **A moved hash here with no such migration is still the failure this file
	// is for.**
	//
	// What moved: the three retrieval mechanisms the reply pipeline gained in
	// its 1.18.0, 1.19.0 and 1.20.0 are wired into the narrator —
	// `entity-search`, the `semantic` arm and the `names` arm, concatenated in
	// respond's own argument order, with `rank` reading the linked pool instead
	// of the bare keyword lane. Until now this document wired the keyword
	// mechanism and the ranker and nothing else, so every retrieval control the
	// panel renders for a narrator reached nothing — the same
	// control-with-no-effect class the retrieval audit removed everywhere it
	// could see, hiding in the one pipeline its corpus does not render through.
	// All three ship off (every cap defaults to 0), so an upgraded install
	// retrieves exactly what it retrieved before.
	// ## The transcript window becomes a real control — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED, again under unchanged versions, and again
	// paired with a migration — `drizzle/0110_session_history_limit.sql` deletes
	// the three published `pipeline_spec_versions` rows so boot republishes
	// them. **A moved hash here with no such migration is still the failure
	// this file is for.**
	//
	// What moved, identically in each: the `history` node wires
	// `params: slot.params()`. It never named the slot, and the executor
	// resolves only the slots a node's config names — so `limit`, "How many
	// recent messages are considered for the context", arrived as `undefined`
	// on every turn these three pipelines have ever taken and the binding fell
	// through to a literal 100. This is the third time this exact omission has
	// shipped (1.16.0/1.10.0 for the lore lanes, 1.10.0 for the narrator's
	// trigger query); it is the same one-line wiring and the same finding.
	//
	// Behaviour-preserving by construction: the declared default is 100 as of
	// this ruling, which is the literal the binding has been using, and 0110
	// lifts the stored 40s that `reconcileConfigs` back-filled from the old
	// declaration. An install at defaults reads the same 100 messages after this
	// as before it.
	// ## The reply step's own Connection and Sampling — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED **again**, a second time under unchanged
	// versions, and again paired with a migration —
	// `drizzle/0111_reply_slots_and_relationship_cap.sql` deletes the three
	// published `pipeline_spec_versions` rows so boot republishes them. **A moved
	// hash here with no such migration is still the failure this file is for.**
	//
	// What moved, identically in each: the `generate` node wires
	// `connection: slot.connection()` and `sampling: slot.sampling()`. It is the
	// OWNER of both — `contextBudget` reads `slot.samplingOf("generate")` and
	// `prompt` reads `slot.connectionOf("generate")` — and it never named them
	// itself, so `refId(p.connection)` at the host read `null`,
	// `resolveCapabilityTarget` took that as "the pipeline chose nothing", and
	// the request went to the instance default while the budget and the wire
	// format followed the pick. One window sized the prompt and another received
	// it. Found by `boot/paramsSlotWiring.test.ts`, which had all six of these in
	// its ledger.
	//
	// ⚠ **NOT behaviour-preserving where somebody set the picker, deliberately.**
	// The pick was entered by a person and ignored; honouring it is the fix
	// (STATE-2026-09-08 §1, "Per-node sampling ignored"). An install that never
	// set one is unaffected — `resolveSlot` falls back to
	// `world.activeConnection[kind]`, projected from the same `connection_defaults`
	// row the `capabilityDefault` tier reads — and a session override still
	// outranks the pipeline's tier.
	// ## The ranker's allocation reaches the assembler — answer 3, three pins
	//
	// ⚠ All three hashes below MOVED **again**, a third time under unchanged
	// versions, and again paired with a migration —
	// `drizzle/0113_declared_ports_and_rank_groups.sql` deletes the three
	// published `pipeline_spec_versions` rows so boot republishes them. **A moved
	// hash here with no such migration is still the failure this file is for.**
	//
	// What moved, identically in each: the `prompt` node wires
	// `groups: $.rank.groups` (D-H). `core:task/rank-hybrid@1` has published what
	// each retrieval band was allotted, spent and filled since it was written,
	// and `core:task/assemble@2` has taken `allocate`'s own `?? {}` instead —
	// two adjacent nodes, one computing exactly what the other needed, with no
	// edge between them. Neither port was declared, which is why nothing said
	// so; `boot/registryHashes.test.ts` records both declarations moving in the
	// same change.
	//
	// ⚠ **Behaviour-preserving, and checkably so.** `allocate` copies `groups`
	// onto `AllocatedContext.groups` and reads it nowhere else, so `blocks`,
	// `totalTokens` and `budget` — everything `render` walks — are the same
	// bytes with the edge or without it. The parity corpus is the evidence: all
	// sixteen goldens are byte-identical across this change. What fills in is the
	// RECEIPT — `dispatch.ts` publishes `payload.groups` as the run's `sources`,
	// which is the budget panel's entire data set and has been an empty object on
	// every run ever recorded.
	// (was "127bfb179f55dd", then "13d5772f33e5ec", then "9cfae9a28583f",
	//  then "17c8c28ac7fd7f")
	// ⚠ MOVED (09-B B4, R-17, 2026-09-15): the pipeline owns its row. A
	// `placeholder` outlet straight after the inlet creates the narration row
	// — the speaker fact and the instructions beside it — and `save` is an
	// `update-message` filling it; `contextBudget` shares the generating
	// step's connection for the model's own window (R-8). The trigger inserts
	// nothing any more. Under the 0.6 freeze the semver stays.
	// (was "1a1055550a18d6")
	// ⚠ MOVED again (U1 review C1, 2026-09-16): the placeholder wires
	// `row: $.input.messageId`, as `respond`'s does — a regenerate, swipe or
	// continue on a side character's line routes back here, and without the
	// wire this node inserted a second row while the verb's spun forever.
	// (was "1ef5a87d5d82cd")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "b85fb72d78a44")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1dcc060b10f7fb")
	// Hash moved (U5a, R-18 (3), 2026-09-16): the side-character fact rides
	// `$.input.sideCharacter` into the placeholder and the context builder
	// (was `$.input.speaker`; that port is the participant reference now).
	// Same fact, same row, same prompt. (was "6ddff19a519fb")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "1e7b25867803a2")
	// Hash moved (2026-09-16): the placeholder wires `speaker:
	// $.input.speaker` — the inlet's participant reference — so a picked
	// character's row carries `metadata.speaker = character:<id>`, the same
	// shape 0138 writes for a migrated row. (was "e3ab80dc58afa")
	// (was "174220ef023ed7") — W9 shape pins, see the note above adventure-ask.
	"core:spec/narrate-character@1.0.0": "dc7fab4edc2c4",
	// (was "b6ba835e86244", then "431aa4254af1", then "12971669b900fd",
	//  then "bc304a8a52b71")
	// ⚠ MOVED on the same terms as `narrate-character` above (09-B B4):
	// placeholder → update, the instructions stored beside the row by the
	// placeholder, the connection shared onto `contextBudget`.
	// (was "1276c81165cdd1")
	// ⚠ MOVED again (U1 review C1, 2026-09-16): `row: $.input.messageId` on
	// the placeholder — the paragraph above `narrate-character@1.0.0`, for the
	// verb on a narration row.
	// (was "8d82b49922817")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "1dae47bcb08545")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "1be02ac2c726fc")
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "11ca2223b19a22")
	// (was "3d0b93608ab5b") — W9 shape pins, see the note above adventure-ask.
	"core:spec/narrate@1.11.0": "1b22fdf56d7757",
	// ⚠ `core:spec/respond@1.20.0`'s hash MOVED for the SECOND time without a
	// bump, on the same terms as the two paragraphs above and paired with
	// `drizzle/0106_continuation_prefill_reprojection`, which deletes its
	// published `pipeline_spec_versions` row so boot republishes it.
	//
	// What moved: the `lines` node wires
	// `continuationPrefill: $.input.continuationPrefill`, so the text a
	// **continue** is continuing reaches the seed line the model writes from
	// (ruling 2026-09-08, D-2). One edge. Byte-identical for every turn that is
	// not a continue — the port carries "" and the seed renders empty, exactly
	// as it always did.
	//
	// And a THIRD time, by the `history` node's `params` wiring — see the
	// paragraph above `narrate-character@1.0.0`, which moved for the same
	// one-line reason, and `drizzle/0110_session_history_limit.sql`.
	//
	// And a FOURTH time, by `drizzle/0111_reply_slots_and_relationship_cap.sql`,
	// carrying TWO edits rather than one. The `generate` node's `connection` and
	// `sampling` — the paragraph above `narrate-character@1.0.0`, which moved
	// for exactly that and nothing else — plus a change only this document has:
	// `gather.relationshipsPerspectives.read` and
	// `gather.relationshipsKnown.read` wire `params: slot.params()`, so "Most
	// relationships" reaches `capRelationships` instead of arriving as
	// `undefined`. That half IS behaviour-preserving, and the declaration is what
	// makes it so: `maxEntries` carries no default now — uncapped is not a number
	// `min: 0` can hold, and `undefined` is what every run has been reading — and
	// 0111 lifts the stored `12`s `reconcileConfigs` back-filled from the old
	// declaration. `boot/registryHashes.test.ts` records the two moved type
	// hashes in the same change.
	//
	// And a FIFTH time, by `drizzle/0113_declared_ports_and_rank_groups.sql` —
	// the `prompt` node's `groups` edge, the paragraph above
	// `narrate-character@1.0.0`, which all three moved for and nothing else.
	//
	// And a SIXTH time, by `drizzle/0115_config_deviations.sql`, on the same
	// terms and for the last of the three shapes `paramsSlotWiring.test.ts`
	// tracks: the `generate` node wires `params: slot.params()`, so the stop
	// sequences a person types reach `input?.params?.stopSequences` instead of
	// arriving as `undefined`. Behaviour-preserving, and the declaration is what
	// makes it so — `core:oracle/generate-text@1` gives `stopSequences` no
	// default, so an install that never typed one resolves `undefined` exactly
	// as it always has. All three documents moved for this and nothing else;
	// `registryHashes.test.ts` records nothing, because no DECLARATION changed.
	//
	// And a SEVENTH time, by `drizzle/0118_relationship_search.sql`, on the same
	// terms and for the relationships ruling (2026-09-10, Q1). ⚠ This one is
	// respond's ALONE — the narrator has no speaker, and a graph read needs a
	// speaker's perspective, so the two narrate documents are untouched and
	// their pins below have not moved.
	//
	// What moved: `gather` gains a `relationships` branch pinning the new
	// `core:query/relationship-search@1`, and `loreLinked` concatenates its
	// candidates behind the two lists it already had. It reads the same three
	// graph layers the two existing relationship branches read — one traversal,
	// two projections, so they cannot disagree — and publishes them as
	// candidates in the `relationships` budget band, ordered scene presence →
	// speaker → recency.
	//
	// ⚠ **Byte-identical prompts, and the reason is a default rather than a
	// dead edge.** `rank-hybrid`'s `share.relationships` is 0, which `select`
	// reads as "leave this source out": every candidate the arm produces is
	// excluded with `excluded_group_disabled`, spends nothing, and renders
	// nowhere. What fills in is the RECEIPT — the graph appears in the
	// retrieval explanation with a rank reason per tie, which it never has.
	// `registryHashes.test.ts` records the new type as a NEW entry; no
	// published type declaration moved, so it re-projects nothing.
	//
	// And an EIGHTH time, closing the half of that ruling the seventh left open:
	// the ranked band reached allocation and the receipt and rendered NOWHERE.
	// `context` moves BELOW `rank` — nothing between them ever read it — and its
	// two relationship in-ports each carry `{ band: rank.candidates, graph: <the
	// dump> }`, so the prompt's relationship sections are built from what
	// ranking selected, in rank order, inside the band's share. ⚠ Still
	// byte-identical on a shipped install, and by the same default: with
	// `share.relationships` at 0 nothing is allocated and the `graph` half is
	// what renders, exactly as before. Respond's alone again — the narrator has
	// no speaker and no relationship ports. No declaration moved, so
	// `registryHashes.test.ts` records nothing.
	// (was "1f78a2ce64600", then "1bc665208daf27", then "196d136945332b",
	//  then "1586b6f70f4a1c", then "1799ea677e50b5", then "11ff0e3a9af9c9",
	//  then "40057185a1f3c")
	// ⚠ MOVED a THIRD time without a bump (09-B B4, R-17, 2026-09-15): the
	// reply creates its own row. `placeholder` (`create-message`, `generating:
	// true`, the inlet's `characterId` and the row a verb re-drives) sits
	// straight after the inlet, `save` is an `update-message` targeting it,
	// and `contextBudget` shares `generate`'s connection so the one window
	// computation (R-8) reads the model's own window. `generateResponse`'s
	// trigger-side insert and the preview-halt road are gone with it. Under
	// the 0.6 freeze the semver stays; declarations moved too, so
	// `registryHashes.test.ts` records five.
	// (was "1459d5e20d701a")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "18917086c3f34")
	// Hash moved (R-7 P5, 2026-09-16 — U3b): the lore pool concatenates the
	// conversation's `band` port — `session-history`'s band intent, alone —
	// so the ranker reserves the transcript's slice from the source's own
	// declaration rather than from a map on itself. Same numbers, same
	// prompt; the parity corpus holds it.
	// (was "19cac7b1208d4e")
	// Hash moved (U5a, R-18 (3), 2026-09-16): the turn strategy takes
	// `speaker: $.input.speaker` — the participant reference — beside the
	// bare `characterId`, so an envoy can be the trigger's pick. Every
	// downstream reader still takes `$.speaker.characterId`; nothing the run
	// sends changes. (was "1ace29594a6283")
	// (was "1c503cc437da52") — W9 shape pins, see the note above adventure-ask.
	"core:spec/respond@1.20.0": "c0b92cae6b39d",
	"core:spec/respond@1.19.0": "fdf2f7090f13c",
	"core:spec/respond@1.18.0": "9315ce3ddeaa4",
	"core:spec/respond@1.17.0": "118378cf44739b",
	// Edited in place with respond@1.20.0, and re-projected by migration 0095 —
	// see the note there. ⚠ The hash recorded against this pin is the one
	// above, not this line: 1.11.0 was edited a *second* time, by the narrator
	// split. Kept here as the drift record of what it hashed to between the two
	// edits, the same way a superseded version is kept.
	// (was "540d1e252d8c9")
	"core:spec/respond@1.16.0": "1cf854da57fc1c",
	"core:spec/narrate@1.10.0": "1db2e9e9b859b4",
	"core:spec/respond@1.15.0": "f8768da5723e3",
	"core:spec/narrate@1.9.0": "1f7a1f6da815d7",
	// Pre-24 (the genre rename): superseded, kept for the drift check.
	"core:spec/create-chat@1.0.0": "e176f2e63375",
	// 1.14.0 / 1.8.0: mode references re-keyed to the create spec (23 §7) —
	// taxonomy.mode and narrate's contributed trigger now name
	// core:spec/create-chat instead of the input type.
	"core:spec/respond@1.14.0": "4e7dcba7841ab",
	"core:spec/narrate@1.8.0": "124ccd9f3b3758",
	// 1.13.0 / 1.7.0 / 1.3.0 / 1.2.0: the catalogue claims (23 §2) —
	// `taxonomy` {zone, role, mode} rides every document.
	"core:spec/respond@1.13.0": "f7c71609c1181",
	"core:spec/narrate@1.7.0": "1e8300f1868ebe",
	// ⚠ 1.3.0's four hashes MOVED under an unchanged version, paired with
	// `drizzle/0102_summarize_batch_budget.sql`, which deletes the four
	// `pipeline_spec_versions` rows so boot republishes them. The version freeze
	// (SDK spec versions pinned at 1 until 0.7.0) is why this is an edit in place
	// rather than 1.4.0, and 0095/0100 are the precedent for the pairing.
	//
	// What moved: the batching Task's `sampling` slot is wired as a REFERENCE to
	// the drafting Provider's (`slot.samplingOf("drafting.item.draft")`), so the
	// window the batch is clamped to is by construction the window it is sent
	// against. Shared rather than a picker of its own — a slot wired with
	// `ofNode` is the owner's to configure (13 §12 finding i) — so an untouched
	// pipeline gains no second Sampling control in the panel.
	// Moved (L3, contracts batch 2, 2026-09-17): `params: slot.params()` on
	// the `create-lore-entry` node. That outlet now declares an `entryType`
	// parameters slot, and a slot the spec never NAMES is not a config key
	// — the panel would render the control, the scope chain would store
	// what a person set, and the run would never read it
	// (`paramsSlotWiring.test.ts`). The value is unchanged: the declared
	// default is world lore, which is what this outlet wrote before.
	"core:spec/summarize-world@1.3.0": "1506542abb583c",  // (was 6a5f107fa3641)
	"core:spec/summarize-character@1.3.0": "a8021c35f8e63",  // (was 102b4ae06e92a1)
	// ⚠ `summarize-scene@1.3.0`'s hash MOVED a SECOND time, again under an
	// unchanged version, and again paired with a migration —
	// `drizzle/0104_ice_scene_cast_extraction.sql` deletes its published
	// `pipeline_spec_versions` row so boot republishes it. **A moved hash here
	// with no such migration is still the failure this file is for.**
	//
	// What moved: the `cast` step is gone. `core:oracle/extract-cast` is on
	// ice, not deleted (plan §2, ruled 2026-09-08) — the node type, its script
	// hooks and its shipped prompt all survive untouched, and reviving it is
	// restoring one property in the catalog. The scene summarizer stops making
	// an unmeasured LLM call whose participant half is replaced by a roster +
	// speech-gated proposal (100% precision, zero fabrications, no model) and
	// whose mentioned half is derived from `message_annotations` instead.
	// (was "9c990d835747a" between 0102 and this)
	"core:spec/summarize-scene@1.3.0": "45c69db1aec6e",  // (was 63c1e956ffead)
	"core:spec/summarize-history@1.3.0": "c6076cc61089a",  // (was d31fcf98fd3d6)
	"core:spec/graph-build@1.2.0": "1cb6f0d989e99c",
	// 1.12.0: the session rename (0141) — session-scope/-history/-cast ids
	// and sessionId/sessionScope ports ripple into every pinned type.
	"core:spec/respond@1.12.0": "72df744027f6d",
	// 1.11.0: turn-taking becomes a node (19 §5, U-C4) — the `speaker` task
	// records the trigger's pick, and context + generation take their
	// speaker from its output instead of only from the run scope.
	"core:spec/respond@1.11.0": "8ae7ccbf18fae",
	// 1.6.0: the session rename, as above.
	"core:spec/narrate@1.6.0": "1e7f35cc2ddaaa",
	// 1.5.0: declares `contributes.triggers` — the narrate button on the
	// standard mode is now a fact in the document, not a branch in
	// generateResponse (19 §3–§4, U-C3).
	"core:spec/narrate@1.5.0": "1bfa0898d8db15",
	"core:spec/summarize-world@1.2.0": "11dc51df9014b",
	"core:spec/summarize-character@1.2.0": "460b20537ef94",
	"core:spec/summarize-scene@1.2.0": "42b49662a7449",
	"core:spec/summarize-history@1.2.0": "235d7d8abbef1",
	"core:spec/graph-build@1.1.0": "122aaab2d9ed79",
	// 1.0.0: the echo spec — the minimal action harness that proves the review
	// gate end to end (a button fires it, `create-message` parks, the modal's
	// form IS the entry). Template for the image provider spec.
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "19cc4810162b94")
	"core:spec/echo@1.0.0": "c8727abf46258",
	/**
	 * The built-in writes (U5b, R-15, 2026-09-16) — five NEW slugs, one per
	 * message verb core implements: `core:inlet/built-in-request@1` straight
	 * into the write outlet, bound to no genre. Published like every other
	 * spec so a delete is a receipted, gate-eligible run pinning a hash.
	 */
	"core:spec/builtin-delete@1.0.0": "12f3d9411b2680",
	"core:spec/builtin-hide@1.0.0": "2d89ebfc08d47",
	"core:spec/builtin-edit@1.0.0": "1f50517efb4c61",
	"core:spec/builtin-swipe@1.0.0": "b69ef788e2df7",
	"core:spec/builtin-branch@1.0.0": "be5ac081454e9",
	// 1.0.0: local image generation end to end — a composer button, the review
	// gate as the prompt entry, and the render posted as a message.
	// Hash moved: `render` names its `params` slot, which the node type now
	// declares — without it the streaming control would render and do nothing.
	// Hash moved (R-15, 2026-09-16 — U5c): `contributes.triggers` became
	// `contributes.actions` — each entry now carries `key`, a venue list
	// (`[{ kind: 'composer' }]`), `quick` and `label` in place of `i18n`.
	// Content of the contribution, not of the run: nothing the pipeline
	// sends changes. (was "19338b1db2497c")
	"core:spec/generate-image@1.0.0": "167183f5f621cc",
	// 1.0.0: the tool-loop reference (20 §9, 01 §4a) — a bounded agentic turn
	// written out, bound to no genre so it is never offered in a composer. New
	// slug, not a bump: the 0.6 freeze forbids moving an existing semver and
	// says nothing about publishing a new one.
	// Hash moved: `generate`'s dead `prompts` share now points at `prompt`,
	// which owns the pool, instead of the reverse (2026-09-10).
	// Hash moved: the template's opening instruction and its closing reminder
	// are the `prompts` slot's shipped row now, not literals (2026-09-10).
	// Hash moved (09-B B4, 2026-09-15): the answer's row is the pipeline's —
	// a `placeholder` after the inlet, `save` an `update-message` filling it.
	// (was "1802d01a31438f")
	// Hash moved (U1 review C1, 2026-09-16): the placeholder wires
	// `row: $.input.messageId`, so a genre binding this spec to a reply
	// function has a regenerate claim the verb's row as the reply specs do.
	// (was "1aa8631e70603b")
	// Hash moved (R-12, 2026-09-16): the generating step no longer wires
	// `prompts: slot.prompts({ node: … })` — `core:oracle/generate-*@1`
	// declares no such slot any more; the share existed only to keep the
	// panel from rendering a copy. Nothing the run sends changes.
	// (was "9420cfdf9c246")
	// (was "1d560d3f202dd5") — W9 shape pins, see the note above adventure-ask.
	"core:spec/tool-loop@1.0.0": "58c36603a5520",
	/**
	 * The **Lair** genre (plans/genres-and-showcase-plugins §3, U3) — nine new
	 * slugs, and nothing above them moves. Every node they pin is one core
	 * already shipped; no existing spec or type was edited.
	 *
	 * `lair-respond` is the reverse crawler's turn: plan, then a junction that
	 * either halts at a room nobody built (a `choices` block addressed to the
	 * OWNER) or narrates — and, in `cast` style, gives one voice call per
	 * character the planner named. The write is on the spine for both arms,
	 * because a write-class outlet may not sit inside a clause (01 §4).
	 *
	 * ⚠ **Recorded before the catalog's `dist` carries them.** These pins were
	 * computed from `core-catalog/src` (the SDK suite's `lair.test.ts` records
	 * the same nine), and this file reads the catalog through its **build**. So
	 * until `npm run sdk:build` runs, `current()` does not contain these keys and
	 * the first test skips them by construction (`now[pin] &&`) — they start
	 * being checked the moment the build catches up, which is exactly when a
	 * drift would matter.
	 */
	"core:spec/lair-create@1.0.0": "181409e22c0b57",
	// Moved (W1, 2026-09-17): the same per-voice lore lane Adventure's
	// respond gained, inside the `cast` branch's `each`.
	// (was "7557cc5126f8e")
	"core:spec/lair-respond@1.0.0": "17f42bf5411cc8",
	// Moved twice on 2026-09-17. First (L3, contracts batch 2): `params:
	// slot.params()` on the `create-lore-entry` node. That outlet now declares
	// an `entryType` parameters slot, and a slot the spec never NAMES is not a
	// config key — the panel would render the control, the scope chain would
	// store what a person set, and the run would never read it
	// (`paramsSlotWiring.test.ts`).
	//
	// Then by the Lair finish lane, two preset values on that same node: the
	// review gate is turned ON (the docblock has promised it since the spec was
	// written, and `resolvePosition` defaults an undeclared position to `off`,
	// so a drafted room was landing unseen), and the entry type is
	// `core:entry/location` — a room is a place, not world lore that happens to
	// be laid out. The exits stay prose: `create-lore-entry@1`'s `links` port is
	// unwired because nothing in core parses a drafted `Exits:` line into names.
	// (was 15ceae616882db, then 94ce032b7c0b)
	"core:spec/lair-build-room@1.0.0": "190c73e865eb9f",
	// Moved (L1, 2026-09-17): the knock's options write the room. The one
	// write-class outlet is `core:outlet/create-lore-entry` (was
	// `create-message`), the `build` branch drafts the dungeon's room layout
	// for the master to fill in, and a preset turns the review gate on. The
	// action is now `effects: 'world'` in the `composer` venue — an
	// owner-addressed block may name one.
	// Moved again by the Lair finish lane: the room files as a
	// `core:entry/location`, exactly as *Build room* now files one.
	// (was "912b4d1226a36", then 1c5e452458312a, then 3899346f4eb21)
	"core:spec/lair-room-answer@1.0.0": "11e6395a67d358",
	"core:spec/lair-whisper@1.0.0": "7056f498d2824",
	"core:spec/lair-nudge@1.0.0": "13f22ac089c1d3",
	"core:spec/lair-trap@1.0.0": "bc6188056ee88",
	"core:spec/lair-reveal@1.0.0": "10266438456afd",
	/** The genre's answer pipeline — one graph, published once per shipped genre. */
	"core:spec/answer-form-lair@1.0.0": "15c9296cf3ab70",
	/**
	 * The **Writing Room** (plans/genres-and-showcase-plugins §2, U2) — ten new
	 * slugs, and nothing above them moves. Every node they pin is one core
	 * already shipped; no existing spec or type was edited.
	 *
	 * `writing-room-respond` is the two-channel turn: ONE junction, on the
	 * channel the trigger was raised on (`$.input.channel`). The manuscript arm
	 * is a continuation with no seed line — the channel declares `voice: 'none'`
	 * — and the talk arm is the companion's reply with the manuscript as a
	 * folio in front of it. One row, created on the spine with
	 * `channel: $.input.channel`, finished by whichever arm fired; the write is
	 * on the spine for the same reason Lair's is (01 §4).
	 *
	 * `writing-room-create` is an INLET AND NOTHING ELSE: greeting is off, there
	 * is nothing to seed, and a create pipeline that read the greetings and then
	 * declined to write them would be two nodes agreeing to do nothing.
	 *
	 * ⚠ **Recorded before the catalog's `dist` carries them**, on exactly the
	 * terms the Lair block above states: computed from `core-catalog/src` (the
	 * SDK suite's `writingRoom.test.ts` records the same ten), skipped by
	 * construction until `npm run sdk:build` catches up.
	 */
	"core:spec/writing-room-create@1.0.0": "183229685dbfb",
	"core:spec/writing-room-respond@1.0.0": "14c09e41ae6abd",
	"core:spec/writing-room-continue@1.0.0": "167b0adb63b018",
	"core:spec/writing-room-rewrite@1.0.0": "31f36c88bf487",
	"core:spec/writing-room-expand@1.0.0": "11351d7d9ca9d2",
	"core:spec/writing-room-tighten@1.0.0": "13effa25d3bc60",
	"core:spec/writing-room-brainstorm@1.0.0": "12e837aa3f8312",
	"core:spec/writing-room-critique@1.0.0": "1877959eaff7ae",
	// Moved (L3, contracts batch 2, 2026-09-17): `params: slot.params()` on
	// the `create-lore-entry` node. That outlet now declares an `entryType`
	// parameters slot, and a slot the spec never NAMES is not a config key
	// — the panel would render the control, the scope chain would store
	// what a person set, and the run would never read it
	// (`paramsSlotWiring.test.ts`). The value is unchanged: the declared
	// default is world lore, which is what this outlet wrote before.
	"core:spec/writing-room-add-to-bible@1.0.0": "ee79fc44a3b4e",  // (was 15a7783fad90dc)
	"core:spec/writing-room-export@1.0.0": "bf5b4e0b398c8",
	/**
	 * The genre's answer pipeline, added 2026-09-17 by the `form-addressed`
	 * ruling: **every** shipped genre declares the event and every shipped
	 * preset binds an answer pipeline, whoever its forms are addressed to
	 * today. A genre cannot promise that no pipeline — its own, one a person
	 * attaches, or a plugin's — will ever put a form to a participant the AI
	 * portrays, and an unanswerable form is a stuck session; the scribe is an
	 * envoy the AI portrays. One graph (`answerFormSpec`), published under
	 * this genre's inlet lock, so nothing above it moves.
	 *
	 * ⚠ Recorded before the catalog's `dist` carries it, on the Lair block's
	 * terms: computed from `core-catalog/src` and skipped by construction
	 * until the build catches up. ⚠ `sdk-tests/writingRoom.test.ts` pins its
	 * specs from an explicit list rather than by scanning `CORE_SPECS`, so
	 * this document has no pin on the SDK side — this line is its only guard.
	 */
	"core:spec/answer-form-writing-room@1.0.0": "7a5c89502dd7a",
	/**
	 * The **Whodunit** genre (plans/genres-and-showcase-plugins §4, U4) — seven
	 * new slugs, and nothing above them moves. Every node they pin is one core
	 * already shipped; no existing spec or type was edited.
	 *
	 * `whodunit-respond` is Adventure's four-agent turn, and its character-lore
	 * lane is **inside** the voices `each`, wired to that iteration's own speaker
	 * (W1): a lane on the spine reads once on a scope that names no character, so
	 * every voice would be handed every suspect's private entries, which in this
	 * genre is the answer. `whodunit-verdict` is the one spec that reads
	 * `core:query/lorebook-triggers@1`, the node that returns all three bands at
	 * once: the judge is the only prompt in the genre shown the whole case.
	 *
	 * ⚠ **Recorded before the catalog's `dist` carries them**, on exactly the
	 * terms the Lair block above states: computed from `core-catalog/src` (the
	 * SDK suite's `whodunit.test.ts` records the same seven), skipped by
	 * construction until `npm run sdk:build` catches up.
	 */
	// Moved twice on 2026-09-17, both recomputed from `core-catalog/src` the way
	// this block's note says; `sdk-tests/whodunit.test.ts` records the same
	// values.
	//
	// First by the genre's `difficulty` → `candour` rename (R1: Adventure owns
	// `difficulty` over `story | normal | hard`). A create document carries the
	// genre declaration itself — `spec({ genre: { shape … } })` — so the
	// field's key, label, enum and default are inside it.
	//
	// Then by D-4a (`core:task/pick-by-hash@1` + `core:task/cast-choices@1`):
	// the create run reads the cast and **derives the culprit**, three nodes
	// that publish to nothing — the derivation is the record, and the one
	// per-session store a spec can reach is the ledger two widgets render.
	// (was "1e3ab7a4c2af5e", then "19d5dd6ff887f0")
	"core:spec/whodunit-create@1.0.0": "1117893aafdd92",
	// Moved (W1, 2026-09-17): the same per-voice lore lane, pool and rank
	// Adventure's and Lair's respond specs gained — a suspect reads their own
	// private entries, and only their own. (was "112b003db90fdb")
	"core:spec/whodunit-respond@1.0.0": "1631751a942d1a",
	// D-4a: the picker's `contextBudget → context → lines → prompt → write`
	// chain — a whole `generate-json` call whose job was to read the cast back
	// out as `{ key, label }` — is one `cast-choices` task, and the history lane
	// that fed it went with it. The options are keyed by participant reference
	// now, not by a name a model spelled. (was "80dd0b85bd53c")
	"core:spec/whodunit-question@1.0.0": "5832beca7487a",
	/** What the question's options fire — in no listing; see `whodunitActions.ts`. */
	"core:spec/whodunit-answer@1.0.0": "1fdc133dbc3a7b",
	"core:spec/whodunit-search@1.0.0": "10b9daa275052b",
	// The same removal as `whodunit-question`. (was "1041c44a77e79")
	"core:spec/whodunit-accuse@1.0.0": "15fb4fa0bbffdd",
	/**
	 * What the accusation's options fire — in no listing, and the one spec shown
	 * the whole case.
	 *
	 * Moved 2026-09-17 by the verdict compare, on `core:task/pair@1`: the spec
	 * re-derives the culprit with the create run's own two nodes
	 * (`cast-choices` → `pick-by-hash`, same list, same scope), pairs it with the
	 * accusation, and a junction decides — `{ path: 'accused', equalsPath:
	 * 'culprit' }`. The `accused` node, wired to nothing since D-4a, is the first
	 * half of that pair. The fold writes `core:slot/case@1`, so the outcome of
	 * the game is the graph's and never a model's, and the judge became the
	 * ending's planner: told the verdict and the culprit through its context's
	 * `fields`, and answering with beats alone. (was "8be81c0e7bbf5")
	 */
	"core:spec/whodunit-verdict@1.0.0": "b92b02c30a527",
	/**
	 * Whodunit's answer pipeline, added by the same ruling and the same one
	 * graph — and this is the genre with the clearest use for it: a narrator
	 * putting a yes/no to a **suspect** is a form addressed to somebody the AI
	 * portrays, and every suspect here is. Nothing reaches it today (every
	 * form the genre ships is the detective's), which is why it is a promise
	 * rather than a path. Inert until the build, as above;
	 * `sdk-tests/whodunit.test.ts` records the same value.
	 */
	"core:spec/answer-form-whodunit@1.0.0": "93c213ce4323"
}

describe("published spec hashes", () => {
	const current = () => {
		const out: Record<string, string> = {}
		for (const entry of CORE_SPECS) {
			const doc = entry.build()
			out[`${doc.id}@${doc.version}`] = canonicalHash(doc)
		}
		return out
	}

	it("resolves every recorded pin to the hash recorded for it", () => {
		const now = current()
		const drifted = Object.entries(PUBLISHED)
			.filter(([pin, hash]) => now[pin] && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(
			drifted,
			drifted.length
				? "This pin now names a different document. That is shippable — " +
						"the edited document publishes as a new version row and the " +
						"slug's pointer moves to it, with no migration — but it must " +
						"be deliberate: bump the spec's *_VERSION and add the new " +
						"pin, or record the new hash against the existing one in the " +
						"same commit as the edit."
				: undefined
		).toEqual([])
	})

	it("records every spec this build publishes", () => {
		const missing = Object.keys(current()).filter((pin) => !PUBLISHED[pin])
		expect(
			missing,
			missing.length
				? `New or bumped spec version(s). Add the pin and hash below:\n` +
						missing
							.map((pin) => `\t"${pin}": "${current()[pin]}",`)
							.join("\n")
				: undefined
		).toEqual([])
	})
})
