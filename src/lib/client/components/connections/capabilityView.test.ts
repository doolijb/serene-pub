import { describe, expect, test } from "vitest"
import {
	alsoAbleHeading,
	candidateRows,
	capabilityEntry,
	capabilityStateWord,
	capabilityVerb,
	defaultChipLabel,
	finderNote,
	getModelButtonLabel,
	hiddenSentence,
	kindIcon,
	modelFact,
	nothingCanSentence,
	nothingElseSentence,
	readySentence,
	serviceLabel,
	statusSentence,
	type CapabilityConnection,
	type CapabilityModel,
	modelFactLine,
	localCatalogLine,
	toDownloadSentence
} from "./capabilityView"
import { readinessRow } from "./readiness"

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

describe("the verb, and the copy built from it", () => {
	test("the four sections get a verb of their own", () => {
		expect(capabilityVerb("text->text", "Chat")).toBe("chat")
		expect(capabilityVerb("text->image", "Image generation")).toBe("draw")
		expect(capabilityVerb("text->embedding", "Embeddings")).toBe("embed")
		expect(capabilityVerb("text->entities", "Named entities")).toBe(
			"find entities"
		)
	})
	test("everything else is 'serve <label>', lowercased mid-sentence", () => {
		expect(capabilityVerb("text+image->text", "Vision")).toBe(
			"serve vision"
		)
		expect(capabilityVerb("plugin->thing", "ASR")).toBe("serve ASR")
	})
	test("the heading counts, and says model in the singular", () => {
		expect(alsoAbleHeading("text->text", "Chat", 3)).toBe(
			"Also able to chat · 3 models"
		)
		expect(alsoAbleHeading("text->text", "Chat", 1)).toBe(
			"Also able to chat · 1 model"
		)
		expect(alsoAbleHeading("text->text", "Chat", 0)).toBe(
			"Also able to chat"
		)
	})
	test("the two empty sentences", () => {
		expect(nothingCanSentence("text->image", "Image generation")).toBe(
			"Nothing here can draw yet."
		)
		expect(nothingElseSentence("text->image", "Image generation")).toBe(
			"Nothing else here can draw yet."
		)
	})
	test("the finder door reads as English in both states", () => {
		expect(getModelButtonLabel("Chat", false)).toBe(
			"Get another chat model"
		)
		expect(getModelButtonLabel("Chat", true)).toBe("Get a chat model")
		expect(getModelButtonLabel("Image generation", true)).toBe(
			"Get an image generation model"
		)
		expect(finderNote("Embeddings")).toBe(
			"Opens the model finder scoped to embeddings."
		)
	})
	test("one per install is ACTIVE, everything else is a default", () => {
		expect(defaultChipLabel("text->text")).toBe("Default")
		expect(defaultChipLabel("text->embedding")).toBe("Active")
		expect(defaultChipLabel("text->entities")).toBe("Active")
	})
})

describe("what the status card says", () => {
	test("the state word per readiness state", () => {
		expect(capabilityStateWord("ok")).toBe("Ready")
		expect(capabilityStateWord("unset")).toBe("Not set")
		expect(capabilityStateWord("warning")).toBe("Needs attention")
		expect(capabilityStateWord("pending")).toBe("Downloading")
	})
	test("a ready capability says what it means for what happens next", () => {
		expect(readySentence("text->text")).toContain("Every session replies")
		expect(readySentence("text->embedding")).toContain("re-embeds")
		expect(readySentence("text->entities")).toContain("re-scans")
		// An SDK transform with no hand-written sentence falls back to its tagline.
		expect(readySentence("text+image->text")).toBe(
			"Can look at pictures you send it."
		)
	})
	test("every other state repeats the readiness row, minus the word the headline just said", () => {
		const rows = capabilityEntry([], {}, "text->text")
		const row = readinessRow(rows)
		expect(row.sentence).toBe("Not set · sessions can't reply")
		expect(statusSentence(row)).toBe("sessions can't reply")
	})
	test("a sentence that does not lead with the state word is kept whole", () => {
		const row = {
			...readinessRow(capabilityEntry([], {}, "text->text")),
			state: "warning" as const,
			sentence: "Ollama is switched off · lantern-1 can't run"
		}
		expect(statusSentence(row)).toBe(row.sentence)
	})
	test("a ready row swaps in the promise", () => {
		const conn = connection()
		const entry = capabilityEntry(
			[conn],
			{ "text->text": { connectionId: 1, connectionModelId: 1 } },
			"text->text"
		)
		const row = readinessRow(entry)
		expect(row.state).toBe("ok")
		expect(statusSentence(row)).toBe(readySentence("text->text"))
	})
})

describe("the fact clause", () => {
	test("'ready' is the machine shrugging — a host LISTS a model", () => {
		expect(modelFact(model())).toBe("listed")
	})
	test("a local file says where it is", () => {
		expect(modelFact(model({ local: { state: "on_disk" } }))).toBe(
			"on disk"
		)
		expect(modelFact(model({ local: { loaded: true } }))).toBe("loaded")
		expect(modelFact(model({ local: { state: "not_downloaded" } }))).toBe(
			"not downloaded"
		)
	})
	test("gone from the host, and switched off", () => {
		expect(modelFact(model({ missingSince: "2026-09-01" }))).toBe(
			"not listed"
		)
		expect(modelFact(model({ enabled: false }))).toBe("switched off")
	})
})

