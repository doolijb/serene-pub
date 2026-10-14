import { describe, expect, test } from "vitest"
import { S } from "@serene-pub/sdk"
import type {
	CapabilityConnection,
	CapabilityModel
} from "$lib/client/components/connections/jobPicker"
import {
	dialRows,
	draftOf,
	editorHeader,
	EDITOR_CARDS,
	filterModelOptions,
	loadoutForJob,
	mergeTargets,
	modelOptions,
	needsSetDefault,
	ownerChip,
	ownerLabel,
	samplingChoices,
	samplingKnobs,
	samplingOnPairChange,
	seededSamplingFor,
	setDial,
	showsWorkflowField,
	updateParams,
	usedByLine,
	whatRuns
} from "./loadoutSheet"
import { summary } from "./loadoutFixtures"

const TRANSFORMS = [
	{ id: "text->text", label: "Chat", output: "text", defaultLoadoutId: 1 },
	{
		id: "text->image",
		label: "Images",
		output: "image",
		defaultLoadoutId: null
	}
]

function model(over: Partial<CapabilityModel> = {}): CapabilityModel {
	return {
		id: 1,
		name: "llama-3",
		model: "llama-3",
		enabled: true,
		missingSince: null,
		satisfiableCapabilities: ["text->text"],
		...over
	}
}
function connection(
	over: Partial<CapabilityConnection> = {}
): CapabilityConnection {
	return {
		id: 1,
		name: "Local",
		type: "ollama",
		models: [model()],
		modelsSync: { at: null, error: null },
		...over
	}
}

describe("the header", () => {
	test("a shipped default reads its prose and its job, its star locked on", () => {
		const l = summary({ defaultFor: "text->text" })
		const h = editorHeader(l, draftOf(l), TRANSFORMS)
		expect(h.title).toBe("Reply")
		expect(h.owner).toBe("Core")
		expect(h.editable).toBe(false)
		expect(h.canDelete).toBe(false)
		expect(h.defaultLabel).toBe("Default for Chat")
		expect(h.defaultLocked).toBe(true)
		expect(h.usedBy).toBe("Used by 0 steps")
	})

	test("a pub loadout is editable and deletable; the title follows the draft", () => {
		const l = summary({
			owner: "pub",
			mergedInto: 1,
			mergedIntoName: "Reply",
			usedBy: { steps: 1, pipelines: ["Chat"] }
		})
		const h = editorHeader(
			l,
			{ ...draftOf(l), name: "Fast replies" },
			TRANSFORMS
		)
		expect(h.editable).toBe(true)
		expect(h.canDelete).toBe(true)
		expect(h.owner).toBe("Yours")
		expect(h.title).toBe("Fast replies")
		expect(h.defaultLocked).toBe(false)
		expect(h.mergedLine).toBe("Merged into Reply")
		expect(h.usedBy).toBe("Used by 1 step")
	})

	test("a new loadout is editable, named New loadout until typed", () => {
		const h = editorHeader(null, draftOf(null, "text->image"), TRANSFORMS)
		expect(h.title).toBe("New loadout")
		expect(h.slug).toBeNull()
		expect(h.editable).toBe(true)
		expect(h.defaultLabel).toBe("Default for Images")
	})

	test("owner chips: core, a plugin, yours", () => {
		expect(ownerLabel("core")).toBe("Core")
		expect(ownerLabel("pub")).toBe("Yours")
		expect(ownerLabel("acme.rp")).toBe("acme.rp")
		expect(ownerChip("core")).toBeNull()
		expect(ownerChip("acme.rp")).toBe("acme.rp")
		expect(usedByLine(3)).toBe("Used by 3 steps")
	})

	test("three cards, never numbered", () => {
		expect(EDITOR_CARDS.map((c) => c.heading)).toEqual([
			"Model",
			"Sampling",
			"Workflow"
		])
	})
})

describe("what runs", () => {
	const conns = [
		connection({
			id: 1,
			name: "KoboldCPP",
			models: [model({ id: 4, name: "Nemo 12B" })]
		})
	]
	test("filled: connection · model · sampling", () => {
		const l = summary({ connectionId: 1, connectionModelId: 4 })
		expect(whatRuns(l, draftOf(l), conns, "Chat")).toEqual({
			tone: "filled",
			text: "KoboldCPP · Nemo 12B · sampling Chat"
		})
	})
	test("unfilled: says what it falls back to", () => {
		const l = summary({ fallbackName: "Reply" })
		expect(whatRuns(l, draftOf(l), conns, null)).toEqual({
			tone: "unfilled",
			text: "Unfilled — falls back to Reply"
		})
	})
	test("merged: runs as the parent", () => {
		const l = summary({ mergedInto: 2, mergedIntoName: "Reply" })
		expect(whatRuns(l, draftOf(l), conns, null).tone).toBe("merged")
	})
})

