/**
 * The both-backends conformance harness (runs at install).
 *
 * `backends` must be a *compiled fact, not an author claim*: a bundle is
 * actually evaluated under **both** QuickJS and SES, and the supported set is
 * the backends it loads cleanly on. This is where the two orthogonal breakage
 * axes get caught empirically —
 *  - SES-hostile code (prototype mutation, core-js at import) fails on SES →
 *    the plugin is quickjs-only;
 *  - WebAssembly / a V8-only dependency fails on QuickJS → the plugin is
 *    ses-only (`requiresV8`).
 * A bundle that loads on neither is rejected — there is nothing to run.
 *
 * The probe invokes a hook that cannot exist: the runtime evaluates the whole
 * bundle to build its hooks map, then reports `missing`. So `missing` means the
 * bundle evaluated cleanly; an `error`/`load`/`timeout` outcome is a genuine
 * load failure on that backend, carried back as the issue. (This catches
 * *load-time* incompatibility; per-hook runtime SES-hostility is a deeper check
 * for later — the runtime still contains it at call time.)
 */

import { createHash } from "node:crypto"
import { QuickJsRuntime } from "./QuickJsRuntime"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import type { PluginRuntime, RuntimeKind } from "./types"

export interface ConformanceResult {
	/** Backends the bundle loaded cleanly on — the compiled `backends` fact. */
	backends: RuntimeKind[]
	/** Why a backend was excluded, keyed by backend. */
	issues: Partial<Record<RuntimeKind, string>>
}

export async function checkConformance(
	bundleSource: string
): Promise<ConformanceResult> {
	const hash = createHash("sha256").update(bundleSource, "utf8").digest("hex")
	const backends: RuntimeKind[] = []
	const issues: Partial<Record<RuntimeKind, string>> = {}

	const runners: [RuntimeKind, () => PluginRuntime][] = [
		["quickjs", () => new QuickJsRuntime()],
		["ses", () => new SesWorkerRuntime()]
	]

	for (const [kind, make] of runners) {
		const rt = make()
		try {
			await rt.load("__conformance__", bundleSource, hash)
			const r = await rt.invoke(
				{ pluginId: "__conformance__", hookName: "__does_not_exist__" },
				{ input: {}, timeoutMs: 3000, seedLabel: "conformance", nowMs: 0 }
			)
			// `missing` = the bundle evaluated cleanly; any other failure is a
			// real load fault on this backend.
			if (r.ok || (!r.ok && r.outcome === "missing")) backends.push(kind)
			else issues[kind] = r.reason
		} catch (e) {
			issues[kind] = String((e as Error)?.message || e)
		} finally {
			await rt.dispose()
		}
	}

	return { backends, issues }
}
