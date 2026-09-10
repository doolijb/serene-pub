/**
 * A core spec's shape and its version move together.
 *
 * Seeding matches on `(slug, semver)` and **skips when it finds a match**, so a
 * changed pipeline published under an unchanged version never reaches an
 * install that already booted. The instance keeps running the old document
 * while the code says otherwise, and nothing anywhere reports it.
 *
 * Tests do not catch this on their own: a fresh database publishes whatever the
 * code currently says, so every integration test passes on the new shape while
 * real upgrades silently get the old one. This is the check that a fresh
 * database cannot perform — a recorded hash from the last time the pair was
 * known to agree.
 *
 * Found the hard way. A version bump written as a string replacement matched
 * nothing, because another session had already moved that spec to the version
 * being written; the replace was a silent no-op and the whole change sat behind
 * a version that seeding skipped.
 *
 * ## When this fails
 *
 * You changed a core spec. Bump its `*_VERSION` and record the new hash here,
 * in the same commit. Two lines, and they are the two that have to stay
 * together — this file exists to make forgetting the first one loud.
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
const PUBLISHED: Record<string, string> = {
	// 1.0.0: the standard session type as a create spec (23 §7) — the F29
	// floor's shape moves from the input descriptor to this document.
	"core:spec/create-chat@2.2.0": "fa56525a69fb9",
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
	// (was "127bfb179f55dd", then "13d5772f33e5ec", then "9cfae9a28583f")
	"core:spec/narrate-character@1.0.0": "17c8c28ac7fd7f",
	// (was "b6ba835e86244", then "431aa4254af1", then "12971669b900fd")
	"core:spec/narrate@1.11.0": "bc304a8a52b71",
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
	// (was "1f78a2ce64600", then "1bc665208daf27", then "196d136945332b",
	//  then "1586b6f70f4a1c")
	"core:spec/respond@1.20.0": "1799ea677e50b5",
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
	"core:spec/summarize-world@1.3.0": "84568ea6ee309",
	"core:spec/summarize-character@1.3.0": "1e14d56806d21f",
	// ⚠ `summarize-scene@1.3.0`'s hash MOVED a SECOND time, again under an
	// unchanged version, and again paired with a migration —
	// `drizzle/0104_ice_scene_cast_extraction.sql` deletes its published
	// `pipeline_spec_versions` row so boot republishes it. **A moved hash here
	// with no such migration is still the failure this file is for.**
	//
	// What moved: the `cast` step is gone. `core:provider/extract-cast` is on
	// ice, not deleted (plan §2, ruled 2026-09-08) — the node type, its script
	// hooks and its shipped prompt all survive untouched, and reviving it is
	// restoring one property in the catalog. The scene summarizer stops making
	// an unmeasured LLM call whose participant half is replaced by a roster +
	// speech-gated proposal (100% precision, zero fabrications, no model) and
	// whose mentioned half is derived from `message_annotations` instead.
	// (was "9c990d835747a" between 0102 and this)
	"core:spec/summarize-scene@1.3.0": "c51485ac64a65",
	"core:spec/summarize-history@1.3.0": "12bf9f369f626e",
	"core:spec/graph-build@1.2.0": "1d9e569016efb3",
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
	"core:spec/echo@1.0.0": "155ebfa1de7484",
	// 1.0.0: local image generation end to end — a composer button, the review
	// gate as the prompt entry, and the render posted as a message.
	"core:spec/generate-image@1.0.0": "7be8979159e48"
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

	it("has not changed shape under an already-recorded version", () => {
		const now = current()
		const drifted = Object.entries(PUBLISHED)
			.filter(([pin, hash]) => now[pin] && now[pin] !== hash)
			.map(([pin, hash]) => `${pin}: recorded ${hash}, code ${now[pin]}`)

		expect(
			drifted,
			drifted.length
				? "A published version is frozen. Bump the spec's *_VERSION and " +
						"add the new pin below — seeding matches on (slug, semver) " +
						"and skips, so an unbumped change never reaches an install " +
						"that has already booted."
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
