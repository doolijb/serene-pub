/**
 * What each shipped slug resolves to, as a checked-in fact.
 *
 * A type slug is an indirection to a content hash (ruling 2026-09-10): the
 * registry row for `id@version` carries whichever declaration the slug resolves
 * to now, `pipeline_definition_declarations` keeps every one it has ever resolved to,
 * and a boot that finds a changed declaration publishes it and moves the
 * pointer. So an edited descriptor no longer stops anything — which removes the
 * *disaster* this file was written for and leaves the *question* it exists to
 * ask.
 *
 * The question is: **did you mean to change what that pin means?** A hash moving
 * is a normal, shippable event; a hash moving without anyone noticing is not.
 * Nothing else in the suite can tell the difference, because a fresh test
 * database publishes whatever the code currently says and passes either way.
 *
 * So this stays a snapshot, and updating a line stays deliberate — what changed
 * is the cost of the answer. Where the three answers used to be *bump the
 * version*, *it was only display text*, or *write a re-projection migration*,
 * the third is gone: an edit is carried to every install by the pointer move
 * alone. Update the line in the same commit as the edit, and the diff shows a
 * declaration and its hash changing together.
 *
 * ⚠ **A version bump is still the honest answer to a breaking change.** Content
 * addressing removed the boot failure, not the judgement: moving a port under
 * `@1` still changes what every spec pinning `@1` does, and this file is where
 * that becomes visible enough to argue about.
 *
 * That a slug's row actually *carries* the recorded hash after a boot — the
 * database half of the same fact — is asserted by
 * `contentAddressing.int.test.ts`, which is where a database is available.
 */

import { describe, it, expect } from "vitest"
import {
	allDefinitions,
	allScriptKinds,
	snapshotRegistry,
	definitionContractHash,
	DESCRIPTOR_DISPLAY_KEYS,
	DESCRIPTOR_POLICY_KEYS,
	getDefinition,
	type Descriptor
} from "@serene-pub/sdk"
import { definitionContentHash } from "$lib/server/pipelines/boot/registrySync"
// Importing the contracts is what registers them — the same fact-about-the-code
// route `bootstrapPipelines` takes, rather than a list maintained beside it.
//
// Note that `@serene-pub/contracts` resolves to its **`dist`**, not its source
// (its package `exports` say so). That is deliberate — this guards what actually
// ships and what the running app loads — but it means editing a descriptor in
// `serene-pub-sdk/contracts/src` changes nothing here until that package is
// rebuilt. If you edited a descriptor and this test did not react, you have not
// run `npm run build` in the contracts package yet, and neither has the app.
import "@serene-pub/contracts"
// And the catalog, for the same reason: core's **entry** types are declared
// there beside the genres and pipelines, and declaring one registers it. Boot
// loads the catalog through `specs/respond`, so a guard that walked only the
// contracts would leave three published types unfrozen — which is the one thing
// this file exists to prevent.
import "@serene-pub/core-catalog"

/**
 * `pin -> contentHash`, for every slug this build publishes.
 *
 * **Do not update a line here to make a test pass.** A changed hash means the
 * declaration behind an already-published pin moved, and there are three correct
 * responses:
 *
 * 1. **Bump the version.** Publish `@2` and leave `@1` in place for the specs
 *    pinning it. This is the answer whenever the change would break them — a
 *    removed port, a narrowed range, an enum option withdrawn. Content
 *    addressing does not make this optional; it makes it a judgement rather than
 *    a boot failure.
 * 2. **You changed only display text.** Labels (`i18n`, `label`) and
 *    `description` are stripped before hashing precisely so they can change
 *    freely. If the hash moved, you changed something else too — find it.
 * 3. **The edit is a correction, and the pointer carries it.** A declared port
 *    that was always supplied, a widened range, a default that was wrong: the
 *    next boot publishes the new declaration, moves the slug's pointer to it,
 *    and keeps the old one under its hash. Record the new hash here in the same
 *    commit as the edit, and say in a comment what moved and why it does not
 *    break the pins.
 *
 * ⚠ **Answer 3 needs no migration.** The next boot re-projects a moved
 * declaration on its own. Every migration number in the comments below names
 * a file of the pre-release chain squashed on 2026-10-01 (archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0221-v2.tar.gz`), never
 * today's file of the same number — those notes record why a hash moved, not
 * a step to repeat.
 *
 * Adding a *new* type is safe and needs nothing — just add its line.
 *
 * ## Migration 0176 — answer 3 as it used to be written, fourteen entries at once
 *
 * Every type with a `connection` slot gained `requires`: the capability ids that
 * connection must satisfy, e.g. `['text->image']` on `generate-image`. Scattered
 * through this table rather than grouped, so they are noted here instead: the
 * providers for text, image, embeddings, speech, the four graph nodes, the two
 * summarizers, name-entry, extract-cast, and the comfy plugin example.
 *
 * `shape` did not move — it still types the SLOT. `requires` is a separate fact
 * about the CONNECTION bound to it, and it exists because filtering on the
 * connection's `modality` scalar refused KoboldCPP an image node for being
 * "a text connection" while it was drawing pictures from the same process.
 *
 * The two MCP nodes are deliberately absent: no transform id is true of a tool
 * server, so they keep filtering by `shape` alone and their hashes did not move.
 */
/**
 * ## The one-shot rename (2026-09-16; plans/30 §U3, migration 0134) — answer 3, thirty-two entries at once
 *
 * `kind` is in the hashed material, so every inlet, oracle and outlet moved
 * when `input · provider · consumer` became `inlet · oracle · outlet` (R-13):
 * the four inlets, the eighteen oracles, the nine outlets and the comfy example.
 * `create-message@1` and `seed-greetings@1` also gained the `channel` in-port
 * the host was already reading (U2 residual). Query and task definitions did
 * not move — nothing in their material changed. The ids themselves moved too
 * (`core:input/…` → `core:inlet/…`), which is why the KEYS below read
 * differently from the previous commit; migration 0134 renamed the registry
 * rows and recorded the old slug in `renamed_from`. `core:input/message-created@1`
 * is gone: culled (R-4), no spec used it and nothing emitted it.
 */
/**
 * ## U6 (plans/29 R-2, 2026-09-17) — ten culled, two bound, three flagged
 *
 * Fifteen published definitions had no handler. Ten are gone from this table
 * — `lorebook-probabilistic`, `message-text`, `persona-card`, `chunk-text`,
 * `first-json`, `rank-by-recency`, `render-entries`, `to-candidates`,
 * `emit-socket`, `save-plugin-data` — no shipped spec placed one, and the
 * registry rows an install holds are marked `removed` by the boot's
 * reverse-diff, never deleted. Two moved by gaining the `target` in-port the
 * host's commit reads (answer 3) and are bound: `attach-image`, `attach-audio`.
 * Three were flagged `provisional: true`: `speak` (plans/14), `mcp-tool` and
 * `mcp-resource` (plans/28) — a policy flag since V6 below, so binding one
 * moves nothing here.
 */
/**
 * ## V6 (plans/31, 2026-09-17) — the contract hash; every pin moved once
 *
 * A definition's content hash covers its **contract** — what a pinned spec
 * runs against: `id · version · kind · ports · slots · effects · review.fields
 * · shape · optional · declaresRandomness · scriptPoints · sessionShape ·
 * earlyExit · causesEvent · liveRow · media · entryShape` — and nothing else.
 * `provisional`, `reviewDefault`, `timeoutMs`, `timeoutKind`, `toggleable`,
 * `public`, `usage` and every piece of display text are **policy**: stored on
 * the registry row, never hashed, refreshed in place. The material is the
 * SDK's `definitionContract`, which this file's `definitionContentHash` now
 * is; the last test below holds the two to one string per definition.
 *
 * Every line in this table moved on the same day, for the same reason: the
 * slug's own `id` and `version` are contract and were never in the material
 * before, and `review.fields`, `shape`, `earlyExit`, `liveRow`,
 * `declaresRandomness` and `media` are contract and were hashed by the SDK
 * only. Answer 3, one hundred and twelve times — the pointer carries each; no
 * spec's document moves, because no declaration changed. Two consequences
 * worth reading off the table: two definitions never share a hash any more
 * (the four turn strategies, `merge-` and `concat-candidates`, the two
 * candidates script kinds and the three `test:` twins each read one value
 * where they read one shared value), and the three provisional definitions
 * will NOT move again the day they are bound.
 */
