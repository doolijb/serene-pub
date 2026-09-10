/**
 * Whether a connection can continue a partial reply — the one derivation.
 *
 * Every case below is a failure that would be SILENT: a Continue button that
 * fires and produces a fresh reply glued onto the old one, or a button greyed
 * out on a connection that would have prefilled perfectly. Neither looks wrong.
 */
import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	CONTINUE_REPLY,
	continueRefusal,
	continueWireModes,
	continuesReply
} from "./continueReply"
import { adapterCapabilities } from "./manifest"

describe("which wire modes carry a continuation", () => {
	test("the completion-capable types carry it in completion wire and nowhere else", () => {
		for (const type of [
			CONNECTION_TYPE.OPENAI,
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.KOBOLDCPP,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			CONNECTION_TYPE.LLAMACPP,
			CONNECTION_TYPE.LM_STUDIO
		])
			expect(continueWireModes(type), type).toEqual(["completion"])
	})

	test("Anthropic carries it in CHAT wire — the Messages API prefills natively", () => {
		expect(continueWireModes(CONNECTION_TYPE.ANTHROPIC)).toEqual(["chat"])
	})

	test("an image-only type carries it nowhere, and declares nothing", () => {
		expect(continueWireModes(CONNECTION_TYPE.A1111)).toEqual([])
		expect(
			adapterCapabilities(CONNECTION_TYPE.A1111)?.supports[CONTINUE_REPLY]
		).toBeUndefined()
	})

	test("a type nobody declares carries it nowhere rather than throwing", () => {
		expect(continueWireModes("not-a-type")).toEqual([])
	})
})

describe("the effective answer is the capability AND the wire it is sent on", () => {
	test("OpenAI-compatible in COMPLETION wire continues: the seed block is left open", () => {
		expect(
			continuesReply(CONNECTION_TYPE.OPENAI, {
				continue_reply: 1,
				wire_completion: 1
			})
		).toBe(true)
	})

	test("OpenAI-compatible in CHAT wire does NOT — the seed would be a closed turn", () => {
		// The whole point of the capability: a trailing `{role:"assistant"}`
		// message is the chat template's business, not a prefill, and whether
		// the model carries on or starts again is not ours to promise.
		expect(
			continuesReply(CONNECTION_TYPE.OPENAI, {
				continue_reply: 1,
				wire_chat: 1,
				wire_completion: 1
			})
		).toBe(false)
	})

	test("the capability switched off refuses even in a wire that could carry it", () => {
		expect(
			continuesReply(CONNECTION_TYPE.OPENAI, { wire_completion: 1 })
		).toBe(false)
	})

	test("Anthropic continues in its only wire, once the capability is on", () => {
		expect(
			continuesReply(CONNECTION_TYPE.ANTHROPIC, {
				continue_reply: 1,
				wire_chat: 1
			})
		).toBe(true)
	})

	test("Anthropic is OFF until somebody says so — the API prefills, the model may not", () => {
		// `{unproven: true, until: "none"}` in the manifest, and NOT in
		// `defaults`: Claude 4.6 and later reject a trailing assistant turn with
		// a 400, and this layer grades the FORMAT, not the model.
		const declared = adapterCapabilities(CONNECTION_TYPE.ANTHROPIC)
			?.supports[CONTINUE_REPLY]
		expect(declared).toEqual({ unproven: true, until: "none" })
		expect(
			adapterCapabilities(CONNECTION_TYPE.ANTHROPIC)?.defaults
		).not.toContain(CONTINUE_REPLY)
		expect(
			continuesReply(CONNECTION_TYPE.ANTHROPIC, { wire_chat: 1 })
		).toBe(false)
	})
})

describe("the refusal says what to do about it, in plain language", () => {
	test("a wire that cannot carry it names the wire and the other mode", () => {
		const reason = continueRefusal(CONNECTION_TYPE.OPENAI, {
			continue_reply: 1,
			wire_chat: 1,
			wire_completion: 1
		})
		expect(reason).toContain("Chat messages")
		expect(reason).toContain("Text completion")
		// Never the id, never "wire_chat" — a person reads this on a button.
		expect(reason).not.toContain("wire_")
		expect(reason).not.toContain("continue_reply")
	})

	test("a capability switched off points at where the switch is", () => {
		const reason = continueRefusal(CONNECTION_TYPE.ANTHROPIC, {
			wire_chat: 1
		})
		expect(reason).toContain("Continue a reply")
		expect(reason).toMatch(/capabilit/i)
	})

	test("a type that cannot do it at all says so without offering a switch", () => {
		const reason = continueRefusal(CONNECTION_TYPE.A1111, {})
		expect(reason).toBeTruthy()
		expect(reason).not.toMatch(/switch it on|turn it on/i)
	})

	test("null — and only null — means the button stays live", () => {
		expect(
			continueRefusal(CONNECTION_TYPE.KOBOLDCPP, {
				continue_reply: 1,
				wire_completion: 1
			})
		).toBeNull()
	})
})
