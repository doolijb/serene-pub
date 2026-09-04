/**
 * The capability panel's row model.
 *
 * Every assertion here is against a failure that would be SILENT on screen: an
 * override written as `false` where it should have been deleted, a switch
 * offered for a capability the protocol cannot express, an untested connection
 * rendered as though something had confirmed it, a resolved answer that
 * contradicts the control with nothing saying so. None of those look wrong; they
 * look like a working panel with the wrong answer in it.
 */
import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	buildCapabilityRows,
	OVERRIDE_STATES,
	relativeAge,
	type CapabilityRow,
	type CapabilityRowsView
} from "./capabilityRows"

const find = (view: CapabilityRowsView, id: string): CapabilityRow => {
	const row = [...view.transforms, ...view.features].find((r) => r.id === id)
	if (!row) throw new Error(`no row for ${id}`)
	return row
}
const has = (view: CapabilityRowsView, id: string): boolean =>
	[...view.transforms, ...view.features].some((r) => r.id === id)

describe("the three states", () => {
	test("an absent override key is AUTO, not off", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: {}, overrides: {} }
		})
		expect(find(view, "text->image").state).toBe("auto")
	})

	test("`false` is OFF and never collapses into auto", () => {
		// The distinction the whole widget exists to keep: an absent key hands
		// authority back to the probe, `false` takes it away permanently.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { overrides: { "text->image": false } }
		})
		expect(find(view, "text->image").state).toBe("off")
	})

	test("a grade is ON", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": 1 },
				resolved: { "text->image": 1 }
			}
		})
		expect(find(view, "text->image").state).toBe("on")
	})

	test("Auto is offered FIRST and sends null — never `false`", () => {
		// A `false` on the Auto position would look identical on screen and mean
		// the opposite: the row would stop hearing its own backend forever.
		expect(OVERRIDE_STATES[0].value).toBe("auto")
		expect(OVERRIDE_STATES[0].wire).toBeNull()
		expect(OVERRIDE_STATES.map((s) => s.wire)).toEqual([
			null,
			"native",
			false
		])
	})
})

describe("the adapter gates the key space", () => {
	test("a capability the adapter never declared gets no row, even when the column carries one", () => {
		// The reported bug, in its durable form: KOBOLDCPP_MANAGED declares no
		// text->image at all, so junk left in the column by an earlier type must
		// not resurrect as a switch.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			capabilities: {
				resolved: { "text->image": 1 },
				overrides: { "text->image": 1 }
			}
		})
		expect(has(view, "text->image")).toBe(false)
		expect(has(view, "text->text")).toBe(true)
	})

	test("a type no manifest entry declares renders nothing rather than guessing", () => {
		const view = buildCapabilityRows({ type: "openai-embeddings" })
		expect(view.declared).toBe(false)
		expect(view.transforms).toEqual([])
		expect(view.features).toEqual([])
	})
})

describe("provenance — the answer to 'why is my LLM offering image generation'", () => {
	test("a hand-set value says so", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": false },
				resolved: {}
			}
		})
		const row = find(view, "text->image")
		expect(row.decidedBy).toBe("override")
		expect(row.provenance).toMatch(/switched this off/i)
	})

	test("a probe says WHEN it answered", () => {
		const at = new Date("2026-08-28T00:00:00.000Z").toISOString()
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->image": 1 },
				probe: { found: { "text->image": 1 }, at }
			},
			now: new Date("2026-08-31T00:00:00.000Z").getTime()
		})
		const row = find(view, "text->image")
		expect(row.decidedBy).toBe("probe")
		expect(row.provenance).toContain("3d ago")
		expect(row.assumed).toBe(false)
	})

	test("a probe answer to a question the adapter never asked is not credited", () => {
		// `streaming` is declared native outright, so resolution ignores a probe
		// for it — and a provenance line naming a layer that had no effect is a
		// wrong answer that reads like a right one.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { streaming: 1 },
				probe: {
					found: { streaming: 1 },
					at: "2026-08-30T00:00:00.000Z"
				}
			}
		})
		expect(find(view, "streaming").decidedBy).toBe("default")
	})

	// `json_schema` rather than `text->image`, which this used to assert: the
	// OPENAI_CHAT entry no longer declares image generation for anyone (nothing
	// implements `generateImage` for that type, so the key cannot be derived) and
	// the `openai-official` preset no longer asserts it. `json_schema` is the
	// same shape of fact — declared `{unproven:true}` by the adapter, asserted
	// `true` by this preset — so the row is still decided by the preset layer.
	test("a preset is named by its display name, not its slug", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI_CHAT,
			preset: "openai-official",
			capabilities: { resolved: { json_schema: 2 } }
		})
		const row = find(view, "json_schema")
		expect(row.decidedBy).toBe("preset")
		expect(row.provenance).toContain("OpenAI (Official)")
	})

	test("an untested connection says so rather than looking authoritative", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->text": 1 } }
		})
		expect(view.tested).toBe(false)
		expect(view.testedText).toMatch(/nothing has tested/i)
		// text->image is `probed` with `until: none`, and nothing has answered.
		expect(find(view, "text->image").assumed).toBe(true)
		// text->text is declared native outright — an assumption about nothing.
		expect(find(view, "text->text").assumed).toBe(false)
	})

	test("a preset's assertion is a claim, not an assumption", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.OPENAI_CHAT,
			preset: "openai-official",
			capabilities: { resolved: { json_schema: 2 } }
		})
		expect(find(view, "json_schema").assumed).toBe(false)
	})
})

