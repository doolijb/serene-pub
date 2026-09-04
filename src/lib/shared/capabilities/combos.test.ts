/**
 * The aggregation, and the two directions it has to cover.
 *
 * Every failure this guards is SILENT. A combo missing from the union is not an
 * error anywhere: the admin screen simply never lists it, no default is ever
 * registered against it, and — under piece 3, where nothing is picked because it
 * merely exists — the first sign is a run refusing a capability with nothing on
 * any screen to set. So the union is asserted in BOTH directions against real
 * data, not against a fixture that agrees with whatever the code happens to do.
 */

import { describe, expect, test } from "vitest"
import { ADAPTER_MANIFEST } from "$lib/shared/connectionAdapters/manifest"
import {
	aggregateCombos,
	servableTransforms,
	type RegistryTypeRow
} from "./combos"

/** A registry row, as `pipeline_type_registry` stores one. */
const type = (
	typeId: string,
	slots: Record<string, unknown>,
	version = 1
): RegistryTypeRow => ({ typeId, version, slots })

describe("servableTransforms", () => {
	test("it is the union across manifest entries, not one entry's list", () => {
		const ids = servableTransforms()
		// text->text comes from seven entries and text->image from two; a
		// union that returned one entry's keys would still contain both, so
		// the discriminating pair is a transform only ONE entry declares
		// beside one only a DIFFERENT entry declares.
		expect(ids).toContain("text+document->text") // OPENAI_CHAT / ANTHROPIC
		expect(ids).toContain("text->image") // KOBOLDCPP / A1111
		expect(new Set(ids).size).toBe(ids.length)
	})

	test("features are not on it", () => {
		// `tools`, `json_schema` and friends live in the same `supports` object.
		// A slot may legitimately require one; an admin cannot point a
		// connection at it, because a feature qualifies a request rather than
		// being something a node goes shopping for.
		const ids = servableTransforms()
		expect(ids.some((id) => !id.includes("->"))).toBe(false)
		expect(ids).not.toContain("tools")
		expect(ids).not.toContain("json_schema")
	})

	test("a probed transform still counts as servable", () => {
		// `{unproven:true}` says nobody has asked the backend yet — a question
		// about an INSTANCE. This file answers a question about the BUILD, and
		// gating on the grade would drop `text->image` from every KoboldCPP-only
		// install until somebody pressed Test.
		expect(
			ADAPTER_MANIFEST["koboldcpp"].capabilities.supports["text->image"]
		).toMatchObject({ unproven: true })
		expect(servableTransforms()).toContain("text->image")
	})
})

describe("aggregateCombos — the union is necessary in both directions", () => {
	test("manifest-only would drop what core demands and no adapter serves", () => {
		// The real case: `core:provider/speak@1` requires `text->audio` and
		// `core:provider/embed-text@1` requires `text->embedding`. No manifest
		// entry declares either — nothing implements `synthesizeSpeech` or
		// `embedText` — so a list built from the manifest alone offers no way
		// to register a default for a capability core will ask for.
		expect(servableTransforms()).not.toContain("text->audio")
		expect(servableTransforms()).not.toContain("text->embedding")

		const combos = aggregateCombos([
			type("core:provider/speak", {
				connection: { kind: "connection", requires: ["text->audio"] }
			}),
			type("core:provider/embed-text", {
				connection: {
					kind: "connection",
					requires: ["text->embedding"]
				}
			})
		])
		const speech = combos.find((c) => c.id === "text->audio")
		expect(speech).toBeDefined()
		expect(speech!.demanded).toBe(true)
		expect(speech!.servable).toBe(false)
		expect(speech!.requiredBy).toEqual([
			{ typeId: "core:provider/speak", version: 1, slot: "connection" }
		])
	})

	test("registry-only would drop what this build serves and nothing demands", () => {
		// The other direction, with no registry rows at all: vision and document
		// reading are servable today and required by no core node type. An
		// aggregation keyed on demand alone makes them unregisterable, which is
		// the same as saying the instance cannot have them.
		const combos = aggregateCombos([])
		const vision = combos.find((c) => c.id === "text+image->text")
		expect(vision).toBeDefined()
		expect(vision!.servable).toBe(true)
		expect(vision!.demanded).toBe(false)
		expect(combos.map((c) => c.id)).toContain("text+document->text")
	})
})

