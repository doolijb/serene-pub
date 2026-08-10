/**
 * The build derives characters in memory and writes nothing.
 *
 * Before this, Pass 1 was a plain id lookup: a scene whose participantCharacters
 * was `[]` (everything predating cast extraction) resolved nobody, so the
 * description pass, state detection, and perspective extraction were all
 * skipped and the build returned an empty proposal *as a success*. Meanwhile
 * the direct-entry path called resolveCharacterNamesToBindingIds, which
 * CREATES a binding row per unmatched name mid-build — so cancelling or
 * discarding still left new characters behind.
 *
 * Pass 1 now applies one uniform rule (ids → lookup, names → resolve, nothing
 * → extract) and unmatched names become proposed `new_N` nodes held in an
 * in-memory ledger. Nothing reaches the database until apply.
 *
 * graphBuilder takes no db handle at all, so "writes nothing" is structural
 * here rather than asserted against a database — these tests pin the behaviour
 * that makes that possible: dedup without a row to dedup against, and seeds
 * never entering the INSERT set.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const runQueuedLLMCallMock = vi.fn()

vi.mock("./runQueuedLLMCall", () => ({
	runQueuedLLMCall: (...args: unknown[]) => runQueuedLLMCallMock(...args)
}))

vi.mock("./getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		Adapter: class {
			constructor(_opts: unknown) {}
		}
	})
}))

const conn = { id: 1, name: "c", type: "openai_chat" } as any
const sampling = { id: 1, name: "s" } as any
const contextConfig = { id: 1 } as any
const promptConfig = { id: 1 } as any

/** Routes canned responses by the label graphBuilder passes to each call. */
function respondByLabel(map: Record<string, string>, fallback = "{}") {
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		const label: string = opts?.label ?? ""
		for (const [needle, text] of Object.entries(map)) {
			if (label.includes(needle)) return { text }
		}
		return { text: fallback }
	})
}

function scene(id: number, summary: string, extra: Record<string, any> = {}) {
	return {
		id,
		name: `Scene ${id}`,
		summary,
		historyEntryId: id,
		historyEntry: { id, year: id, month: null, day: null },
		participantCharacters: null,
		mentionedCharacters: null,
		...extra
	}
}

const seedAria = {
	id: 10,
	name: "Aria",
	nodeState: "active",
	summary: "a scout",
	aliases: []
}

beforeEach(() => {
	runQueuedLLMCallMock.mockReset()
})
afterEach(() => {
	runQueuedLLMCallMock.mockReset()
})

describe("buildGraphFromScenes — in-memory character discovery", () => {
	test("a scene with no stored cast is extracted from, and an unmatched name becomes a proposed new_N node", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({
			"character extraction":
				'{"participants": ["Aria", "Cassia"], "mentioned": []}',
			"Character Perspective":
				'{"relationships": [{"to": "Cassia", "type": "ally", "description": "d", "visibility": "acknowledged", "status": "active"}]}'
		})

		const result = await buildGraphFromScenes({
			scenes: [scene(1, "Aria and Cassia met.")] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		// Cassia matched no seed, so she is PROPOSED, not created.
		const proposed = result.proposal.nodes
		expect(proposed).toHaveLength(1)
		expect(proposed[0].name).toBe("Cassia")
		expect(proposed[0].tempId).toMatch(/^new_\d+$/)

		// Aria matched a seed and must NOT be in the INSERT set — that would
		// duplicate a binding that already exists, on every apply.
		expect(proposed.some((n) => n.name === "Aria")).toBe(false)
		expect(
			proposed.some((n) => n.tempId.startsWith("existing_"))
		).toBe(false)

		// Before the fix this build produced nothing at all.
		expect(result.proposal.relationships.length).toBeGreaterThan(0)
	})

	test("the same unknown name across two scenes yields ONE proposed node (ledger dedup)", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({
			"character extraction":
				'{"participants": ["Aria", "Cassia"], "mentioned": []}',
			"Character Perspective": '{"relationships": []}'
		})

		const result = await buildGraphFromScenes({
			scenes: [
				scene(1, "Aria and Cassia met."),
				scene(2, "Aria and Cassia met again.")
			] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		const cassias = result.proposal.nodes.filter(
			(n) => n.name === "Cassia"
		)
		// This is the guarantee the old code got by COMMITTING a binding
		// mid-build and re-reading it. The ledger replaces that with a map, so
		// the same dedup happens with zero writes.
		expect(cassias).toHaveLength(1)
	})

	test("case and whitespace variants collapse to one proposed node", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		let call = 0
		runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
			const label: string = opts?.label ?? ""
			if (label.includes("character extraction")) {
				call++
				return {
					text:
						call === 1
							? '{"participants": ["Aria", "Cassia"], "mentioned": []}'
							: '{"participants": ["Aria", " cassia "], "mentioned": []}'
				}
			}
			if (label.includes("Character Perspective"))
				return { text: '{"relationships": []}' }
			return { text: "{}" }
		})

		const result = await buildGraphFromScenes({
			scenes: [scene(1, "one"), scene(2, "two")] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		expect(
			result.proposal.nodes.filter((n) => /cassia/i.test(n.name))
		).toHaveLength(1)
	})

	test("a scene already holding valid binding ids costs NO extraction call", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({ "Character Perspective": '{"relationships": []}' })

		await buildGraphFromScenes({
			scenes: [
				scene(1, "Aria alone.", { participantCharacters: [10] })
			] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		const extractionCalls = runQueuedLLMCallMock.mock.calls.filter(
			([opts]: any) => (opts?.label ?? "").includes("character extraction")
		)
		expect(extractionCalls).toHaveLength(0)
	})

	test("legacy name strings resolve against the seeds without an extraction call", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({ "Character Perspective": '{"relationships": []}' })

		const result = await buildGraphFromScenes({
			scenes: [
				scene(1, "Aria alone.", { participantCharacters: ["Aria"] })
			] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		const extractionCalls = runQueuedLLMCallMock.mock.calls.filter(
			([opts]: any) => (opts?.label ?? "").includes("character extraction")
		)
		// The stored names ARE the recorded cast — re-extracting from the
		// summary would be a lossy replacement for them.
		expect(extractionCalls).toHaveLength(0)
		// Resolved to the existing seed, so nothing new is proposed.
		expect(result.proposal.nodes).toHaveLength(0)
	})

	test("scenes whose cast was derived are reported for write-back; ones with ids are not", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({
			"character extraction":
				'{"participants": ["Aria"], "mentioned": []}',
			"Character Perspective": '{"relationships": []}'
		})

		const result = await buildGraphFromScenes({
			scenes: [
				scene(1, "derived"),
				scene(2, "stored", { participantCharacters: [10] })
			] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})

		expect(result.resolvedSceneCast.map((r) => r.sceneId)).toEqual([1])
	})

	test("a build that resolves nobody anywhere throws instead of returning an empty proposal as success", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		respondByLabel({
			"character extraction": '{"participants": [], "mentioned": []}'
		})

		await expect(
			buildGraphFromScenes({
				scenes: [scene(1, "An empty room.")] as any,
				connection: conn,
				sampling,
				contextConfig,
				promptConfig,
				seedNodes: [seedAria]
			})
		).rejects.toThrow(/Nothing could be extracted/)
	})
})
