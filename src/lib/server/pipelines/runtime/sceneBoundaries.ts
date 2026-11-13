/**
 * 🚧 `core:query/scene-boundaries@1` (owner ruling, 2026-11-12): where the
 * session's scenes begin, for the scenes routine (`core:spec/scene-boundaries`)
 * — the lines on `main` at least `depth` rounds old where a boundary trigger
 * fired and still holds, in line order, as `SceneBoundary[]`. The walk is
 * `sceneBoundariesOf` (`scenes/boundaryWatcher.ts`); `every` is the routine's
 * own cadence (`n` rounds), read off the routine port.
 *
 * It writes nothing: a query never does. The routine places each boundary
 * through `core:outlet/propose-scene-cue@1`.
 *
 * ⚠ Not the judged scene check (the sweep's `core:task/sweep-duties@1`, a
 * model's call) — this asks no model.
 */
import type { Bindings } from "@serene-pub/sdk"
import { halt, ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput } from "./bindingTypes"

/** A whole number of at least 1, else the fallback. */
const wholeOr = (v: unknown, fallback: number): number =>
	typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : fallback

export function sceneBoundariesBindings(): Bindings {
	return {
		"core:query/scene-boundaries@1": reads<typeof C.sceneBoundaries>(
			async (input: NodeInput<typeof C.sceneBoundaries>) => {
				const sessionId = input?.scope?.sessionId
				if (sessionId === undefined)
					return halt(
						"there is no session to look for scene boundaries in — the run is not scoped to a session"
					)
				const routine = input?.routine as
					| { cadence?: { options?: { n?: unknown } } }
					| undefined
				const depth = wholeOr(input?.params?.depth, 2)
				// The cadence's own default when `n` is absent (`EVERY_N_ROUNDS`).
				const every = wholeOr(routine?.cadence?.options?.n, 2)
				const db = (await import("$lib/server/db")).db as never
				const { sceneBoundariesOf } = await import(
					"$lib/server/scenes/boundaryWatcher"
				)
				const result = await sceneBoundariesOf(db, sessionId, {
					depth,
					every
				})
				return ok({ main: result.boundaries })
			},
			{ ports: ["scope", "routine"], params: ["depth"] }
		)
	}
}
