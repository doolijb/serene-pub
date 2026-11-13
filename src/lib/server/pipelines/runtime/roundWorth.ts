/**
 * 🚧 `core:query/round-worth@1` (owner ruling, 2026-11-11): how many minutes
 * of story time one round is worth — the session's `roundWorth` genre field,
 * read from the settings document and handed on as a number and as a step
 * (`{ by, unit: "minutes" }`) a pipeline may feed to a clock outlet.
 *
 * One value, one writer: the session settings form writes the field; this only
 * reads it. A genre that places no such field, or a session that sets 0, is
 * worth 0 — a pipeline reading 0 moves nothing.
 *
 * ⚠ This is not the clock. It decides nothing and writes nothing: whether a
 * pipeline respects the interval, and what it moves, is that pipeline's.
 */
import type { Bindings } from "@serene-pub/sdk"
import { halt, ok, reads } from "@serene-pub/sdk"
import { ROUND_WORTH_KEY } from "@serene-pub/core-catalog"
import type * as C from "@serene-pub/contracts"
import type { CoreQueryCtx, NodeInput } from "./bindingTypes"

/** What the query publishes. */
export interface RoundWorth {
	minutes: number
	step: { by: number; unit: "minutes" }
}

/** The round worth a settings document states: a whole number above 0, else 0. */
export function roundWorthOf(doc: unknown): RoundWorth {
	const fields = (doc as { fields?: Record<string, unknown> } | null)?.fields
	const v = fields?.[ROUND_WORTH_KEY]
	const minutes =
		typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0
	return { minutes, step: { by: minutes, unit: "minutes" } }
}

export function roundWorthBindings(): Bindings {
	return {
		"core:query/round-worth@1": reads<typeof C.roundWorth>(
			async (
				input: NodeInput<typeof C.roundWorth>,
				ctx: CoreQueryCtx
			) => {
				const doc = await ctx.read("session_settings", {
					sessionId: input?.scope?.sessionId
				})
				if (!doc)
					return halt(
						"there is no session to read the round worth for — the run is scoped to a " +
							"session that no longer exists"
					)
				const w = roundWorthOf(doc)
				return ok({ main: w, minutes: w.minutes, step: w.step })
			},
			{ ports: ["scope"] }
		)
	}
}