describe("saving", () => {
	test("sends only what moved; nothing moved is null", () => {
		const l = summary({
			owner: "pub",
			connectionId: 1,
			connectionModelId: 2
		})
		expect(updateParams(l, draftOf(l))).toBeNull()
		expect(
			updateParams(l, {
				...draftOf(l),
				connectionModelId: 3,
				samplingConfigId: 9
			})
		).toEqual({
			id: 1,
			connectionId: 1,
			connectionModelId: 3,
			samplingConfigId: 9
		})
	})
	test("a shipped loadout never sends its prose", () => {
		const l = summary()
		expect(
			updateParams(l, { ...draftOf(l), name: "Mine", description: "x" })
		).toBeNull()
	})
	test("dials are sent as a whole map, emptied to null", () => {
		const l = summary({ workflowId: 3, workflowValues: { steps: 30 } })
		expect(updateParams(l, { ...draftOf(l), workflowValues: {} })).toEqual({
			id: 1,
			workflowValues: null
		})
		expect(
			updateParams(l, {
				...draftOf(l),
				workflowValues: { steps: 30, cfg: 6 }
			})
		).toEqual({ id: 1, workflowValues: { steps: 30, cfg: 6 } })
	})
	test("the star rides setDefault, only when turned on", () => {
		expect(needsSetDefault(summary(), { isDefault: true })).toBe(true)
		expect(
			needsSetDefault(summary({ defaultFor: "text->text" }), {
				isDefault: true
			})
		).toBe(false)
		expect(needsSetDefault(null, { isDefault: false })).toBe(false)
	})
})

describe("merge targets", () => {
	test("same job only, never itself, never a loop", () => {
		const a = summary({ id: 1 })
		const b = summary({ id: 2, name: "Tools", mergedInto: 1 })
		const c = summary({ id: 3, name: "Chain", mergedInto: 2 })
		const d = summary({ id: 4, name: "Img", transform: "text->image" })
		expect(mergeTargets([a, b, c, d], a).map((l) => l.id)).toEqual([])
		expect(mergeTargets([a, b, c, d], c).map((l) => l.id)).toEqual([1, 2])
	})
})

describe("the Model card's list", () => {
	const conns = [
		connection({
			id: 1,
			name: "Local",
			models: [
				model({ id: 1, name: "llama-3" }),
				model({
					id: 2,
					name: "sdxl",
					satisfiableCapabilities: ["text->image"]
				}),
				model({ id: 3, name: "off", enabled: false })
			]
		}),
		connection({
			id: 2,
			name: "Anthropic",
			type: "anthropic",
			models: [model({ id: 10, name: "Claude" })]
		}),
		connection({
			id: 3,
			name: "Images only",
			models: [
				model({
					id: 20,
					name: "flux",
					satisfiableCapabilities: ["text->image"]
				})
			]
		})
	]
	const none = { connectionId: null, connectionModelId: null }

	test("every model for the job across connections; switched-off ones left out", () => {
		expect(
			modelOptions(conns, "text->text", null, none).map(
				(o) => `${o.connectionTitle}/${o.modelName}`
			)
		).toEqual(["Anthropic/Claude", "Local/llama-3"])
		expect(
			modelOptions(conns, "text->image", null, none).map(
				(o) => o.modelName
			)
		).toEqual(["flux", "sdxl"])
	})

	test("the chosen pair leads", () => {
		const rows = modelOptions(conns, "text->text", null, {
			connectionId: 1,
			connectionModelId: 1
		})
		expect(rows[0]).toMatchObject({ key: "1:1", modelName: "llama-3" })
	})

	test("a filter matches the model or the connection", () => {
		const rows = modelOptions(conns, "text->text", null, none)
		expect(
			filterModelOptions(rows, "anth").map((o) => o.modelName)
		).toEqual(["Claude"])
		expect(
			filterModelOptions(rows, "LLAMA").map((o) => o.modelName)
		).toEqual(["llama-3"])
	})

	test("consequences in the receipt's words, chips for what it does", () => {
		const graded = [
			connection({
				id: 5,
				name: "Host",
				models: [
					model({
						id: 7,
						name: "plain",
						facts: { contextWindow: 32768 } as never
					}),
					{
						...model({ id: 8, name: "schema" }),
						capabilities: { resolved: { json_schema: 2 } }
					} as never
				]
			})
		]
		const rows = modelOptions(
			graded,
			"text->text",
			"core:loadout/extraction@1",
			none
		)
		const plain = rows.find((r) => r.modelName === "plain")!
		expect(plain.consequences).toEqual([
			"JSON by instruction (no schema door)"
		])
		expect(plain.facts).toEqual([]) // the row's own line says the context already
		expect(plain.fact).toBe("33k context")
		const schema = rows.find((r) => r.modelName === "schema")!
		expect(schema.consequences).toEqual([])
		expect(schema.chips).toEqual(["Schema door"])
	})
})

