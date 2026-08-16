/**
 * Pull the first complete JSON object out of an LLM response.
 *
 * Lived inside graphBuilder.ts as a module-private helper while
 * `summarizer/index.ts` did the same job with `raw.match(/\{[\s\S]*\}/)` — a
 * greedy slice that runs to the LAST `}` in the response, so any trailing
 * commentary ("...} Hope that helps!") or a second object drags along with it
 * and `JSON.parse` fails on input this walker handles fine.
 *
 * It could not simply be exported from there: graphBuilder imports from
 * ./summarizer, so summarizer importing back would be a cycle. Hence a neutral
 * module both can depend on.
 *
 * The walk tracks brace depth while respecting string literals and escapes, so
 * braces inside strings ("a } in text") do not terminate the object early.
 */

/** Thrown when no parseable object can be found. Carries the raw text for diagnostics. */
export class JsonExtractionError extends Error {
	public raw: string
	public truncated: boolean
	constructor(message: string, raw: string, truncated = false) {
		super(message)
		this.name = "JsonExtractionError"
		this.raw = raw
		this.truncated = truncated
	}
}

/**
 * Returns the substring spanning the first balanced `{...}`, with any markdown
 * code fence stripped first.
 *
 * @throws JsonExtractionError when there is no `{`, or no matching `}`.
 */
export function extractJson(raw: string): string {
	const stripped = raw
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/, "")
		.trim()
	const start = stripped.indexOf("{")
	if (start === -1)
		throw new JsonExtractionError(
			"No JSON object found in LLM response",
			raw
		)

	let depth = 0
	let inString = false
	let escape = false
	for (let i = start; i < stripped.length; i++) {
		const ch = stripped[i]
		if (escape) {
			escape = false
			continue
		}
		if (ch === "\\" && inString) {
			escape = true
			continue
		}
		if (ch === '"') {
			inString = !inString
			continue
		}
		if (inString) continue
		if (ch === "{") depth++
		else if (ch === "}") {
			if (--depth === 0) return stripped.slice(start, i + 1)
		}
	}
	// Ran out of input mid-object — almost always a response cut short by the
	// token limit, which is worth distinguishing from "there was never any JSON".
	throw new JsonExtractionError(
		"No complete JSON object found in LLM response",
		raw,
		true
	)
}

/** True if `raw` contains a complete JSON object. */
export function hasJsonObject(raw: string): boolean {
	try {
		extractJson(raw)
		return true
	} catch {
		return false
	}
}
