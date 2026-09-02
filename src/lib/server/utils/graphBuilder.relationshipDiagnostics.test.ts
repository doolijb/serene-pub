/**
 * "No relationships extracted" used to be unattributable.
 *
 * parseCharacterPerspectives had six separate bail-outs — no JSON, unparseable
 * JSON, no `relationships` array, an entry with no type, an entry with no
 * target, and a target naming nobody in the scene — and every one of them was a
 * bare `return []` / `continue`. graphBuilder contained no logging at all, and
 * the only user-facing output was the static string "No relationships
 * extracted." So a build that produced nothing looked identical whether the
 * model had abstained or the parser had discarded everything it returned, and
 * telling those apart required a re-run and a guess.
 *
 * These pin the attribution: each drop path lands in its own bucket, an honest
 * abstention lands in none of them, and the pair guard reports itself.
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

const conn = { id: 1, name: "c", type: "openai_session" } as any
// A real post-0171 row: a shape naming its vocabulary, values, and the
// switchboard saying which of them are in play. The `as any` used to hide
// that this literal was not a row at all.
const sampling = {
	id: 1,
	name: "s",
	shape: "core:shape/text-gen@1",
	values: {},
	enabled: []
} as any
const contextConfig = { id: 1 } as any
const promptConfig = { id: 1 } as any

function respondByLabel(map: Record<string, string>, fallback = "{}") {
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		const label: string = opts?.label ?? ""
		for (const [needle, text] of Object.entries(map)) {
			if (label.includes(needle)) return { text }
		}
		return { text: fallback }
	})
}

const seedAria = {
	id: 10,
	name: "Aria",
	nodeState: "active",
	summary: "a scout",
	aliases: []
}

function scene(id: number, summary: string) {
	return {
		id,
		name: `Scene ${id}`,
		summary,
		historyEntryId: id,
		historyEntry: { id, year: id, month: null, day: null },
		participantCharacters: null,
		mentionedCharacters: null
	}
}

/** One build over one scene, with the cast and perspective replies supplied. */
async function build(cast: string, perspective: string) {
	const { buildGraphFromScenes } = await import("./graphBuilder")
	respondByLabel({
		"character extraction": cast,
		"Character Perspective": perspective
	})
	return buildGraphFromScenes({
		scenes: [scene(1, "Something happened.")] as any,
		connection: conn,
		sampling,
		contextConfig,
		promptConfig,
		seedNodes: [seedAria]
	})
}

const TWO_PRESENT = '{"participants": ["Aria", "Cassia"], "mentioned": []}'

/**
 * One present character, one mentioned — so exactly ONE perspective call is
 * made, from Aria. Needed wherever a test asserts on the source field: with two
 * present characters the single canned reply is served to both perspectives, so
 * a reply naming Aria as its source is legitimately a wrong-source entry for
 * Cassia's call, and `wrongSource` could never be zero.
 */
const ONE_SOURCE = '{"participants": ["Aria"], "mentioned": ["Cassia"]}'

beforeEach(() => runQueuedLLMCallMock.mockReset())
afterEach(() => runQueuedLLMCallMock.mockReset())

describe("relationship diagnostics attribute an empty result", () => {
	// Each case names the bucket that must catch it. Asserting the sibling
	// buckets stay zero is the real content — a tally that counted everything
	// as "badJson" would be worse than no tally.
	const cases: Array<{ bucket: string; reply: string }> = [
		{ bucket: "noJson", reply: "I could not find any relationships." },
		{ bucket: "badJson", reply: '{"relationships": [oops]}' },
		{ bucket: "notArray", reply: '{"relationships": "none"}' },
		{
			bucket: "missingType",
			reply: '{"relationships": [{"to": "Cassia"}]}'
		},
		{
			bucket: "missingTarget",
			reply: '{"relationships": [{"type": "ally"}]}'
		}
	]

	test.each(cases)(
		"$bucket is counted on its own",
		async ({ bucket, reply }) => {
			const result = await build(TWO_PRESENT, reply)
			const d = result.relationshipDiagnostics

			expect(result.proposal.relationships).toHaveLength(0)
			expect(d.perspectiveCalls).toBeGreaterThan(0)
			expect(d[bucket as keyof typeof d]).toBeGreaterThan(0)

			for (const other of cases.map((c) => c.bucket)) {
				if (other === bucket) continue
				expect(d[other as keyof typeof d]).toBe(0)
			}
			expect(d.unresolvedTargets).toEqual([])
			expect(d.wrongSource).toBe(0)
		}
	)

	test("an unresolvable target is reported BY NAME, not just counted", async () => {
		const result = await build(
			TWO_PRESENT,
			'{"relationships": [{"to": "Commander Thorne", "type": "ally"}]}'
		)
		const d = result.relationshipDiagnostics

		// The name is the diagnostic: it separates a hallucinated character
		// from a real one the matcher failed to reconcile.
		expect(d.unresolvedTargets).toEqual(["Commander Thorne"])
		expect(d.noJson + d.badJson + d.notArray).toBe(0)
	})

	test("an honest abstention is reported as an abstention, not as a drop", async () => {
		const result = await build(TWO_PRESENT, '{"relationships": []}')
		const d = result.relationshipDiagnostics

		expect(d.perspectiveCalls).toBeGreaterThan(0)
		expect(
			d.noJson +
				d.badJson +
				d.notArray +
				d.missingType +
				d.missingTarget +
				d.unresolvedTargets.length
		).toBe(0)
		expect(d.scenesSkippedNoPair).toBe(0)
	})
})