describe("sampling knobs", () => {
	test("text reads temperature and length; image reads steps, cfg, size", () => {
		expect(
			samplingKnobs(
				{
					id: 1,
					name: "Chat",
					values: { temperature: 0.7, responseTokens: 512, topP: 1 },
					enabled: ["temperature", "responseTokens"]
				},
				"text->text"
			)
		).toEqual(["Temperature 0.7", "512 tokens max"])
		expect(
			samplingKnobs(
				{
					id: 2,
					name: "SDXL",
					values: { steps: 30, cfg: 7, width: 1024, height: 1024 },
					enabled: ["steps", "cfg", "width", "height"]
				},
				"text->image"
			)
		).toEqual(["30 steps", "CFG 7", "1024×1024"])
		expect(samplingKnobs(null, "text->text")).toEqual([])
	})
})

describe("the swap rule", () => {
	const options = {
		"text->text": [
			{
				id: 5,
				name: "Default",
				shape: S.textGen,
				seedKey: "sampling-default"
			},
			{ id: 6, name: "Mine", shape: S.textGen, seedKey: null }
		]
	}

	test("a config of the right shape is kept, silently", () => {
		expect(
			samplingOnPairChange(
				{ transform: "text->text", samplingConfigId: 6 },
				options
			)
		).toEqual({ samplingConfigId: 6, notice: null })
	})

	test("a mismatched config swaps to the seeded default and says so", () => {
		const res = samplingOnPairChange(
			{ transform: "text->text", samplingConfigId: 9 },
			options,
			[{ id: 9, name: "SDXL", shape: S.imageGen }]
		)
		expect(res.samplingConfigId).toBe(5)
		expect(res.notice).toBe(
			"SDXL does not fit this model, so sampling is now Default."
		)
	})

	test("the seeded default is core's default loadout's preset", () => {
		expect(seededSamplingFor("text->text", options)?.id).toBe(5)
		expect(seededSamplingFor("text->embedding", options)).toBeNull()
	})
})

describe("the Workflow card", () => {
	test("shows only for a template payload", () => {
		expect(showsWorkflowField({ payload: "template" })).toBe(true)
		expect(showsWorkflowField({ payload: "flat" })).toBe(false)
		expect(showsWorkflowField(null)).toBe(false)
		expect(showsWorkflowField(undefined)).toBe(false)
	})

	test("the Sampling card lists the job's configs, never a workflow's", () => {
		const sd = { id: 1, name: "SD", shape: S.imageGen, seedKey: null }
		expect(samplingChoices({ "text->image": [sd] }, "text->image")).toEqual(
			[sd]
		)
		expect(samplingChoices({ "text->image": [sd] }, "text->text")).toEqual(
			[]
		)
	})

	const variables = [
		{ name: "steps", type: "integer" as const, default: 20 },
		{
			name: "lora_strength",
			type: "number" as const,
			default: 0.8,
			min: 0,
			max: 2
		},
		{ name: "prompt", type: "string" as const },
		{ name: "references.[0].filename", type: "string" as const }
	]

	test("dials: the step-fed names are not dials; each says default or set here", () => {
		const rows = dialRows(variables, { lora_strength: 0.5 })
		expect(rows.map((r) => r.name)).toEqual(["steps", "lora_strength"])
		expect(rows[0]).toMatchObject({
			value: 20,
			setHere: false,
			note: "Default 20"
		})
		expect(rows[1]).toMatchObject({
			label: "Lora strength",
			value: 0.5,
			setHere: true,
			note: "Set here · default 0.8"
		})
	})

	test("moving a dial sets it; back to its default (or emptied) drops it", () => {
		const [steps] = dialRows(variables, {})
		const set = setDial({}, steps!, "30")
		expect(set).toEqual({ steps: 30 })
		expect(setDial(set, steps!, 20)).toEqual({})
		expect(setDial(set, steps!, "")).toEqual({})
	})
})

describe("job doors", () => {
	test("open the default, else core's declared default, else nothing", () => {
		const list = {
			loadouts: [
				summary({ id: 1 }),
				summary({
					id: 7,
					loadoutId: "core:loadout/images@1",
					transform: "text->image"
				})
			],
			transforms: TRANSFORMS
		}
		expect(loadoutForJob("text->text", list)).toBe(1)
		expect(loadoutForJob("text->image", list)).toBe(7)
		expect(loadoutForJob("text->video", list)).toBeNull()
	})
})
