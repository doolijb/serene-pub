/**
 * A resumed build (the review's Retry) proposes what an uninterrupted one
 * would (plan A21 review).
 *
 * A failed build is resumed from the snapshot taken before the scene that
 * failed. The snapshot carried the relationships and characters of the scenes
 * before it, but not the rest of what those scenes produced — so the resumed
 * proposal had their relationships and none of:
 *
 * - their casts (`resolvedSceneCast`): the apply saved no cast for them, their
 *   new ties were born `secret`, and — stamped graphed all the same — no later
 *   Extend read them again to repair it;
 * - the changes to existing members they found (a death, a summary);
 * - the count the "nothing could be extracted" tripwire reads, which could
 *   then fire on a resumed half that had one-character scenes left.
 */
import { describe, expect, test, vi } from "vitest"
import type { GraphBuilderResumeState } from "./graphBuilder"

const runQueuedLLMCallMock = vi.fn()

vi.mock("./runQueuedLLMCall", () => ({
	runQueuedLLMCall: (...args: unknown[]) => runQueuedLLMCallMock(...args)
}))

vi.mock("./getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		Adapter: class {
			stops: any
			withStops(s: any) {
				this.stops = s
				return this
			}
			constructor(_opts: unknown) {}
		}
	})
}))

const conn = { id: 1, name: "c", type: "openai_session" } as any
const sampling = {
	id: 1,
	name: "s",
	shape: "core:shape/text-gen@1",
	values: {},
	enabled: []
} as any

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

const seeds = [
	{ id: 10, name: "Aria", nodeState: "active", summary: "A scout.", aliases: [] },
	{ id: 11, name: "Kael", nodeState: "active", summary: "A smith.", aliases: [] }
]

/**
 * Scene 1 (Year 1): Aria and Kael; Kael dies. Scene 2 (Year 2): Aria alone.
 * Scene 3 (Year 3): Aria and Kael again — the one that fails the first time.
 */
function answer(failScene3: { now: boolean }) {
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		const label: string = opts?.label ?? ""
		if (label.includes("Year 3") && failScene3.now)
			throw new Error("model timed out")
		// The extraction call's label names no scene; its prompt does.
		if (label.includes("character extraction"))
			return {
				text: JSON.stringify(opts).includes("keeps watch alone")
					? '{"participants": ["Aria"], "mentioned": []}'
					: '{"participants": ["Aria", "Kael"], "mentioned": []}'
			}
		if (label.includes("State Detection") && label.includes("Year 1"))
			return {
				text: '{"changes": [{"name": "Kael", "newState": "deceased", "reason": "Fell in battle."}]}'
			}
		if (label.includes("Perspective") && label.includes("Aria"))
			return {
				text: '{"relationships": [{"to": "Kael", "type": "ally", "description": "d", "visibility": "acknowledged", "status": "active"}]}'
			}
		return { text: "{}" }
	})
}

async function build(opts: {
	resumeState?: GraphBuilderResumeState
	onSceneStart?: (s: GraphBuilderResumeState) => void
}) {
	const { buildGraphFromScenes } = await import("./graphBuilder")
	return buildGraphFromScenes({
		scenes: [
			scene(1, "Aria and Kael hold the pass. Kael falls."),
			scene(2, "Aria keeps watch alone."),
			scene(3, "Aria remembers Kael.")
		] as any,
		connection: conn,
		sampling,
		seedNodes: seeds as any,
		...opts
	})
}

describe("a resumed build", () => {
	test("proposes what the scenes before its checkpoint found — casts and member changes too", async () => {
		const failScene3 = { now: true }
		answer(failScene3)
		let checkpoint: GraphBuilderResumeState | undefined
		await expect(
			build({ onSceneStart: (s) => (checkpoint = s) })
		).rejects.toThrow("model timed out")
		expect(checkpoint?.sceneIndex).toBe(2)

		failScene3.now = false
		// A snapshot is held in memory between the two runs, but made to
		// survive a copy, as any value handed across a boundary should.
		const resumed = await build({
			resumeState: JSON.parse(JSON.stringify(checkpoint))
		})
		const whole = await build({})

		expect(resumed.resolvedSceneCast.map((c) => c.sceneId)).toEqual([
			1, 2, 3
		])
		expect(resumed.resolvedSceneCast).toEqual(whole.resolvedSceneCast)
		expect(resumed.proposal.updatedNodes).toEqual(whole.proposal.updatedNodes)
		expect(
			resumed.proposal.updatedNodes?.find((u) => u.name === "Kael")
				?.nodeState
		).toBe("deceased")
		expect(resumed.proposal.relationships).toEqual(
			whole.proposal.relationships
		)
	})

	test("a resumed half that finds nobody is not 'nothing could be extracted'", async () => {
		// Scene 2 fails after its cast was read; on the retry the model reads
		// nobody in it. The scene before the checkpoint had a cast all along.
		const failScene2 = { now: true }
		runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
			const label: string = opts?.label ?? ""
			if (label.includes("Year 2") && failScene2.now)
				throw new Error("model timed out")
			if (label.includes("character extraction"))
				return {
					text: JSON.stringify(opts).includes("hold the pass")
						? '{"participants": ["Aria", "Kael"], "mentioned": []}'
						: failScene2.now
							? '{"participants": ["Aria"], "mentioned": []}'
							: '{"participants": [], "mentioned": []}'
				}
			return { text: "{}" }
		})
		const { buildGraphFromScenes } = await import("./graphBuilder")
		const run = (resumeState?: GraphBuilderResumeState) =>
			buildGraphFromScenes({
				scenes: [
					scene(1, "Aria and Kael hold the pass."),
					scene(2, "The wind howls.")
				] as any,
				connection: conn,
				sampling,
				seedNodes: seeds as any,
				resumeState,
				onSceneStart: (s) => (checkpoint = s)
			})
		let checkpoint: GraphBuilderResumeState | undefined
		await expect(run()).rejects.toThrow("model timed out")
		failScene2.now = false
		const resumed = await run(JSON.parse(JSON.stringify(checkpoint)))
		expect(resumed.resolvedSceneCast.map((c) => c.sceneId)).toEqual([1, 2])
	})
})