describe("the service chip and the kind tile", () => {
	test("the two managed runtimes name themselves", () => {
		expect(serviceLabel({ type: "ollama" })).toBe("Ollama")
		expect(serviceLabel({ type: "koboldcpp_managed" })).toBe("KoboldCPP")
	})
	test("a preset names the service, not the protocol", () => {
		expect(serviceLabel({ type: "openai", preset: "openrouter" })).not.toBe(
			"openai"
		)
	})
	test("a local ONNX row is ONNX", () => {
		expect(serviceLabel({ type: "local-onnx" })).toBe("ONNX")
	})
	test("the tile is the kind's mark", () => {
		expect(kindIcon("ollama")).toBe("Server")
		expect(kindIcon("koboldcpp_managed")).toBe("Cpu")
		expect(kindIcon("local-onnx-ner")).toBe("ScanText")
		expect(kindIcon("openai")).toBe("Cloud")
	})
})

describe("the 'also able to' rows", () => {
	test("one row per pair that can serve it", () => {
		const rows = candidateRows([connection()], "text->text")
		expect(rows.rows).toHaveLength(1)
		expect(rows.rows[0]).toMatchObject({
			connectionId: 1,
			connectionTitle: "Local",
			modelId: 1,
			modelName: "llama-3",
			fact: "listed",
			icon: "Server"
		})
	})
	test("a model that cannot serve it is not a row", () => {
		const conn = connection({
			models: [model({ satisfiableCapabilities: ["text->embedding"] })]
		})
		expect(candidateRows([conn], "text->text").rows).toHaveLength(0)
	})
	test("the pair already registered is not offered again", () => {
		const conn = connection({
			models: [model({ id: 1 }), model({ id: 2, name: "mistral" })]
		})
		const rows = candidateRows([conn], "text->text", {
			connectionId: 1,
			modelId: 1
		})
		expect(rows.rows.map((r) => r.modelId)).toEqual([2])
	})
	test("switched off and not listed are counted, never listed", () => {
		const conn = connection({
			models: [
				model({ id: 1 }),
				model({ id: 2, enabled: false, satisfiableCapabilities: [] }),
				model({
					id: 3,
					missingSince: "2026-09-01",
					satisfiableCapabilities: []
				})
			]
		})
		const rows = candidateRows([conn], "text->text")
		expect(rows.rows.map((r) => r.modelId)).toEqual([1])
		expect(rows.hidden).toBe(2)
		expect(hiddenSentence(rows.hidden)).toBe(
			"2 more are switched off or not listed"
		)
		expect(hiddenSentence(1)).toBe("1 more is switched off or not listed")
		expect(hiddenSentence(0)).toBeNull()
	})
	test("the registered pair is never counted among the ones not shown", () => {
		const conn = connection({
			models: [
				model({ id: 1, enabled: false, satisfiableCapabilities: [] }),
				model({ id: 2, name: "mistral" })
			]
		})
		const rows = candidateRows([conn], "text->text", {
			connectionId: 1,
			modelId: 1
		})
		expect(rows.rows.map((r) => r.modelId)).toEqual([2])
		expect(rows.hidden).toBe(0)
	})
	test("a connection that serves nothing here contributes nothing at all", () => {
		const other = connection({
			id: 9,
			name: "Images",
			models: [
				model({
					id: 90,
					enabled: false,
					satisfiableCapabilities: []
				})
			]
		})
		const rows = candidateRows([connection(), other], "text->text")
		expect(rows.rows.map((r) => r.connectionId)).toEqual([1])
		expect(rows.hidden).toBe(0)
	})
	test("the default's connection comes first, then title order", () => {
		const a = connection({ id: 1, name: "Zebra" })
		const b = connection({
			id: 2,
			name: "Alpha",
			models: [model({ id: 2 })]
		})
		const c = connection({
			id: 3,
			name: "middle",
			models: [model({ id: 3 })]
		})
		const rows = candidateRows([a, b, c], "text->text", { connectionId: 1 })
		expect(rows.rows.map((r) => r.connectionTitle)).toEqual([
			"Zebra",
			"Alpha",
			"middle"
		])
	})
	test("with no default set, plain title order", () => {
		const a = connection({ id: 1, name: "Zebra" })
		const b = connection({
			id: 2,
			name: "Alpha",
			models: [model({ id: 2 })]
		})
		const rows = candidateRows([a, b], "text->text")
		expect(rows.rows.map((r) => r.connectionTitle)).toEqual([
			"Alpha",
			"Zebra"
		])
	})
	// Plan 2026-09-24 A1/C2: the chooser lists what is HERE. A local model
	// that is not downloaded is a count and a door to the finder, and one
	// still arriving is shown but cannot be used — the server refuses both.
	test("local models not downloaded are counted, never listed", () => {
		const conn = connection({
			type: "local-onnx",
			models: [
				model({ id: 1, name: "on-disk", local: { state: "on_disk" } }),
				model({
					id: 2,
					name: "fetchable",
					local: { state: "not_downloaded" }
				}),
				model({
					id: 3,
					name: "arriving",
					local: { state: "downloading" }
				})
			]
		})
		const list = candidateRows([conn], "text->text")
		expect(list.rows.map((r) => r.modelName)).toEqual([
			"on-disk",
			"arriving"
		])
		expect(list.toDownload).toBe(1)
		expect(list.rows.map((r) => r.usable)).toEqual([true, false])
	})
	test("a host's models are always usable", () => {
		expect(candidateRows([connection()], "text->text").rows[0].usable).toBe(
			true
		)
	})
	test("the download line", () => {
		expect(toDownloadSentence(0)).toBeNull()
		expect(toDownloadSentence(1)).toBe("1 more is available to download")
		expect(toDownloadSentence(5)).toBe("5 more are available to download")
	})
	test("a local model's fact carries its size and dimensions", () => {
		expect(
			localCatalogLine({
				state: "not_downloaded",
				catalog: { sizeMb: 35, dimensions: 384 }
			})
		).toBe("35 MB · 384 dimensions")
		expect(localCatalogLine(undefined)).toBe("")
	})
})