describe("the state chip reports the grade the SERVER resolved", () => {
	test("emulated is named as ours rather than shown as plain On", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { tools: 1, grammar: 1 } }
		})
		expect(find(view, "tools").stateLabel).toBe("On · by Serene Pub")
		expect(find(view, "grammar").stateLabel).toBe("On")
	})

	test("a capability missing from `resolved` is Off, not blank", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->text": 1 } }
		})
		const row = find(view, "text->image")
		expect(row.grade).toBe(0)
		expect(row.on).toBe(false)
		expect(row.stateLabel).toBe("Off")
		expect(row.letter).toBeUndefined()
	})

	test("a grade is read against the capability's OWN top, never a shared one", () => {
		// The reason grades replaced the flat enum. Image generation at 1 is the
		// best image generation there is, and tool calling at 1 is Serene Pub
		// doing the work — the same number, two different readings, and the row
		// carries the scale so neither presentation has to know the difference.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->image": 1, tools: 1 } }
		})
		const image = find(view, "text->image")
		expect(image.grade).toBe(image.top)
		expect(image.letter).toBe("A")
		expect(image.stateLabel).toBe("On")

		const tools = find(view, "tools")
		expect(tools.top).toBe(2)
		expect(tools.letter).toBe("B")
		expect(tools.stateLabel).toBe("On · by Serene Pub")
	})
})

describe("contested rows — an explicit off that did not stick", () => {
	test("KoboldCPP's tools come back emulated and the row names the lever", () => {
		// Expected on day one: `closure()` re-supplies tools through the native
		// grammar, so switching them off does nothing until the grammar goes.
		// Whether an explicit `false` OUGHT to survive the closure is an SDK
		// ruling, deferred — so the row has to be honest instead of silent.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { tools: false },
				resolved: { tools: 1, grammar: 1 }
			}
		})
		const row = find(view, "tools")
		expect(row.contested).toBe(true)
		expect(row.derivedVia).toContain("grammar")
		expect(row.derived).toContain("Grammar constraints")
	})

	test("an off that DID stick is not contested", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				overrides: { "text->image": false },
				resolved: { "text->text": 1 }
			}
		})
		const row = find(view, "text->image")
		expect(row.contested).toBe(false)
		expect(row.derived).toBeUndefined()
	})

	test("a transform is in neither closure table, so nothing claims to derive it", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->image": 1 } }
		})
		expect(find(view, "text->image").derivedVia).toEqual([])
	})
})

describe("disclosure", () => {
	test("transforms are always visible and features are the ones behind Advanced", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->text": 1, tools: 1 }
			}
		})
		expect(view.transforms.every((r) => r.kind === "transform")).toBe(true)
		expect(view.features.every((r) => r.kind === "feature")).toBe(true)
		expect(view.transforms.map((r) => r.id)).toContain("text->image")
		expect(view.featuresOnLabels).toEqual(["Tool calling"])
	})

	test("`basic` PINS text->text first — it does not filter", () => {
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {}
		})
		expect(view.transforms[0].id).toBe("text->text")
		expect(view.transforms[0].basic).toBe(true)
	})

	test("an A1111 connection still gets rows, having no text->text at all", () => {
		// A strict basic-only cut would leave this connection with an empty
		// panel — the reason `isBasicCapability` pins rather than filters.
		const view = buildCapabilityRows({
			type: CONNECTION_TYPE.A1111,
			capabilities: { resolved: { "text->image": 1 } }
		})
		// One row, and one only. This used to expect `text+image->image` and
		// `image->image` beside it, which A1111Adapter could not do and said so in
		// its own profile — the manifest's key space is now derived from the
		// actions a module implements, and nothing implements `editImage`.
		expect(view.transforms.map((r) => r.id)).toEqual(["text->image"])
		expect(view.transforms.every((r) => r.basic)).toBe(false)
	})

	test("rows are named, never addressed", () => {
		const view = buildCapabilityRows({ type: CONNECTION_TYPE.KOBOLDCPP })
		for (const row of [...view.transforms, ...view.features])
			expect(row.label).not.toContain("->")
	})
})

describe("relativeAge", () => {
	const base = new Date("2026-08-31T12:00:00.000Z").getTime()
	const ago = (ms: number) => new Date(base - ms).toISOString()

	test("reads in the steps a person thinks in", () => {
		expect(relativeAge(ago(5_000), base)).toBe("just now")
		expect(relativeAge(ago(5 * 60_000), base)).toBe("5m ago")
		expect(relativeAge(ago(3 * 3_600_000), base)).toBe("3h ago")
		expect(relativeAge(ago(3 * 86_400_000), base)).toBe("3d ago")
	})

	test("an unparseable timestamp does not render NaN at somebody", () => {
		expect(relativeAge("not a date", base)).toBe("at an unknown time")
	})
})
