import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

/**
 * Tool calling's pure halves (20 §9): the advertisement the model sees, and
 * the reader that turns its reply back into data. The convention is one
 * fenced block; the parse is total (an unparseable block is prose, not a
 * crash) and the null call is the loop's exit predicate, not an error.
 */

const TOOLS = [
	{
		name: "roll_dice",
		description: "Roll dice like 3d6+2.",
		parameters: {
			type: "object",
			properties: { expr: { type: "string" } }
		}
	},
	{ name: "ledger_get", description: "Read a world-state key." }
]

const advertise = (input: any) =>
	coreBindings()["core:task/advertise-tools@1"]!(input, {} as any) as any
const parse = (input: any) =>
	coreBindings()["core:task/parse-tool-call@1"]!(input, {} as any) as any

describe("advertise-tools", () => {
	it("publishes both doors; style picks what main carries", async () => {
		const r = await advertise({ tools: TOOLS, params: {} })
		expect(r.kind).toBe("ok")
		// prompt is the default door — the tier that works everywhere.
		expect(typeof r.value.main).toBe("string")
		expect(r.value.prompt).toContain("roll_dice")
		expect(r.value.prompt).toContain("```tool_call")
		expect(r.value.native).toEqual([
			expect.objectContaining({ name: "roll_dice" }),
			expect.objectContaining({
				name: "ledger_get",
				parameters: { type: "object", properties: {} }
			})
		])

		const native = await advertise({
			tools: TOOLS,
			params: { style: "native" }
		})
		expect(Array.isArray(native.value.main)).toBe(true)
	})

	it("no tools means an empty advertisement, not a heading over nothing", async () => {
		const r = await advertise({ tools: [], params: {} })
		expect(r.value.prompt).toBe("")
		expect(r.value.native).toEqual([])
	})
})

describe("parse-tool-call", () => {
	it("reads the fenced convention and strips it from the prose", async () => {
		const text =
			'Ash squints at the lock.\n\n```tool_call\n{"tool": "roll_dice", "args": {"expr": "1d20+2"}}\n```'
		const r = await parse({ text, tools: TOOLS })
		expect(r.value.call).toEqual({
			tool: "roll_dice",
			args: { expr: "1d20+2" }
		})
		expect(r.value.text).toBe("Ash squints at the lock.")
	})

	it("tolerates a bare object and the name/arguments spelling", async () => {
		const r = await parse({
			text: 'I will check. {"tool": "ledger_get", "args": {"key": "gold"}} Done.',
			tools: TOOLS
		})
		expect(r.value.call).toEqual({
			tool: "ledger_get",
			args: { key: "gold" }
		})
	})

	it("no call, an unknown tool, or broken JSON is prose — null, never a crash", async () => {
		expect((await parse({ text: "Just narration.", tools: TOOLS })).value.call).toBeNull()
		expect(
			(
				await parse({
					text: '```tool_call\n{"tool": "not_a_tool", "args": {}}\n```',
					tools: TOOLS
				})
			).value.call
		).toBeNull()
		const broken = await parse({
			text: '```tool_call\n{"tool": "roll_dice", args: BROKEN\n```',
			tools: TOOLS
		})
		expect(broken.value.call).toBeNull()
		// Prose passes through untouched when nothing parsed.
		expect(broken.value.text).toContain("BROKEN")
	})
})
