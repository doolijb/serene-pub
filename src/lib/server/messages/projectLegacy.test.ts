import { describe, it, expect } from "vitest"
import { projectLegacy, type LegacyMessageRow } from "./projectLegacy"
import { textOf } from "./textOf"

/**
 * The one algorithm (20 §5), pinned at the unit: every legacy shape the wild
 * holds — plain, swiped, reasoning, narrator, generating, greeting — projects
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
					reasoningHistory: ["hmm one", null]
				},
				reasoning: null
			}
		})
		expect(p.message.activeRevisions).toEqual({ "0": 1 })
		// revision 0 carries its reasoning; revision 1 has none
		expect(
			p.parts.filter((x) => x.type === "core:reasoning")
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

	it("a single-revision message keeps its denormalized reasoning", () => {
		const p = project({ metadata: { reasoning: "let me consider" } })
		expect(p.parts).toMatchObject([
			{ ordinal: 1, type: "core:reasoning", content: "let me consider" },
			{ ordinal: 2, type: "core:markdown" }
		])
		// reasoning never enters the default projection
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

	it("a live generationStatus (R-19) wins over the retired stage enum", () => {
		expect(
			project({
				isGenerating: true,
				generationStage: "queued",
				generationStatus: { i18n: { en: "{speaker} is typing" } }
			}).message.status
		).toBe("generating")
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

	/* ── folded sections (B4, D5 2026-09-27) ─────────────────────────── */

	const plan = {
		kind: "plan",
		label: "Plan",
		items: ["Wren — draws her blade", "The goblin — flees"]
	}
	const note = { kind: "notes", label: "Step notes", content: "Low light." }

	it("a row's folded sections become core:section parts above reasoning and body", () => {
		const p = project({
			metadata: { reasoning: "weigh it", sections: [plan, note] }
		})
		expect(p.parts).toEqual([
			{
				step: 0,
				revision: 0,
				ordinal: 1,
				type: "core:section",
				content: "- Wren — draws her blade\n- The goblin — flees",
				data: {
					title: "Plan",
					kind: "plan",
					items: ["Wren — draws her blade", "The goblin — flees"]
				}
			},
			{
				step: 0,
				revision: 0,
				ordinal: 2,
				type: "core:section",
				content: "Low light.",
				data: { title: "Step notes", kind: "notes" }
			},
			{
				step: 0,
				revision: 0,
				ordinal: 3,
				type: "core:reasoning",
				content: "weigh it",
				data: null
			},
			{
				step: 0,
				revision: 0,
				ordinal: 4,
				type: "core:markdown",
				content: "Ash tilts her head.",
				data: null
			}
		])
		// Folded sections never enter the default projection — the body only.
		expect(textOf(asMessage(p))).toBe("Ash tilts her head.")
	})

	it("each swipe keeps its own sections, parallel to history", () => {
		const p = project({
			content: "second",
			metadata: {
				sections: [note],
				swipes: {
					currentIdx: 1,
					history: ["first", "second", "third"],
					sectionsHistory: [null, [plan]]
				}
			}
		})
		const sections = p.parts.filter((x) => x.type === "core:section")
		expect(sections.map((x) => [x.revision, (x.data as any).title])).toEqual([
			[1, "Plan"]
		])
		// A revision with sections lays its body out after them; one without
		// keeps the fixed slot.
		expect(
			p.parts
				.filter((x) => x.type === "core:markdown")
				.map((x) => [x.revision, x.ordinal])
		).toEqual([
			[0, 2],
			[1, 3],
			[2, 2]
		])
		expect(textOf(asMessage(p))).toBe("second")
	})

	it("before any history is kept, slot 0 holds the row's own sections", () => {
		const p = project({
			content: "first",
			metadata: {
				sections: [note],
				swipes: { currentIdx: 0, history: ["first", "second"] }
			}
		})
		expect(
			p.parts
				.filter((x) => x.type === "core:section")
				.map((x) => [x.revision, (x.data as any).title])
		).toEqual([[0, "Step notes"]])
	})

	it("instructions stay at 0 and sections follow them", () => {
		const p = project({
			isNarratorResponse: true,
			metadata: { narratorInstructions: "Focus.", sections: [plan] }
		})
		expect(p.parts.map((x) => [x.ordinal, x.type])).toEqual([
			[0, "core:section"],
			[1, "core:section"],
			[3, "core:markdown"]
		])
		expect((p.parts[1]!.data as any).kind).toBe("plan")
	})

	it("a row with no sections projects exactly as before (existing rows unchanged)", () => {
		const p = project({ metadata: { reasoning: "t", sections: [] } })
		expect(p.parts.map((x) => [x.ordinal, x.type])).toEqual([
			[1, "core:reasoning"],
			[2, "core:markdown"]
		])
	})
})
