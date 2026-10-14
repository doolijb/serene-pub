/**
 * 🚧 The Sprite set fill's bindings (DESIGN-image-generation §6.3; I5):
 *
 *  - `core:inlet/card-action@1` — the identity, like every inlet: the host
 *    resolved the card and the form before the run (`runCardAction`).
 *  - `core:task/build-sprite-series@1` — one image series item per sprite
 *    label, each with its phrase off the *Sprite label phrases* row
 *    (`sprites/fill.ts`). Pure: no read, no call.
 *
 * `core:outlet/attach-sprite@1` binds in `bindings.ts`, beside
 * `show-sprite`; its write is the host's (`sprites/attach.ts`).
 */
import type { Bindings } from "@serene-pub/sdk"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput } from "./bindingTypes"
import { buildSpriteSeries } from "$lib/server/sprites/fill"

export function spriteFillBindings(): Bindings {
	return {
		"core:inlet/card-action@1": reads<typeof C.cardAction>(
			async (input: NodeInput<typeof C.cardAction>) => ok(input),
			{ ports: [] }
		),
		"core:task/build-sprite-series@1": reads<typeof C.buildSpriteSeries>(
			async (input: NodeInput<typeof C.buildSpriteSeries>) => {
				const { series, labels } = buildSpriteSeries({
					labels: input?.labels,
					phrases: (input?.prompts as { phrases?: unknown } | undefined)
						?.phrases,
					likeness: input?.likeness,
					likenessNegative: input?.likenessNegative
				})
				return ok({ main: series, series, labels })
			},
			{ ports: ["labels", "likeness", "likenessNegative", "prompts"] }
		)
	}
}
