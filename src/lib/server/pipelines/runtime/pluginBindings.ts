/**
 * Plugin node bindings (20 §9) — the seam that puts an extension's *nodes* on
 * the spine, the way `hookDispatch` already puts its script links in chains.
 *
 * A registry row with `transport: 'process'` is a type whose implementation
 * lives in a sandboxed plugin, not in `coreBindings()`. This module projects
 * those rows into executor bindings: each one a wrapper that calls the
 * plugin's exported hook through the `RuntimeManager` — permission-checked
 * capabilities, settings on the reserved input key, the invocation log — and
 * hands the hook's own `Result` back to the executor, unwrapped. The executor
 * never learns which side implemented a node, which is the same law the
 * script fold keeps.
 *
 * ## The hook's return
 *
 * A hook returns a `Result` — binding law B1, the same `ok(ports)` / `err` /
 * `halt` / `cancelled` a core binding returns. The sandbox transport carries
 * that value through verbatim (it never unwraps), so unwrapping it is this
 * seam's job: see `asHookResult`. A hook packaged before B1 returns a bare
 * ports object, which still reads as one.
 *
 * ## The manifest binding
 *
 * `manifest.hooks.nodeHandlers: { '<definitionId>@<version>': exportedHookName }`
 * — the mirror of `hookKinds` and `engines`, read the same way: the stored
 * manifest is the one source of truth (F6), never a naming convention guessed
 * from the id.
 *
 * A *hand-written* app-runtime manifest may spell the map as
 * `nodeDefinitions`. `serene-pub build` writes `nodeDefinitions` as the ARRAY
 * of definition summaries the audit screen and the registry projection read
 * (D-6b), so the packaged map lives under `hooks` beside the handler list it
 * names. Both spellings are read here, the packaged one first; the array form
 * is not a map and is skipped rather than half-read.
 *
 * ## Determinism
 *
 * The hook's RNG label derives from the run seed, the pin, and a digest of
 * the exact input — so replays with the recorded seed roll the same, and two
 * same-typed nodes in one run (or one node under `map`) get distinct streams
 * without depending on scheduling order. `Date.now` is pinned to the run's
 * start, like scripts.
 *
 * ## Failure shape
 *
 * A refused or crashed hook is an `err` with the sentence, which the executor
 * already knows how to treat (absorbed on `optional` nodes, terminal
 * otherwise); a plugin uninstalled since the spec resolved reads as "no
 * binding", exactly like any other unregistered type.
 */

import { pluginRuleRef } from "@serene-pub/sdk"
import { and, eq, isNotNull, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Bindings, Result } from "@serene-pub/sdk"
import { ok, err, halt, cancelled } from "@serene-pub/sdk"
import type { RuntimeManager } from "$lib/server/plugins/RuntimeManager"
import type { HandlerRequires } from "@serene-pub/sdk"
import { structuralCompat } from "$lib/server/pipelines/runtime/structuralCompat"
import { isHookCtxKind } from "$lib/server/plugins/hookCtx"

/**
 * The map-shaped binding source on a stored manifest, in reading order:
 * `hooks.nodeHandlers` (what `serene-pub build` writes, D-6b), then the
 * app-runtime `nodeDefinitions` map.
 *
 * An entry is only read when it IS a map: the packaged `nodeDefinitions` is an
 * array of summaries, and reading an array's indices as pins would bind
 * `'0' → undefined` and call it a declaration.
 */
function bindingSource(manifest: unknown): Record<string, unknown> {
	const m =
		manifest && typeof manifest === "object" ? (manifest as any) : undefined
	const asMap = (v: unknown) =>
		v && typeof v === "object" && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: undefined
	return (
		asMap(m?.hooks?.nodeHandlers) ??
		asMap(m?.nodeDefinitions) ??
		{}
	)
}

/**
 * Read the node-definition bindings off a stored manifest, tolerant of its json
 * being anything.
 */
export function nodeDefinitionsOf(manifest: unknown): Record<string, string> {
	const raw = bindingSource(manifest)
	const out: Record<string, string> = {}
	for (const [pin, hook] of Object.entries(raw)) {
		if (typeof hook === "string" && hook) out[pin] = hook
		// The declared form, added for structural compatibility (ruling
		// 2026-09-10): `{ hook, reads: { ports, params } }`. Read here rather
		// than in a second walk so the two spellings cannot disagree about
		// which hook a pin names.
		else if (hook && typeof hook === "object") {
			const name = (hook as { hook?: unknown }).hook
			if (typeof name === "string" && name) out[pin] = name
		}
	}
	return out
}

