/**
 * Wire mode, resolved: the four layers, the tie-break, and the fallbacks.
 *
 * The tie-break is the interesting one. Two capabilities describe one method,
 * a backend routinely offers both, and something has to say which is used when
 * the caller does not care — that is the "either" default the SDK owns. Every
 * case below is written so that flipping `WIRE_MODE_ORDER` fails it, because a
 * silent flip would change what every existing connection sends.
 */

import { describe, expect, it } from "vitest"
import {
	WIRE_CAPABILITY,
	WIRE_MODE_ORDER,
	resolveCapabilities,
	wireModeOf,
	type CapabilitySet
} from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	adapterCapabilities,
	PRESET_CAPABILITIES
} from "$lib/shared/connectionAdapters/manifest"
import {
	declaredWireModes,
	usesCompletionTemplate,
	wireModeFor
} from "$lib/shared/connectionAdapters/wireMode"

/** The four layers, exactly as `connections/resolve.ts` collapses them. */
const resolvedFor = (
	type: string,
	over: {
		preset?: string
		probe?: CapabilitySet
		overrides?: Record<string, number | false>
	} = {}
): CapabilitySet =>
	resolveCapabilities({
		adapter: adapterCapabilities(type)!,
		preset: over.preset ? PRESET_CAPABILITIES[over.preset] : undefined,
		probe: over.probe,
		overrides: over.overrides as any
	})

describe("the either/or default", () => {
	it("prefers chat when a connection offers both", () => {
		// The tie-break, stated. Chat loses nothing — roles reach the model as
		// roles — while completion has to encode them as delimiters the model
		// must have been trained to read, and carries a second choice (which
		// template) that fails silently when it is wrong.
		expect(wireModeOf({ wire_chat: 1, wire_completion: 1 })).toBe("chat")
		expect(WIRE_MODE_ORDER[0]).toBe("chat")
	})

	it("answers with the only mode a connection has", () => {
		expect(wireModeOf({ wire_completion: 1 })).toBe("completion")
		expect(wireModeOf({ wire_chat: 1 })).toBe("chat")
	})

	it("answers undefined for a set that names neither", () => {
		// A real answer, not a defaulted one: the caller knows what it knows
		// about the connection and decides. `wireModeFor` is where that
		// decision lives for this app.
		expect(wireModeOf({})).toBeUndefined()
		expect(wireModeOf({ "text->text": 1, tools: 2 })).toBeUndefined()
	})

	it("reads grade 0 as off rather than as present", () => {
		// An explicit off resolves to a MISSING key, but a stored set from an
		// older build can carry the zero. Treating it as present would pick a
		// mode the connection has switched off.
		expect(wireModeOf({ wire_chat: 0, wire_completion: 1 })).toBe(
			"completion"
		)
		expect(wireModeOf({ wire_chat: 0 } as CapabilitySet)).toBeUndefined()
	})
})

