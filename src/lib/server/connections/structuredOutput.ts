/**
 * Which door a request for structured output goes out through.
 *
 * Three, in decreasing strength, and a step asks for the strongest the
 * connection actually holds:
 *
 *   · **schema** — the shape itself travels. `json_schema` natively on Ollama,
 *     OpenAI and LM Studio; compiled to a grammar on the llama.cpp family,
 *     which is what `EMULATABLE_VIA` already says when it maps `json_schema` to
 *     `grammar`.
 *   · **object** — "answer with JSON", with nothing said about the shape. The
 *     `json_object` door, and where a step lands when it supplied no schema.
 *   · **instruction** — the connection constrains nothing, so the request says
 *     so in words and the reply is parsed the way it always was.
 *
 * ## Why it is a pure function over the capability set
 *
 * Two reasons, and the second is the one that matters. The first is testability:
 * the ladder is three lines and every one of them is a decision somebody will
 * want to see asserted without a database. The second is that the answer has to
 * reach the RECEIPT — a step that asked for a schema and got a sentence
 * produced the same kind of answer by a very different route, and "the model
 * ignored the schema" and "there was no schema on the wire" are the two
 * diagnoses a reader has to be able to tell apart.
 *
 * ## An undetermined connection gets the instruction
 *
 * 0175 left an empty capability set on every row it could not resolve, and
 * `capabilityRefusal` reads emptiness permissively so an untested connection
 * keeps working. That reading is right for a REFUSAL and wrong here: emptiness
 * is not evidence that a backend takes `response_format`, and the instruction
 * door works on every backend there is. So absence lands on the safe rung, and
 * the row upgrades itself the first time somebody tests it.
 */

import { satisfies, topGrade, type CapabilitySet } from "@serene-pub/sdk"

export type StructuredMode = "schema" | "object" | "instruction"

export interface StructuredChoice {
	mode: StructuredMode
	/** The capability the request leans on, or null on the instruction door. */
	capability: "json_schema" | "json_object" | null
	/** Held below this capability's own top band — a grammar, rather than a field. */
	degraded: boolean
}

const held = (have: CapabilitySet, id: "json_schema" | "json_object") => {
	const verdict = satisfies({ requires: [id] }, have)
	if (!verdict.ok) return null
	const grade = verdict.grades[id] ?? 0
	return { grade, degraded: grade < topGrade(id) }
}

/**
 * The ladder. `schema` is only reachable when a schema was actually supplied —
 * asking a service to enforce a shape nobody named is a request with nothing in
 * it.
 */
export function chooseStructuredMode(
	have: CapabilitySet,
	request: { schema?: unknown }
): StructuredChoice {
	if (request.schema) {
		const withSchema = held(have, "json_schema")
		if (withSchema)
			return {
				mode: "schema",
				capability: "json_schema",
				degraded: withSchema.degraded
			}
	}
	const asObject = held(have, "json_object")
	if (asObject)
		return {
			mode: "object",
			capability: "json_object",
			degraded: asObject.degraded
		}
	return { mode: "instruction", capability: null, degraded: false }
}

/**
 * What the instruction door puts on the wire.
 *
 * One sentence, named here rather than written into a prompt, because it is a
 * property of the REQUEST and not of the agent making it: a step whose
 * connection cannot constrain the answer needs it, and the same step on a
 * connection that can must not carry it — a shipped prompt cannot tell those
 * apart, and this decision knows.
 */
export const JSON_INSTRUCTION =
	"Reply with a single JSON object and nothing else. No prose before it, no prose after it, and no code fence around it."
