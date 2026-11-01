/**
 * 🚧 **Plugin actions outside a session** (M0, SHAPES L12 Seams; lane P4).
 *
 * A package's `pluginActions` entry `{ params, handler }` names, in `handler`,
 * the id of a `query` or `outlet` node definition the same package implements.
 * This runs that handler for whoever is signed in, with the payload checked
 * against `params` first, and returns the handler's `out.main` (the shape the
 * pipeline runtime reads). ⚠ Not a session **action** — no run, no message.
 */
import { and, eq } from "drizzle-orm"
import { checkValues } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { megabytes } from "$lib/shared/imports/fileCaps"
import { getManager } from "$lib/server/plugins"
import { asHookResult } from "$lib/server/pipelines/runtime/pluginBindings"
import { pluginsEnabled } from "./flag"
import { notCoreRow } from "./frameHost"
import {
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	type PluginManifest
} from "./permissions"
import type { SandboxManager } from "./SandboxManager"

/** A refusal whose sentence is the person's to read. */
export class PluginActionRefusal extends Error {}

interface ActionManifest extends PluginManifest {
	pluginActions?: Record<string, unknown>
	nodeDefinitions?: Array<{ id?: unknown; kind?: unknown; timeoutMs?: unknown }>
	hooks?: { nodeHandlers?: Record<string, unknown> }
}

export async function invokePluginAction(
	db: Db,
	opts: {
		pluginId: string
		action: string
		input: Record<string, unknown>
		userId: number
		manager?: Pick<SandboxManager, "callHook">
	}
): Promise<unknown> {
	const { pluginId, action, input, userId } = opts
	if (!pluginsEnabled()) throw new PluginActionRefusal("Extensions are switched off on this pub.")
	const [row] = await db
		.select()
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, pluginId), eq(schema.plugins.enabled, true), notCoreRow()))
		.limit(1)
	if (!row) throw new PluginActionRefusal("That extension is not installed, or it is switched off.")
	const name = row.name
	const manifest = (row.manifest ?? {}) as ActionManifest
	const decl = manifest.pluginActions?.[action] as
		| { params?: Record<string, unknown>; handler?: unknown }
		| undefined
	if (!decl || typeof decl !== "object" || typeof decl.handler !== "string")
		throw new PluginActionRefusal(`'${name}' has no action called '${action}'.`)
	const handler = decl.handler
	const def = manifest.nodeDefinitions?.find(
		(d) => d?.id === handler && (d.kind === "query" || d.kind === "outlet")
	)
	const hookName = manifest.hooks?.nodeHandlers?.[handler]
	if (!def || typeof hookName !== "string")
		throw new PluginActionRefusal(`'${name}' declares '${action}' with a handler it does not ship.`)
	const messages = checkValues((decl.params ?? {}) as never, input)
		.filter((f) => f.severity === "error")
		.map((f) => f.message)
	if (messages.length)
		throw new PluginActionRefusal(`'${action}' was refused: ${messages.join("; ")}`)
	if (typeof input.bytes === "string") {
		const b64 = input.bytes
		const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0
		const size = Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
		const grant =
			storageGrant(
				effectivePermissions(declaredPermissions(manifest), row.adminDenied as string[] | null),
				row.storageQuotaOverride as number | null
			) ?? 0
		if (size > grant)
			throw new PluginActionRefusal(
				`That file is ${megabytes(size)}; '${name}' can keep at most ${megabytes(grant)}.`
			)
	}
	const manager = opts.manager ?? getManager()
	const kind = def.kind as "query" | "outlet"
	const timeout = typeof def.timeoutMs === "number" ? def.timeoutMs : 30_000
	const res = await manager.callHook(pluginId, hookName, input, {
		kind,
		timeoutMs: Math.min(timeout, 120_000),
		user: String(userId),
		seedLabel: `plugin-action:${action}`
	})
	if (res.ok) {
		const result = asHookResult(res.value)
		if (result && result.kind !== "ok")
			throw new PluginActionRefusal(
				`'${name}' could not do '${action}': ${result.reason || "the extension's hook did not finish"}`
			)
		const v = result ? result.value : res.value
		const ports: Record<string, unknown> =
			v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { main: v }
		return ports.main
	}
	if (res.outcome === "missing")
		throw new PluginActionRefusal(
			`'${name}' is not running. An administrator can switch it on under Admin › Plugins.`
		)
	throw new PluginActionRefusal(`'${name}' could not do '${action}': ${res.reason}`)
}