describe("the four layers decide it", () => {
	it("KoboldCPP offers both and lands on chat", () => {
		// The status quo preserved: `extraJson.useChat ?? true` was chat.
		expect(
			wireModeFor(
				CONNECTION_TYPE.KOBOLDCPP,
				resolvedFor(CONNECTION_TYPE.KOBOLDCPP)
			)
		).toBe("chat")
	})

	it("a hand-set override outranks the adapter's own default", () => {
		// The sentence the capability panel promises, in bytes: "a hand-set
		// value outranks every test that comes after it."
		expect(
			wireModeFor(
				CONNECTION_TYPE.KOBOLDCPP,
				resolvedFor(CONNECTION_TYPE.KOBOLDCPP, {
					overrides: { wire_chat: false }
				})
			)
		).toBe("completion")
	})

	it("the openai-official preset takes completion away, and an override gives it back", () => {
		// The preset is a DEFAULT, not a gate. OpenAI's own API is chat-only in
		// practice, so the preset says so — and somebody who knows better can
		// still switch it on, which is exactly the layering the panel describes.
		const preset = resolvedFor(CONNECTION_TYPE.OPENAI, {
			preset: "openai-official"
		})
		expect(preset.wire_completion).toBeUndefined()
		expect(wireModeFor(CONNECTION_TYPE.OPENAI, preset)).toBe("chat")

		const forced = resolvedFor(CONNECTION_TYPE.OPENAI, {
			preset: "openai-official",
			overrides: { wire_chat: false, wire_completion: 1 }
		})
		expect(wireModeFor(CONNECTION_TYPE.OPENAI, forced)).toBe(
			"completion"
		)
	})

	it("Anthropic cannot be switched to completion by any layer", () => {
		// The GATE, as opposed to the preset default above. The Messages API has
		// no field for one flat prompt, so `wire_completion` is absent from
		// `supports` and `resolveCapabilities` iterates `supports` — an override
		// naming it is inert rather than obeyed.
		const forced = resolvedFor(CONNECTION_TYPE.ANTHROPIC, {
			overrides: { wire_chat: false, wire_completion: 1 }
		})
		expect(forced.wire_completion).toBeUndefined()
		// With chat switched off and completion unreachable, nothing is
		// resolved — and the fallback answers from the type's declaration.
		expect(wireModeFor(CONNECTION_TYPE.ANTHROPIC, forced)).toBe("chat")
	})

	it("llama.cpp DEFAULTS to completion while still offering chat", () => {
		// The supported-but-not-defaulted shape, and the one type that has it.
		// `LlamaCppAdapter` reaches both of llama-server's endpoints now, but
		// every row the 0105 rename touched was being called by `/completion`,
		// so `wire_chat` is declared in `supports` and left out of `defaults`:
		// `resolveCapabilities` gives it a model grade of 0 until somebody
		// raises it. Moving it into `defaults` would silently re-tune every
		// upgrading install on the send path.
		const declared = resolvedFor(CONNECTION_TYPE.LLAMACPP)
		expect(declared.wire_chat).toBeUndefined()
		expect(wireModeFor(CONNECTION_TYPE.LLAMACPP, declared)).toBe(
			"completion"
		)

		// And it is genuinely reachable — an override switches it on, which an
		// ABSENT `supports` key could not do (the Anthropic case above is the
		// inert half of that same contrast).
		const switched = resolvedFor(CONNECTION_TYPE.LLAMACPP, {
			overrides: { wire_chat: 1 }
		})
		expect(switched.wire_chat).toBe(1)
		expect(wireModeFor(CONNECTION_TYPE.LLAMACPP, switched)).toBe("chat")
	})
})

describe("the fallbacks, in order", () => {
	it("falls through to the type's declaration for a set that predates the keys", () => {
		// The real case on every upgrading install: `capabilities.resolved` was
		// written by a build in which these two ids did not exist, so it names
		// neither. Reading the adapter layer alone is not a second resolution of
		// the four — it is the same static read the capability panel makes.
		expect(
			wireModeFor(CONNECTION_TYPE.LLAMACPP, {
				"text->text": 1
			})
		).toBe("completion")
		expect(wireModeFor(CONNECTION_TYPE.KOBOLDCPP, {})).toBe("chat")
		expect(wireModeFor(CONNECTION_TYPE.ANTHROPIC, null)).toBe("chat")
	})

	it("prefers the resolved set over the declaration when it has an answer", () => {
		// The mutation: dropping the first step would make every hand-set
		// override invisible and send the adapter's default forever.
		expect(
			wireModeFor(CONNECTION_TYPE.KOBOLDCPP, { wire_completion: 1 })
		).toBe("completion")
	})

	it("answers chat for a type nothing declares", () => {
		// The last resort, and it is `chat` for the same reason the tie-break
		// is: a flat prompt can always be rebuilt from messages, while a
		// chat-only backend handed a flat payload has no messages to send.
		expect(wireModeFor("no-such-type", {})).toBe("chat")
		expect(wireModeFor(undefined, undefined)).toBe("chat")
	})

	it("only counts a declared mode that is also ON by default", () => {
		// `declaredWireModes` is both halves — `supports` is a gate and
		// `defaults` is a position. Reading `supports` alone would report a mode
		// the type can express but does not offer.
		const declared = declaredWireModes(CONNECTION_TYPE.OPENAI)
		expect(declared[WIRE_CAPABILITY.chat]).toBeGreaterThan(0)
		expect(declared[WIRE_CAPABILITY.completion]).toBeGreaterThan(0)
		expect(declaredWireModes(CONNECTION_TYPE.A1111)).toEqual({})
		expect(declaredWireModes(null)).toEqual({})
	})
})

describe("what the mode is used for", () => {
	it("a completion template has an effect in exactly one mode", () => {
		// The "no control without an effect" rule, in one predicate — the forms
		// and the admin picker both read this rather than each spelling it.
		expect(usesCompletionTemplate("completion")).toBe(true)
		expect(usesCompletionTemplate("chat")).toBe(false)
	})
})