/**
 * What an extension declares each of its node hooks reads (ruling 2026-09-10).
 *
 * ⚠ **Optional, and its absence is not a failure.** A manifest written before
 * this existed declares nothing, and a plugin binding a hook to a type it
 * declared itself has nothing to check — the compile-time derivation already
 * held it. The declaration earns its keep in the case the ruling names: a
 * plugin binding a hook to **somebody else's** public type, where two
 * separately compiled artefacts meet and no `tsc` run saw both.
 *
 * Read off the same map the binding is read from rather than a parallel one,
 * because a second map is a second thing that can name a different hook.
 */
export function nodeReadsOf(manifest: unknown): Record<string, HandlerRequires> {
	const raw = bindingSource(manifest)
	const out: Record<string, HandlerRequires> = {}
	for (const [pin, hook] of Object.entries(raw)) {
		if (!hook || typeof hook !== "object") continue
		const reads = (hook as { reads?: unknown }).reads
		if (!reads || typeof reads !== "object") continue
		const { ports, params } = reads as { ports?: unknown; params?: unknown }
		// Half a declaration is not a declaration: the missing half would be
		// checked as "reads nothing", which is the one answer that always
		// passes.
		if (!Array.isArray(ports) || !Array.isArray(params)) continue
		out[pin] = {
			ports: ports.filter((p): p is string => typeof p === "string"),
			params: params.filter((p): p is string => typeof p === "string")
		}
	}
	return out
}

/** djb2 over the serialized input — a stable per-call address, never crypto. */
const digest = (v: unknown): string => {
	let s: string
	try {
		s = JSON.stringify(v) ?? ""
	} catch {
		s = ""
	}
	let h = 5381
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
	return (h >>> 0).toString(36)
}

const RESULT_KINDS = new Set(["ok", "err", "halt", "cancelled"])

/**
 * A hook's raw return read as a `Result` (binding law B1), or `undefined` when
 * it is not one — in which case the caller keeps the pre-B1 reading, where the
 * value *is* the ports object.
 *
 * ⚠ Strict about the shape on purpose. `ok`/`err`/`halt`/`cancelled` build
 * exactly `{ kind }` plus at most `value` or `reason`, and JSON drops an
 * undefined member on the way across the sandbox — so `ok(undefined)` and
 * `cancelled()` arrive as a lone `{ kind }`. A ports object that happens to
 * carry a `kind` port (`{ kind: 'ok', main: … }`) can never be one of those,
 * and reading it as a result would silently drop every port it has.
 */
export function asHookResult(v: unknown): Result | undefined {
	if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
	const o = v as Record<string, unknown>
	if (typeof o.kind !== "string" || !RESULT_KINDS.has(o.kind))
		return undefined
	for (const k of Object.keys(o))
		if (k !== "kind" && k !== "value" && k !== "reason") return undefined
	return o as unknown as Result
}

/**
 * Pins already noted for returning a bare ports object instead of a `Result`.
 * Module-level because bindings are rebuilt for every run: the note is about
 * how an extension is packaged, not about one run, and once is enough.
 */
const bareReturnNoted = new Set<string>()

const PLUGIN_NODE_TIMEOUT_MS = 30_000

export interface PluginBindingOptions {
	seed: string
	nowMs: number
	runId?: string
	user?: string
	/**
	 * The running pipeline's owning package (its slug), or undefined for core's
	 * and a person's own pipelines. A plugin's private node runs only in its own
	 * package's pipelines (R62): everywhere else its binding refuses.
	 */
	specOwner?: string
}

