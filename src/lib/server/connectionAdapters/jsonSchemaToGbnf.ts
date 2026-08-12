/**
 * Minimal JSON Schema → GBNF converter.
 *
 * Covers exactly the subset this app's structured-output schemas use and
 * THROWS on anything else. That is the whole design: a converter that silently
 * ignores a keyword it does not understand emits a grammar looser than the
 * schema it claims to implement, and the symptom is bad extractions weeks
 * later rather than an error at the call site.
 *
 * Supported:
 *   { type: "object", properties, required: <every key>, additionalProperties: false }
 *   { type: "array",  items }
 *   { type: "string" }
 *   { type: "string", enum: [...] }      // a single-element enum is a value pin
 *
 * Deliberately unsupported — add here WITH A TEST when a schema needs one:
 * optional properties, numbers, booleans, null, nested combinators
 * (oneOf/anyOf/allOf), `const`, and `maxLength`.
 *
 * Two intentional narrowings versus the JSON Schema it is given:
 *
 *  - **Key order is fixed.** JSON Schema permits object keys in any order; a
 *    grammar cannot express that without a combinatorial blowup. Every parser
 *    in this app reads by key, so the narrowing is invisible downstream, and
 *    providers that take the JSON Schema natively still accept any order.
 *  - **All properties are required.** Enforced rather than assumed: a schema
 *    whose `required` omits a key is rejected, so an optional field can never
 *    be silently promoted to mandatory by this converter.
 *
 * The `string` / `char` / `ws` primitives are lifted verbatim from llama.cpp's
 * shipped `grammars/json.gbnf` — the same source as JSON_OBJECT_GBNF next door,
 * and for the same reason: see the warning there about hand-authored grammars
 * producing hangs rather than parse errors. `char*` is unbounded exactly as
 * upstream has it; `max_tokens` is the backstop, and bounded repetition big
 * enough to hold a sentence expands to a grammar large enough to be its own
 * problem.
 */

export type JsonSchemaNode =
	| {
			type: "object"
			properties: Record<string, JsonSchemaNode>
			required?: string[]
			additionalProperties?: boolean
	  }
	| { type: "array"; items: JsonSchemaNode }
	| { type: "string"; enum?: string[] }

/**
 * A GBNF literal matching the JSON encoding of `value`, quotes included.
 *
 * Two layers of escaping, which is the part that is easy to get wrong and the
 * reason this is a named function with its own tests: JSON.stringify produces
 * the JSON form (`Ka"th` → `"Ka\"th"`), then `"` and `\` are escaped again for
 * the GBNF literal that wraps it. A character named with a quote or backslash
 * produces a broken grammar without this — and a broken grammar hangs a
 * generation instead of failing it.
 */
function gbnfLiteral(value: string): string {
	const json = JSON.stringify(value)
	return `"${json.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

const PRIMITIVES = [
	String.raw`string ::= "\"" char* "\"" ws`,
	String.raw`char ::= [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4})`,
	String.raw`ws ::= | " " | "\n" [ \t]{0,20}`
]

export function jsonSchemaToGbnf(root: JsonSchemaNode): string {
	const rules: string[] = []
	let counter = 0

	const ruleName = (hint: string) => {
		const safe = hint.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()
		return `${safe || "node"}-${++counter}`
	}

	function build(node: JsonSchemaNode, hint: string): string {
		if (!node || typeof node !== "object" || !("type" in node)) {
			throw new Error(
				`jsonSchemaToGbnf: expected a schema node with a "type" at "${hint}"`
			)
		}

		if (node.type === "string") {
			if ("const" in node) {
				throw new Error(
					`jsonSchemaToGbnf: "const" is unsupported at "${hint}" — use a single-element enum, which more providers accept natively`
				)
			}
			if ("maxLength" in node) {
				throw new Error(
					`jsonSchemaToGbnf: "maxLength" is unsupported at "${hint}" — it would make the grammar and the schema disagree`
				)
			}
			if (node.enum) {
				if (node.enum.length === 0) {
					throw new Error(
						`jsonSchemaToGbnf: empty enum at "${hint}" — nothing would be generatable`
					)
				}
				return `(${node.enum.map(gbnfLiteral).join(" | ")})`
			}
			return "string"
		}

		if (node.type === "array") {
			const item = build(node.items, `${hint}-item`)
			const name = ruleName(hint)
			// The `( ... )?` arm is what keeps the empty array expressible —
			// `{"relationships": []}` is a legitimate, and common, answer.
			rules.push(
				`${name} ::= "[" ws ( ${item} (ws "," ws ${item})* ws )? "]"`
			)
			return name
		}

		if (node.type === "object") {
			const keys = Object.keys(node.properties ?? {})
			if (keys.length === 0) {
				throw new Error(
					`jsonSchemaToGbnf: object with no properties at "${hint}"`
				)
			}
			if (node.additionalProperties !== false) {
				throw new Error(
					`jsonSchemaToGbnf: object at "${hint}" must set additionalProperties:false — the grammar admits no extra keys, so the schema must say so too`
				)
			}
			const required = node.required ?? []
			const missing = keys.filter((k) => !required.includes(k))
			if (missing.length > 0) {
				throw new Error(
					`jsonSchemaToGbnf: optional properties are unsupported at "${hint}" (${missing.join(", ")}) — the grammar would make them mandatory`
				)
			}
			const parts = keys.map(
				(k) =>
					`${gbnfLiteral(k)} ws ":" ws ${build(node.properties[k], k)}`
			)
			const name = ruleName(hint)
			rules.push(`${name} ::= "{" ws ${parts.join(' ws "," ws ')} ws "}"`)
			return name
		}

		throw new Error(
			`jsonSchemaToGbnf: unsupported type "${(node as { type: string }).type}" at "${hint}"`
		)
	}

	const rootRef = build(root, "root")
	return [`root ::= ${rootRef}`, ...rules, ...PRIMITIVES].join("\n") + "\n"
}
