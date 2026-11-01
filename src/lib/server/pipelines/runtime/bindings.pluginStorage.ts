/**
 * 🚧 (M2a) `core:query/plugin-storage@1`'s binding, in its own module (beside
 * `bindings.ts` for the reason `bindings.relationships.ts` gives). The read is
 * the host's `plugin_storage` table; whose storage and which person come from
 * the run, never from a port.
 */
import type { Bindings } from "@serene-pub/sdk"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { CoreQueryCtx, NodeInput } from "./bindingTypes"

export function pluginStorageBindings(): Bindings {
	return {
		"core:query/plugin-storage@1": reads<typeof C.pluginStorage>(
			async (
				input: NodeInput<typeof C.pluginStorage>,
				ctx: CoreQueryCtx
			) => {
				const answer = (await ctx.read("plugin_storage", {
					path: input?.path,
					scope: input?.params?.scope,
					as: input?.params?.as
				})) as { main: unknown; found: boolean }
				return ok({ main: answer.main, found: answer.found })
			},
			{ ports: ["path"], params: ["scope", "as"] }
		)
	}
}
