/**
 * The frozen-type guard, as a checked-in fact.
 *
 * `syncTypeRegistry` refuses to republish a type version whose content changed,
 * which is the right rule — a spec that pinned `@1` would otherwise keep
 * compiling and start behaving differently. But look at what the refusal *does*
 * on a running instance: `bootstrapPipelines` catches `TypeRegistryConflictError`,
 * puts the message in `report.conflict`, and **returns early**
 * (`bootstrap.ts:90-96`). Specs are never seeded, the legacy migration never
 * runs, and pipelines quietly stop working. Nothing in the test suite notices,
 * because a fresh test database has no prior rows to conflict with — the
 * conflict only exists on databases that booted the *previous* build.
 *
 * So the failure mode is: add a parameter to a descriptor, all tests pass, ship
 * it, and every existing install loses pipelines on the next restart with a
 * message only the diagnostics screen shows.
 *
 * This file is the thing that notices. It records what each published type
 * hashes to today. Editing a descriptor changes its hash, this test fails on a
 * clean database, and the failure message says which of the three legitimate
 * answers applies. It is a snapshot on purpose: the whole point is that it can
 * only be updated deliberately.
 */

import { describe, it, expect } from "vitest"
import { allTypes, allScriptTypes, snapshotRegistry } from "@serene-pub/sdk"
import { typeContentHash } from "$lib/server/pipelines/boot/registrySync"
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

/**
 * `pin -> contentHash`, for every type this build publishes.
 *
 * **Do not update a line here to make a test pass.** A changed hash means the
 * contract of an already-published type version moved, and there are exactly
 * three correct responses:
 *
 * 1. **Bump the version.** Publish `@2` and leave `@1` in place for the specs
 *    pinning it. This is the default answer for a real contract change — a port,
 *    a parameter's default, a range, an enum's options.
 * 2. **You changed only display text.** Labels (`i18n`) and `description` are
 *    stripped before hashing precisely so they can change freely. If the hash
 *    moved, you changed something else too — find it.
 * 3. **You wrote a re-projection migration.** Migrations 0099 and 0106 delete
 *    the affected registry rows so the next boot re-projects them. That is
 *    deliberately narrow, only safe pre-1.0 while the versions in question have
 *    no third-party pins, and must not become the habit. If that is what you
 *    did, update the hash here in the same commit as the migration.
 *
 * Adding a *new* type is safe and needs no migration — just add its line.
 */