describe("field-name tolerance, widened from a real model's output", () => {
	// Every shape below was captured verbatim from a Dark-Scarlett-v1.0-26B
	// build that returned nine good relationships and had all nine discarded.
	// The content was correct each time; only the keys differed.
	test.each([
		{
			what: "person_1/person_2 with `type`",
			reply: '{"relationships": [{"person_1": "Aria", "person_2": "Cassia", "type": "friends", "description": "d"}]}'
		},
		{
			what: "person_1/person_2 with `relationship_type`",
			reply: '{"relationships": [{"person_1": "Aria", "person_2": "Cassia", "relationship_type": "affectionate", "description": "d"}]}'
		},
		{
			what: "person_1/person_2 with `relation`",
			reply: '{"relationships": [{"person_1": "Aria", "person_2": "Cassia", "relation": "antagonistic", "status": "active"}]}'
		}
	])("$what is accepted", async ({ reply }) => {
		const result = await build(ONE_SOURCE, reply)
		const d = result.relationshipDiagnostics

		expect(result.proposal.relationships.length).toBeGreaterThan(0)
		expect(d.missingType).toBe(0)
		expect(d.missingTarget).toBe(0)
		expect(d.wrongSource).toBe(0)
	})

	test("the documented from/to/type shape still works", async () => {
		const result = await build(
			ONE_SOURCE,
			'{"relationships": [{"from": "Aria", "to": "Cassia", "type": "ally", "description": "d"}]}'
		)
		expect(result.proposal.relationships.length).toBeGreaterThan(0)
		expect(result.relationshipDiagnostics.wrongSource).toBe(0)
	})

	test("a REVERSED pair is discarded, not swapped", async () => {
		// Observed verbatim: Corb's call returned {from: "Maren", to: "Corb"}
		// with a description that read as Corb's stance. This used to be
		// repaired by swapping the endpoints — but that is a guess about whose
		// stance the entry describes, and a wrong guess records a relationship
		// the subject never held, carrying a plausible reason and description
		// that make it very hard to spot later. `from` is pinned to the subject
		// at the decoder (buildPerspectiveSchema), so on a provider that
		// honours the schema this case cannot arise at all; this is the
		// backstop for those that cannot.
		const result = await build(
			ONE_SOURCE,
			'{"relationships": [{"person_1": "Cassia", "person_2": "Aria", "type": "wary", "description": "d"}]}'
		)
		const d = result.relationshipDiagnostics

		expect(result.proposal.relationships).toHaveLength(0)
		expect(d.wrongSource).toBe(1)
	})

	test("a MISSING source is not a wrong direction — the caller supplies it", async () => {
		// Only a positive claim that contradicts the call's contract drops the
		// entry. An absent `from` makes no claim, so it keeps the behaviour it
		// has always had: the source is the subject of the call.
		const result = await build(
			ONE_SOURCE,
			'{"relationships": [{"to": "Cassia", "type": "ally", "description": "d"}]}'
		)
		expect(result.proposal.relationships).toHaveLength(1)
		expect(result.relationshipDiagnostics.wrongSource).toBe(0)
	})

	test("an entry between two THIRD parties is refused, not attributed", async () => {
		// The cost of accepting a symmetric person_1/person_2 pair: without a
		// source check, a relationship the perspective character is not part of
		// would be silently recorded as theirs.
		const result = await build(
			ONE_SOURCE,
			'{"relationships": [{"person_1": "Someone Else", "person_2": "Cassia", "type": "ally"}]}'
		)
		const d = result.relationshipDiagnostics

		expect(result.proposal.relationships).toHaveLength(0)
		expect(d.wrongSource).toBeGreaterThan(0)
		expect(d.missingType).toBe(0)
		expect(d.missingTarget).toBe(0)
	})

	test("a non-JSON response is retried once, and the retry is counted", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		let perspectiveCalls = 0
		runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
			const label: string = opts?.label ?? ""
			if (label.includes("character extraction"))
				return { text: ONE_SOURCE }
			if (label.includes("Character Perspective")) {
				perspectiveCalls++
				// First attempt drifts into prose, as the real model did;
				// the retry complies.
				return perspectiveCalls === 1
					? {
							text: "The air in the medbay smelled like ozone. I leaned against the table."
						}
					: {
							text: '{"relationships": [{"to": "Cassia", "type": "ally", "description": "d"}]}'
						}
			}
			return { text: "{}" }
		})

		const result = await buildGraphFromScenes({
			scenes: [scene(1, "Something happened.")] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})
		const d = result.relationshipDiagnostics

		expect(d.retried).toBe(1)
		expect(d.retriedRecovered).toBe(1)
		expect(d.noJson).toBe(0) // the retry succeeded, so nothing was lost
		expect(result.proposal.relationships).toHaveLength(1)
	})

	test("a response that is prose twice is counted, not retried forever", async () => {
		const { buildGraphFromScenes } = await import("./graphBuilder")
		let calls = 0
		runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
			const label: string = opts?.label ?? ""
			if (label.includes("character extraction"))
				return { text: ONE_SOURCE }
			if (label.includes("Character Perspective")) {
				calls++
				return {
					text: "She watched him across the room, saying nothing."
				}
			}
			return { text: "{}" }
		})

		const result = await buildGraphFromScenes({
			scenes: [scene(1, "Something happened.")] as any,
			connection: conn,
			sampling,
			contextConfig,
			promptConfig,
			seedNodes: [seedAria]
		})
		const d = result.relationshipDiagnostics

		expect(d.retried).toBe(1)
		expect(d.retriedRecovered).toBe(0)
		expect(d.noJson).toBe(1)
		expect(calls).toBe(2) // exactly one retry, never a third attempt
	})
})

