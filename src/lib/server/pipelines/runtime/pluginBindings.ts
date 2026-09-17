/**
 * Plugin node bindings (20 §9) — the seam that puts an extension's *nodes* on
 * the spine, the way `hookDispatch` already puts its script links in chains.
 *
 * A registry row with `transport: 'process'` is a type whose implementation
 * lives in a sandboxed plugin, not in `coreBindings()`. This module projects
 * those rows into executor bindings: each one a wrapper that calls the
 * plugin's exported hook through the `RuntimeManager` — permission-checked
 * capabilities, settings on the reserved input key, the invocation log — and
 * hands the returned ports object back as an ordinary `ok`. The executor
 * never learns which side implemented a node, which is the same law the
 * script fold keeps.
 *
 * ## The manifest binding
 *
 * `manifest.nodeDefinitions: { '<definitionId>@<version>': exportedHookName }` — the
 * mirror of `hookTypes` and read the same way: the stored manifest is the one
 * source of truth (F6), never a naming convention guessed from the id.
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

import { and, eq, isNotNull, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Bindings } from "@serene-pub/sdk"
import { ok, err } from "@serene-pub/sdk"
import type { RuntimeManager } from "$lib/server/plugins/RuntimeManager"
import type { HandlerRequires } from "@serene-pub/sdk"
import { structuralCompat } from "$lib/server/pipelines/runtime/structuralCompat"

/**
 * Read `nodeDefinitions` off a stored manifest, tolerant of its json being
 * anything. ⏳ `nodeTypes` — the pre-rename key — is read when
 * `nodeDefinitions` is absent, for plugins packaged against the previous SDK;
 * drop after one release.
 */
export function nodeDefinitionsOf(manifest: unknown): Record<string, string> {
	const m = manifest && typeof manifest === "object" ? (manifest as any) : undefined
	const raw = m?.nodeDefinitions ?? m?.nodeTypes
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, string> = {}
	for (const [pin, hook] of Object.entries(raw as Record<string, unknown>)) {
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
 * Read off the same `nodeDefinitions` map rather than a parallel one, because a
 * second map is a second thing that can name a different hook.
 */
export function nodeReadsOf(manifest: unknown): Record<string, HandlerRequires> {
	const m = manifest && typeof manifest === "object" ? (manifest as any) : undefined
	const raw = m?.nodeDefinitions ?? m?.nodeTypes
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, HandlerRequires> = {}
	for (const [pin, hook] of Object.entries(raw as Record<string, unknown>)) {
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

const PLUGIN_NODE_TIMEOUT_MS = 30_000

export interface PluginBindingOptions {
	seed: string
	nowMs: number
	runId?: string
	user?: string
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
		const hookName = owner.nodeDefinitions[pin]
		if (!hookName) {
			bindings[pin] = async () =>
				err(
					`the extension '${owner.pluginId}' declares no hook for ${pin} — ` +
						`its manifest's nodeDefinitions is the binding, and it has no entry`
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
		bindings[pin] = async (input: unknown) => {
			const r = await manager.callHook(
				owner.pluginId,
				hookName,
				{ input },
				{
					timeoutMs: PLUGIN_NODE_TIMEOUT_MS,
					seedLabel: `${opts.seed}:node:${pin}:${digest(input)}`,
					nowMs: opts.nowMs,
					runId: opts.runId,
					user: opts.user
				}
			)
			if (!r.ok) return err(r.reason ?? "the extension's hook failed")
			// The hook returns the ports object, exactly as a core binding's
			// `ok(...)` value — `{ main, ... }`. A bare value is tolerated as
			// `main` so the trivial hook stays trivial.
			const v = r.value
			const ports =
				v && typeof v === "object" && !Array.isArray(v)
					? (v as Record<string, unknown>)
					: { main: v }
			if (!("main" in ports)) (ports as any).main = ports
			return ok(ports)
		}
	}
	return bindings
}
