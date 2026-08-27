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
 * `manifest.nodeTypes: { '<typeId>@<version>': exportedHookName }` — the
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

type Db = { select: any }

/** Read `nodeTypes` off a stored manifest, tolerant of its json being anything. */
export function nodeTypesOf(manifest: unknown): Record<string, string> {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).nodeTypes
			: undefined
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, string> = {}
	for (const [pin, hook] of Object.entries(raw as Record<string, unknown>))
		if (typeof hook === "string" && hook) out[pin] = hook
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

	const rows: Array<{
		typeId: string
		version: number
		kind: string
		ownerPluginId: number
	}> = await db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			version: schema.pipelineTypeRegistry.version,
			kind: schema.pipelineTypeRegistry.kind,
			ownerPluginId: schema.pipelineTypeRegistry.ownerPluginId
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.transport, "process"),
				eq(schema.pipelineTypeRegistry.status, "live"),
				isNotNull(schema.pipelineTypeRegistry.ownerPluginId)
			)
		)
	const nodeRows = rows.filter((r) => r.kind !== "script")
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
			{ pluginId: o.pluginId, nodeTypes: nodeTypesOf(o.manifest) }
		])
	)

	for (const row of nodeRows) {
		const pin = `${row.typeId}@${row.version}`
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
		const hookName = owner.nodeTypes[pin]
		if (!hookName) {
			bindings[pin] = async () =>
				err(
					`the extension '${owner.pluginId}' declares no hook for ${pin} — ` +
						`its manifest's nodeTypes is the binding, and it has no entry`
				)
			continue
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