describe("the pair guard counts sources and targets separately", () => {
	test("one present + one mentioned character IS a pair", async () => {
		const result = await build(
			'{"participants": ["Aria"], "mentioned": ["Cassia"]}',
			'{"relationships": [{"to": "Cassia", "type": "ally", "description": "d"}]}'
		)

		// Previously skipped whole: the guard counted only present characters,
		// so a scene with one participant and the rest mentioned produced no
		// perspective call — even though mentioned characters are already
		// passed as valid relationship targets.
		expect(result.relationshipDiagnostics.perspectiveCalls).toBe(1)
		expect(result.relationshipDiagnostics.scenesSkippedNoPair).toBe(0)
		expect(result.proposal.relationships).toHaveLength(1)
	})

	test("a genuinely solo scene is skipped, and says so", async () => {
		const result = await build(
			'{"participants": ["Aria"], "mentioned": []}',
			'{"relationships": []}'
		)

		expect(result.relationshipDiagnostics.perspectiveCalls).toBe(0)
		expect(result.relationshipDiagnostics.scenesSkippedNoPair).toBe(1)
	})

	test("a scene-derived relationship carries its history entry", async () => {
		// The date lives on the relationship row so the graph can be read as a
		// timeline. historyEntryId used to be set ONLY for direct history
		// entries, so every scene-derived relationship — the large majority —
		// persisted with a null date even though the scene knew its entry all
		// along.
		const result = await build(
			ONE_SOURCE,
			'{"relationships": [{"from": "Aria", "to": "Cassia", "type": "ally", "description": "d"}]}'
		)
		const [rel] = result.proposal.relationships
		expect(rel).toBeDefined()
		// scene(1, …) is built with historyEntryId 1 — both associations are
		// expected here, not one or the other.
		expect(rel.historyEntryId).toBe(1)
		expect(rel.sceneId).toBe(1)
	})
})
