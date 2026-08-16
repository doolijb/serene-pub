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
				// `string ","` and `(…) ws "}"`, not `string ws ","` — every
				// value owns its trailing ws and the container adds none.
				'root-1 ::= "{" ws "\\"name\\"" ws ":" ws string "," ws "\\"mood\\"" ws ":" ws ("\\"glad\\"" | "\\"sad\\"") ws "}" ws',
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
		// An array of strings is where the old doubling compounded worst:
		// `string` owns a trailing ws, so the previous `ws "," ws` and `ws )?`
		// produced two ambiguous whitespace sites per element.
		expect(grammar).toContain('::= "[" ws ( string ("," ws string)* )? "]" ws')
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

/**
 * Whitespace ownership — see the WHITESPACE OWNERSHIP block in
 * jsonSchemaToGbnf.ts for why this is the thing most worth guarding.
 *
 * Deliberately NOT a search for the token pair `ws ws`. The bug that motivated
 * these tests never emitted that pair: it emitted `string ws`, a reference to a
 * ws-terminal rule followed by an explicit ws — textually innocent, semantically
 * doubled, and ambiguous enough to peg a CPU core inside llama.cpp's grammar
 * filter. A string search would have passed it.
 */
describe("jsonSchemaToGbnf — whitespace ownership", () => {
	/** Tokenises a rule body, keeping quoted literals and char classes whole. */
	function tokenize(body: string): string[] {
		const out: string[] = []
		for (let i = 0; i < body.length; i++) {
			const c = body[i]
			if (c === " " || c === "\t") continue
			if (c === '"' || c === "[") {
				const close = c === '"' ? '"' : "]"
				let j = i + 1
				while (j < body.length && body[j] !== close) {
					if (body[j] === "\\") j++
					j++
				}
				out.push(body.slice(i, j + 1))
				i = j
				continue
			}
			if ("()|*?+".includes(c)) {
				out.push(c)
				continue
			}
			if (c === "{") {
				const j = body.indexOf("}", i)
				out.push(body.slice(i, j + 1))
				i = j
				continue
			}
			let j = i
			while (j < body.length && /[A-Za-z0-9_-]/.test(body[j])) j++
			out.push(body.slice(i, j))
			i = j - 1
		}
		return out.filter(Boolean)
	}

	function parseRules(grammar: string): Map<string, string[]> {
		const rules = new Map<string, string[]>()
		for (const line of grammar.split("\n")) {
			const at = line.indexOf("::=")
			if (at === -1) continue
			rules.set(line.slice(0, at).trim(), tokenize(line.slice(at + 3)))
		}
		return rules
	}

	const GRAMMAR = jsonSchemaToGbnf(buildPerspectiveSchema("Amara Lin"))

	test("no value is followed by an explicit ws it already owns", () => {
		const rules = parseRules(GRAMMAR)
		// A rule is ws-terminal when its body's last token is `ws`.
		const wsTerminal = new Set(
			[...rules].filter(([, t]) => t.at(-1) === "ws").map(([n]) => n)
		)
		// `)` is deliberately not treated as owning: an enum is emitted as
		// `(lit | lit) ws`, where the group holds bare literals and the trailing
		// ws is the one the value is supposed to own. A group whose alternatives
		// were themselves ws-terminal would slip past this — the golden file
		// below is what catches structural drift of that kind.
		const violations: string[] = []
		for (const [name, tokens] of rules) {
			for (let i = 0; i < tokens.length - 1; i++) {
				const owns = tokens[i] === "ws" || wsTerminal.has(tokens[i])
				if (owns && tokens[i + 1] === "ws") {
					violations.push(`${name}: "${tokens[i]} ws"`)
				}
			}
		}
		expect(violations).toEqual([])
	})

	test("every value form ends in exactly one ws, containers included", () => {
		const rules = parseRules(GRAMMAR)
		// Objects and arrays are values too when nested — that is the half of
		// the invariant that is easy to drop, and dropping it forbids
		// whitespace between a closing brace and its following comma.
		for (const name of ["relationships-item-1", "relationships-2", "root-3"]) {
			expect(rules.get(name)!.at(-1)).toBe("ws")
		}
		expect(rules.get("string")!.at(-1)).toBe("ws")
	})

	/**
	 * Golden file. Hand-verified once, boundary by boundary, against llama.cpp's
	 * `grammars/json.gbnf` discipline. If this diffs, re-verify by hand — do not
	 * paste the new output in.
	 */
	test("matches the hand-verified golden grammar", () => {
		expect(GRAMMAR).toBe(
			String.raw`root ::= root-3
relationships-item-1 ::= "{" ws "\"from\"" ws ":" ws ("\"Amara Lin\"") ws "," ws "\"to\"" ws ":" ws string "," ws "\"type\"" ws ":" ws string "," ws "\"reason\"" ws ":" ws string "," ws "\"description\"" ws ":" ws string "," ws "\"status\"" ws ":" ws ("\"active\"" | "\"resolved\"" | "\"broken\"" | "\"evolved\"") ws "," ws "\"visibility\"" ws ":" ws ("\"secret\"" | "\"acknowledged\"" | "\"public\"") ws "}" ws
relationships-2 ::= "[" ws ( relationships-item-1 ("," ws relationships-item-1)* )? "]" ws
root-3 ::= "{" ws "\"relationships\"" ws ":" ws relationships-2 "}" ws
string ::= "\"" char* "\"" ws
char ::= [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4})
ws ::= | " " | "\n" [ \t]{0,20}
`
		)
	})
})