const PUBLISHED_HASHES: Record<string, string> = {
	"chariot.comfy:render-image@1": "1c1c3bef639b8",
	"chariot.dice-tray:roll@1": "7d840117afff3",
	"chariot.recall:rank-recall@1": "d2ab2a077c87c",
	// Moved (U6, R-2, 2026-09-17): a `target` in-port — the row the part lands
	// on, the port `update-message` takes — and bound. The host's commit read
	// `p.target?.id` already; the declaration now says so. (was "c499561b77704")
	"core:outlet/attach-audio@1": "1f92305dec26b9",
	// Same day, same port, same reason. (was "1427daa9dd3b33")
	"core:outlet/attach-image@1": "1a83777d127f38",
	// Moved (L2/L3, contracts batch 2, 2026-09-17) — answer 3, and nothing
	// pinning it moves: an `entryType` **param** (which kind of entry this
	// pipeline writes, refused at the commit when it names no declared type,
	// world lore when absent, which is what the code did unconditionally
	// before) and a `links` **in-port** (the links written in the SAME
	// transaction as the row). `links` is here rather than only on the link
	// outlet so an entry and its links commit together, or not at all. No shipped spec
	// wires either, so no document moves. (was "c745cab165e22")
	"core:outlet/create-lore-entry@1": "15401f006df68c",
	// NEW (L2, 2026-09-17): one link between two entries of the session's
	// lorebook — an entry-ended `narrative_relationships` row, the same edge
	// the lorebook's own graph draws, which no pipeline could write. `to`
	// takes a NAME as well as an id so a second run can link what a first
	// created; `effects: 'write'`, review on the link itself (`linkType`,
	// `label`) and never on its ends, `causesEvent: lore-link-created`.
	// Moved 2026-09-29 (places plan B2): the relationship's whole descriptor —
	// in-ports `name` (new) and `description` (was `label`, renamed with no
	// alias), param `reverseLinkType` (new, default '' = one way), review fields
	// `linkType`, `reverseLinkType`, `name`, `description`. The commit became
	// idempotent (host-side, not hashed). Proven: the snapshot entry with only
	// those undone (ports `from`/`to`/`label`, no `reverseLinkType`, the old
	// review fields) hashes back to the old pin. (was "685d35ac8c432")
	"core:outlet/link-lore-entries@1": "1f418ee9febeaa",
	// Re-projected by 0174: a `media` in-port, so an image can be posted AS a new
	// message. `attach-image` could not do it — a message created inside a run is
	// not a valid target for a later node — which left no path at all from a
	// render to a posted image.
	// Moved (09-B B4, R-17, 2026-09-15): the pipeline owns its row. Six new
	// in-ports — `characterId`, `speaker`, `generating`, `narration`,
	// `instructions`, `row` — make this the reply's placeholder outlet;
	// `liveRow: true` names its row as where an oracle's stream lands, and
	// `reviewDefault: 'off'` puts the gate on the update (R-21 (3)).
	// (was "14a3a9a68ea88d")
	// Moved (U5a, R-18 (3), 2026-09-16): the side-character fact's in-port is
	// `sideCharacter` (was `speaker`) — that word is the participant
	// reference now, one meaning. The stored key `metadata.speaker` is
	// unchanged. (was "2d8c3cc53d940")
	// Moved (U5g, R-18 (3), 2026-09-16): a `speaker` in-port — the
	// participant reference, `character:<id>` | `envoy:<slug>` — stored as
	// `metadata.speaker`; the side-character fact moves to
	// `metadata.sideCharacter` (migration 0138). An envoy's row has no
	// `characterId`, so this is its only identity. (was "118098d1e63e40")
	// Moved (U5d, R-15 *Forms*, 2026-09-17): a `blocks` in-port — a
	// MessageBlock list posted with the row, validated, stamped with the
	// writing spec's action identity and a block id, stored as a
	// `core:blocks` part; a form among them addressed to the AI is recorded
	// as `form-addressed`. `review.fields: ['text']` declared too — contract
	// since V6. (was "198a9cc1f85286")
	// Moved (lair pass B4, D5, 2026-09-27): a `sections` in-port
	// (`folded-sections@1`) — the reply's folded sections, stored per swipe
	// and projected as `core:section` parts. (was "10759d42019944")
	// Moved 2026-09-30 (Lair character turns, owner ruling): a `turnPlan`
	// in-port — the planner's document whose speakers take character turns,
	// resolved and stored as `metadata.turnPlan`. Additive. Proven: the
	// contracts source with only this lane's ports reverted hashes back to
	// the old pin. (was "1a521707874871")
	"core:outlet/create-message@1": "648433d37fbc8",
	"core:outlet/graph-proposal@1": "68c1f10a8eb0c",
	// Moved (09-B B4, 2026-09-15): a `thinking` in-port, so the reply's
	// reasoning trace lands on the row it fills; the `target` port now takes
	// the placeholder's write result (`write-result@1` is assignable to
	// `row-ids@1` since the same ruling).
	// (was "f912a25836fda")
	// Moved (U5d, 2026-09-17): a `blocks` in-port, appended after the text
	// lands — see `create-message`. (was "1df0cd729ce38f")
	// Moved (lair pass B4, 2026-09-27): a `sections` in-port — see
	// `create-message`. (was "1f7eec771e6f80")
	// Moved 2026-10-03 (owner note 39): the `thinking` in-port is `reasoning`
	// — one concept, one name (NOMENCLATURE §23). (was "3359a3cadb39")
	"core:outlet/update-message@1": "fda61fb31de76",
	"core:inlet/summarize-request@1": "1ffc99d5933e6c",
	// Gained the `greeting` field on its sessionShape (20, migration 0151) —
	// the default greeting-on-creation behaviour stated, not changed.
	//
	// Re-projected by **0106** (policy answer 3): a `continuationPrefill`
	// out-port, so a caller can supply the text a **continue** is continuing
	// (ruling 2026-09-08, D-2). Additive — `echo`, `generate-image`,
	// `graph-build` and `narrate` share this input type and wire nothing to the
	// new port, so a port nothing wires is never resolved and none of their
	// documents move. Only `respond` reads it.
	//
	// Moved (09-B B4, R-17, 2026-09-15): a `messageId` out-port — the row a
	// regenerate, swipe or continue re-drives, for the placeholder outlet to
	// claim instead of inserting. Additive on the same terms as the port
	// above: only the reply specs wire it.
	// (was "1a8550b1c61c38")
	// Moved (U5a, R-18 (3), 2026-09-16): a `speaker` out-port carrying a
	// participant reference — `character:<id>` or `envoy:<slug>` — beside
	// the now-deprecated bare `characterId`. Additive: only `respond` wires
	// it (into its turn strategy). (was "16a8548c6bdd16")
	// Moved (U5b, R-15, 2026-09-16): a `changes` out-port — what the
	// built-ins did to the session since the last reply, published by
	// `runTurn` and consumed by the run that receives it. Additive: no spec
	// wires it yet, so no document moves. (was "5d3b5ec58fca9")
	// Moved (U5b review S4, 2026-09-16): that port renamed `sessionChanges`
	// — `changes` is the state ledger's word on `resolve-state-changes@1`
	// and `set-state@1` (R1). Still unwired by any spec, so no document
	// moves. (was "b5adca2b8e1c2")
	// Moved (U5d, R-15 *Forms*, 2026-09-17): two out-ports — `payload`, what
	// an action's fire sent (the host always supplied it, undeclared), and
	// `form`, the block facts a press on a form carries, read off the row.
	// (was "2099748049ba8")
	// Moved (R-C, 2026-09-17): a `channel` out-port — which channel the
	// message that triggered this turn is on, so a genre can branch on it at
	// a junction and so the seed line can be the one that channel's declared
	// `voice` calls for. Additive on the same terms as `messageId` and
	// `speaker` above: no shipped spec wires it, so no document moves, and
	// the port it does not have is the reason `voice: 'narrator'` shipped
	// unwired. (was "1bc7a6568eb294")
	// Moved (G9, contracts batch 2, 2026-09-17): a `presser` out-port — the
	// reference of whoever sent the message or fired the action this run
	// answers. `user:<id>`, or `character:<id>` where they hold a persona in
	// the session, or the participant an answer pipeline pressed for. NOT
	// `speaker`, which is whose turn it is: on nearly every turn a person
	// types and a character answers, and the host's path for writing a line AS
	// the presser (`create-message@1`'s `speaker: 'user:<id>'`) existed with
	// no port carrying the reference to put in it. Additive on the same terms
	// as `channel` above: no shipped spec wires it, so no document moves.
	// (was "1a907ed16d5413")
	// Moved 2026-09-28 (lair re-plan R3, `collects`): an additive `recipients`
	// out-port (`core:shape/participant-refs@1`) — the cast members a press
	// collected, validated by the host. No shipped spec wires it yet (R10 will),
	// so no document moves for it. Proven: the snapshot entry with `recipients`
	// deleted from its ports hashes back to the old pin. (was "5da048e50625c")
	// Moved 2026-09-28 (lair re-plan R8): an additive `via` out-port — how
	// the fired turn was reached (`narrate` on the `core#narrate` press); the
	// Lair routes Narrate on it ahead of the channel. Proven: the snapshot entry with that port deleted hashes back to the old pin. (was "ed6b0ebef63cb")
	"core:inlet/user-message@1": "11b79532336221",
	/**
	 * Forms (U5d, R-15 *Forms*, 2026-09-17). NEW types — a line each: the
	 * inlet `core:event/form-addressed@1` lands on; the task that turns the
	 * form into a prompt context and a JSON Schema; the task that turns an
	 * oracle's `{ question, options, addressee }` into a `choices` block; the
	 * task that takes a press apart for the action it fires; and the outlet
	 * that commits an oracle's answer exactly as a click would (`effects:
	 * 'write'`, `reviewDefault: 'off'`, `review.fields: ['answer']`,
	 * `causesEvent: form-answered`).
	 */
	"core:inlet/form-addressed@1": "eaa49f3684cc2",
	"core:task/form-context@1": "1d7e674904cdd6",
	// Both moved 2026-09-27 (lair pass B12): an additive `referent` port —
	// in on make-choices (stamped on the block), out on read-answer (read
	// back on the press's run). Only that port moved them.
	// (was "3e585eb0287f8" and "16006e4fcd8b3")
	// Both moved 2026-09-30 (plan A27 P5, the "fall back" default): an additive
	// `vantage` port (`json@1`) beside `referent` — in on make-choices, out on
	// read-answer — where a question was asked from. Proven: the registry
	// snapshot of each with only that port deleted hashes back to the old pin.
	// (was "180abbaabc628f" and "172eb29516e05d")
	"core:task/make-choices@1": "b5554f939e8d",
	"core:task/read-answer@1": "7cd6634557a9a",
	// NEW (contracts batch 2, 2026-09-17): two values side by side in one
	// document, under names the spec chose, so a junction's `equalsPath` has
	// two paths to compare — a junction branches on ONE port, and until this
	// nothing in core merged two. ⚠ An absent side is OMITTED and never
	// written as null: `predicateHolds` answers false when either side is
	// `undefined`, but `null === null`, so nulls would fire a verdict on a
	// turn where nobody decided anything.
	"core:task/pair@1": "1a78c74711949b",
	// (was "118beb40f685e4") — a write's timeout (5 s, was 600 s) and two out-ports, `firedAction` · `firedRunId` — the commit collects the fire, the host dispatches it (U5d review, W2).
	"core:outlet/answer-form@1": "19c67e930a44d2",
	/**
	 * The built-in writes (U5b, R-15, 2026-09-16). NEW types — a line each:
	 * the request inlet every `core:spec/builtin-*` starts with, and the
	 * five write outlets, each `effects: 'write'` with `reviewDefault: 'off'`
	 * and a `causesEvent` naming its `core:event/message-*` / `session-branched`.
	 */
	// +`sprite` port 2026-09-24 (DESIGN-sprites §6): a person's pick for
	// `core:spec/show-sprite`. Additive; re-recorded pre-release, not bumped.
	"core:inlet/built-in-request@1": "1cc4d1e1258b67",
	"core:outlet/delete-message@1": "1df20df447956b",
	"core:outlet/hide-message@1": "75981562f5865",
	"core:outlet/edit-message@1": "1f8b8b73d43d57",
	"core:outlet/swipe-message@1": "9f6bbbdd40316",
	"core:outlet/branch-session@1": "aedd725871d9d",
	// Sprites (DESIGN-sprites §5, 2026-09-24; in-pipeline 2026-10-05). The
	// sprite picker is ONE oracle now (owner: "not a wrapper", "the explicit
	// text or string passed in") — a NEW type, no migration, just a line: in
	// `text` · `speaker` · `scope` · `set`, params `enabled` · `margin` ·
	// `floor`, no connection slot. It REPLACES `core:query/sprites-for@1`
	// (was "1582ff1430d4c0", which re-read the line from its message id and
	// embedded inside the host) and `core:task/pick-sprite-similarity@1` (was
	// "1ded5f377e9a30"), both removed with no alias (no back-compat before
	// distribution; the five reply specs pinning them were repinned in the
	// same change, and a session's stored settings move with the node key —
	// `boot/spritePickerMove.ts`).
	"core:oracle/pick-sprite@1": "1624d1aaa2f77",
	// Moved 2026-10-05 (plan D1): +`source` in-port, a literal the spec writes
	// (`picker` on the reply specs, `person` in `core:spec/show-sprite`) —
	// the host decided it from the running spec's id until then. Same `@1`,
	// re-recorded pre-release. (was "1aed02b2dfc4c0")
	"core:outlet/show-sprite@1": "1c703cdec6bb9",
	// The session's story clock (DESIGN-story-time P3, 2026-09-28). A NEW type
	// — no migration, just a line: moves the SESSION's clock through its
	// book's calendar, never the book's present.
	// Moved (enum member labels, 2026-09-29): `unit` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "b6e8585367d9")
	// Moved 2026-10-02 (lorebooks Wave 8): declares `causesEvent:
	// core:event/session-updated@1` (R33): the outlet now emits `session-updated` `{
	// changed: ['storyClock'] }`, so the event is no longer a declared root
	// (lorebooks Wave 7 close-out). Edited in place; no migration (the slug's
	// pointer moves at boot). (was "ddc156d7a0cec")
	"core:outlet/advance-story-clock@1": "cdff1f3a47f7c",
	"core:inlet/session-created@1": "1bac3a1f2d1149",
	// The side-character turn (ruling 2026-09-07). A NEW type — no migration,
	// just a line: it inserts a row and conflicts with nothing.
	//
	// Its own type rather than a flag on `user-message@1`, because that type
	// carries the standard chat's `sessionShape` and therefore *is* the chat
	// mode; a per-turn action must not restate a session's shape. It also
	// carries a `speaker` port the chat input has no room for, and the
	// new-name fact as declared `extras` on its scripts hook — which is what
	// lets a script read "the lorebook has never heard of this name" through
	// the one dispatch core scripts and extension hooks already share.
	//
	// Moved (U1 review C1, 2026-09-16): a `messageId` out-port, on the same
	// terms as `user-message@1`'s — a verb on a side character's line routes
	// back to `narrate-character`, whose placeholder claims the verb's row
	// through it instead of inserting a second one. Additive: only that spec
	// wires it.
	// (was "aae12bf9be9a8")
	// Moved (U5a, R-18 (3), 2026-09-16): `speaker` is the participant
	// reference — `character:<id>`, null for a free-form name — and the
	// whole fact `{ name, characterId, known, character }` moved to
	// `sideCharacter`, because a fact carrying a typed name is not a
	// reference to anybody. `narrate-character` follows the rename.
	// (was "4a78161fc4b7")
	// Moved (U5b, R-15, 2026-09-16): the `changes` out-port, on the same
	// terms as `user-message@1`'s. (was "1f362f9aad444")
	// Moved (U5b review S4, 2026-09-16): `changes` → `sessionChanges`, on the
	// same terms as `user-message@1`'s. (was "4078fdc5d681e")
	"core:inlet/side-character-turn@1": "16953b445ab691",
	"core:query/session-greetings@1": "b9be953c1501",
	// New 2026-09-28 (lair re-plan R6): a seated envoy's declared greeting,
	// interpolated — the create spec's read beside the cards' greetings.
	"core:query/envoy-greeting@1": "f3c56408ed918",
	"core:outlet/seed-greetings@1": "1afd90048e87d2",
	// Re-projected by **0201** (policy answer 3): the node is `optional`, which
	// in the executor turns an error into an empty `ok` with `recoveredAsEmpty`
	// on the receipt. It is wired into a shipped spec for the first time in
	// respond 1.19.0, and most installs have no embedding model — the host
	// answers that by throwing, which is the right answer to a caller and the
	// wrong thing to let end somebody's turn. The plan's second governing rule
	// is an absolute (*an unavailable mechanism subtracts a signal; it never
	// disables a path*), so the guarantee is structural here rather than a
	// `try` in one binding. It also earns the node its "Use this source"
	// switch, which is the zero-cost way to turn the semantic mechanism off.
	// Moved (R-7 P2 refined, 2026-09-16 — U3b): `enabled` is marked `shared`,
	// so the loser embed node's `slot.params({ node })` still resolves it at
	// the owner under the field-level rule. Same value, same default.
	// (was "335574a52f09f")
	// Moved (enum member labels, 2026-09-29): `enabled` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "145a24d51e143c")
	// Moved 2026-10-05 (owner ruling D-c, "remove `embed-text`'s inert
	// connection control"): the `connection` slot is deleted — it was declared
	// and never read, held at the star, ten inert controls on the retrieval
	// arms. A narrowed declaration under the pre-release freeze: every spec
	// pinning it was repinned in the same change. (was "1d244c261dfbb8")
	"core:oracle/embed-text@1": "39efca38c5da4",
	// Gained its two script hooks in 0.6-preview (migration 0146): `scripts`
	// before over `content`, `castScripts` after over `cast` — the paste-rung
	// half of replaceable cast extraction (ruling of 2026-08-26). Replacing
	// the extractor itself stays a node rebind, never a script.
	// Moved (R-12, 2026-09-16): the `messages` in-port is culled — `summarize` wired
	// the transcript into it and the handler never read it; the extractor
	// works from `content`. No shipped spec runs this node (the extraction is
	// on ice), so no document moves with it. (was "972921f6b6931")
	"core:oracle/extract-cast@1": "7831ea64c5b34",
	// Gained `currentCharacterId` in 0.6-preview (migration 0134): the §27l
	// stop-string exclusion follows the next-speaker node's output through
	// the host's payload-wins seam (19 §5).
	// Re-projected by 0170 (policy answer 3): the type gained a multimodal
	// contract — an `attachments` in-port, a `parts` out-port, and a declared
	// `media` capability — before any release shipped it.
	// Gained `params.streaming` (`auto | off`): a per-node say in whether the
	// request is sent as a stream, beside `stopSequences`. Additive with a
	// declared default, so a config that has never held the address resolves
	// `auto` and every existing pipeline sends what it sent.
	// Moved (09-B B4, 2026-09-15): a `thinking` out-port, declared now that
	// `update-message` takes it — the binding has published it since it first
	// stripped a trace.
	// (was "867d5d06400c5")
	// Moved (R-12, 2026-09-16): the `prompts` slot (`system`, `postHistory`) is culled.
	// No handler read it — the instructions travel inside `context`, through
	// `assemble@2`'s own `prompts` slot — and every spec wired it as
	// `slot.prompts({ node: 'context' })` only so the panel would not render
	// a second copy. Behaviour-preserving: nothing consumed the value on any
	// run. The same slot leaves `generate-with-tools@1` and `generate-json@1`.
	// (was "1a083045eaf4b")
	// Moved (enum member labels, 2026-09-29): `streaming` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1b38509034c053")
	// Moved 2026-10-03 (owner note 39): the `thinking` out-port is `reasoning`
	// — one concept, one name (NOMENCLATURE §23). (was "1ae8e1f7b8300e")
	"core:oracle/generate-text@1": "160d9dc57f992a",
	"core:oracle/graph-node-description@1": "338643a12d7a",
	"core:oracle/graph-node-resolution@1": "144ed35a261c23",
	"core:oracle/graph-perspective@1": "1507fd50fbe616",
	"core:oracle/graph-pre-filter@1": "1850789a82c4f9",
	"core:oracle/graph-state-detection@1": "bf3ae8fbd53f5",
	// Re-pinned when 14 was built out (the draft stub's hash never reached an
	// install — 0141's core wipe re-projects every row at boot).
	// `provisional: true` (U6, R-2, 2026-09-17): declared, not bound, plans/28
	// owns the handler. Policy since V6 — binding it moves nothing here.
	"core:oracle/mcp-tool@1": "1e44b38506a00b",
	// Same flag, same plan.
	"core:oracle/mcp-resource@1": "ef231626303e9",
	// Re-projected by **0113** (policy answer 3), with the two summarize steps
	// below: a `loreType` in-port (D-I). `summarizeSpec` writes it as a literal
	// into the node's config, in the same map as `content` and `batch`, and
	// `resolveInput` passes a non-ref config value through untouched — so the
	// binding reads `input.loreType` exactly the way it reads a port, and a
	// port is what it is. Declared rather than made a parameter, which would
	// have put "which kind of entry this pipeline writes" in the panel as
	// something a user could tune their scene summarizer into a world one with.
	"core:oracle/name-entry@1": "721f6c62e54a1",
	// `provisional: true` (U6, R-2, 2026-09-17): declared, not bound, plans/14
	// owns the handler. Policy since V6 — binding it moves nothing here.
	"core:oracle/speak@1": "15b834f7e24c86",
	// Re-projected by **0113** — `loreType`, on the same terms as `name-entry`
	// above.
	// Moved (R-11, 2026-09-16 — U4): its `each-draft` interior point declares
	// `accepts: ['core:script:text/transform@1']` — the one kind the broker
	// used to hardcode for every point, now the point's own declaration and,
	// like a port hook's `accepts`, part of the hashed contract. The same
	// change stripped the point's display text from the hash (the comment
	// promised it; the code did not), so `i18n` → `label` on the point moves
	// nothing further. Behaviour-preserving: the applier is offered the list
	// it was always offered. The only definition with a point, so the only
	// pin that moves.
	//
	// ⚠ **Not moved by R-9**, deliberately: every optional or gated definition
	// gained a projected `settings` slot on its registry row the same day, and
	// none of their pins moved — `definitionContentMaterial` hashes
	// `authoredSlots()` only. See `registrySync.ts` for why.
	// (was "1f87aae843e9b8")
	"core:oracle/summarize-batch@1": "104ff874953d6b",
	"core:oracle/summarize-synth@1": "3f410f2816392",
	"core:query/session-cast@1": "ab1fe8baf6775",
	/**
	 * The settings document re-read (PLAN-turn-order §4.12, way 2; A3,
	 * 2026-09-22). The six session inlets, `session-cast@1` (`envoys` port)
	 * and every node with a `scripts` slot (`'session'` extra) moved in the
	 * same change — see PLAN-STATUS-turn-order.md A3.
	 */
	"core:query/session-settings@1": "31eb6de4a89d7",
	// Re-projected by 0186 (policy answer 3), together with `history-entries`
	// below — one hash, because the three lore gather branches share a slot declaration
	// and the content hash strips display text. `scanDepth`'s declared default
	// moved 3 → 10 to match `DEFAULT_RETRIEVAL.scanDepth`, the number every
	// scan has actually run on: the gather branches shipped without a wired `params`
	// slot, so the declaration was never handed to anything and the two could
	// not be seen to disagree. Wiring the slot is what makes the number live,
	// which is why the correction and the wiring land together.
	//
	// Re-projected again by **0192** (policy answer 3), all four lore types
	// together: `loreSlots` and `lorebook-triggers` each gain
	// `admitThreshold`, the declared control behind the admission gate. The
	// scan admitted on `pinned || keyword > 0 || nameMatch > 0`, so an entry
	// with no matching key could not reach the prompt however relevant it was
	// — the condition that forces a lorebook to be hand-indexed. It defaults to
	// **0, which is off**, so every existing install behaves exactly as it did
	// until somebody moves it; the hash still moves, because a declared field
	// is contract whatever its default.
	//
	// Re-projected a third time by **0199** (policy answer 3), the four lore
	// types again: `lexicalScoring`, `trigramFolding` and `titleWeight` —
	// retrieval plan phase 1's three lexical-quality controls. BM25 in place of
	// the raw per-occurrence sum, character trigrams in place of exact
	// substring only, and a title that can outrank the keys it sits beside.
	// Every default reproduces today: `overlap` is the sum the scan already
	// computed (and still literally calls `tfidfSignal` for), `0` folding is off
	// by the `admitThreshold` convention, and `1` is neutral rather than off
	// because a space cannot split a token, so weighting the title and the keys
	// alike is arithmetically the one bag of words they already were. The hash
	// moves because a declared field is contract whatever its default.
	//
	// Re-projected a fourth time by **0203** (policy answer 3), the three lore
	// gather branches and `vector-search` together: `retrievalMode` is **culled**. It
	// named which mechanism might surface an entry that had declared nothing of its
	// own, and two of its three values had already collapsed into one behaviour
	// — `both` meant "fuse the two mechanisms' rankings" and respond 1.17.0 removed
	// the fusion, so the mechanisms contribute additively to one score and there
	// is nothing left to choose between. The third value switched a mechanism
	// off in bulk for entries whose authors never asked, which is the shape the
	// governing rule forbids.
	//
	// ⚠ **No hash moves for its sequel.** Migration 0204 drops the per-entry
	// `retrieval_strategy` column — the same shape one scope down, and the last
	// exclusive routing there was — and nothing in this file moves with it. It
	// was a tier-one *column*, declared by no entry type in `roles` or `fields`
	// and addressed by no query type, so no content hash contains it and no
	// registry row needs re-projecting. That is worth stating rather than
	// leaving as an absence: the way to tell a column change from a contract
	// change is whether a pin here has to move, and this one does not.
	//
	// Re-projected again by **0099** (policy answer 3), with the third gather
	// branch and `lorebook-triggers`: `guaranteedMessages` is **declared**. It
	// was the audit's mirror-image finding — engine-read and declared nowhere,
	// so the only value it could ever hold was `DEFAULT_RETRIEVAL`'s hardcoded
	// 10, while it set the presence window for character-lore co-occurrence and
	// the term-frequency window for tf-idf. Declared at 10, which is what every
	// scan has silently run at, so it is behaviour-preserving by construction.
	// Moved (R-12, 2026-09-16): the `text` in-port is culled on all three lanes and on
	// `lorebook-triggers` — filled by no spec, read by no handler; the scan
	// derives its window from `scope`. Behaviour-preserving by construction.
	// (was "e252379dcbac9")
	// Moved (R-7 P5, 2026-09-16 — U3b): each lane declares its own `share`,
	// `maxEntries` and `priority` — the band intent it publishes at the head
	// of its candidates — at the numbers the ranker's map held (0.1667 / 20,
	// 0.1667 / 15, 0.1666 / 10), and the seven scan knobs are marked `shared`.
	// The three hashes differ now because the intent's defaults and labels
	// do. Behaviour-preserving by construction; migration 0135 moves stored
	// values. (was "b2dd2f1b3f043" ×3)
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `bands` ({ worldLore })
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "c2bd803678ccb")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "c04e4704eba99")
	// Moved 2026-10-02 (lorebooks Wave 8): the keyword lane's new `exclusions` out-
	// port — the entries its selective logic ruled out, as eligibility verdicts
	// (lorebooks C2). Edited in place; no migration (the slug's pointer moves at
	// boot). (was "140fe9926f31bc")
	"core:query/world-lore@1": "8a660280c2cef",
	// Moved (W1, 2026-09-17): gained the `speaker` in-port — a participant
	// reference naming whose private lore this read is for, wired inside a
	// repeating clause so two voices of one turn read two pools from one
	// gather. Additive and unwired on every shipped spec that had this node
	// before it, and the host keys on the run's scope exactly as it did when
	// the port is absent — so the pointer carries it (answer 3). Its two
	// sibling lanes do NOT gain it: world lore and history are not gated by a
	// lorebook binding, so a speaker would be a control that reads nothing.
	// (was "c469fd1ae6088")
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `bands` ({ characterLore })
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "a80274d1059ef")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "13eb24bba7db95")
	// Moved 2026-10-02 (lorebooks Wave 8): the keyword lane's new `exclusions` out-
	// port (lorebooks C2). Edited in place; no migration (the slug's pointer moves
	// at boot). (was "d57fea94d7a4b")
	"core:query/character-lore@1": "14fab76b8a3b72",
	// Gained the `channel` param in 0.6-preview (migration 0149, 20 §7);
	// default 'main' reproduces the legacy read byte-for-byte.
	//
	// Re-projected by **0110** (policy answer 3): `limit`'s declared default
	// moves 40 → 100 (ruling 2026-09-09, D-8's terms). The number is not a
	// retune — the binding read `input.limit`, which nothing supplies, so every
	// run since this node existed has taken its literal 100 while the panel
	// showed 40. Declaring the effective value is what lets the control be
	// wired without moving a single install's transcript window; changing the
	// number is a separate decision against the measure corpus.
	// (was "2272f3cfb8f4b")
	// Moved (R-12, 2026-09-16): the `budget` in-port is culled — declared, wired by no
	// spec and read by nothing; the window this node fetches is
	// `params.limit`, and fitting history to a token budget is the ranker's.
	// `params.priority` stays declared and unread, allow-listed in
	// `boot/declaredReads.ts` until P5 moves it onto the source (U3).
	// (was "24ce875b04648")
	// Moved (R-7 P5, 2026-09-16 — U3b): the conversation's band intent —
	// `share` 0.5, `maxEntries` 50, `minEntries` 6, `priority` read at last —
	// and a `band` out-port carrying it to the ranker. (was "c9d269db28ae0")
	// (was "16a2cac2f8f36b") — `main` · `messages` say `messages@1` — rows, which is what the binding always published (U5d review, W9); `band` still `context-candidates@1`.
	// Moved 2026-09-28 (lair re-plan R13): the `unplayedOnly` param — a side
	// channel's talk since the story's last line, refused on `main`. Proven:
	// the descriptor with only that param deleted hashes to the old pin.
	// (was "31215db9aacee")
	// Moved 2026-09-28 (lair re-plan R10's fold-in of the R9 follow-up): the
	// `talkOnly` param — off `main`, only people's lines and the replies fired
	// there, so the Lair's room check never reads the Sanctum's beats row.
	// Proven: the registry entry with only that param deleted hashes to the
	// old pin. (was "195977552018d0")
	// Moved 2026-09-28 (lair re-plan R11, File as a room): the `messageId`
	// in-port — one row, by id: the message a press on a message's ⋮ was made
	// on. Proven: the SDK sources with only R11's edits reverted hash this
	// entry back to the old pin. (was "cb6b15802d5e0")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "b9dbc930f90c1")
	// Moved 2026-10-03 (history window): the `budget` in-port — wired, the
	// read is the newest rows up to twice the window by a generous estimate
	// (never more than 2000) and `limit` is not read; `limit`'s description
	// says so. Every shipped reply wires it. (was "1b671cade13c9c")
	"core:query/session-history@1": "4d8a07e5d38b0",
	// Lair character turns (owner ruling 2026-09-30): the standing turn plan
	// a character turn plays from. A new type: no migration.
	"core:query/turn-plan@1": "a71a679f5d817",
	// Moved (U5f, R-15 *Staleness and order*, 2026-09-17): a `version`
	// out-port — the session's state version, on its own port so a spec can
	// hand it back as `base`. Additive: the Adventure keeper graphs wire it.
	// (was "138a9731c106d9")
	"core:query/session-state@1": "10900258df1b46",
	// NEW (attributes phase 3a, 2026-09-26): how many of each item are held
	// (Σ held counts across the session's owners) and left (limit − held).
	// Answers, never enforces — supply is the genre pipeline's to keep.
	"core:query/item-supply@1": "ff463d61f66e9",
	// NEW (2026-09-27, owner-confirmed "query stats from the lorebook, and
	// over time"): a lorebook's durable stats — world, cast members, places —
	// with no session needed; scoped to the session's book or a granted one.
	// MOVED 2026-09-27 (rulings 15/16): + optional `branch`, `at`, `forkCut`
	// in-ports — a custom reading of the book. Additive; nothing wired to the
	// old ports reads differently except the no-session default line (most
	// recently used, not main) and the fork cut on a branch.
	"core:query/lorebook-state@1": "1c4a3fff73b0e0",
	// NEW (2026-09-27): one stat's values over time for one owner — by
	// message in the scope session, by story date across sessions, or both.
	// MOVED 2026-09-27: the same three optional in-ports, same reasons.
	// RENAMED 2026-09-27 (owner ruling, R1): was `core:query/stat-history@1`,
	// edited in place (Q4). Only the id moved: the descriptor with its id put
	// back hashes to the old pin "167511afc4ab53".
	// Moved 2026-09-27 (owner-approved, no alias): the out-port `history` is
	// `trail`. Nothing else moved: with the port renamed back the descriptor
	// hashes to the old pin (was "2ca9898789a3f").
	// Moved (enum member labels, 2026-09-29): `mode` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "192ca120c8b84e")
	"core:query/stat-trail@1": "17f0de75a3a3b3",
	// ⚠ `core:query/graph-context@1` was here, and is gone rather than frozen.
	// It split into the two below, because one node emitting both directions of
	// the graph gave them one heading, one layout and one switch. Removing a
	// published pin is what the third test in this file exists to catch, and it
	// is allowed here only because 0.6 has not shipped: every stored spec
	// pinning it is a preview document, and `0124` deletes its registry rows
	// along with the specs that named it.
	//
	// ⚠ **Both hashes MOVED — answer 3, paired with
	// `drizzle/0111_reply_slots_and_relationship_cap.sql`**, which deletes both
	// registry rows so boot re-projects them. Reading this file's own rule
	// before editing these lines: a parameter's default is hashed, and this is
	// the third response, not the first.
	//
	// What moved: `maxEntries` — "Most relationships" — **lost its default**.
	// Neither spec named the `params` slot on either node, so `resolveInput`
	// never resolved it and `bindings.ts` called
	// `capRelationships(section, undefined)` on every run this node type has
	// ever made, which that function reads as *no ceiling* and returns the
	// section whole. `respond` wires `params: slot.params()` on both as of 0111,
	// so the declaration becomes live, and under ruling D-8 the declared default
	// must therefore BE the value every run has actually used.
	//
	// That value is "uncapped", and it is not expressible as a number here. `0`
	// is taken and means the opposite (`capRelationships` returns `null`,
	// dropping the section — the off-switch convention this package uses
	// everywhere); a negative sentinel IS what `capRelationships` reads as no
	// cap, but `min: 0` forbids one and no other parameter in the contracts uses
	// a negative sentinel; and a large finite number is a different value that
	// is merely usually indistinguishable. An absent default is the exact one:
	// `resolveSlot`'s params branch copies a schema default only
	// `if (v?.default !== undefined)` and `reconcileConfigs` back-fills a row
	// only when a declaration carries one, so an untouched install resolves
	// `undefined` and stays uncapped. 0111's third statement lifts the stored
	// `12`s the old declaration had already back-filled — without it, wiring the
	// slot would cap every upgraded install at 12.
	//
	// `min: 0`, `type: 'integer'` and the label are unchanged; the description
	// gained "leave it empty for no ceiling", and display text is stripped
	// before hashing, so the whole of the movement is the missing `default`.
	// (was "133fb1aab4e288")
	"core:query/relationships-perspectives@1": "1a2d5179a4bc15",
	// (was "1a709dd0599745")
	"core:query/relationships-known@1": "fd3cbb1afbf80",
	// The graph as a ranked retrieval mechanism (ruling 2026-09-10, Q1) — the
	// same three layers the two nodes above publish as keyed sections, read
	// instead as candidates in the `relationships` budget band and ordered
	// scene presence → speaker → recency. A **new** type, so nothing is
	// re-projected: it has never been published, and the two above are
	// untouched. It reuses their `relationshipSlots`, so the ceiling means the
	// same three things here as it does there.
	// Moved (R-7 P5, 2026-09-16 — U3b): `share` (0, the band's switch) and
	// `priority` beside the ceiling; the ceiling is the band's, absent =
	// uncapped. (was "1a07eb0bde9fac")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "15b1b8194c0986")
	// Moved 2026-09-29 (genre plan F6(a)): a `loreLinks` param (boolean,
	// default true — what every run did) switches the lore-link hop; Adventure's
	// preset turns it off. The cast-wide read (nobody speaking) is the host read's,
	// not the descriptor's. Proven: the descriptor with only `loreLinks` deleted
	// hashes to the old pin. (was "11a0d9e6e56a49")
	"core:query/relationship-search@1": "14d6e302a08f1f",
	"core:query/graph-scenes@1": "3d0bc6433032e",
	// The third gather branch, added in 0.6 after its absence was found: the
	// split into world and character lore left `history` with no node, so those
	// candidates were read, scored and dropped for two spec versions. A *new*
	// type needs no re-projection — nothing has published it before.
	// Re-projected by 0186, again by 0192, again by 0199 and again by 0203 with
	// the other two gather branches; see the note there.
	// Re-projected a fifth time by **0099** with its two siblings, for
	// `guaranteedMessages`; see their note.
	// Moved with its two siblings above (R-12): `text` culled. (was "e252379dcbac9")
	// Moved with its two siblings (R-7 P5, U3b): its own intent at 0.1666 / 10.
	// (was "b2dd2f1b3f043")
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `bands` ({ history })
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "1c5ee4567fc8b2")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "bd17d58e1976")
	// Moved 2026-10-02 (lorebooks Wave 8): the keyword lane's new `exclusions` out-
	// port (lorebooks C2). Edited in place; no migration (the slug's pointer moves
	// at boot). (was "e1166297a747a")
	"core:query/history-entries@1": "1403d2cf364be7",
	// Re-projected by 0186: the same `scanDepth` correction, on this type's own
	// duplicate declaration of the field. Deliberately still a separate schema
	// rather than folded into the shared `loreSlots` — the two overlap in that
	// one field name and nothing else, and folding would cull five declared
	// addresses and hand this node a `retrievalMode` its binding never reads.
	// (That mode is gone from `loreSlots` too as of 0203, and this type's hash
	// is untouched by it — which is the separation earning itself a second
	// time: a shared declaration would have moved this hash for a field this
	// node never had.)
	//
	// Re-projected again by 0192, which adds `admitThreshold` here as well as
	// on the shared declaration — the narrator runs its lore through this type,
	// and a gate reachable on the reply pipeline and not on the narrator would
	// be a control that exists on one screen and not the other for no reason a
	// user could discover.
	//
	// Re-projected a third time by **0195** (policy answer 3), which closes
	// plan bug 15 — this type's own dead-control cluster, the last of the ones
	// bug 12 found the first of. `caseSensitive`, `useRegex`, `weight` and
	// `minInclude` rendered, validated and stored a row while
	// `retrievalParamsFrom` read none of them; they are **culled**, two because
	// they describe how an *entry* matches and live on the entry
	// (`signals.ts` reads `entry.caseSensitive` and `entry.matchMode`), two
	// because they are the ranker's and are `share`/`signal*` and `minEntries`
	// on `rank-hybrid` — the same pair `session-history` lost for the same
	// reason. `recursionDepth` is **wired instead of culled**, by renaming it
	// to `maxRecursionDepth`: one letter is why it looked live and was not, and
	// that is the name `retrievalParamsFrom` and the three lore gather branches already
	// use. 0195 carries the stored values across the rename and deletes the
	// four culled addresses' node overrides, which the reconciler cannot see.
	//
	// Re-projected a fourth time by **0199**, with the three lore gather branches above:
	// the same three lexical-quality controls, on this type's own duplicate
	// schema, for the reason 0192 gives — the narrator runs its lore through
	// this type.
	//
	// Re-projected a fifth time by **0099**, again with the three lore gather
	// branches: `guaranteedMessages`, for the reason 0192 gives — the narrator
	// runs its lore through this type and reaches the same `keywordQuery` from
	// the same seam, so a window that exists on the reply pipeline and not on
	// the narrator is a difference no user could discover a reason for.
	// Moved (R-12, 2026-09-16): `text` in-port culled, with the three lanes
	// above. (was "74f456fa99d6a")
	// Moved (R-7 P5, 2026-09-16 — U3b review W1): the node produces three
	// lore bands through one port and now declares an intent per band,
	// namespaced — `worldLoreShare` / `worldLoreMaxEntries` /
	// `worldLorePriority` and the same for `characterLore` and `history` —
	// from the one `LORE_BANDS` table the three lanes read, so the numbers
	// and labels are the lanes' own. Its handler publishes three band intents
	// at the head of `main`/`hits`. Behaviour-preserving by construction: the
	// defaults are the ranker's fallback numbers, which is what every
	// `lorebook-triggers` spec (narrate, narrate-character, adventure-look)
	// ran on while this node declared nothing. Migration 0135 moves a stored
	// lore member on those specs' rankers here. The three spec hashes do NOT
	// move — their documents wire `params: slot.params()` already; only the
	// declaration behind the slot grew. (was "13604832d9dbd")
	// Moved (W1, 2026-09-17): gained the `speaker` in-port, on
	// `character-lore@1`'s terms above — this node produces the character-lore
	// band through the same gated read, so it takes the same port.
	// (was "73ddcc1d71670")
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `bands` ({ worldLore, characterLore, history })
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "1b5e7f463cde1e")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "ff1e7cb5db9f2")
	// Moved 2026-10-02 (lorebooks Wave 8): the new `exclusions` out-port (lorebooks
	// C2). Edited in place; no migration (the slug's pointer moves at boot). (was
	// "404416a976bd")
	"core:query/lorebook-triggers@1": "190c56d8514e39",
	// A **new** type (2026-09-17), so no migration and no bump — the same
	// sentence `entry-keys@1` below stands on. It is the **listing** door the
	// five definitions above are not: no mechanism runs, nothing is scored, and
	// `main`/`entries` publish `core:shape/json@1` rather than candidates, so
	// no reader of theirs could be looking at this. It shares no declaration
	// with them — its own `scope` in-port and its own three parameters, nothing
	// spread from `loreSlots` — which is why nothing else in this table moved
	// when it landed, and that immobility is the check that the addition really
	// is additive. See `runtime/bindings.ts` for what it binds to and
	// `host.ts`'s `lorebook_entries` case for the read.
	//
	// Moved the same day (answer 3), before it had ever shipped: the first
	// parameter is `entryTypes`, not `types` — a parameter may not take the
	// bare noun (R3), and *type* alone already names a node type, a session
	// type and a part type. Nothing else in this table moves: the declaration
	// is this node's own and is spread into nothing. (was "1fabf250d1b6c5")
	//
	// ⚠ **Red until the contracts package is rebuilt.** This file reads the
	// contracts through their `dist`, which still carries `types`, so the drift
	// check above reports this line until `npm run sdk:build` catches up — the
	// Lair block in `specHashes.test.ts` describes the same lag, which skips
	// there only because those keys are absent from `current()` and this one is
	// not. The recorded value is the source's, computed with this file's own
	// `definitionContentHash` over the snapshot with the key renamed.
	// Moved 2026-09-29 (places plan B2): param `withLinks` (boolean, default
	// false) — each row's lore links, said from the row, on `links`. Additive:
	// off, a row carries no `links`. Proven: the snapshot entry with only that
	// param deleted hashes back to the old pin. (was "13572f1bddbdd1")
	"core:query/lorebook-entries@1": "3763af6fd2ef8",
	// A **new** type, so no migration and no bump — policy's own sentence,
	// "adding a new type is safe and needs no migration". Nothing else in this
	// table moved when it landed, which is the check that says the declaration
	// really is additive: it declares its own ports and its own two parameters
	// and spreads nothing from a sibling, so no existing content hash could
	// follow it. See `ranking/keyProposal.ts` for what it binds to.
	"core:query/entry-keys@1": "112e2978d9c9a8",
	"core:query/summarize-source@1": "1b53afc623e3fc",
	// Re-projected by **0201** (policy answer 3), retrieval plan phase 2: this
	// mechanism is wired into the shipped reply spec at last, and it gains the switch
	// that lets it be. `maxEntries` defaults to **0 — off** — on the
	// `admitThreshold` convention, so an upgraded install embeds nothing and
	// retrieves nothing through it until somebody raises the number. The type
	// also gains `optional`, which is what lets an admin skip the node outright
	// and what stops a missing embedding model costing anybody a turn: an error
	// becomes an empty result, and the plan's second governing rule (an
	// unavailable mechanism subtracts a signal, it never disables a path) holds
	// in the executor rather than only in prose.
	//
	// Re-projected by **0203**: `retrievalMode` is culled here too. It was
	// declared on both mechanisms so that neither could disagree with the other about
	// an undecided entry, so it had to leave both together — and it leaves them
	// agreeing for a better reason, since each now reads the entry's own column
	// and nothing else. See the lore gather branches' note above for the argument.
	//
	// Re-projected by **0099**, and this one is two contract changes at once.
	// `topK`'s default moves 12 → 40 because the binding read it off an in-port
	// name the node does not declare and ran on a literal `?? 40` — 40 is what
	// every install has actually searched at, so wiring the control must not
	// re-tune anybody. And `minScore: 0.35` is **culled** for
	// `similarityFalloff`: a floor removes a row from the pool, where no other
	// mechanism can reach it either, which is the one thing the governing rule
	// forbids. The replacement shapes the contribution (`cos ** falloff`) and
	// ships at 1 — the raw cosine, which is what ran while the floor sat unread.
	// (was "132b49d9fcceb4") — `vectors` says `json@1` — a list of query vectors, which is what `embed-text@1` publishes (U5d review, W9).
	// (was "66b22cb34f028") — 2026-09-29, genre uplift C3: `maxEntries` stops being
	// the semantic mechanism's switch and becomes its ceiling — default 0 → 5, no
	// longer `quick`. The switch moved to `query-windows.searchByMeaning`, the
	// chain's first node, because this node is its last: the probes were embedded
	// before `maxEntries = 0` said nothing was wanted.
	// Moved 2026-10-02 (lorebooks Wave 8): the `speaker` in-port, character-lore's
	// semantics — the leak guard for an arm inside a per-voice clause (lorebooks C3,
	// R3). Edited in place; no migration (the slug's pointer moves at boot). (was
	// "1e4527ac6d1122")
	"core:query/vector-search@1": "3ecd7d4089af2",
	// New 2026-10-02 (lorebooks C2/R4, E-2): the cast's presences as the run's
	// session reads them — its line, and `at` its story clock. A new type.
	"core:query/cast-presences@1": "68689a20c23d4",
	// The third retrieval mechanism (design §13.5), added 2026-09-06 — retrieval by
	// the names a scene is using, over annotations written in the background. A
	// **new** type id, so the registry inserts it and nothing conflicts: no
	// re-projection migration, on the same terms as the tool-calling pair below.
	// Moved 2026-09-27 (owner ruling, option b): recalled lines are their own
	// declared band — `bands: { recalledLines }`, carried on `messages` alone
	// (`bandPorts`, contract beside `bands`) — with their share declared as
	// `recalledLinesShare`. Nothing else moved: with those three removed the
	// descriptor hashes to the old pin. (was "a62c1e036691f")
	// Moved 2026-10-02 (lorebooks Wave 8): the `speaker` in-port (lorebooks C3), and
	// `maxEntries` 0→5 / `maxMessages` 0→20: retrieval on by default (R5, A23(b)).
	// Edited in place; no migration (the slug's pointer moves at boot). (was
	// "1c6d05c53e6a7c")
	"core:query/entity-search@1": "1b90356d30b294",
	// Documentation search (U5g, R-18, 2026-09-16) — the guide genre's one
	// retrieval mechanism: the compiled docs' sections, scored against the
	// newest messages, published in the `worldLore` band. A **new** type id.
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `bands` ({ docsExcerpts })
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "53584fd75910e")
	// Moved (enum member labels, 2026-09-29): `priority` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1e3b8e273bd69a")
	"core:query/docs-search@1": "dd460cc84424e",
	// The fifth mechanism (retrieval plan phase 4), added 2026-09-06 —
	// retrieval by *description*: a second named vector space holding one
	// vector per name, queried with the descriptive references the scene used
	// ("the captain" → Captain Vell). **New** type ids, so the registry inserts
	// them and nothing conflicts; the re-projection in 0202 is for
	// `rank-hybrid`'s new weight alone.
	//
	// `mention-spans` carries the mechanism's one switch (`maxMentions`, 0 = off) and
	// it is on the *first* node of the chain, so a switched-off mechanism reads
	// nothing and embeds nothing. `entity-link` takes the candidate list on an
	// in-port and returns it enriched, which is what makes "a link is a score
	// contribution, never an admission" a property of the ports rather than a
	// promise in a binding.
	// Moved 2026-10-02 (lorebooks Wave 8): `maxMentions` 0→8: retrieval on by
	// default (R5, A23(b)). Edited in place; no migration (the slug's pointer moves
	// at boot). (was "1001472b134a3c")
	"core:query/mention-spans@1": "122cef04ff82df",
	// Moved 2026-10-02 (lorebooks Wave 8): the `speaker` in-port (lorebooks C3, R3).
	// Edited in place; no migration (the slug's pointer moves at boot). (was
	// "14722f3bd64182")
	"core:query/entity-link@1": "1ec6b7b641ddd5",
	// Gained a `variables` slot for its post-budget lore and history in
	// 0.6-preview. Re-projected by migration 0108, on the same terms as 0107.
	// Migration 0095 — answer 3.
	//
	// `core:task/assemble@2` gained a `connection` slot. It calls nothing with
	// it: the only thing read is `metadata.promptFormat`, so the node that
	// renders the prompt can learn which wire format it is rendering for.
	// Nothing supplied that before — `prompt/assemble.ts` read an
	// `input.promptFormat` no port, slot or spec ever set — so every prompt
	// rendered as Vicuna whatever the connection said, while `dispatch.ts`
	// stamped the receipt with the connection's real format.
	//
	// A slot declaration is content, so the hash moved and the registry row is
	// a stale snapshot of code that no longer exists;
	// `drizzle/0095_prompt_format_reprojection.sql` deletes it so boot
	// re-projects. Every shipped spec wires the slot to the SENDING node
	// (`slot.connectionOf("generate")`), which is a shared reference and
	// therefore adds no option to the config panel — an untouched pipeline
	// gains no setting and, on a `vicuna` connection, renders identical bytes.
	//
	// Re-projected by **0113** (policy answer 3): three in-ports — `decisions`,
	// `messages` and `groups` (D-I, D-H). The first two were **supplied by every
	// shipped spec and declared by nobody**, and one of them is the input the
	// binding halts without; the third was published by
	// `core:task/rank-hybrid@1` and wired by nobody, so `allocate` ran on its
	// own `{}` while the ranker's per-band arithmetic sat one node upstream.
	// Undeclared cost more than tidiness: `validate.ts` skips its shape check
	// when either end of an edge is undeclared, so a plugin wiring the wrong
	// shape into this node got no finding at all.
	//
	// Not a retune. `allocate` copies `groups` onto `AllocatedContext.groups`
	// and reads it nowhere else, so every byte `render` walks is unchanged —
	// the parity corpus is identical across the change. What fills in is the
	// receipt's `sources`, empty on every run until now.
	//
	// Moved again 2026-09-10 by the blocks-parameters lane, and this is the
	// **first entry recorded under content addressing** — so it is the worked
	// example of what a moved hash costs now. There is no migration beside it
	// and there is no version bump: the slug's pointer moves to the new
	// declaration at the next boot, the declaration it moved off stays in
	// `pipeline_definition_declarations`, and a receipt naming the old hash still
	// resolves. All that is required is this line, changed in the same commit
	// as the edit, which is what keeps the move visible in review.
	//
	// Moved again 2026-09-10: the template slot declares a SET of engines
	// (`acceptedEngines: [handlebars, liquid]`) where it declared one, so Liquid is
	// selectable for the story string. Handlebars stays first, which is what
	// a new template here is still written in — the parity corpus is
	// byte-identical and no shipped row changes pool.
	// Moved (R-12, 2026-09-16): `params.truncation` (`oldest-first | lowest-weight`) is
	// culled — declared, rendered, read by nothing. Assemble drops nothing;
	// what fits is the ranker's `select`, per band, so a second drop rule here
	// had no place to act. Behaviour-preserving: no run ever consulted it.
	// (was "1d97d036a0a3e4")
	// Moved 2026-09-27 (typed templates P2, edited in place — owner ruling
	// Q4): the `variables` slot is open — `rendersBands: { from: 'candidates',
	// raw: ['characterLore'] }` — so every band declared upstream renders as a
	// top-level name through its layout. Nothing else moved: with
	// `rendersBands` stripped the descriptor hashes to "17aafe8e99ff34". The
	// parity corpus is byte-identical (core's three render as they did).
	// (was "92ce2a7d407b0")
	// Moved 2026-09-27 (typed templates P3, edited in place — owner ruling
	// Q4): the template slot's `variables` are corrected to what `render()`
	// supplies — typed `worldLore`, `history`, `currentDate`, `characterLore`,
	// `sessionMessages`, `injectionsByIndex`, `budget`, `postHistory` and the
	// `bands` alias, where it declared `blocks` (a param that never reaches
	// a template), `budget` as two bare names and `prompts` (never a name —
	// the prompts are spread). Declaration only: nothing renders differently.
	// With the old three put back the descriptor hashes to "92ce2a7d407b0".
	// (`build-template-context@1` / `build-narrator-context@1` gained
	// `portSchemas` too — policy then, so neither pin moved; hashed since
	// the 2026-09-27 "Fix" ruling, below each.)
	// (was "3dd1da9b7a6df")
	// Moved 2026-09-27 (typed templates P6, edited in place — owner ruling
	// Q4): a new optional in-port `annex` (S.json), fed only by
	// `core:query/session-annex@1` with `view: 'template'` (law T2) — every
	// declared annex key of the owners in scope, read by a template as
	// `annex.<owner>.<key>`. Unwired on every shipped spec, so nothing renders
	// differently. With the port taken back out the descriptor hashes to
	// "3dd1da9b7a6df".
	// Moved 2026-09-27 (owner ruling, R1): the template slot's `engines` is
	// `acceptedEngines` — `engines` is the manifest's version range only.
	// Nothing else moved: with the key put back the descriptor hashes to the
	// old pin (was "1b71505ab9ded7").
	// Moved 2026-09-27 (no back-compat before distribution, owner ruling):
	// the `bands` alias object is gone from the template variables —
	// bands are top-level names only. Nothing else moved: with the `bands`
	// field put back the descriptor hashes to the old pin (was "16d010705bfeb2").
	// Moved 2026-09-30 (character lore reaches the prompt, owner ruling): the
	// `variables` slot renders `characterLore` through `core:var/character-lore@1`
	// and `rendersBands` loses `raw`; the template scope types `characterLore`
	// as the laid-out string; the `blocks` param's shipped order lists it under
	// `personas`. Nothing else moved: with those four put back the descriptor
	// hashes to the old pin (was "a16c3e447ae6b").
	// Moved 2026-10-02 (author's note AN1): the template scope types
	// `authorsNote` (`ASSEMBLE_TEMPLATE_SCOPE`) — the placed note a template
	// renders with `{{#with ../authorsNote}}`. (was "193232d7172599")
	// Moved 2026-10-02 (composer attachments phase 4): the template scope's
	// transcript line gains `attachments` — the placed files a template renders
	// with `{{{attachments}}}`. (was "c263e71c1772a")
	// Moved 2026-10-03 (B2 prompt shape): the `blocks` param's shipped order
	// lists `currentDate` LAST instead of first (`SHIPPED_PROMPT_BLOCK_IDS`),
	// matching the shipped template, which moved the date to the end of the
	// system block so the top of the prompt stays cache-stable. Nothing else
	// moved: with the old order put back the descriptor hashes to the old pin.
	// (was "a09e1d06836e8")
	"core:task/assemble@2": "980fcefab8e91",
	// Tool calling's pure halves (20 §9), added 2026-08-26. New types — a
	// row inserts and conflicts with nothing.
	// Moved (enum member labels, 2026-09-29): `style` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1fde41dd02ebce")
	"core:task/advertise-tools@1": "23b5e457f81bc",
	"core:task/parse-tool-call@1": "319ee4b56a7bf",
	// The three the tool loop needed beside them (20 §9, 01 §4a), added
	// 2026-09-10. All new types — a row inserts and conflicts with nothing, so
	// no migration. `run-tool` is the impure middle the two pure halves sit
	// either side of; `available-tools` is what the advertisement is built
	// from, a Query because which extensions are enabled is not a property of
	// a spec; `join-text` is the reduce a repeated block has always needed —
	// `map` and `loop` publish a list and every write takes a scalar.
	"core:query/available-tools@1": "1275d437461a7e",
	"core:oracle/run-tool@1": "e3dfadabceed9",
	"core:task/join-text@1": "89b6a865c3edd",
	// Lair pass B5 (2026-09-27, owner D5): a document's lists as one folded
	// section — the producer of `folded-sections@1`, the Lair's Plan. A new
	// type: a row inserts and conflicts with nothing, so no migration.
	// Moved 2026-09-28 (lair re-plan R8): an additive `text` out-port — the
	// same lines as a markdown list, the body of the Lair's Sanctum beats row.
	// Proven: the snapshot entry with that port deleted hashes back to the old pin. (was "2b88526b34c5b")
	"core:task/list-section@1": "ac239206b7bee",
	// Lair re-plan R8 (2026-09-28): a list's first item and the rest — the
	// Lair's lead delver (streamed) and the party after them. A new type.
	"core:task/split-first@1": "bdd22584e47cb",
	// Lair re-plan R7 (2026-09-28): a room name, unless an entry or recent
	// prose already describes it — what the Lair's knock is checked against.
	// A new type: no migration. It REPLACES `core:task/unlisted-name@1`
	// (B13, was "1017d8d6385e1a"), removed with no alias (owner 2026-09-27:
	// no back-compat before distribution; the only spec pinning it was
	// `lair-respond`, repinned in the same change).
	// Moved 2026-09-29 (places plan B6): a `path` param (default `''`) — where
	// the name sits inside `name`, so *Answer the door* can read the world's
	// `location` off a session-state document (and a lore reference is its
	// listed entry, a binding rule with no declaration). A widened declaration
	// the pointer carries: an unset `path` reads `name` whole, as before.
	// Proven: the registry snapshot of this declaration with only
	// `slots.params.schema.path` deleted hashes back to the old pin.
	// (was "cbaecbe798dca")
	// Moved 2026-09-30 (plan A27 P5): an additive in-port `fallbackName`
	// (`json@1`), looked for when `name` at `path` names nothing — the Lair's
	// door reads the knock's `vantage` there. Unwired, it reads as before.
	// Proven: the snapshot with only that port deleted hashes back to the old
	// pin. (was "298d40eeb2950")
	"core:task/undescribed-name@1": "10d69dd5844c15",
	// The two pure Tasks of D-4a (2026-09-17), and **new** types — a row
	// inserts and conflicts with nothing, so no migration and no bump.
	//
	// `pick-by-hash` is the node that lets a genre DERIVE a hidden fact
	// instead of authoring it: rendezvous hashing over a stable key, so the
	// create run and every later turn reach the same item with nothing written
	// down (the alternative was the attribute-slot ledger, which the player's
	// own state panel renders). `turn-random@1` could not stand in — it draws
	// `ctx.random`, seeded per RUN. `cast-choices` is the other half of the
	// same gap: `make-choices@1` needs `{ key, label }` options and nothing
	// turned a cast into that list, so both Whodunit pickers spend a model
	// call enumerating the room.
	//
	// Both moved the same night, before either had shipped — the window in
	// which a name is free, and the reason to spend it.
	//
	// `pick-by-hash`: its in-port is **`scopeKey`** and its out-port
	// **`pickIndex`** (R3 — qualify, never the bare noun). *key* alone was
	// already an option's key, the identity a candidate is scored under and a
	// settings field's name; *index* was a database index and a message's
	// position. Nothing else in this table moves: the declaration is this
	// node's own and is spread into nothing.
	//
	// `cast-choices`: a **`question`** in-port and a **`json`** out-port
	// carrying `{ question, options }` — the document
	// `core:task/make-choices@1` reads off its own `json` port (ruled (b),
	// 2026-09-17). The alternative was a `question` in-port on
	// `make-choices`, which would have moved the hash of a node already wired
	// into three shipped specs; shaping the document on this side moves only
	// this line, and `make-choices@1` above is byte-identical across the
	// change. `options` stays beside `json` for a spec that wants the bare
	// list — a pick over the same options is exactly that spec.
	//
	// Both values were computed from the **source** declaration, because this
	// file reads the contracts through their `dist` and that package lagged
	// the edit — the same lag the `lorebook-entries` line above describes.
	// The route is this file's own `definitionContentHash` over
	// `snapshotRegistry`'s entry for the declaration as `contracts/src`
	// declares it, verified by reproducing two pins already recorded here:
	// `join-text@1` and `lorebook-entries@1` both come back byte-identical by
	// it. So if either line below is red, `npm run sdk:build` has not caught
	// up with the source — not that the pin moved again.
	// (were "ba3cb88fbbe59" and "16714786944485")
	"core:task/pick-by-hash@1": "1d94930bb514a9",
	// Moved (enum member labels, 2026-09-29): `exclude` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "610624f6ff394")
	"core:task/cast-choices@1": "3fdcc4cd2ba7d",
	// The native door (20 §9). `core:oracle/generate-text@1` is published and
	// frozen, so a `tools` in-port and a `toolCall` out-port are a NEW pin
	// rather than two more lines on that one — which would move its hash and
	// need a re-projection on every install, for a capability most connections
	// do not have. One binding serves both.
	// Gained `params.streaming` with the other three providers.
	// Moved (R-12, 2026-09-16): `prompts` slot culled — see `generate-text@1`.
	// (was "b8e60704bfb8e")
	// Moved (enum member labels, 2026-09-29): `streaming` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1d291657ad5c20")
	"core:oracle/generate-with-tools@1": "86a789d13c163",
	// The structured door, on the same terms as the tools one above and for the
	// same reason: `generate-text@1` is published and frozen, and this node does
	// not make the same request anyway. It asks a question rather than taking a
	// turn, so it declares no speaker and no attachments, takes a `schema`, and
	// publishes the parsed document instead of prose.
	// Gained `params.streaming` with the other three providers.
	// Moved (R-12, 2026-09-16): `prompts` slot culled — see `generate-text@1`.
	// (was "7bac9bd9068a5")
	// Moved (enum member labels, 2026-09-29): `streaming` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "170f772cd314a4")
	"core:oracle/generate-json@1": "122a7ddc81dfeb",
	// Re-projected by **0102** (policy answer 3): a `sampling` slot, so the cut
	// can be clamped to the window the batch is actually sent against — the
	// binding read no sampling config at all, and there is no truncation on
	// this path to catch an overflow (`compilePrompt` returns early on an
	// injected prompt). Same shape and same argument as
	// `core:task/context-budget@1`. `batchTokens` also moves from 2048 to 2560
	// — a default is content, and the old number meant 548 tokens of chat once
	// the binding subtracted its reserve from it.
	// Moved 2026-10-03 (attachments follow-ups, owner ruling): an optional
	// `attachments` in-port (`core:shape/media-by-message@1`) — each file is
	// named after its message's text and counted in the cut. Unwired, or a
	// message with no files, batches exactly as before. (was "3a1bef51d6d9a")
	"core:task/batch-messages@1": "1e1437002c1acc",
	// The narrator's half of the split (migration 0114). It shares this one's
	// implementation and ports; what makes it a separate type is that it
	// declares a different configurable surface — `narratorName`, and no
	// example-dialogue or relationship layouts. Adding a type needs no
	// re-projection: it inserts a row and conflicts with nothing.
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `portSchemas` (out main/templateContext)
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "f832d75d396be")
	// Moved 2026-09-29 (genre uplift C2): an additive `turnDirection` in-port
	// (S.text) — what the person asked the narration to do, rendered
	// `{{turnDirection}}` by the shipped narrator row; it was stored beside the
	// row and sent nowhere. Proven: the registered declaration with only that
	// port deleted hashes back to the old pin. (was "79532f3db7018")
	// Moved 2026-10-02 (author's note AN1): `TEMPLATE_CONTEXT_SCHEMA` (its
	// hashed `portSchemas`) declares the optional `authorsNote`. (was "a5f7ffcdaf881")
	"core:task/build-narrator-context@1": "2d7e9cd66420c",
	// The third context surface (ruling 2026-09-07), and a NEW type for the
	// same reason the narrator's was one: it declares a different configurable
	// surface. What separates it from the narrator's is a `speaker` IN-PORT —
	// a side character's name is data the trigger carried, different every
	// turn, where `narratorName` is a setting stored once. Putting it in a
	// prompts slot would mean editing a prompt config to speak as somebody
	// else, and every turn rendering with whichever name was stored last.
	//
	// ⚠ It also does NOT carry `currentCharacterId`, which the other two
	// context builders inherit from the shared shape. Character-lore
	// visibility is decided by the host read, which keys on the run's scope —
	// so a speaker id arriving on this node's port could change whose voice
	// the prompt is in without changing whose lore it was handed. `sideCharacter`
	// carries the name and the card; the id stays where the host can act on
	// it. (Its absence is also what keeps it out of `UNFILLED_IN_PORTS` —
	// there is no port to excuse.)
	// ⚠ MOVED: two declared in-ports, `state` and `plan`, both unwired on the
	// pipeline that had this node first (`core:spec/chat-side-character`), so
	// nothing it does changes. A voice built with no place in front of it
	// answered from whatever the transcript suggested.
	// Moved (U5a, 2026-09-16): the fact's in-port is `sideCharacter` (was
	// `speaker`) — see `side-character-turn@1`. Same handler, same reads.
	// (was "4db3df67c3a47")
	// Moved (W1, 2026-09-17): gained the `speaker` OUT-port — the participant
	// reference this node already derived from the `sideCharacter` fact,
	// published so a lore lane in the same clause can be handed the same
	// answer instead of matching the name a second time. Still no
	// `currentCharacterId` in-port: the id is published, never set.
	// (was "2314a96fa5a1c")
	// Moved 2026-09-28 (lair re-plan R8): an additive `locationEntries`
	// in-port — a voice sees the room it stands in now that nothing narrates
	// it. Proven: the snapshot entry with that port deleted hashes back to the old pin. (was "152663c795c601")
	// Moved 2026-09-28 (lair re-plan R9): new in-port `locationPassage`
	// (S.text) — `undescribed-name@1`'s `passage`, a room described only in
	// prose, rendered `{{locationPassage}}` for the voices. Proven: the
	// registered declaration with only that port deleted hashes back to the
	// old pin. (was "1b8e23fe2a287e")
	// Moved 2026-09-29 (genre uplift C2): an additive `turnDirection` in-port
	// (S.text) — the narrator modal's text on a side character's turn, wired by
	// `narrate-character` alone. Proven: the registered declaration with only
	// that port deleted hashes back to the old pin. (was "10d63d20f9448a")
	"core:task/build-side-character-context@1": "66f7e3d3276d3",
	// Gained the `variables` slot in 0.6-preview (migration 0107), a
	// `speakerRelationships` layout when the graph query was wired in
	// (migration 0111), and lost `narratorName` from its `prompts` slot when
	// the narrator got its own type (migration 0114). Answer 3 above each
	// time, and the only reason it is legitimate is that no third party has
	// pinned this version yet.
	// Both context builders gained `currentCharacterId` with the provider
	// above (migration 0134, shared `contextPorts`): the prompt's voice
	// follows the same recorded speaker decision.
	// Re-projected by **0113** (policy answer 3): four in-ports (D-I).
	// `relationshipsPerspectives` and `relationshipsKnown` are wired by
	// `respond` and named by this type's own `variables` renders, so every part
	// of the round trip was written down except the ports. `speakerName` and
	// `speakerCharacter` are supplied by `bindings.ts`'s side-character
	// wrapper, which calls THIS type's handler with the name and the card
	// spread on — a supplier that is a sibling binding rather than a document,
	// which is exactly why the declaration is the only record that the input
	// surface is wider than the edges.
	//
	// ⚠ `build-narrator-context@1` is **not** re-projected. The four are
	// declared on this type rather than in the shared `contextPorts`: the
	// narrator has no speaker's perspective to build graph context from, so
	// widening the shared map would give it ports it must leave empty forever.
	// Moved by the `state` in-port: templates read `state.world.weather` off
	// the resolved session state, which nothing could supply before.
	// Moved (U5g, R-18, 2026-09-16): a `speaker` in-port — the participant
	// reference — so an envoy's card (name, description off the genre's
	// declaration the cast read carries) compiles where a cast member's
	// would, through the `speakerName`/`speakerCharacter` seam. A
	// `character:` reference changes nothing. (was "6b960498d9527")
	// Moved 2026-09-27 (lair pass B17): a `turnDirection` in-port — what the
	// person typed with Trigger trap or Reveal, rendered `{{turnDirection}}`
	// as `build-scene-context@1` does. Only that port was added. (was
	// "1a11717a9bff7a")
	// Moved 2026-09-27 (owner ruling "Fix"): `bands` and `portSchemas` are
	// contract — they decide what a template may reference — so its declared `portSchemas` (out main/templateContext)
	// is now hashed (still read from the row's policy). Nothing else moved:
	// with it excluded the descriptor hashes to the old pin. (was "1b6f655fa71f47")
	// Moved 2026-09-28 (lair re-plan R6): two in-ports declared on this type
	// alone, unwired on every spec but the Lair's Sanctum branch —
	// `locationEntries` (the rooms) and `recentStory` (the story's newest
	// rows, as prose). Proven: the descriptor with only those two ports
	// deleted hashes to the old pin. (was "bc647c1553e26")
	// Moved 2026-09-28 (lair re-plan R13): two in-ports on this type alone —
	// `fields` (the genre fields, `{{sanctumSteers}}` for the Castellan) and
	// `scratchpad` (the Castellan's own notes). Proven: the descriptor with
	// only those two ports deleted hashes to the old pin. (was "f3b1eb062b5a1")
	// Moved 2026-10-02 (author's note AN1): `TEMPLATE_CONTEXT_SCHEMA` (its
	// hashed `portSchemas`) declares the optional `authorsNote` the builder
	// carries to Assemble. (was "a684804f023dc")
	"core:task/build-template-context@1": "1211721006a38a",
	/**
	 * The Adventure genre's three agent surfaces onto that same builder.
	 *
	 * New types, not edits — nothing above moves for them. They exist because a
	 * shipped prompt is resolved per (node type, slot) per spec: four agents
	 * sharing one context type would ship four agents one set of instructions,
	 * so four surfaces is four pools is four editable prompts. `build-scene-
	 * context@1` is the one with a `plan` port and `build-keeper-context@1` the
	 * one with `reply` and the `afterWrite` ordering edge.
	 */
	// Both moved 2026-09-27 (lair pass B11, Lair half): an additive
	// `direction` in-port — what the person sent, for a genre whose composer
	// is instructions — rendered as `{{direction}}`. Additive: every spec
	// that leaves it unwired builds as before.
	// (was "cb8d07e357492" and "1f1aa57b4caed2")
	// Both moved again 2026-09-27 (lair wave 3): the in-port renamed
	// `direction` → `turnDirection` (R1: `direction` is the Lair's
	// standing-note slot), and an additive `locationEntries` in-port (B13) —
	// a lorebook-entries listing rendered as `{{knownLocations}}` and
	// `{{locationEntry}}`. Only those two ports moved them.
	// (was "1f6d041a389991" and "dc1850c1ba833")
	// Both moved 2026-09-28 (lair re-plan R13): the `sideTalk` in-port (the
	// Sanctum talk since the story's last line, `{{sideTalk}}`) on both, and
	// `scratchpad` (`{{scratchpad}}`) on the planner. Proven: each descriptor
	// with only those ports deleted hashes to its old pin.
	// (was "152c3965ec862a" and "30b7bc4427e4d")
	// Both moved 2026-09-29 (genre plan F6(a)): an additive `castRelationships`
	// in-port (`S.candidates`, the ranker's allocation) rendered as
	// `{{castRelationships}}` — how the cast stand with each other, for the game
	// master's two agents only. Proven: each descriptor with only that port
	// deleted hashes to its old pin. (was "3ada6d27fc92f" and "b8a0eaecd7649")
	"core:task/build-planner-context@1": "17ad9c92aaac9a",
	// Moved 2026-09-30 (Lair party speech, owner ruling): an additive
	// `partySpeakers` in-port (`S.json`, side-character facts read flat)
	// rendered as `{{partySpeakers}}` — whose lines the Castellan's party call
	// writes. Proven: the descriptor with only that port deleted hashes to its
	// old pin. (was "179a221d8168a8")
	// Moved 2026-09-30 (place sight, owner ruling): a `placeSight` in-port —
	// `'reach'`, the place the scene is at and the places one way from it,
	// read by the Lair's Castellan speaking for the party. Additive. Proven
	// with create-message's. (was "bc25ffbd21a10")
	"core:task/build-scene-context@1": "18bfc96d9426b0",
	"core:task/build-keeper-context@1": "17dab50617992b",
	/**
	 * A model's JSON answer, read back as data — the other half of asking for
	 * structure. `optional`, so a reply nobody can read subtracts the structure
	 * and not the turn.
	 */
	"core:task/parse-json@1": "641e92e749ec8",
	// Moved (U5f, R-15 *Staleness and order*, 2026-09-17): a `base` in-port
	// (the state version the changes are deltas against) and a `refused`
	// out-port (the sentences `main.refused` always carried — a slot that
	// moved since the base lands there in `apply` mode). Additive: every
	// pin keeps `changes` · `scope` · `applied` · `proposed`.
	// (was "9628110ba5c34")
	// Moved 2026-09-28 (lair re-plan R8): an optional `worldRow` in-port —
	// the row this run wrote that world-owned changes are filed at (the
	// Lair's Sanctum beats row). Proven: the snapshot entry with that port deleted hashes back to the old pin. (was "1566850749f34")
	// Moved (enum member labels, 2026-09-29): `mode` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1093d0a080288c")
	"core:task/set-state@1": "6f569ab24f4f3",
	/**
	 * The names a model used, resolved against this session's cast. A Query
	 * because resolving a name is a read; the same `ownerFor`/`slotFor` the
	 * three state tools use, reached from a JSON block instead of a tool call.
	 */
	// ⚠ MOVED: one declared in-port, `plan`, carrying the planner's world hints
	// — a required part of the plan's schema that no node read, so a turn that
	// planned a location left the world strip empty.
	// Moved (U5f, R-15 *Staleness and order*, 2026-09-17): a `base` in-port,
	// passed through onto every resolved change so `set-state` can rebase
	// each one. Additive. (was "16e758af287e3d")
	// Moved (attributes phase 3b, 2026-09-26): a `supply` in-port — the
	// item-supply answer a genre wires to refuse an item line past what is
	// left; the item arm now resolves onto the inventory stat. Additive.
	// (was "1d3741c19b7463")
	// Moved 2026-09-28 (lair re-plan R10, whisper recipients): an `owners`
	// in-port (`participant-refs@1`) — who an owner-less change is for, made
	// once per reference; the Whisper's recipients. Additive. Proven: the
	// registry entry with only that port deleted hashes to the old pin.
	// (was "1043888051f27a")
	// Moved 2026-09-30 (stat ownership, owner ruling): a `keeps` in-port —
	// whose stats this keeper keeps (`'world'`, or one participant
	// reference); a change to any other owner is refused. Additive. Proven
	// with create-message's. (was "8e48a372c8f42")
	"core:query/resolve-state-changes@1": "1f628fee792deb",
	// Moved (R-8, 2026-09-15): a `connection` slot, shared with the generating
	// step in every shipped spec, so the ONE window computation reads the
	// model's own window (0114) off the same pair the request goes out on.
	// (was "efdd9a915c681")
	"core:task/context-budget@1": "1949a34d1d682",
	// Re-projected by 0191 (policy answer 3). Two changes, one hash move: the
	// dead `strategy` and `dedup` parameters are gone — the binding read
	// neither, `strategy` was 0.5's engine choice that wiring replaced, and
	// `dedup` described what rank fusion does unconditionally — and the node
	// gained a `diagnostics` out-port, which is where it now says so when its
	// input orderings turn out to be disjoint.
	"core:task/merge-candidates@1": "2dc1eda4715b3",
	// The node the three lore gather branches wanted all along: concatenation, stamping
	// no score, so `rank-hybrid` still has signals to score and share bands to
	// budget between. A **new** type — a row inserts and conflicts with
	// nothing, so it needs no re-projection of its own.
	//
	// One implementation beside the merge above, declared under its own id —
	// and since V6 the id is contract, so the two read two hashes where they
	// read one (ports alone, no slots, was all the material had to tell them
	// apart by).
	"core:task/concat-candidates@1": "16fda337949636",
	// New 2026-10-02 (lorebooks C2, R2/R4): the gates between the mechanisms
	// and the ranker — exclusions, secrecy, presence — marking
	// `Candidate.ineligible`, never deleting. A new type: no re-projection.
	"core:task/eligibility@1": "85ca266c8f6c5",
	// Re-projected by **0106** (policy answer 3). It gained a
	// `continuationPrefill` IN-port — and the seam it feeds is older than the
	// port: `prompt/messages.ts` has put `input.continuationPrefill` on the seed
	// line (the `-2` placeholder the model continues from) since it was written,
	// and `runtime/bindings.ts` has passed it through, with NOTHING able to
	// supply a value because the declaration had no port for one. So a continue
	// sent an empty seed, got a fresh reply, and the socket glued the partial on
	// afterwards. The declaration is what was missing (ruling 2026-09-08, D-2).
	"core:task/process-messages@1": "11460213d98113",
	// The same conversation for a step that READS it: no seed line, and no JSON
	// blocks left by an earlier turn for the next model to imitate. Both are
	// properties of the transcript rather than of the request, which is why they
	// are a node and not a flag on a provider: by the time a completion prompt is
	// rendered the seed is an open block inside one string.
	"core:task/prose-transcript@1": "1faa916f51a8e2",
	// 🚧 New 2026-10-02 (composer attachments phase 4, PLAN §3.5): a
	// transcript's files by message, and where each line's files go — a media
	// marker the call can read, a text file inlined, or a name.
	"core:query/history-attachments@1": "1af76901817d05",
	"core:task/place-attachments@1": "e09e819d9ff6b",
	// (was "74c7f9fc461f") — 2026-09-29, genre uplift C3: gains `searchByMeaning`
	// (boolean, default false, `quick`), the semantic mechanism's one switch, on
	// the chain's first node so an off arm cuts no probes and embeds nothing.
	// (was "1fc11e6254a0fd") — 2026-09-29, genre uplift F1 (owner: one
	// EXPENSIVE call per turn, local models don't count): `searchByMeaning`
	// becomes `auto | on | off`, default `auto`, and the node gains a
	// `connection` slot (the embed step's, by reference) whose connection group
	// `auto` reads. Proven: contracts/src copied with only that edit reverted
	// hashes back to the old pin. Held 2026-09-30 (owner: never skip a paid
	// service for retrieval): `auto` now reads only whether that slot resolves
	// — any embedding model set up searches — and only display text moved,
	// which is stripped before hashing.
	// Moved 2026-10-05 (owner ruling D-c): the `connection` slot states its
	// own kind — `shape` embeddings, `requires: ['text->embedding']` — where
	// it was wired by reference to the embed step's, which no longer declares
	// one. Held at the active embedding connection (`config/heldSlots.ts`).
	// (was "15ef89ff8f32d7")
	"core:task/query-windows@1": "163334e27456c",
	// Re-projected by **0201**, and it is the one type in that migration nobody
	// set out to touch. Ruling R6 removes per-source floors — *"lore competes on
	// score alone"* — which narrows `minEntries` from the five bands to
	// `messages` only; that field lives on the shared `rankSlots`, so this type
	// re-hashes with `rank-hybrid` below. Noted rather than worked around: the
	// alternative is a second copy of the whole rank slot declaration, and 0195
	// records why `lorebook-triggers` keeping its own duplicate is tolerable
	// only because the two overlap in a single field name.
	// Both re-projected by migration 0146. rank-hybrid gained the nine
	// signal-weight fields — the tuning matrix `weights.ts` always held but
	// nothing declared; rank-semantic gained `sourceBudget` and
	// `defaultSourceBudget`, its last two undeclared constants. Every default
	// reproduces the shipped constants exactly, so an untouched spec selects
	// identically — `nodeParams.test.ts` and the parity corpus are the checks.
	//
	// Re-projected again by the pre-squash **0196** (`0196_score_led_allocation`,
	// archived) (policy answer 3): `scoreLedAllocation`,
	// the declared switch between the two allocation precedences (design §7).
	// `SelectOptions.scoreLedAllocation` was built and tested with no runtime
	// caller at all — this node is the only runtime `select()` there is — so
	// the inversion was reachable only from a unit test. It ships **false**,
	// the `admitThreshold` convention: an upgraded install selects exactly what
	// it selected before, and the parity corpus keeps measuring the shipped
	// path. The hash still moves, because a declared field is contract whatever
	// its default. `rank-by-recency` above is untouched — the field is spread
	// onto this type alone, like the signal matrix and for the same reason.
	//
	// Re-projected again by **0199**: a tenth signal weight, `signalProximity`
	// — how tightly an entry's matched keys clustered in the window, which
	// `signalKeyword` cannot see because it counts *how many* keys matched and
	// never *where*. The number is computed on every scan whatever this weight
	// is (it falls out of the key walk that was already happening), so the
	// weight is the only thing that decides whether it counts — and it is **0
	// in every band**. `rank-by-recency` is untouched again, and for the same
	// reason.
	//
	// Re-projected again by **0201** (policy answer 3), three changes and one
	// hash:
	//
	//   * `mechanismWeights` — the grouped keyword / semantic / name strengths
	//     (retrieval plan phase 3). The nine weights above are the right data at
	//     the wrong altitude, and this is the altitude a reader starts at. All
	//     three default to **1, which is neutral rather than maximum**: a
	//     multiplication by one is what already happened, so an untouched
	//     install scores exactly what it scored before. A new control *type*
	//     (`strengths`) rather than a `share`, because raising one takes nothing
	//     from the others and drawing them alike would teach the wrong
	//     arithmetic.
	//   * `signalSemantic` — an eleventh signal weight, for the cosine the
	//     semantic mechanism attaches. **Not zero**, unlike `signalProximity`, and
	//     deliberately: the *mechanism* ships off, so nothing carries the signal until
	//     somebody turns the mechanism on, and zeroing both would make raising the cap
	//     do nothing.
	//   * `minEntries` narrowed to `messages` (R6), shared with
	//     `rank-by-recency` above.
	//
	// Re-projected **again** by **0202** (retrieval plan phase 4), for one
	// field: `signalEntityVector`, a twelfth signal weight carrying the
	// mention→name link. 0.2 in the three lore bands, sized **strictly below**
	// `signalNameMatch`'s 0.25 as a rule rather than a preference — exact and
	// trigram matching own invented names, entity vectors own descriptive
	// references, and a similarity cannot exceed 1, so the link can never
	// outrank an entry whose title literally occurred.
	//
	// ⚠ `rank-by-recency` is **not** re-projected this time, unlike in 0201.
	// `SIGNAL_WEIGHT_FIELDS` is spread onto this type alone; only `rankSlots`
	// is shared, and it did not move.
	//
	// Re-projected by **0099**: `signalRecency` and `signalSceneAffinity` are
	// **culled**. Nothing has ever written `signals.recency` or
	// `signals.sceneAffinity` on any path in any release, so both weights
	// multiplied a permanent zero while being declared, transposed, scored,
	// persisted and rendered. `signalDensity` survives the same audit because it
	// now has a producer — the scan writes `density` on every candidate, as it
	// already wrote `proximity`. `runtime/signalWiring.int.test.ts` is what
	// makes that pair of facts a CI failure rather than a second audit.
	//
	// ⚠ `rank-by-recency` is again **not** re-projected: `SIGNAL_WEIGHT_FIELDS`
	// is spread onto this type alone.
	// Re-projected by **0113** (policy answer 3): a `groups` OUT-port (D-H).
	// `select()` has always returned what each band was allotted, spent and
	// filled, and the binding has always published it on this key — with
	// nothing declared, nothing downstream could learn it existed.
	//
	// ⚠ `rank-by-recency` and the `rank-recall` example are again **not**
	// re-projected: the port is spread onto this type alone, like
	// `SIGNAL_WEIGHT_FIELDS` and the `scripts` hook. Neither computes per-band
	// usage, and a port they cannot fill would be a promise neither keeps.
	// Moved (R-7 P5, 2026-09-16 — U3b): `share`, `maxEntries` and
	// `minEntries` — the five-band maps 16 §5a rejected — are gone from the
	// ranker and declared on the five sources; `shareNormalisation` (relative,
	// the shipped arithmetic) joins the cross-source set. Migration 0135 moves
	// the stored maps. (was "a4ba08bbc5618")
	// Moved (enum member labels, 2026-09-29): `shareNormalisation` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "876a234180ff9")
	// Moved 2026-10-02 (lorebooks Wave 8): the `shownElsewhere` in-port — entry ids
	// a prompt shows in a slot of their own, ruled out before ranking (the room
	// rule). Edited in place; no migration (the slug's pointer moves at boot). (was
	// "125d3aaf08a75f")
	"core:task/rank-hybrid@1": "5013ea258d836",
	// Moved (R-12, 2026-09-16): `params.currentWindow` / `recentWindow` are culled from
	// the ranker — they size the two windows `query-windows@1` cuts and
	// declares as its own; here they were rendered twice and read once.
	// `withDefaults` still fills both for the `SemanticParams` shape, so the
	// ranker's arithmetic is byte-identical. (was "d3849f48f8442")
	"core:task/rank-semantic@1": "cf206e2efccf8",
	// The four next-speaker strategies (19 §5, U-C4) — one implementation,
	// four ids, four hashes: the id is contract (V6), and the family shares
	// everything but that.
	// Moved, all four (U5a, R-18 (3), 2026-09-16): a `speaker` in-port — the
	// explicit pick as a participant reference, which is the only way an
	// envoy can be picked — and a `speaker` out-port beside `characterId`,
	// so the receipt and the wiring carry the reference; the bare id stays
	// for the context and generation readers. (was "cadef103232f2")
	// ⚠ All six moved again at A6 (PLAN-turn-order §4.4, 2026-09-22): the
	// strategies are re-ported over turn order as STATE — `candidates` and
	// `messages` in, `turn-entries@1` out on `main` and `order`, and no
	// `speaker`/`characterId` in-ports at all, because an explicit pick
	// never enters a strategy any more (it fires the entry, §4.6).
	// `turn-none@1` is deleted (§7, renamed to `turn-manual`) and
	// `turn-narrator@1` joins them.
	"core:task/turn-round-robin@1": "19e0f487d4e182",
	"core:task/turn-random@1": "1bf5ca2130f332",
	"core:task/turn-user-split@1": "1f8697aaf316c4",
	"core:task/turn-scripted@1": "74526c62974cd",
	"core:task/turn-manual@1": "125603eaa6f9a8",
	// The turn-order model path (R41, M4).
	"core:oracle/turn-advise@1": "ce040959fde78",
	"core:task/turn-narrator@1": "166b99ce8c8dcf",
	/**
	 * The pool and the first orderer (§4.4): who may be seated at all, and
	 * the mentioned rule that sorts whoever was named to the front. New at
	 * A6, so they freeze here on the same terms as everything else.
	 */
	// Moved (enum member labels, 2026-09-29): `characters` · `personas` · `envoys` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "4a8e6145972ba")
	"core:task/turn-pool@1": "d6ab8b813bf74",
	"core:task/turn-mentioned@1": "14877e0d91b65e",
	/** The one write path for `metadata.turnOrder` (§4.2). */
	"core:outlet/set-turn-order@1": "1147dd9013c784",
	/** The session's annex (§4.3, R6) — the pipeline layer's own memory. */
	/**
	 * The session-event inlet (§4.1, §4.4): the door every event-driven
	 * spec enters through, locked over several events at once.
	 */
	// E1 (2026-09-23): also reads the recorded-event envelope. Was "13b58d70fb2f59".
	"core:inlet/session-event@1": "124b78685ea899",
	// V1 (2026-09-23): the AI view (`view`, `speaker`).
	"core:query/session-annex@1": "2e774d630cb76",
	// Moved 2026-09-27 (no back-compat before distribution, owner ruling): the
	// `see` in-port and `audienceFrom` are gone — the audience stored is the
	// annex declaration's. Nothing else moved: with the port and the contract
	// key put back the descriptor hashes to the old pin (was "1f42d118c9b036").
	"core:outlet/set-session-annex@1": "7bc796f8c8b43",
	// 2026-09-26: annex fields — the one write every declared field goes through.
	"core:outlet/set-annex-field@1": "18bd0af3e04563",
	/** Recording a declared event (E1, R45/R47): the write whose event its literal names. */
	"core:outlet/record-event@1": "5b03e0d2f7394",
	// The `test:` fixtures are published by the same module as everything else,
	// so a running instance has rows for them and they freeze on exactly the same
	// terms. Editing one to suit an SDK test would stop pipelines on every
	// upgraded install — which is worth knowing before it happens, not after.
	"test:query/network@1": "89bfd7d0b9c91",
	"test:task/bad-toggleable@1": "1b049c5454ccd9",
	"test:task/gate@1": "287eb5a95fdb9",
	// ── Scripts (18) ────────────────────────────────────────────────────
	//
	// Published into the same registry under the same freeze rule. The seven
	// core contracts of 18 §3, one content scope per group.
	"core:script:text/transform@1": "168985a29d3b67",
	"core:script:text/stop@1": "11bbc3440d6195",
	"core:script:messages/inject@1": "6bdac9278679f",
	"core:script:messages/transform@1": "fb7dd6e01540b",
	"core:script:candidates/filter@1": "160e74129e402f",
	"core:script:candidates/rescore@1": "17bf99d12e564e",
	"core:script:context/transform@1": "e188343d13ee7",
	// The cast scope (2026-08-26): scripts over what extract-cast publishes.
	// A new type — inserts a row, conflicts with nothing, needs no migration.
	"core:script:cast/transform@1": "9abc9e28e8c41",
	"core:script:turn/select@1": "1eb4afff5c269d",
	// Local image generation: the modality twin of generate-text, same node kind,
	// its shape naming which one. A new type — inserts a row, needs no migration.
	// Gained a `params` slot, holding `streaming` alone — the node had none, so
	// the slot moves with the parameter. `off` means one request with no
	// progress polling and no previews.
	// Moved (enum member labels, 2026-09-29): `streaming` gained `members` — a label
	// and hint per option, so the Pipelines panel stops showing raw values. Display
	// text inside a slot schema is hashed; nothing pinning it moves. (was "1ec57f509dd81f")
	"core:oracle/generate-image@1": "101bafcc9f5eab",
	// ── Entry types (Part 1) ────────────────────────────────────────────
	//
	// A lorebook row's kind, declared and versioned instead of being the table
	// it sat in. New types — a row inserts and conflicts with nothing, so no
	// re-projection migration is involved. What *is* worth knowing is what
	// moves these hashes: roles, render, source kind, export key, the anchor
	// policy and the declared `fields` schema are all contract, so changing any
	// of them is `@2` and not an edit here.
	"core:entry/world-lore@1": "100f8933de881b",
	// Moved 2026-09-30 (same ruling): `render` names `core:var/character-lore@1`
	// in place of the `character-card` destination. With it put back the
	// descriptor hashes to the old pin (was "50f9370f3ab1").
	"core:entry/character-lore@1": "16fb98fc8626a4",
	// A15 (2026-09-30): month and day take the story-time rule's range
	// (`STORY_TIME_PART_RANGES` — a floor of 1, no ceiling) instead of a
	// Gregorian 1–12 / 1–31 that refused dates the book's calendar allows.
	// Kept at `@1` under the pre-0.7 version freeze; the pointer moves at
	// boot, and 0198 drops the CHECK projected under the old range.
	// (was "64444542921c6")
	// A15 follow-up (2026-09-30): `day` declares `narrows: "month"` — a day
	// needs a month, projected into the history CHECK. Same `@1` under the
	// freeze; 0207 drops every projected CHECK so the next boot re-projects.
	// Proven: the snapshot with `day.narrows` removed hashes to the old pin.
	// (was "14f631ac57def2")
	// Note 1 (owner, 2026-10-02): drops the `parent` field role — history is
	// always top level relative to other lore, never filed under another
	// entry. Same `@1` under the freeze; the app asks the role map
	// (`declaresParent`), and the history-anchor clear migration empties any
	// stored filing. (was "c52dca49f40fd")
	"core:entry/history@1": "1d2cdefaa3b6d2",
	// NEW (L3, 2026-09-17): a place the story can be in, and can be walked out
	// of. World lore's roles and fields, the `worldLore` band, rendered by the
	// world-lore variable — what earns it a type is that a place is a thing
	// other places are next to. ⚠ No `exits` field and no `exportKey`: exits
	// are link rows (the settings language has no reference type, so a field
	// could only hold names with no foreign key and no cascade), and the wire
	// vocabulary has no word for a location, so it exports as world lore.
	// Moved 2026-09-29 (places plan B2, owner ruling 2026-09-29): drops the
	// `parent` field role — a place is never filed under anything; places join
	// by relationships. Edited in place at `@1` under the freeze (SDK versions
	// frozen until 0.7.0); the app asks the role map (`declaresParent`), and
	// 0195 already cleared every place's anchor. Proven: the snapshot entry
	// with `roles.parent: 'anchorEntryId'` restored hashes back to the old pin.
	// (was "1d81270e5347d7")
	// A26 (2026-09-30): declares `exportKey: "location"` — a place travels as a
	// place (`ENTRY_EXPORT_KEYS` gained the word), so the paragraph above's "no
	// `exportKey`, exports as world lore" holds only for the 0.5-compat export
	// profile. Same `@1` under the freeze. Proven: the snapshot with
	// `entryShape.exportKey` removed hashes to the old pin.
	// (was "124df05bc5d692")
	"core:entry/location@1": "98ba6f0d87011",
	// NEW (attributes phase 3a, 2026-09-26): a thing somebody can hold. World
	// lore's roles, band and layout plus `supply` (unique · limited ·
	// unlimited) and `supplyLimit`.
	// A26 (2026-09-30): declares `exportKey: "item"` — an item travels as an
	// item; only the 0.5-compat export profile writes it as world lore. Same
	// `@1` under the freeze. Proven: the snapshot with `entryShape.exportKey`
	// removed hashes to the old pin. (was "1eea67730e8c97")
	"core:entry/item@1": "12c63b4101539c",
	"test:task/passthrough@1": "14f0c9d8aaf7b0",
	"test:task/sloppy-stream@1": "1224877b3fece4",
	"test:task/slow@1": "b227d955f2539"
}

