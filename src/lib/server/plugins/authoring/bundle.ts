/**
 * The plugin bundler preset (author-side).
 *
 * A plugin ships as one self-contained CJS bundle — its own code plus its
 * pure-JS dependencies inlined at build time, so the app never resolves a
 * node_modules or runs `npm install`. This is the esbuild preset that produces
 * it, and the guard that makes the sandbox contract legible at build time:
 * importing a Node builtin the sandbox withholds (`fs`, `net`, `http`,
 * `child_process`, …) is a **build error** pointing the author at `ctx`
 * instead. Pure-JS deps bundle normally; anything reaching for real OS/IO fails
 * here rather than at install.
 *
 * Output is `format: "cjs"` assigning `module.exports = { hooks, … }`, which is
 * exactly what the runtime evaluates. `target: es2021` stays inside QuickJS-ng's
 * language support so a bundle that avoids WASM/Intl runs on both backends.
 *
 * Reference implementation; the published SDK re-exports it. esbuild is the only
 * dependency, matched to what the toolchain already carries.
 */

import * as esbuild from "esbuild"

/** Node builtins the sandbox withholds by design — importing one is an error. */
const CAPABILITY_BUILTINS = [
	"fs",
	"fs/promises",
	"net",
	"http",
	"https",
	"http2",
	"child_process",
	"dns",
	"tls",
	"cluster",
	"dgram",
	"worker_threads",
	"os",
	"process",
	"v8",
	"vm",
	"inspector",
	"module",
	"repl"
]

function capabilityGuard(): esbuild.Plugin {
	const filter = new RegExp(
		`^(?:node:)?(?:${CAPABILITY_BUILTINS.map((b) => b.replace("/", "\\/")).join("|")})$`
	)
	return {
		name: "sp-capability-guard",
		setup(build) {
			build.onResolve({ filter }, (args) => ({
				errors: [
					{
						text:
							`'${args.path}' is not available to plugins — the sandbox withholds ` +
							`OS/IO by design. Use the SDK's ctx (ctx.storage, ctx.fetch) instead.`
					}
				]
			}))
		}
	}
}

/** The base esbuild options for a plugin bundle. */
export function pluginBundleOptions(): esbuild.BuildOptions {
	return {
		bundle: true,
		format: "cjs",
		platform: "neutral",
		target: "es2021",
		legalComments: "none",
		plugins: [capabilityGuard()]
	}
}

export interface BundleInput {
	/** Inline entry source (for programmatic/test use). */
	source?: string
	/** Or an entry file on disk. */
	entryFile?: string
	/** Where to resolve the entry's imports from (defaults to cwd). */
	resolveDir?: string
}

/** Bundle a plugin to a single self-contained CJS string. Throws on a build
 * error (including a forbidden capability import). */
export async function bundlePlugin(input: BundleInput): Promise<string> {
	const result = await esbuild.build({
		...pluginBundleOptions(),
		write: false,
		...(input.entryFile
			? { entryPoints: [input.entryFile] }
			: {
					stdin: {
						contents: input.source ?? "",
						resolveDir: input.resolveDir ?? process.cwd(),
						loader: "js"
					}
				})
	})
	const out = result.outputFiles?.[0]
	if (!out) throw new Error("bundle: esbuild produced no output")
	return out.text
}
