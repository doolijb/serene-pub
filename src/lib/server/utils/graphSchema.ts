/**
 * Response schemas for graph-build LLM calls.
 *
 * Standalone and import-free for the same reason as graphPrompts.ts next door:
 * the prompt and the schema are two halves of one contract, and both are read
 * by callers that must not pull in the LLM machinery.
 */

import type { JsonSchemaNode } from "$lib/server/connectionAdapters/jsonSchemaToGbnf"

export const RELATIONSHIP_STATUSES = [
	"active",
	"resolved",
	"broken",
	"evolved"
] as const

export const RELATIONSHIP_VISIBILITIES = [
	"secret",
	"acknowledged",
	"public"
] as const

/**
 * The perspective-extraction contract, pinned to one subject.
 *
 * `from` is pinned to the subject's literal name as a single-element enum, and
 * that pin is the entire point of this being per-call rather than a constant.
 *
 * What it buys: a perspective call for Corb cannot emit
 * `{"from":"Maren","to":"Corb"}` at all — the decoder masks the tokens. The
 * builder observed exactly that reversal seven times in one build, and used to
 * repair it by swapping the endpoints. Swapping was a guess about whose stance
 * the entry described, so it is gone; a wrong direction is now discarded
 * (parseCharacterPerspectives, `wrongSource`). Making the wrong direction
 * unemittable in the first place is what keeps that stricter rule from costing
 * anything on providers that honour the schema.
 *
 * What it does NOT buy, and must not be claimed: a grammar masks tokens, not
 * meaning. It forces the `from` LABEL to be the subject; it cannot force the
 * `description` to actually be about the subject's stance. The real effect is
 * that committing to a direction before generating the prose biases what
 * follows — genuine, but a bias, not a guarantee.
 *
 * **The subject here MUST be the same one the prompt names.** Measured, by
 * getting it wrong: handing a call whose prompt said `subject.name = "Maren"` a
 * grammar built for "Corb" produced `{"from":"Corb", …}` — the decoder simply
 * overrode the prompt, and the result was well-formed, confident and wrong,
 * passing every downstream check including the `wrongSource` guard. That is the
 * flip side of the constraint working: it wins against the prompt, so the two
 * must agree. Both call sites in graphBuilder read `fromNode.name`, eleven
 * lines apart, which is what keeps them in step — do not introduce a second
 * source for either.
 *
 * `to` is deliberately left a free string rather than pinned to the known
 * cast. Pinning it would eliminate hallucinated targets outright, but it would
 * also make new characters unnameable and take the `new_N` node-minting path
 * dark with it. There is no middle setting: a grammar alternation with a free
 * string is the same as no constraint, because grammars mask tokens, they do
 * not reweight them. `type` is free for the same kind of reason — the prompt
 * invites "a more precise one of your own".
 */
export function buildPerspectiveSchema(subjectName: string): JsonSchemaNode {
	return {
		type: "object",
		additionalProperties: false,
		required: ["relationships"],
		properties: {
			relationships: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"from",
						"to",
						"type",
						"reason",
						"description",
						"status",
						"visibility"
					],
					properties: {
						// A single-element enum rather than `const`: identical
						// meaning, and materially better support across the
						// providers that consume this schema natively.
						from: { type: "string", enum: [subjectName] },
						to: { type: "string" },
						type: { type: "string" },
						reason: { type: "string" },
						description: { type: "string" },
						status: {
							type: "string",
							enum: [...RELATIONSHIP_STATUSES]
						},
						visibility: {
							type: "string",
							enum: [...RELATIONSHIP_VISIBILITIES]
						}
					}
				}
			}
		}
	}
}
