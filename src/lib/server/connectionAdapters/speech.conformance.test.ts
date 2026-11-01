/**
 * Lane V2: the speech family against the manifest. Every connection type whose
 * manifest declares `text->audio` has a registry `speech` module, and the other
 * way round; each module's class defines `synthesizeSpeech` and nothing else.
 * (`manifest.conformance.test.ts` does not walk the `speech` slot; this file
 * does, with the speech base as the stop class.)
 */
import { beforeAll, describe, expect, test } from "vitest"
import {
	ADAPTER_REGISTRY,
	REGISTERED_CONNECTION_TYPES
} from "$lib/server/adapters/registry"
import { actionsOf } from "$lib/server/adapters/actions"
import type { ActionName } from "$lib/shared/connectionAdapters/actions"
import { BaseSpeechAdapter } from "./speech/BaseSpeechAdapter"
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const SPEAKING = [
	CONNECTION_TYPE.OPENAI,
	CONNECTION_TYPE.OLLAMA,
	CONNECTION_TYPE.KOBOLDCPP,
	CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	CONNECTION_TYPE.AUDIOCPP,
	CONNECTION_TYPE.AUDIOCPP_MANAGED,
	CONNECTION_TYPE.ELEVENLABS
].sort()

const declares = (type: string) =>
	"text->audio" in (adapterCapabilities(type)?.supports ?? {})

const found = new Map<string, Set<ActionName>>()
const modules = new Map<string, Awaited<ReturnType<NonNullable<(typeof ADAPTER_REGISTRY)[string]["speech"]>>>>()

beforeAll(async () => {
	for (const type of REGISTERED_CONNECTION_TYPES) {
		const load = ADAPTER_REGISTRY[type]?.speech
		if (!load) continue
		const mod = await load()
		modules.set(type, mod)
		found.set(type, actionsOf(mod.Adapter, BaseSpeechAdapter))
	}
}, 60_000)

describe("speech registry <-> manifest `text->audio`", () => {
	test("exactly the seven speaking types declare text->audio", () => {
		expect(REGISTERED_CONNECTION_TYPES.filter(declares).sort()).toEqual(SPEAKING)
	})
	test("exactly the seven speaking types register a speech module", () => {
		expect(REGISTERED_CONNECTION_TYPES.filter((t) => ADAPTER_REGISTRY[t]?.speech).sort()).toEqual(SPEAKING)
	})
	test.each(REGISTERED_CONNECTION_TYPES.map((t) => [t]))("%s: declares text->audio iff it has a speech module", (type) => {
		expect(declares(type)).toBe(!!ADAPTER_REGISTRY[type]?.speech)
	})
	test.each(SPEAKING.map((t) => [t]))("%s: the module's class defines synthesizeSpeech and no other action", (type) => {
		expect([...(found.get(type) ?? [])]).toEqual(["synthesizeSpeech"])
	})
	test.each(SPEAKING.map((t) => [t]))("%s: the class derives from BaseSpeechAdapter", (type) => {
		expect(modules.get(type)!.Adapter.prototype instanceof BaseSpeechAdapter).toBe(true)
	})
	test("speech-only types (audiocpp, audiocpp_managed, elevenlabs) list and test on their own; shared types do not", () => {
		for (const t of [CONNECTION_TYPE.AUDIOCPP, CONNECTION_TYPE.AUDIOCPP_MANAGED, CONNECTION_TYPE.ELEVENLABS]) {
			expect(typeof modules.get(t)!.listModels, t).toBe("function")
			expect(typeof modules.get(t)!.testConnection, t).toBe("function")
		}
		for (const t of [CONNECTION_TYPE.OPENAI, CONNECTION_TYPE.OLLAMA, CONNECTION_TYPE.KOBOLDCPP, CONNECTION_TYPE.KOBOLDCPP_MANAGED]) {
			expect(modules.get(t)!.listModels, t).toBeUndefined()
			expect(modules.get(t)!.testConnection, t).toBeUndefined()
		}
	})
	test("every speech module can discover facts", () => {
		for (const t of SPEAKING) expect(typeof modules.get(t)!.discoverSpeechFacts, t).toBe("function")
	})
	test("the speech-only types' manifest grade is native; the shared types' is unproven", () => {
		for (const t of [CONNECTION_TYPE.AUDIOCPP, CONNECTION_TYPE.ELEVENLABS])
			expect((adapterCapabilities(t)!.supports as any)["text->audio"]).toBe("native")
		for (const t of [CONNECTION_TYPE.OPENAI, CONNECTION_TYPE.OLLAMA, CONNECTION_TYPE.KOBOLDCPP, CONNECTION_TYPE.KOBOLDCPP_MANAGED])
			expect((adapterCapabilities(t)!.supports as any)["text->audio"]).toMatchObject({ unproven: true })
	})
})