const PUBLISHED_HASHES: Record<string, string> = {
	"chariot.comfy:render-image@1": "12d57bdcc7949f",
	"chariot.dice-tray:roll@1": "b7457cf04e36d",
	"chariot.recall:rank-recall@1": "17b9069e6e0b65",
	"core:consumer/attach-audio@1": "2a3ce393ac3d8",
	"core:consumer/attach-image@1": "dce5f172a6edb",
	"core:consumer/create-lore-entry@1": "f8eff8031562c",
	"core:consumer/create-message@1": "1338e0ae6946f",
	"core:consumer/emit-socket@1": "7658edce87c6",
	"core:consumer/graph-proposal@1": "437560532d042",
	"core:consumer/save-plugin-data@1": "1548f67cc814f",
	"core:consumer/update-message@1": "f912a25836fda",
	"core:input/message-created@1": "f90c5108c7e82",
	"core:input/summarize-request@1": "118295257093fb",
	"core:input/user-message@1": "8efb208dbb7a8",
	"core:provider/embed-text@1": "1a2be2fe9ae5a9",
	"core:provider/extract-cast@1": "1893b46d500ce4",
	// Gained `currentCharacterId` in 0.6-preview (migration 0134): the §27l
	// stop-string exclusion follows the next-speaker node's output through
	// the host's payload-wins seam (19 §5).
	"core:provider/generate-text@1": "190742a9f644c5",
	"core:provider/graph-node-description@1": "6f9762a123b0c",
	"core:provider/graph-node-resolution@1": "e769698f56c34",
	"core:provider/graph-perspective@1": "10d6e4b8419763",
	"core:provider/graph-pre-filter@1": "af07bcf5d1b65",
	"core:provider/graph-state-detection@1": "145613287cd09f",
	// Re-pinned when 14 was built out (the draft stub's hash never reached an
	// install — 0141's core wipe re-projects every row at boot).
	"core:provider/mcp-tool@1": "2a4ceca243862",
	"core:provider/mcp-resource@1": "9d9890414a3d8",
	"core:provider/name-entry@1": "1b49a34a5cac88",
	"core:provider/speak@1": "8e5f957ad71f9",
	"core:provider/summarize-batch@1": "1030d47b263042",
	"core:provider/summarize-synth@1": "71b9b65aee561",
	"core:query/session-cast@1": "142e94006413af",
	"core:query/world-lore@1": "110c27164fe03f",
	"core:query/character-lore@1": "110c27164fe03f",
	"core:query/session-history@1": "1cd3ef785272df",
	// ⚠ `core:query/graph-context@1` was here, and is gone rather than frozen.
	// It split into the two below, because one node emitting both directions of
	// the graph gave them one heading, one layout and one switch. Removing a
	// published pin is what the third test in this file exists to catch, and it
	// is allowed here only because 0.6 has not shipped: every stored spec
	// pinning it is a preview document, and `0124` deletes its registry rows
	// along with the specs that named it.
	"core:query/relationships-perspectives@1": "133fb1aab4e288",
	"core:query/relationships-known@1": "1a709dd0599745",
	"core:query/graph-scenes@1": "93cf67e05eb1",
	// The third retrieval lane, added in 0.6 after its absence was found: the
	// split into world and character lore left `history` with no node, so those
	// candidates were read, scored and dropped for two spec versions. A *new*
	// type needs no re-projection — nothing has published it before.
	"core:query/history-entries@1": "110c27164fe03f",
	"core:query/lorebook-probabilistic@1": "6ac9faa6efbb8",
	"core:query/lorebook-triggers@1": "22187c6565f6a",
	"core:query/message-text@1": "13028fee53a4e1",
	"core:query/persona-card@1": "a0b05bce48983",
	"core:query/summarize-source@1": "172011b74d3c72",
	"core:query/vector-search@1": "7da453ddb532",
	// Gained a `variables` slot for its post-budget lore and history in
	// 0.6-preview. Re-projected by migration 0108, on the same terms as 0107.
	"core:task/assemble@2": "ec708761ef260",
	"core:task/batch-messages@1": "1666e1b5864572",
	// The narrator's half of the split (migration 0114). It shares this one's
	// implementation and ports; what makes it a separate type is that it
	// declares a different configurable surface — `narratorName`, and no
	// example-dialogue or relationship layouts. Adding a type needs no
	// re-projection: it inserts a row and conflicts with nothing.
	"core:task/build-narrator-context@1": "131936fee7832b",
	// Gained the `variables` slot in 0.6-preview (migration 0107), a
	// `speakerRelationships` layout when the graph query was wired in
	// (migration 0111), and lost `narratorName` from its `prompts` slot when
	// the narrator got its own type (migration 0114). Answer 3 above each
	// time, and the only reason it is legitimate is that no third party has
	// pinned this version yet.
	// Both context builders gained `currentCharacterId` with the provider
	// above (migration 0134, shared `contextPorts`): the prompt's voice
	// follows the same recorded speaker decision.
	"core:task/build-template-context@1": "2ea90523e3006",
	"core:task/chunk-text@1": "5cef916d3eef",
	"core:task/context-budget@1": "efdd9a915c681",
	"core:task/first-json@1": "13093e6bda129",
	"core:task/merge-candidates@1": "8fb80a93f5f72",
	"core:task/process-messages@1": "8d63ae74798bb",
	"core:task/query-windows@1": "184fdf6f3a0762",
	"core:task/rank-by-recency@1": "dffb14d273fdf",
	"core:task/rank-hybrid@1": "1b57a9620c46d4",
	"core:task/rank-semantic@1": "d6d78af40280e",
	"core:task/render-entries@1": "7541eb6256ba5",
	// The four next-speaker strategies (19 §5, U-C4) — one implementation,
	// four ids, and one hash: the content hash strips display text, and what
	// remains (ports, timeout) is identical across the family, exactly like
	// the three lore lanes above.
	"core:task/turn-round-robin@1": "cadef103232f2",
	"core:task/turn-random@1": "cadef103232f2",
	"core:task/turn-manual@1": "cadef103232f2",
	"core:task/turn-none@1": "cadef103232f2",
	"core:task/to-candidates@1": "174b5c86bb414b",
	// The `test:` fixtures are published by the same module as everything else,
	// so a running instance has rows for them and they freeze on exactly the same
	// terms. Editing one to suit an SDK test would stop pipelines on every
	// upgraded install — which is worth knowing before it happens, not after.
	"test:query/network@1": "c1601e776f664",
	"test:task/bad-toggleable@1": "594a2f094b17a",
	"test:task/gate@1": "cf73634860fe1",
	// ── Scripts (18) ────────────────────────────────────────────────────
	//
	// Published into the same registry under the same freeze rule. The seven
	// core contracts of 18 §3, one content scope per group.
	"core:script:text/transform@1": "14b3b24125511d",
	"core:script:text/stop@1": "1657b41ed5a2be",
	"core:script:messages/inject@1": "10feba4829eab3",
	"core:script:messages/transform@1": "48e7776bf623f",
	"core:script:candidates/filter@1": "5921c6940b28f",
	"core:script:candidates/rescore@1": "5921c6940b28f",
	"core:script:context/transform@1": "1a74f953c2e773",
	"test:task/passthrough@1": "cf73634860fe1",
	"test:task/sloppy-stream@1": "13093e6bda129",
	"test:task/slow@1": "cf73634860fe1"
}

/**
 * `release` is not hashed, so its value here is arbitrary.
 *
 * Script types are included, and have to be: they are published into the same
 * registry under the same freeze rule (18 §2), so a guard that only walked
 * `allTypes()` would let a script contract move without anyone noticing —
 * which is the one thing this file exists to prevent.
 */
const current = (): Record<string, string> => {
	const out: Record<string, string> = {}
	for (const entry of snapshotRegistry([...allTypes(), ...allScriptTypes()], {
		release: "test"
	}))
		out[`${entry.id}@${entry.version}`] = typeContentHash(entry)
	return out
}

const WHAT_TO_DO =
	"\n\nA published type version is frozen. Bump the version, or ship a registry " +
	"re-projection migration (see 0099/0106) and update the hash in the same commit. " +
	"Read the comment above PUBLISHED_HASHES before editing it."

describe("published type content hashes", () => {
	const now = current()

	it("has not changed under any already-published pin", () => {
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
		const [entry] = snapshotRegistry(allTypes(), { release: "test" })
		const before = typeContentHash(entry)
		const after = typeContentHash({
			...entry,
			i18n: { name: { en: "Something else entirely" } },
			description: "and a different explanation"
		} as any)
		expect(after).toBe(before)
	})
})
