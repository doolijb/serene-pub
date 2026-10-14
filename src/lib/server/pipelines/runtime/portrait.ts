/**
 * 🚧 Portrait's bindings (DESIGN-image-generation §6.2; I8):
 *
 *  - `core:task/build-proofs@1` — `count` identical series items keyed
 *    `1…n` (`characters/portrait.ts`). Pure: no read, no call.
 *  - `core:outlet/offer-media@1` — each picture into the card's gallery; its
 *    write is the host's (`host.ts` → `characters/portrait.ts`), and this
 *    publishes what it placed on `offered`.
 *
 * The card action inlet binds in `spriteFill.ts`.
 */
import type { Bindings } from "@serene-pub/sdk"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput, OutletCtx } from "./bindingTypes"
import { buildProofs } from "$lib/server/characters/portrait"

export function portraitBindings(): Bindings {
	return {
		"core:task/build-proofs@1": reads<typeof C.buildProofs>(
			async (input: NodeInput<typeof C.buildProofs>) => {
				const series = buildProofs(input?.count)
				return ok({ main: series, series })
			},
			{ ports: ["count"] }
		),
		"core:outlet/offer-media@1": reads<typeof C.offerMedia>(
			async (input: NodeInput<typeof C.offerMedia>, ctx: OutletCtx) => {
				// `written` is the executor's (no write, no event), not a row id.
				const {
					offered,
					written: _,
					...ids
				} = (await ctx.commit(input)) as {
					offered?: unknown
					written?: unknown
				}
				return ok({
					status: "committed",
					ids,
					offered: Array.isArray(offered) ? offered : []
				})
			},
			{ ports: ["media", "characterId"] }
		)
	}
}