describe("the summary entry", () => {
	test("an SDK transform comes from the summary", () => {
		const entry = capabilityEntry([], {}, "text->text")
		expect(entry.label).toBe("Chat")
		expect(entry.set).toBe(false)
		expect(entry.state).toBe("unset")
	})
	test("a registration naming a model that is here resolves", () => {
		const entry = capabilityEntry(
			[connection()],
			{ "text->text": { connectionId: 1, connectionModelId: 1 } },
			"text->text"
		)
		expect(entry.set).toBe(true)
		expect(entry.model?.name).toBe("llama-3")
		expect(entry.connection?.name).toBe("Local")
	})
	test("a transform the SDK does not declare still gets an entry", () => {
		const entry = capabilityEntry([], {}, "text->hologram")
		expect(entry.capability).toBe("text->hologram")
		expect(entry.set).toBe(false)
		expect(entry.stateWord).toBe("not set")
	})
})

describe("modelFactLine — the capability view is a chooser", () => {
	test("puts the facts a choice turns on in front of the state", () => {
		expect(
			modelFact({
				id: 1,
				name: "Claude Sonnet 4.5",
				enabled: true,
				missingSince: null,
				facts: {
					contextWindow: 200000,
					pricing: { inPerMTok: 3, currency: "USD" },
					source: "list"
				}
			})
		).toBe("200k context · $3.00 in")
	})

	test("falls back to the state where the host said nothing", () => {
		// Eight rows each reading "listed" distinguish none of them, but it is
		// still the honest answer when there is no other.
		expect(
			modelFact({
				id: 1,
				name: "gpt-4o",
				enabled: true,
				missingSince: null
			})
		).toBe("listed")
	})

	test("keeps a state that is not merely 'listed'", () => {
		const out = modelFact({
			id: 1,
			name: "bge-small",
			enabled: true,
			missingSince: null,
			facts: { sizeBytes: 133_000_000, source: "list" },
			local: { state: "not_downloaded" }
		} as any)
		expect(out).toContain("133 MB")
		expect(out).not.toBe("133 MB")
	})

	test("the admin's override wins over the host's context", () => {
		expect(
			modelFactLine({
				contextWindow: 8192,
				facts: { contextWindow: 200000, source: "host" }
			})
		).toBe("8k context")
	})

	test("a free model says Free, not $0.00", () => {
		expect(
			modelFactLine({
				facts: {
					pricing: { inPerMTok: 0, currency: "USD" },
					source: "host"
				}
			})
		).toBe("Free")
	})

	test("says nothing at all when the host said nothing", () => {
		expect(modelFactLine({})).toBe("")
	})
})

describe("finderNote — promise only the scope the finder has", () => {
	test("names the scope for the four modalities that have one", () => {
		expect(finderNote("Embeddings", "text->embedding")).toBe(
			"Opens the model finder scoped to embeddings."
		)
		expect(finderNote("Chat", "text->text")).toBe(
			"Opens the model finder scoped to chat."
		)
	})

	test("claims no scope for a capability the finder cannot scope to", () => {
		// The shipped view said "scoped to vision" under a button that lands on
		// Chat: there is no vision list, and a model that can see is a chat
		// model on the same host.
		expect(finderNote("Vision", "text+image->text")).toBe(
			"Opens the model finder."
		)
		expect(finderNote("Speech", "text->audio")).toBe(
			"Opens the model finder."
		)
	})

	test("keeps the old sentence when no capability is given", () => {
		expect(finderNote("Embeddings")).toBe(
			"Opens the model finder scoped to embeddings."
		)
	})
})
