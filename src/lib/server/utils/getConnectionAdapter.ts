import type { AdapterExports } from "../connectionAdapters/BaseConnectionAdapter"
import { ADAPTER_REGISTRY } from "../adapters/registry"

/**
 * The text-family module for a connection type.
 *
 * A lookup over `ADAPTER_REGISTRY` rather than a `switch` of its own: the
 * registry is the single type → module map, and the conformance test that keeps
 * `ADAPTER_MANIFEST` honest walks the same one. Two hand-written copies of the
 * mapping is how a type acquires a capability nothing can deliver.
 *
 * The thunk is still what defers the `import()`, for the reason the registry's
 * header spells out: `@lmstudio/sdk` cannot be parsed at all under
 * nodejs-mobile's V8, so pulling every adapter into the startup module graph
 * crashes server boot on Android whether or not that type is configured.
 *
 * TODO (conformance lane): once every adapter is renamed to its named actions,
 * add the dev-only assertion here that this module's implemented actions match
 * what the manifest declares for `connectionType`. This is the one path where
 * the module is already loaded, so it is the only place a future OUT-OF-TREE
 * adapter can be checked at all — CI can only see the ones in the repo.
 */
export async function getConnectionAdapter(
	connectionType: string
): Promise<AdapterExports> {
	const load = ADAPTER_REGISTRY[connectionType]?.text
	if (!load) throw new Error(`Unsupported connection type: ${connectionType}`)
	return await load()
}