/**
 * `release` is not hashed, so its value here is arbitrary.
 *
 * Script types are included, and have to be: they are published into the same
 * registry under the same freeze rule (18 §2), so a guard that only walked
 * `allDefinitions()` would let a script contract move without anyone noticing —
 * which is the one thing this file exists to prevent.
 */
const current = (): Record<string, string> => {
	const out: Record<string, string> = {}
	for (const entry of snapshotRegistry([...allDefinitions(), ...allScriptKinds()], {
		release: "test"
	}))
		out[`${entry.id}@${entry.version}`] = definitionContentHash(entry)
	return out
}

const WHAT_TO_DO =
	"\n\nA pin now means something different from what it meant at this commit. " +
	"That is shippable — the slug's pointer moves at the next boot and no " +
	"migration is involved — but it must be deliberate: either bump the version " +
	"(the honest answer when the change breaks the specs pinning it), or record " +
	"the new hash here in the same commit as the edit. " +
	"Read the comment above PUBLISHED_HASHES before editing it."

describe("published type content hashes", () => {
	const now = current()

	it("resolves every recorded pin to the hash recorded for it", () => {
		const drifted = Object.entries(PUBLISHED_HASHES)
			.filter(([pin, hash]) => pin in now && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(drifted, drifted.length ? WHAT_TO_DO : undefined).toEqual([])
	})

	it("records every type this build publishes", () => {
		// A new type is safe to add — this only keeps the file complete, so the
		// drift check above stays meaningful as the registry grows.
		const unrecorded = Object.keys(now).filter(
			(pin) => !(pin in PUBLISHED_HASHES)
		)
		expect(
			unrecorded,
			unrecorded.length
				? "\n\nNew type(s). Adding a type needs no migration — add the pin and " +
						"its hash to PUBLISHED_HASHES."
				: undefined
		).toEqual([])
	})

	it("still publishes every type it has published before", () => {
		// Deleting a published version orphans every spec that pinned it, which
		// fails at load rather than at boot. Deliberate removals update this file.
		const missing = Object.keys(PUBLISHED_HASHES).filter(
			(pin) => !(pin in now)
		)
		expect(
			missing,
			missing.length
				? "\n\nType(s) no longer published. Any stored spec pinning one of " +
						"these can no longer be loaded."
				: undefined
		).toEqual([])
	})

	it("ignores display text, which is the promise that lets labels change", () => {
		// The guard is only trustworthy if its exclusions actually hold: if
		// `i18n`/`description` leaked into the hash, every copyedit would read as
		// a contract change and the three tests above would cry wolf until someone
		// stopped reading them.
		const [entry] = snapshotRegistry(allDefinitions(), { release: "test" })
		const before = definitionContentHash(entry)
		const after = definitionContentHash({
			...entry,
			i18n: { name: { en: "Something else entirely" } },
			description: "and a different explanation"
		} as any)
		expect(after).toBe(before)
	})

	it("leaves the substrate's settings slot out, so declaring the switch moved no pin", () => {
		// R-9 (2026-09-16): the projection adds a `settings` slot to every
		// optional or gated row — `enabled`, `review` — for the panel to read
		// like any slot. It is derived from `optional` and `effects`, which are
		// hashed already, so digesting it too would have moved forty-one pins
		// above for a change nobody authored. The row carries it; the hash does
		// not. Both halves asserted, because a strip that also dropped it from
		// the row would pass the second and break the panel.
		const entries = snapshotRegistry(allDefinitions(), { release: "test" })
		const withSlot = entries.filter((e) => "settings" in e.slots)
		expect(withSlot.length).toBeGreaterThan(0)
		for (const e of withSlot) {
			expect(!!e.optional || e.effects === "write" || e.effects === "external").toBe(true)
			const { settings: _settings, ...authored } = e.slots
			expect(definitionContentHash({ ...e, slots: authored })).toBe(
				definitionContentHash(e)
			)
		}
		// And the other direction: a definition with no switch gets no slot,
		// so nothing is projected that the substrate does not read.
		for (const e of entries.filter((e) => !("settings" in e.slots)))
			expect(!e.optional && e.effects !== "write" && e.effects !== "external").toBe(true)
	})

	it("strips a script point's display text, and hashes what it accepts", () => {
		// R-11 (2026-09-16). `accepts` on a point is contract for the reason a
		// port hook's is (S3); its label never was, and until this change the
		// material carried it anyway.
		const entry = snapshotRegistry(allDefinitions(), { release: "test" }).find(
			(e) => e.scriptPoints?.length
		)!
		expect(entry, "no shipped definition declares a point").toBeTruthy()
		const relabelled = {
			...entry,
			scriptPoints: entry.scriptPoints!.map((p) => ({
				...p,
				label: { en: "Jeder Entwurf" },
				description: { en: "anders" }
			}))
		}
		expect(definitionContentHash(relabelled)).toBe(definitionContentHash(entry))
		const widened = {
			...entry,
			scriptPoints: entry.scriptPoints!.map((p) => ({
				...p,
				accepts: [...p.accepts, "core:script:text/stop@1"]
			}))
		}
		expect(definitionContentHash(widened)).not.toBe(definitionContentHash(entry))
	})

	/**
	 * The same promise, two levels down, and against the SDK's answer.
	 *
	 * ⚠ The test above injects display text at the TOP of the entry, which is
	 * the only level the earlier guard exercised the strip at — and that is how core
	 * and the SDK came to disagree without anything failing. A parameter's
	 * display text is **not** spelled `i18n`: settings.ts calls `label` the
	 * canonical key for a field or a member band and `i18n` its deprecated
	 * alias, and those sit inside `slots[].schema`. The SDK's descriptor
	 * registry stripped `label` (`DESCRIPTOR_DISPLAY_KEYS`); core hashed it.
	 * So re-declaring a descriptor with a renamed parameter was a no-op in the
	 * SDK and, here, a `TypeRegistryConflictError` that `bootstrapPipelines`
	 * caught by returning early — silently stopping every pipeline on the
	 * install. The stop is gone (the slug's pointer moves instead), and since
	 * V6 the two sides are one function, `definitionContract` — this test
	 * holds core's hash to the SDK's for the injected label AND for every
	 * shipped definition, so two answers to *is this the same declaration?*
	 * cannot come apart without a red line here.
	 *
	 * ⚠ **No shipped type carries a `label` today**, which is why the
	 * disagreement was latent. That is also why this test injects one:
	 * without it, nothing in the suite can tell the corrected strip from the
	 * old one, and a green suite would be evidence of nothing.
	 *
	 * The control is the half that makes it a test rather than a tautology.
	 * `max` is a range, and a range decides which stored values are still legal
	 * — so both sides must call it material, or "strips display text" would only
	 * mean "answers the same for everything".
	 */
	it("strips a parameter's display text at every level, and agrees with the SDK about which words those are", () => {
		const withParams = allDefinitions().find(
			(t: any) =>
				t.slots?.params?.schema &&
				Object.keys(t.slots.params.schema).length > 0
		) as any
		expect(
			withParams,
			"no shipped type declares a parameters schema, so there is nothing " +
				"to inject a label into and this guard is testing nothing"
		).toBeTruthy()

		const field = Object.keys(withParams.slots.params.schema)[0]!
		/** The descriptor with one extra key on one parameter, deep-copied. */
		const withKey = (key: string, value: unknown) => {
			const copy = JSON.parse(JSON.stringify(withParams))
			copy.slots.params.schema[field][key] = value
			return copy
		}
		const coreHash = (d: unknown) =>
			definitionContentHash(
				snapshotRegistry([d as any], { release: "test" })[0]!
			)
		const sdkHash = (d: unknown) => definitionContractHash(d as Descriptor)

		const base = withKey("__unused", undefined)
		for (const word of [
			"i18n",
			"description",
			...(DESCRIPTOR_DISPLAY_KEYS.display ?? [])
		]) {
			const renamed = withKey(word, { en: "Höchste K" })
			expect(
				coreHash(renamed),
				`core hashed a parameter's \`${word}\`, so translating it is a ` +
					`frozen-type conflict on every upgrading install`
			).toBe(coreHash(base))
			expect(
				sdkHash(renamed),
				`the SDK hashed a parameter's \`${word}\` — the two strips have ` +
					`come apart again`
			).toBe(sdkHash(base))
		}

		// The control: a range is contract on both sides.
		const widened = withKey("max", 999_999)
		expect(coreHash(widened)).not.toBe(coreHash(base))
		expect(sdkHash(widened)).not.toBe(sdkHash(base))

		// And the whole registry: core's hash of a row IS the SDK's hash of
		// the descriptor it was projected from, definition by definition.
		for (const d of allDefinitions())
			expect(coreHash(d), d.id).toBe(sdkHash(d))
	})

	/**
	 * Contract moves a pin; policy does not (plans/31 V6, 2026-09-17).
	 *
	 * The one rule this table is read under: *what runs is contract; what is
	 * offered is policy.* Each half is asserted on a shipped definition rather
	 * than a fixture, so the check is against the declarations that are
	 * actually published — and against the SDK's list of policy keys, so a
	 * key classified there is exercised here without a second list.
	 */
	it("moves for a port, for review.fields — and not for provisional, timeoutMs or any policy key", () => {
		const generate = getDefinition("core:oracle/generate-text@1")!
		const hashOf = (d: Descriptor) =>
			definitionContentHash(snapshotRegistry([d], { release: "test" })[0]!)
		const before = hashOf(generate)

		// Policy: the flag that U6 hashed on purpose, and the timeout.
		expect(hashOf({ ...generate, provisional: true })).toBe(before)
		expect(hashOf({ ...generate, timeoutMs: (generate.timeoutMs ?? 0) + 1 })).toBe(before)
		// Every policy key, moved to a value it does not hold.
		const moved: Record<(typeof DESCRIPTOR_POLICY_KEYS)[number], unknown> = {
			i18n: { name: { en: "Renamed" } },
			reviewDefault: generate.reviewDefault === "on" ? "off" : "on",
			toggleable: !generate.toggleable,
			provisional: true,
			public: !generate.public,
			timeoutMs: 1,
			timeoutKind: generate.timeoutKind === "idle" ? "wall" : "idle",
			usage: "somewhere.else"
		}
		for (const key of DESCRIPTOR_POLICY_KEYS)
			expect(hashOf({ ...generate, [key]: moved[key] }), key).toBe(before)

		// Contract that rides the row's policy (owner ruling "Fix",
		// 2026-09-27): what a source names as template variables, and what a
		// port's payload holds — each hashed through the row, so a plugin
		// update that changes them moves the pin, and the same declaration
		// does not.
		const band = (id: string) => ({ id, scope: { secretEntry: "any" }, sample: null })
		const withBands = hashOf({ ...generate, bands: { secretEntry: band("test:var/secret-entry@1") } } as Descriptor)
		expect(withBands).not.toBe(before)
		expect(hashOf({ ...generate, bands: { secretEntry: band("test:var/secret-entry@1") } } as Descriptor)).toBe(withBands)
		expect(hashOf({ ...generate, bands: { secretEntry: band("test:var/secret-entry@2") } } as Descriptor)).not.toBe(withBands)
		const withSchema = hashOf({ ...generate, portSchemas: { out: { main: { type: "string" } } } } as Descriptor)
		expect(withSchema).not.toBe(before)
		expect(hashOf({ ...generate, portSchemas: { out: { main: { type: "string" } } } } as Descriptor)).toBe(withSchema)
		expect(hashOf({ ...generate, portSchemas: { out: { main: { type: "number" } } } } as Descriptor)).not.toBe(withSchema)

		// Contract: a port, and the review fields.
		expect(
			hashOf({
				...generate,
				ports: { ...generate.ports, in: { ...generate.ports.in, extra: "core:shape/text@1" } }
			})
		).not.toBe(before)
		expect(hashOf({ ...generate, review: { fields: ["context"] } })).not.toBe(before)

		// And the three flagged definitions, bound: no pin above moves.
		for (const id of ["core:oracle/speak@1", "core:oracle/mcp-tool@1", "core:oracle/mcp-resource@1"]) {
			const d = getDefinition(id)!
			expect(d.provisional, id).toBe(true)
			const { provisional: _p, ...bound } = d
			expect(hashOf(bound as Descriptor), id).toBe(PUBLISHED_HASHES[id])
		}
	})
})
