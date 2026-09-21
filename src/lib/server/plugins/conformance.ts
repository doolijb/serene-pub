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
 * The probe invokes a hook that cannot exist: the sandbox evaluates the whole
 * bundle to build its hooks map, then reports `missing`. So `missing` means the
 * bundle evaluated cleanly; an `error`/`load`/`timeout` outcome is a genuine
 * load failure on that backend, carried back as the issue. (This catches
 * *load-time* incompatibility; per-hook runtime SES-hostility is a deeper check
 * for later — the sandbox still contains it at call time.)
 *
 * ## The pure-hook reach (plans/29 R-3, F11)
 *
 * Two kinds of hook get neither `storage` nor `fetch` on their ctx
 * (`hookCtx.ts`): a **task** — a task definition's hook, and a template
 * engine's renderer, which is a task by nature — and a **chain link** (a
 * script kind's hook, `hookKinds`). A bundle whose pure hook reaches for
 * either member would install cleanly and halt on its first run with a
 * `TypeError` the author reads as a sandbox bug, so the probe runs every hook
 * the manifest binds under one of those two kinds and asks. Differentially,
 * because QuickJS names no member in "not a function": the hook runs under
 * its own kind's ctx and, if it failed, once more under an oracle's — the one
 * kind that has both members. A failure that changes when the members appear
 * is the reach; a failure that stays word for word is the hook's own and not
 * this probe's business. The bundle fails conformance on every backend that
 * shows it, with a sentence naming the law.
 */

import { createHash } from "node:crypto"
import { QuickJsSandbox } from "./QuickJsSandbox"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import type { PluginSandbox, SandboxKind } from "./types"
import { nodeDefinitionsOf } from "$lib/server/pipelines/runtime/pluginBindings"
import { hookKindsOf } from "./hookDispatch"
import { engineTypesOf } from "./engineHost"
import type { HookCtxKind } from "./hookCtx"

export interface ConformanceResult {
	/** Backends the bundle loaded cleanly on — the compiled `backends` fact. */
	backends: SandboxKind[]
	/** Why a backend was excluded, keyed by backend. */
	issues: Partial<Record<SandboxKind, string>>
}

/** A hook the manifest binds under a pure kind, and the role it names it for. */
interface PureHook {
	hookName: string
	kind: Extract<HookCtxKind, "task" | "chain-link">
	/** What the manifest bound it as, for the sentence. */
	role: string
}

/**
 * Every hook the manifest binds under a kind granted neither member: a `task`
 * definition's hook (the kind is the id's second segment, 01 §3a), a template
 * engine's renderer (dispatched as a task, `engineHost.ts`), and a script
 * kind's link (`chain-link`, `hookDispatch.ts`). One entry per hook name and
 * kind, whichever binding named it first.
 */
function pureHooksOf(manifest: unknown): PureHook[] {
	const seen = new Set<string>()
	const out: PureHook[] = []
	const add = (hookName: string, kind: PureHook["kind"], role: string) => {
		const key = `${kind}:${hookName}`
		if (seen.has(key)) return
		seen.add(key)
		out.push({ hookName, kind, role })
	}
	for (const [pin, hook] of Object.entries(nodeDefinitionsOf(manifest)))
		if (/^[^:]+:task\//.test(pin)) add(hook, "task", `the task definition ${pin}`)
	for (const [engineId, hook] of Object.entries(engineTypesOf(manifest)))
		add(hook, "task", `the template engine ${engineId}`)
	for (const [scriptKindId, hook] of Object.entries(hookKindsOf(manifest)))
		add(hook, "chain-link", `the script kind ${scriptKindId}`)
	return out
}

export async function checkConformance(
	bundleSource: string,
	/** The package's manifest, for the pure hooks to probe; absent, none are. */
	manifest?: unknown
): Promise<ConformanceResult> {
	const hash = createHash("sha256").update(bundleSource, "utf8").digest("hex")
	const backends: SandboxKind[] = []
	const issues: Partial<Record<SandboxKind, string>> = {}
	const pureHooks = pureHooksOf(manifest)

	const runners: [SandboxKind, () => PluginSandbox][] = [
		["quickjs", () => new QuickJsSandbox()],
		["ses", () => new SesWorkerSandbox()]
	]

	for (const [kind, make] of runners) {
		const rt = make()
		try {
			await rt.load("__conformance__", bundleSource, hash)
			const probe = (hookName: string, ctxKind: HookCtxKind) =>
				rt.invoke(
					{ pluginId: "__conformance__", hookName },
					{ kind: ctxKind, input: {}, timeoutMs: 3000, seedLabel: "conformance", nowMs: 0 }
				)
			const r = await probe("__does_not_exist__", "task")
			// `missing` = the bundle evaluated cleanly; any other failure is a
			// real load fault on this backend.
			if (!(r.ok || (!r.ok && r.outcome === "missing"))) {
				issues[kind] = r.reason
				continue
			}
			let reached: string | undefined
			for (const { hookName, kind: hookKind, role } of pureHooks) {
				const asPure = await probe(hookName, hookKind)
				if (asPure.ok || asPure.outcome !== "error") continue
				const asOracle = await probe(hookName, "oracle")
				if (asOracle.ok || asOracle.reason !== asPure.reason) {
					reached =
						`hook '${hookName}' is bound as ${role} and reaches for what a ` +
						`${hookKind} hook's ctx does not carry (storage or fetch): a ${hookKind} ` +
						`is pure (F11) and gets neither (plans/29 R-3). Move the reach into an ` +
						`oracle, or drop it.`
					break
				}
			}
			if (reached) issues[kind] = reached
			else backends.push(kind)
		} catch (e) {
			issues[kind] = String((e as Error)?.message || e)
		} finally {
			await rt.dispose()
		}
	}

	return { backends, issues }
}