describe("aggregateCombos — provenance", () => {
	test("requiredBy names every demanding site, not just the first", () => {
		const combos = aggregateCombos([
			type("core:provider/generate-text", {
				connection: { kind: "connection", requires: ["text->text"] }
			}),
			type("core:provider/graph-extract", {
				connection: { kind: "connection", requires: ["text->text"] }
			})
		])
		const chat = combos.find((c) => c.id === "text->text")!
		expect(chat.requiredBy.map((r) => r.typeId)).toEqual([
			"core:provider/generate-text",
			"core:provider/graph-extract"
		])
	})

	test("optional is filed apart from requires and never sets `demanded`", () => {
		// D2: a capability nothing REQUIRES is not missing. Summing the two
		// would put a permanent "unset" complaint on the screen for something
		// no run will ever need.
		const combos = aggregateCombos([
			type("core:provider/generate-text", {
				connection: {
					kind: "connection",
					requires: ["text->text"],
					optional: ["text+image->text"]
				}
			})
		])
		const vision = combos.find((c) => c.id === "text+image->text")!
		expect(vision.demanded).toBe(false)
		expect(vision.requiredBy).toEqual([])
		expect(vision.optionalFor).toEqual([
			{
				typeId: "core:provider/generate-text",
				version: 1,
				slot: "connection"
			}
		])
	})

	test("an optional-only capability still reaches the list", () => {
		// Nothing serves `text->video` and nothing requires it — but a node that
		// would USE it needs somewhere to be pointed, and a capability an admin
		// cannot register is a capability the instance does not have.
		const combos = aggregateCombos([
			type("plugin:provider/clip", {
				connection: { kind: "connection", optional: ["text->video"] }
			})
		])
		const video = combos.find((c) => c.id === "text->video")
		expect(video).toBeDefined()
		expect(video!.demanded).toBe(false)
		expect(video!.servable).toBe(false)
	})

	test("a feature in requires is skipped, and does not become a combo", () => {
		const combos = aggregateCombos([
			type("core:provider/generate-text", {
				connection: {
					kind: "connection",
					requires: ["text->text", "json_schema"]
				}
			})
		])
		expect(combos.map((c) => c.id)).not.toContain("json_schema")
		expect(combos.some((c) => c.id === "text->text")).toBe(true)
	})

	test("a plugin transform this build never heard of is on the list", () => {
		// The escape hatch, asserted rather than assumed: the aggregation is a
		// union over an OPEN id space. A hardcoded array is what this replaces,
		// and its failure mode is exactly this row silently missing.
		const combos = aggregateCombos([
			type("plugin:provider/dub", {
				connection: { kind: "connection", requires: ["audio->audio"] }
			})
		])
		const dub = combos.find((c) => c.id === "audio->audio")!
		expect(dub.demanded).toBe(true)
		expect(dub.servable).toBe(false)
	})

	test("slots that are not connection slots contribute nothing", () => {
		// A prompts or parameters slot carries no `requires`, and reading one
		// must not throw on a JSON column holding whatever a plugin wrote.
		const combos = aggregateCombos([
			type("core:task/assemble", {
				prompts: { kind: "prompts", fields: {} },
				junk: null,
				alsoJunk: "a string where an object was expected"
			} as Record<string, unknown>)
		])
		// Only the servable half survives, and nothing is demanded.
		expect(combos.every((c) => !c.demanded)).toBe(true)
	})

	test("the same capability from two versions of a type is two sites", () => {
		const combos = aggregateCombos([
			type("core:provider/generate-text", {
				connection: { kind: "connection", requires: ["text->text"] }
			}),
			type(
				"core:provider/generate-text",
				{
					connection: { kind: "connection", requires: ["text->text"] }
				},
				2
			)
		])
		expect(
			combos
				.find((c) => c.id === "text->text")!
				.requiredBy.map((r) => r.version)
		).toEqual([1, 2])
	})
})

describe("aggregateCombos — order", () => {
	test("grouped by output kind in IO_KINDS order, then alphabetical", () => {
		// The admin screen groups by output kind and renders what it is sent, so
		// the order is decided once, here. IO_KINDS puts text before image.
		const ids = aggregateCombos([]).map((c) => c.id)
		const textOut = ids.filter((id) => id.endsWith("->text"))
		const imageOut = ids.filter((id) => id.endsWith("->image"))
		expect(textOut.length).toBeGreaterThan(0)
		expect(imageOut.length).toBeGreaterThan(0)
		expect(ids.indexOf(textOut[textOut.length - 1])).toBeLessThan(
			ids.indexOf(imageOut[0])
		)
		// `localeCompare`, not a code-unit sort — the two disagree here, because
		// `+` and `-` collate differently from their code points, and the point
		// of the assertion is that ONE rule is applied, not which.
		expect(textOut).toEqual([...textOut].sort((a, b) => a.localeCompare(b)))
	})

	test("it is stable across calls", () => {
		expect(aggregateCombos([]).map((c) => c.id)).toEqual(
			aggregateCombos([]).map((c) => c.id)
		)
	})
})
