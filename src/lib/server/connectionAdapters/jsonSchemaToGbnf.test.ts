import { describe, expect, test } from "vitest"
import { jsonSchemaToGbnf, type JsonSchemaNode } from "./jsonSchemaToGbnf"
import { buildPerspectiveSchema } from "$lib/server/utils/graphSchema"

/**
 * Decodes a GBNF string literal back to the characters it matches, so the
 * escaping can be checked semantically rather than by eyeballing backslashes.
 * Inside a GBNF literal only `\"` and `\\` are meaningful for our output.
 */
function decodeGbnfLiteral(literal: string): string {
	const body = literal.slice(1, -1) // strip the surrounding GBNF quotes
	let out = ""
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\\") {
			i++
			out += body[i]
		} else {
			out += body[i]
		}
	}
	return out
}

const pinnedFromLiteral = (grammar: string): string => {
	const line = grammar.split("\n").find((l) => l.includes('\\"from\\"'))!
	// the value expression immediately after the `"from"` key
	const m = line.match(/\\"from\\"" ws ":" ws \((".*?[^\\]")\) ws/)
	return m![1]
}

describe("jsonSchemaToGbnf", () => {
	test("emits a grammar for the shape it is given", () => {
		const schema: JsonSchemaNode = {
			type: "object",
			additionalProperties: false,
			required: ["name", "mood"],
			properties: {
				name: { type: "string" },
				mood: { type: "string", enum: ["glad", "sad"] }
			}
		}
		expect(jsonSchemaToGbnf(schema)).toBe(
			[
				"root ::= root-1",
				'root-1 ::= "{" ws "\\"name\\"" ws ":" ws string ws "," ws "\\"mood\\"" ws ":" ws ("\\"glad\\"" | "\\"sad\\"") ws "}"',
				'string ::= "\\"" char* "\\"" ws',
				'char ::= [^"\\\\\\x7F\\x00-\\x1F] | "\\\\" (["\\\\bfnrt] | "u" [0-9a-fA-F]{4})',
				'ws ::= | " " | "\\n" [ \\t]{0,20}',
				""
			].join("\n")
		)
	})

	test("an array keeps the empty case expressible", () => {
		// `{"relationships": []}` is a legitimate and common answer; a grammar
		// that cannot express it would force the model to invent an entry.
		const grammar = jsonSchemaToGbnf({
			type: "array",
			items: { type: "string" }
		})
		expect(grammar).toContain(
			'::= "[" ws ( string (ws "," ws string)* ws )? "]"'
		)
	})

	describe("escaping — a broken literal hangs a generation rather than failing it", () => {
		test.each([
			["Corb", "plain"],
			['Ka"th', "embedded quote"],
			["Back\\slash", "embedded backslash"],
			['Ka"th\\Vor', "both"],
			["Père D'Or", "unicode and apostrophe"]
		])("round-trips %j (%s)", (name) => {
			const literal = pinnedFromLiteral(
				jsonSchemaToGbnf(buildPerspectiveSchema(name))
			)
			// What the grammar matches must be exactly the JSON encoding of the
			// name — i.e. what a compliant model writes for that value.
			expect(decodeGbnfLiteral(literal)).toBe(JSON.stringify(name))
			// …and parsing that back gives the original name.
			expect(JSON.parse(decodeGbnfLiteral(literal))).toBe(name)
		})
	})

	describe("rejects what it cannot faithfully express", () => {
		test("optional properties", () => {
			expect(() =>
				jsonSchemaToGbnf({
					type: "object",
					additionalProperties: false,
					required: ["a"],
					properties: { a: { type: "string" }, b: { type: "string" } }
				})
			).toThrow(/optional properties are unsupported.*b/)
		})

		test("additionalProperties left open", () => {
			expect(() =>
				jsonSchemaToGbnf({
					type: "object",
					required: ["a"],
					properties: { a: { type: "string" } }
				})
			).toThrow(/additionalProperties:false/)
		})

		test("an unsupported type rather than a silently looser grammar", () => {
			expect(() =>
				jsonSchemaToGbnf({
					type: "object",
					additionalProperties: false,
					required: ["n"],
					properties: { n: { type: "number" } as never }
				})
			).toThrow(/unsupported type "number"/)
		})

		test("const, which several providers handle poorly", () => {
			expect(() =>
				jsonSchemaToGbnf({
					type: "string",
					const: "x"
				} as never)
			).toThrow(/"const" is unsupported/)
		})

		test("maxLength, which would make grammar and schema disagree", () => {
			expect(() =>
				jsonSchemaToGbnf({
					type: "string",
					maxLength: 10
				} as never)
			).toThrow(/"maxLength" is unsupported/)
		})

		test("an empty enum", () => {
			expect(() =>
				jsonSchemaToGbnf({ type: "string", enum: [] })
			).toThrow(/empty enum/)
		})
	})
})

describe("buildPerspectiveSchema", () => {
	const schema = buildPerspectiveSchema("Corb") as any
	const props = schema.properties.relationships.items.properties

	test("pins `from` to the subject and nothing else", () => {
		expect(props.from).toEqual({ type: "string", enum: ["Corb"] })
	})

	test("leaves `to` and `type` free", () => {
		// Pinning `to` to the known cast would take new-character discovery
		// (the `new_N` minting path) down with it; `type` is free because the
		// prompt invites a more precise one than the listed examples.
		expect(props.to).toEqual({ type: "string" })
		expect(props.type).toEqual({ type: "string" })
	})

	test("constrains the two closed vocabularies", () => {
		expect(props.status.enum).toEqual([
			"active",
			"resolved",
			"broken",
			"evolved"
		])
		expect(props.visibility.enum).toEqual([
			"secret",
			"acknowledged",
			"public"
		])
	})

	test("the reversed direction is not expressible", () => {
		// The whole point of the pin: a perspective call for Corb cannot emit
		// {"from":"Maren", …}. Asserted on the grammar, which is what the
		// decoder actually enforces.
		const grammar = jsonSchemaToGbnf(buildPerspectiveSchema("Corb"))
		expect(grammar).toContain('("\\"Corb\\"")')
		expect(grammar).not.toContain("Maren")
	})

	test("converts without throwing for every supported construct it uses", () => {
		expect(() =>
			jsonSchemaToGbnf(buildPerspectiveSchema("Amara Lin"))
		).not.toThrow()
	})
})
