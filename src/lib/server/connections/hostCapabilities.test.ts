/**
 * The host-declared capability layer, end to end through the pair merge
 * (PLAN-composer-attachments phase 5, lane M).
 *
 * The order under test: adapter → preset → HOST-DECLARED → probe → override.
 * Pure — `mergeEndpointModel` and `capabilityRefusal` are both reads, so the
 * rows are literals and no database is opened.
 */
import { describe, expect, it } from "vitest"
import { mergeEndpointModel } from "./models"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { hostDeclaredCapabilities } from "$lib/shared/connections/hostCapabilities"

const VISION = "text+image->text" as const

function endpoint(over: Record<string, unknown> = {}): any {
	return {
		id: 1,
		name: "Endpoint",
		type: CONNECTION_TYPE.OPENAI,
		preset: null,
		baseUrl: "https://openrouter.ai/api/v1",
		promptFormat: null,
		tokenCounter: "estimate",
		extraJson: {},
		capabilities: { resolved: { "text->text": 1 } },
		...over
	}
}

function model(over: Record<string, unknown> = {}): any {
	return {
		id: 10,
		connectionId: 1,
		model: "some/model",
		name: "Some model",
		enabled: true,
		promptFormat: null,
		tokenCounter: null,
		contextWindow: null,
		modality: "text-gen",
		facts: {},
		extraJson: {},
		capabilities: {},
		...over
	}
}

const visionFacts = { inputModalities: ["text", "image"], source: "host" }
const textFacts = { inputModalities: ["text"], source: "host" }

describe("the host-declared layer", () => {
	it("makes an OpenRouter vision model satisfiable for vision with no override", () => {
		const pair = mergeEndpointModel(
			endpoint(),
			model({ model: "qwen/qwen2.5-vl-72b", facts: visionFacts })
		)
		expect(capabilityRefusal(pair, VISION)).toBeNull()
	})

	it("leaves a model whose host said nothing at the adapter's default (off)", () => {
		const pair = mergeEndpointModel(endpoint(), model())
		expect(capabilityRefusal(pair, VISION)).not.toBeNull()
	})

	it("outranks the preset: a text-only model on the OpenRouter preset is not offered images", () => {
		const onPreset = endpoint({ preset: "openrouter" })
		// The preset alone asserts vision for every model on the service…
		expect(capabilityRefusal(mergeEndpointModel(onPreset, model()), VISION)).toBeNull()
		// …and the model's own listing, being about THIS model, wins over it.
		const pair = mergeEndpointModel(
			onPreset,
			model({ model: "deepseek/deepseek-chat", facts: textFacts })
		)
		expect(capabilityRefusal(pair, VISION)).not.toBeNull()
	})

	it("loses to an explicit Off on the connection", () => {
		const pair = mergeEndpointModel(
			endpoint({
				capabilities: {
					resolved: { "text->text": 1 },
					overrides: { [VISION]: false }
				}
			}),
			model({ facts: visionFacts })
		)
		expect(capabilityRefusal(pair, VISION)).not.toBeNull()
	})

	it("loses to an explicit Off on the model", () => {
		const pair = mergeEndpointModel(
			endpoint(),
			model({
				facts: visionFacts,
				capabilities: { overrides: { [VISION]: false } }
			})
		)
		expect(capabilityRefusal(pair, VISION)).not.toBeNull()
	})

	it("loses to a probe, which is what the backend actually answered", () => {
		const pair = mergeEndpointModel(
			endpoint({
				type: CONNECTION_TYPE.KOBOLDCPP,
				capabilities: {
					resolved: { "text->text": 1 },
					probe: { found: { [VISION]: 0 } }
				}
			}),
			model({ facts: visionFacts })
		)
		expect(capabilityRefusal(pair, VISION)).not.toBeNull()
	})

	it("turns Vision on for a managed KoboldCPP model launched with a vision projector", () => {
		const managed = endpoint({
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			baseUrl: "http://localhost:5001"
		})
		const without = mergeEndpointModel(managed, model({ model: "gemma-3-4b.gguf" }))
		expect(capabilityRefusal(without, VISION)).not.toBeNull()
		const withProjector = mergeEndpointModel(
			managed,
			model({
				model: "gemma-3-4b.gguf",
				extraJson: { mmproj: "mmproj-gemma-3-4b-f16.gguf" }
			})
		)
		expect(capabilityRefusal(withProjector, VISION)).toBeNull()
	})

	it("reaches Ollama through the facts its listing now carries", () => {
		const ollama = endpoint({
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost:11434"
		})
		const pair = mergeEndpointModel(
			ollama,
			model({ model: "qwen2.5vl:7b", facts: visionFacts })
		)
		expect(capabilityRefusal(pair, VISION)).toBeNull()
	})
})

describe("hostDeclaredCapabilities", () => {
	it("declares nothing for silence, never a no", () => {
		expect(hostDeclaredCapabilities({ facts: {} })).toBeUndefined()
		expect(hostDeclaredCapabilities({ facts: null })).toBeUndefined()
		expect(
			hostDeclaredCapabilities({ facts: { contextWindow: 8192, source: "host" } })
		).toBeUndefined()
	})

	it("reads a list with and without image as on and off", () => {
		expect(hostDeclaredCapabilities({ facts: visionFacts })).toEqual({ [VISION]: true })
		expect(hostDeclaredCapabilities({ facts: textFacts })).toEqual({ [VISION]: false })
	})

	it("lets a vision projector win over a listing that predates it", () => {
		expect(
			hostDeclaredCapabilities({
				facts: textFacts,
				extraJson: { mmproj: "mmproj.gguf" }
			})
		).toEqual({ [VISION]: true })
		expect(hostDeclaredCapabilities({ extraJson: { mmproj: "  " } })).toBeUndefined()
	})
})
