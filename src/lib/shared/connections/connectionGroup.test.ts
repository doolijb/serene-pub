import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { connectionGroupOf } from "./connectionGroup"

/**
 * The embedding types, filed where the connections index shows them. A
 * label only — Search by meaning searches with any of them alike (owner,
 * 2026-09-30).
 */
describe("connectionGroupOf — every type that can embed", () => {
	test("a model this pub runs, or a runtime on this network, is local", () => {
		expect(connectionGroupOf(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)).toBe(
			"local"
		)
		expect(connectionGroupOf(CONNECTION_TYPE.OLLAMA)).toBe("local")
		expect(connectionGroupOf(CONNECTION_TYPE.OLLAMA_EMBEDDINGS)).toBe(
			"local"
		)
	})

	test("a runtime you run yourself is local, whether or not this pub started it", () => {
		// The type's own category, the one the New connection picker files it
		// by. A KoboldCPP on localhost serving an embedding model is not the
		// expensive call (review 2026-09-29: it used to be filed a service).
		expect(connectionGroupOf(CONNECTION_TYPE.KOBOLDCPP)).toBe("local")
		expect(connectionGroupOf(CONNECTION_TYPE.KOBOLDCPP_MANAGED)).toBe(
			"local"
		)
		expect(connectionGroupOf(CONNECTION_TYPE.LM_STUDIO)).toBe("local")
		expect(connectionGroupOf(CONNECTION_TYPE.LLAMACPP)).toBe("local")
		expect(connectionGroupOf(CONNECTION_TYPE.A1111)).toBe("local")
	})

	test("a hosted API is a service", () => {
		expect(connectionGroupOf(CONNECTION_TYPE.OPENAI)).toBe("service")
		expect(connectionGroupOf(CONNECTION_TYPE.ANTHROPIC)).toBe("service")
		// The type the OpenAI embeddings API itself uses, so a service even
		// when it points at an LM Studio: the type is the claim.
		expect(connectionGroupOf(CONNECTION_TYPE.OPENAI_EMBEDDINGS)).toBe(
			"service"
		)
	})

	test("the group is the type's category, for every declared type", () => {
		for (const o of CONNECTION_TYPE.options)
			expect(connectionGroupOf(o.value), o.value).toBe(
				o.category === "local" ? "local" : "service"
			)
	})

	test("no type at all, or one nobody declared, is not a claim to be local", () => {
		expect(connectionGroupOf(null)).toBe("service")
		expect(connectionGroupOf(undefined)).toBe("service")
		expect(connectionGroupOf("some-plugin-type")).toBe("service")
	})
})
