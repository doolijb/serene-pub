import { describe, it, expect } from "vitest"
import { projectLegacy, type LegacyMessageRow } from "./projectLegacy"
import { textOf } from "./textOf"

/**
 * The one algorithm (20 §5), pinned at the unit: every legacy shape the wild
 * holds — plain, swiped, thinking, narrator, generating, greeting — projects
 * to a model whose `textOf` is byte-identical to the legacy `content`. That
 * equality is the migration's whole warrant.
 */

const base = (over: Partial<LegacyMessageRow> = {}): LegacyMessageRow => ({
	id: 1,
	sessionId: 10,
	role: "assistant",
	characterId: 7,
	content: "Ash tilts her head.",
	updatedAt: new Date("2026-08-20T12:00:00Z"),
	...over
})

const project = (over: Partial<LegacyMessageRow> = {}) =>
	projectLegacy(base(over))

const asMessage = (p: ReturnType<typeof projectLegacy>) => ({
	activeRevisions: p.message.activeRevisions as Record<string, number>,
	parts: p.parts.map((x) => ({
		step: x.step ?? 0,
		revision: x.revision ?? 0,
		ordinal: x.ordinal ?? 0,
		type: x.type,
		content: x.content ?? null
	}))
})

describe("projectLegacy", () => {
	it("a plain message is one markdown part at the origin coordinates", () => {
		const p = project()
		expect(p.parts).toEqual([
			{
				step: 0,
				revision: 0,
				ordinal: 2,
				type: "core:markdown",
				content: "Ash tilts her head.",
				data: null
			}
		])
		expect(p.message.activeRevisions).toEqual({ "0": 0 })
		expect(p.message.kind).toBe("core:chat")
		expect(p.message.channel).toBe("main")
		// Ruled: every creating path writes "1.0".
		expect(p.message.version).toBe("1.0")
		expect(textOf(asMessage(p))).toBe("Ash tilts her head.")
	})

	it("swipes become revisions; the cursor follows currentIdx", () => {
		const p = project({
			content: "second",
			metadata: {
				swipes: {
					currentIdx: 1,
					history: ["first", "second"],
					thinkingHistory: ["hmm one", null]
				},
				thinking: null
			}
		})
		expect(p.message.activeRevisions).toEqual({ "0": 1 })
		// revision 0 carries its thinking; revision 1 has none
		expect(
			p.parts.filter((x) => x.type === "core:thinking")
		).toMatchObject([{ revision: 0, content: "hmm one" }])
		expect(
			p.parts.filter((x) => x.type === "core:markdown")
		).toMatchObject([
			{ revision: 0, content: "first" },
			{ revision: 1, content: "second" }
		])
		// textOf follows the cursor — byte parity with legacy `content`
		expect(textOf(asMessage(p))).toBe("second")
	})

	it("null currentIdx means 0; an out-of-range cursor clamps", () => {
		const nul = project({
			content: "a",
			metadata: { swipes: { currentIdx: null, history: ["a", "b"] } }
		})
		expect(nul.message.activeRevisions).toEqual({ "0": 0 })
		const wild = project({
			content: "b",
			metadata: { swipes: { currentIdx: 9, history: ["a", "b"] } }
		})
		expect(wild.message.activeRevisions).toEqual({ "0": 1 })
	})

	it("a single-revision message keeps its denormalized thinking", () => {
		const p = project({ metadata: { thinking: "let me consider" } })
		expect(p.parts).toMatchObject([
			{ ordinal: 1, type: "core:thinking", content: "let me consider" },
			{ ordinal: 2, type: "core:markdown" }
		])
		// thinking never enters the default projection
		expect(textOf(asMessage(p))).toBe("Ash tilts her head.")
	})

	it("a narration becomes kind + label + an Instructions section", () => {
		const p = project({
			characterId: null,
			isNarratorResponse: true,
			content: "Rain sweeps the docks.",
			metadata: {
				narratorName: "Narrator",
				narratorInstructions: "Focus on the weather.",
				swipes: { currentIdx: 1, history: ["Dry night.", "Rain sweeps the docks."] }
			}
		})
		expect(p.message.kind).toBe("core:narration")
		expect(p.message.speakerLabel).toBe("Narrator")
		// message-level in the legacy model → rides every revision
		expect(
			p.parts.filter((x) => x.type === "core:section")
		).toMatchObject([
			{ revision: 0, content: "Focus on the weather.", data: { title: "Instructions" } },
			{ revision: 1, content: "Focus on the weather." }
		])
		expect(textOf(asMessage(p))).toBe("Rain sweeps the docks.")
	})

	it("generation state folds into status; greeting folds into extras", () => {
		expect(
			project({ isGenerating: true, generationStage: "queued" }).message
				.status
		).toBe("queued")
		expect(
			project({ isGenerating: true, generationStage: null }).message
				.status
		).toBe("generating")
		expect(
			project({ error: { message: "boom" } }).message.status
		).toBe("error")
		expect(
			project({ metadata: { isGreeting: true } }).message.extras
		).toEqual({ core: { isGreeting: true } })
	})

	it("is deterministic — re-projection is byte-identical", () => {
		const row = base({
			metadata: {
				swipes: { currentIdx: 0, history: ["x", "y"] },
				narratorInstructions: "note"
			}
		})
		expect(JSON.stringify(projectLegacy(row))).toBe(
			JSON.stringify(projectLegacy(row))
		)
	})
})
