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
 *
 * ── WHITESPACE OWNERSHIP — the invariant this file exists to hold ───────────
 *
 * **Every value rule ends in exactly one `ws`. No container ever emits `ws`
 * after a value.** "Value" includes objects and arrays, because a container is
 * itself a value when nested — hence `"}" ws` and `"]" ws`, mirroring stock.
 *
 * This is not stylistic. Violating it is how this converter shipped a bug that
 * hung KoboldCPP hard enough to look like a crashed subprocess:
 *
 *   string ::= "\"" char* "\"" ws          <- value owns a trailing ws
 *   item   ::= ... ":" ws string ws "," ...  <- container added a second one
 *
 * `ws ws` is *ambiguous*, not merely redundant: any run of whitespace can be
 * split between the two rules in many ways, so every whitespace character
 * multiplies the live parse stacks and per-token grammar filtering cost grows
 * with output length. The process pegs a core — busy, never finishing — so it
 * stops answering health probes and reads as dead rather than as a bad grammar.
 * Nothing errors, nothing completes.
 *
 * Note the shape of that mistake: the primitives above were canonical, and the
 * defect still landed, because the *structure* around them was hand-authored.
 * A schema→GBNF compiler is a hand-authored grammar with extra steps. Keeping
 * the primitives verbatim buys nothing on its own.
 *
 * Guarded by a golden-file snapshot of the perspective grammar rather than a
 * search for the token pair `ws ws` — the original defect never emitted that
 * pair. It emitted `string ws`: a reference to a ws-terminal rule followed by
 * an explicit ws, textually innocent and semantically doubled.
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
				// Trailing `ws` so an enum is a value like any other — see
				// WHITESPACE OWNERSHIP above. `string` already carries one.
				return `(${node.enum.map(gbnfLiteral).join(" | ")}) ws`
			}
			return "string"
		}

		if (node.type === "array") {
			const item = build(node.items, `${hint}-item`)
			const name = ruleName(hint)
			// The `( ... )?` arm is what keeps the empty array expressible —
			// `{"relationships": []}` is a legitimate, and common, answer.
			//
			// No `ws` before `,` or `]`: the item is a value and owns its own
			// trailing `ws`. The `ws` after `]` is this rule paying that same
			// debt for whoever contains it. See WHITESPACE OWNERSHIP above.
			rules.push(
				`${name} ::= "[" ws ( ${item} ("," ws ${item})* )? "]" ws`
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
			// `KEY ws ":"` — the key is a raw literal and owns no trailing `ws`,
			// so this boundary needs one explicitly. (Stock json.gbnf gets it
			// free by using its `string` rule as the key.) The value that
			// follows owns its own, so nothing is added before `,` or `}`.
			const parts = keys.map(
				(k) =>
					`${gbnfLiteral(k)} ws ":" ws ${build(node.properties[k], k)}`
			)
			const name = ruleName(hint)
			rules.push(`${name} ::= "{" ws ${parts.join(' "," ws ')} "}" ws`)
			return name
		}

		throw new Error(
			`jsonSchemaToGbnf: unsupported type "${(node as { type: string }).type}" at "${hint}"`
		)
	}

	const rootRef = build(root, "root")
	return [`root ::= ${rootRef}`, ...rules, ...PRIMITIVES].join("\n") + "\n"
}