export async function pluginNodeBindings(
	db: Db,
	manager: RuntimeManager,
	opts: PluginBindingOptions
): Promise<Bindings> {
	const bindings: Bindings = {}

	const rows = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			kind: schema.pipelineDefinitionRegistry.kind,
			ownerPluginId: schema.pipelineDefinitionRegistry.ownerPluginId,
			isPublic: schema.pipelineDefinitionRegistry.isPublic,
			// The declaration side of the structural check. Read from the
			// **row**, never from a descriptor: F6 says core reads a plugin's
			// contract from what it stored at install, and a
			// `transport: 'process'` type has no in-process descriptor to read
			// even if that rule allowed it.
			ports: schema.pipelineDefinitionRegistry.ports,
			slots: schema.pipelineDefinitionRegistry.slots
		})
		.from(schema.pipelineDefinitionRegistry)
		.where(
			and(
				eq(schema.pipelineDefinitionRegistry.transport, "process"),
				eq(schema.pipelineDefinitionRegistry.status, "live"),
				isNotNull(schema.pipelineDefinitionRegistry.ownerPluginId)
			)
		)
	// `ownerPluginId` is nullable on the column and the `isNotNull` above is
	// what makes it real here; the predicate carries that into the type rather
	// than asserting it in the row annotation, where it was simply untrue.
	const nodeRows = rows.filter(
		(r): r is (typeof rows)[number] & { ownerPluginId: number } =>
			r.kind !== "script" && r.ownerPluginId != null
	)
	if (!nodeRows.length) return bindings

	const owners: Array<{
		id: number
		pluginId: string
		manifest: unknown
	}> = await db
		.select({
			id: schema.plugins.id,
			pluginId: schema.plugins.pluginId,
			manifest: schema.plugins.manifest
		})
		.from(schema.plugins)
		.where(
			inArray(
				schema.plugins.id,
				[...new Set(nodeRows.map((r) => r.ownerPluginId))]
			)
		)
	const byOwner = new Map(
		owners.map((o) => [
			o.id,
			{
				pluginId: o.pluginId,
				nodeDefinitions: nodeDefinitionsOf(o.manifest),
				nodeReads: nodeReadsOf(o.manifest)
			}
		])
	)

	for (const row of nodeRows) {
		const pin = `${row.definitionId}@${row.version}`
		const owner = byOwner.get(row.ownerPluginId)
		if (!owner) {
			// The type outlived its plugin. A binding that *says so* beats an
			// unregistered-type error pointing at the wrong suspect.
			bindings[pin] = async () =>
				err(
					`${pin} belongs to an extension that is no longer installed`
				)
			continue
		}
		// A node is as public as its handler (R62). A private one runs only in
		// its own package's pipelines — never another package's, never one a
		// person authored — whatever door the pipeline came in by.
		if (!row.isPublic && owner.pluginId !== opts.specOwner) {
			bindings[pin] = async () =>
				err(
					`${pin} is private to '${owner.pluginId}' — only its own pipelines may use it. ` +
						`Its author makes it reusable with handler(…, { visibility: 'public' }).` +
						pluginRuleRef("private-nodes")
				)
			continue
		}
		const hookName = owner.nodeDefinitions[pin]
		if (!hookName) {
			bindings[pin] = async () =>
				err(
					`the extension '${owner.pluginId}' declares no hook for ${pin} — ` +
						`its manifest's hooks.nodeHandlers is the binding, and it has no entry`
				)
			continue
		}
		/**
		 * Structural compatibility (ruling 2026-09-10), where a plugin says
		 * what its hook reads.
		 *
		 * ⚠ An `err` binding rather than a thrown boot. A third party's
		 * packaging mistake must not be able to stop this install from
		 * starting — the same judgement the two branches above already make
		 * for an uninstalled owner and a missing hook entry. The sentence is
		 * the one `structuralCompat` writes, so a plugin author reads the same
		 * words core would read about its own bindings.
		 */
		const reads = owner.nodeReads[pin]
		if (reads) {
			const verdict = structuralCompat(
				reads,
				{
					definitionId: row.definitionId,
					version: row.version,
					ports: row.ports,
					slots: row.slots
				},
				`the extension '${owner.pluginId}' hook '${hookName}'`
			)
			if (!verdict.ok) {
				bindings[pin] = async () => err(verdict.message)
				continue
			}
		}
		/**
		 * The row's kind decides the hook's ctx (R-3): a task gets neither
		 * storage nor fetch, an oracle both, a query or outlet storage. An
		 * `err` binding for a row of any other kind, in the same voice as the
		 * three refusals above — an entry type is a row shape and is never
		 * placed, and an inlet's hook is never invoked (the executor publishes
		 * the input itself), so neither has a ctx to build.
		 */
		const kind = row.kind
		if (!isHookCtxKind(kind) || kind === "chain-link" || kind === "event" || kind === "lifecycle") {
			bindings[pin] = async () =>
				err(
					`${pin} is a '${row.kind}' definition, which no hook ctx is built for — ` +
						`only a task, query, oracle or outlet hook runs as a node`
				)
			continue
		}
		bindings[pin] = async (input: unknown) => {
			const r = await manager.callHook(
				owner.pluginId,
				hookName,
				/**
				 * The node's input, as the handler's first argument — **not**
				 * wrapped in an envelope.
				 *
				 * This seam is a projection of the SDK's own
				 * `pluginNodeBindings` (`sdk/src/pluginHarness.ts`), which
				 * says so in as many words and hands the executor's input
				 * straight to `handler(input, ctx)`. It is also how every
				 * handler anyone has written reads: `input.sessionId`,
				 * `input.text`. Wrapped as `{ input }`, a handler verified
				 * against the harness read `undefined` off every port here and
				 * computed an answer from nothing — silently, because a port
				 * that is not there is not an error (D-6b).
				 *
				 * `settings` rides beside the ports as the reserved key
				 * `SandboxManager` spreads in (12 §6), which is what "reserved
				 * *input* key" means; a definition cannot declare a port of
				 * that name (`checkNoSettingsPort`).
				 *
				 * Narrowed rather than asserted: the executor resolves a
				 * node's input to a ports object, and a binding is typed
				 * `unknown` because the executor cannot know which node it is
				 * building. Anything else would arrive as an empty input on
				 * the far side of JSON anyway.
				 */
				input && typeof input === "object" && !Array.isArray(input)
					? (input as Record<string, unknown>)
					: {},
				{
					kind,
					timeoutMs: PLUGIN_NODE_TIMEOUT_MS,
					seedLabel: `${opts.seed}:node:${pin}:${digest(input)}`,
					nowMs: opts.nowMs,
					runId: opts.runId,
					user: opts.user,
					// Another package's pipeline, or a person's: only the
					// secrets this plugin lends reach the fetch bridge (R63).
					foreignPipeline: owner.pluginId !== opts.specOwner
				}
			)
			if (!r.ok) return err(r.reason ?? "the extension's hook failed")
			/**
			 * The hook returned a `Result` and the transport passed it through
			 * untouched, so unwrap it here: an `err`, `halt` or `cancelled`
			 * reaches the executor in the voice the hook used, and an `ok`
			 * reaches it as its ports. Read as ports instead, `{ kind: 'ok',
			 * value }` *became* the ports object — and with no `main` of its
			 * own it was then given one pointing at itself.
			 */
			const result = asHookResult(r.value)
			if (result && result.kind !== "ok") {
				const reason = result.reason
				if (result.kind === "err")
					return err(reason || "the extension's hook failed")
				if (result.kind === "halt")
					return halt(reason || "the extension's hook halted")
				return cancelled(reason || "the extension's hook was cancelled")
			}
			if (!result && !bareReturnNoted.has(pin)) {
				bareReturnNoted.add(pin)
				console.debug(
					`[plugins] ${pin} returned a bare value, not a Result — ` +
						`a hook returns ok(ports) / err(…) (binding law B1). ` +
						`Read as the ports object, as before B1.`
				)
			}
			// The ports object, exactly as a core binding's `ok(...)` value —
			// `{ main, ... }`. A bare value is tolerated as `main` so the
			// trivial hook stays trivial.
			const v = result ? result.value : r.value
			const ports: Record<string, unknown> =
				v && typeof v === "object" && !Array.isArray(v)
					? { ...(v as Record<string, unknown>) }
					: { main: v }
			/**
			 * ⚠ Never `ports.main = ports`. That self-reference was handed to
			 * `ok()` and then walked by the receipt's redaction and payload
			 * hashing, neither of which terminates on a cycle. A shallow copy
			 * says the same thing — the whole object is the main port — and is
			 * a value the receipt can carry.
			 */
			if (!("main" in ports)) ports.main = { ...ports }
			return ok(ports)
		}
	}
	return bindings
}
