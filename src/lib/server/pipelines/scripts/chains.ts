/**
 * The chain applier — core's half of the executor's script seam (18 §4a, §5).
 *
 * The executor owns *where* chains apply; this owns *how*: dereference the id
 * list into rows, run each link in the sandbox, and keep the law set —
 *
 *  - **transforms fold, in order** (18 §5): each link's declared outs merge
 *    onto the flowing value, everything else passes through;
 *  - **verdicts reduce**: every stop link evaluates independently against the
 *    same text and the earliest index wins — order-free, which is what makes
 *    merging chains from several sources well-defined with no precedence rule;
 *  - **a failing link degrades, S2**: skipped with `result: 'err'` and the
 *    reason, and the chain continues. A slop filter with a typo must never
 *    cost somebody their reply, and must never vanish silently either;
 *  - **every link is recorded** (S5), including the skipped and the failed.
 *
 * ## Randomness is per-link, not per-run
 *
 * Each link gets its own stream, seeded from the run seed plus the link's own
 * address. Deliberate: parallel blocks apply chains concurrently, and a single
 * shared stream would make draw order — and therefore every roll — depend on
 * scheduling. Per-link seeding makes each link's rolls a pure function of the
 * run seed and its address, whatever ran beside it (18 §6, F26 in spirit).
 */

import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type {
	ScriptChainApplier,
	ScriptHookSite,
	ScriptApplicationRecord
} from "@serene-pub/sdk"
import {
	scriptTypeInfos,
	type ScriptTypeInfo
} from "$lib/server/pipelines/entities/scripts"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"
import type { PluginHookDispatch } from "$lib/server/pipelines/scripts/pluginDispatch"

type Db = { select: any; insert: any; update: any; delete: any }

export interface ScriptApplierOptions {
	/** The run seed — link streams derive from it (see header). */
	seed: string
	/** What `Date.now()` answers inside every script — the run's start. */
	nowMs: number
	/** Values for declared hook extras — speaker name, cast names. */
	extras?: Record<string, unknown>
	timeoutMs?: number
	/**
	 * The run's connection and its attached stop guards (18 §4b). Evaluated
	 * into the same min-reduction as any hook that accepts `text/stop` — legal
	 * precisely because verdicts are order-free, so the union across sources
	 * needs no precedence rule. Each application records `via` so the receipt
	 * says which side supplied the guard (18 §4c).
	 */
	connectionStops?: {
		connectionId: number
		connectionName: string
		rows: Array<{
			id: number
			name: string
			typeId: string
			enabled: boolean
			source: string
			varsIn: string[]
		}>
	}
	/**
	 * The extension-hook executor, present only when plugins are enabled and the
	 * runtime is ready. A chain link whose type is plugin-owned
	 * (`transport: 'process'`) is routed here instead of the in-process Scripts
	 * sandbox; both feed the same fold. Absent, such links are absorbed as a
	 * skip — the pipeline runs exactly as it did before extensions existed.
	 */
	pluginDispatch?: PluginHookDispatch
	/** The pipeline run id, threaded to the plugin runtime's invocation log. */
	runId?: string
	/** Who triggered the run — for the plugin log and the account-visibility view. */
	user?: string
}

/** What a transform is allowed to hand back, per content scope. */
function validShape(content: string, v: unknown): string | null {
	if (content === "text")
		return typeof v === "string" ? null : "a string was expected"
	if (content === "messages" || content === "candidates")
		return Array.isArray(v) ? null : "an array was expected"
	if (content === "context" || content === "cast")
		return v && typeof v === "object" && !Array.isArray(v)
			? null
			: "an object was expected"
	return null
}

const sizeOf = (v: unknown): number => {
	try {
		return Buffer.byteLength(JSON.stringify(v) ?? "", "utf8")
	} catch {
		return Number.MAX_SAFE_INTEGER
	}
}

export function makeScriptApplier(
	db: Db,
	opts: ScriptApplierOptions
): ScriptChainApplier {
	// Both caches live for the applier — one run — never longer. A row edited
	// mid-run not being observed is the *correct* reading: the chain a run
	// applies is the chain that was resolved when it started.
	let typesPromise: Promise<Map<string, ScriptTypeInfo>> | null = null
	const types = () =>
		(typesPromise ??= scriptTypeInfos(db).then(
			(list) => new Map(list.map((t) => [t.typeId, t]))
		))
	const rowCache = new Map<number, any>()

	async function rowsFor(ids: number[]): Promise<Map<number, any>> {
		const missing = ids.filter((id) => !rowCache.has(id))
		if (missing.length) {
			const fetched = await db
				.select()
				.from(schema.pipelineScripts)
				.where(inArray(schema.pipelineScripts.id, missing))
			for (const r of fetched as any[]) rowCache.set(r.id, r)
		}
		return rowCache
	}

	return async (site: ScriptHookSite, chain: unknown, value: unknown) => {
		const applications: ScriptApplicationRecord[] = []
		const record = (
			r: Omit<ScriptApplicationRecord, "phase" | "appliedBy">
		) => {
			applications.push({
				...r,
				phase: site.phase,
				// Substrate hooks and binding-invoked interior points (18 §4e)
				// share the applier; the site says which one asked.
				appliedBy: site.origin ?? "substrate"
			})
		}

		const ids = (Array.isArray(chain) ? chain : []).filter(
			(v): v is number => typeof v === "number"
		)
		// The connection's guards apply whether or not the pipeline configured
		// a chain of its own (18 §4b) — an empty chain and an absent one both
		// still carry the endpoint's model knowledge.
		const connApplies =
			!!opts.connectionStops?.rows.length &&
			site.accepts.includes("core:script:text/stop@1") &&
			typeof value === "string"
		if (!ids.length && !connApplies) return { value, applications }

		const [typeMap, rows] = [await types(), await rowsFor(ids)]

		let current = value
		/** Verdicts, collected across every stop link for the min-reduction. */
		const verdicts: Array<{ index: number; at: number }> = []

		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]!
			const row = rows.get(id)
			if (!row) {
				record({
					scriptId: id,
					name: `#${id}`,
					typeId: "",
					result: "skip",
					reason: "no longer exists — remove it from this chain"
				})
				continue
			}
			const base = { scriptId: id, name: row.name, typeId: row.typeId }
			if (!site.accepts.includes(row.typeId)) {
				record({
					...base,
					result: "skip",
					reason: "a kind this hook does not accept"
				})
				continue
			}
			if (!row.enabled) {
				record({ ...base, result: "skip", reason: "disabled" })
				continue
			}
			const type = typeMap.get(row.typeId)
			if (!type) {
				record({
					...base,
					result: "skip",
					reason: "its type is not registered on this build"
				})
				continue
			}

			// The subject: the type's first in-port is what flows through the
			// hook. Declared ins narrow what is serialized in (18 §6a — least
			// privilege at the data level); extras arrive on ctx, read-only.
			const subject = type.varsIn[0] ?? "value"
			const declaredIns = new Set(
				((row.varsIn ?? []) as string[]).length
					? ((row.varsIn ?? []) as string[])
					: type.varsIn
			)
			const vars: Record<string, unknown> = {}
			if (declaredIns.has(subject)) vars[subject] = current
			const extras: Record<string, unknown> = {}
			for (const name of site.extras)
				if (declaredIns.has(name))
					extras[name] = (opts.extras ?? {})[name] ?? null

			// One address for the per-link stream, whichever executor runs it,
			// so a chain replays the same whether a link is core's or a
			// plugin's. The PRNG lives inside the sandbox; only the label crosses.
			const seedLabel = `${opts.seed}:scripts:${site.nodeKey}:${site.slot}:${i}:${id}`

			// The single dispatch fork. A plugin-owned type (`transport:
			// 'process'`) runs out-of-process through the injected port; core's
			// own runs in the in-process sandbox. Both hand back one
			// `ScriptRunResult`, so everything below — verdict, inject,
			// transform — is applied identically and never learns which ran.
			let res: Awaited<ReturnType<typeof runScriptSource>>
			if (type.transport === "process") {
				if (!opts.pluginDispatch || type.ownerPluginId == null) {
					record({
						...base,
						result: "skip",
						reason: "extensions are disabled on this instance"
					})
					continue
				}
				res = await opts.pluginDispatch.runHook({
					ownerPluginId: type.ownerPluginId,
					typeId: row.typeId,
					value: declaredIns.has(subject) ? current : null,
					extras,
					seedLabel,
					nowMs: opts.nowMs,
					timeoutMs: opts.timeoutMs ?? 250,
					runId: opts.runId,
					user: opts.user
				})
			} else {
				res = await runScriptSource({
					source: row.source ?? "",
					vars,
					extras,
					seedLabel,
					nowMs: opts.nowMs,
					timeoutMs: opts.timeoutMs ?? 250
				})
			}

			if (!res.ok) {
				record({
					...base,
					result: "err",
					reason: res.reason,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}

			if (type.semantics === "verdict") {
				const v = res.value
				if (typeof v === "number" && Number.isFinite(v)) {
					const len =
						typeof current === "string"
							? current.length
							: Number.MAX_SAFE_INTEGER
					const index = Math.max(0, Math.min(Math.floor(v), len))
					verdicts.push({ index, at: applications.length })
					record({
						...base,
						result: "ok",
						verdict: index,
						logs: res.logs,
						durationMs: res.durationMs
					})
				} else if (v === undefined) {
					record({
						...base,
						result: "ok",
						logs: res.logs,
						durationMs: res.durationMs
					})
				} else {
					record({
						...base,
						result: "err",
						reason: "a stop script returns an index, or nothing",
						logs: res.logs,
						durationMs: res.durationMs
					})
				}
				continue
			}

			// Inject — additive-only, and *positional data*, never a splice.
			// The ruling of 2026-08-23: an injection is a statement about where
			// in the rendered conversation something lands, and position
			// belongs to the template (§20). So the entries append onto
			// `context.injections`; the assemble step resolves depths to
			// message indexes beside `postHistory.targetIndex`; and the
			// template's own loop renders them — visible, movable, restylable
			// by whoever owns the template, and checkable by the corpus.
			if (type.operation === "inject") {
				if (res.value === undefined) {
					record({
						...base,
						result: "ok",
						changed: false,
						logs: res.logs,
						durationMs: res.durationMs
					})
					continue
				}
				const entries = Array.isArray(res.value) ? res.value : null
				const valid =
					entries &&
					entries.length <= 32 &&
					entries.every(
						(e: any) =>
							e &&
							typeof e === "object" &&
							["user", "system", "assistant"].includes(e.role) &&
							typeof e.content === "string" &&
							e.content.length > 0 &&
							sizeOf(e.content) <= 64 * 1024 &&
							Number.isInteger(e.depth) &&
							e.depth >= 0
					)
				if (!valid) {
					record({
						...base,
						result: "err",
						reason:
							"an inject script returns up to 32 entries of " +
							"{role: user|system|assistant, content, depth ≥ 0} — nothing was added",
						logs: res.logs,
						durationMs: res.durationMs
					})
					continue
				}
				const ctx = current as Record<string, unknown>
				current = {
					...ctx,
					injections: [
						...((ctx.injections as unknown[]) ?? []),
						...entries.map((e: any) => ({
							role: e.role,
							content: e.content,
							depth: e.depth
						}))
					]
				}
				record({
					...base,
					result: "ok",
					changed: entries.length > 0,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}

			// Transform. Returning nothing is passthrough; a script whose
			// declared outs do not include the subject cannot rewrite it —
			// in-but-not-out is read-only, mechanically (18 §6a).
			if (res.value === undefined) {
				record({
					...base,
					result: "ok",
					changed: false,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}
			const outs = (row.varsOut ?? []) as string[]
			if (!outs.includes(subject)) {
				record({
					...base,
					result: "ok",
					changed: false,
					reason: `declares no rewrite of '${subject}' — read-only, value kept`,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}
			const shapeErr = validShape(type.content, res.value)
			if (shapeErr) {
				record({
					...base,
					result: "err",
					reason: `returned a value where ${shapeErr} — value kept`,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}
			const cap = Math.max(4 * sizeOf(current), 64 * 1024)
			if (sizeOf(res.value) > cap) {
				record({
					...base,
					result: "err",
					reason: `output exceeds ${cap} bytes — value kept`,
					logs: res.logs,
					durationMs: res.durationMs
				})
				continue
			}
			const changed =
				typeof res.value === "string" && typeof current === "string"
					? res.value !== current
					: JSON.stringify(res.value) !== JSON.stringify(current)
			current = res.value
			record({
				...base,
				result: "ok",
				changed,
				logs: res.logs,
				durationMs: res.durationMs
			})
		}

		// The connection's own stop guards join here (18 §4b): every pipeline
		// running against the connection inherits them with no wiring — the
		// plugin author never knew the model echoes names, and their pipeline
		// doesn't suffer it. Only at hooks that accept `text/stop`, only rows
		// of that type, each recorded with `via` so the receipt names the side
		// that supplied the guard (18 §4c).
		const conn = opts.connectionStops
		if (
			conn?.rows.length &&
			site.accepts.includes("core:script:text/stop@1") &&
			typeof current === "string"
		) {
			for (let i = 0; i < conn.rows.length; i++) {
				const row = conn.rows[i]!
				const base = {
					scriptId: row.id,
					name: row.name,
					typeId: row.typeId,
					via: `connection:${conn.connectionName}`
				}
				if (row.typeId !== "core:script:text/stop@1") {
					record({
						...base,
						result: "skip",
						reason: "not a stop script — how did it get attached?"
					})
					continue
				}
				if (!row.enabled) {
					record({ ...base, result: "skip", reason: "disabled" })
					continue
				}
				const declaredIns = new Set(
					(row.varsIn ?? []).length ? row.varsIn : ["text"]
				)
				const vars: Record<string, unknown> = {}
				if (declaredIns.has("text")) vars.text = current
				const extras: Record<string, unknown> = {}
				for (const name of site.extras)
					if (declaredIns.has(name))
						extras[name] = (opts.extras ?? {})[name] ?? null

				const res = await runScriptSource({
					source: row.source ?? "",
					vars,
					extras,
					seedLabel: `${opts.seed}:scripts:connection:${conn.connectionId}:${i}:${row.id}`,
					nowMs: opts.nowMs,
					timeoutMs: opts.timeoutMs ?? 250
				})
				if (!res.ok) {
					record({
						...base,
						result: "err",
						reason: res.reason,
						logs: res.logs,
						durationMs: res.durationMs
					})
					continue
				}
				const v = res.value
				if (typeof v === "number" && Number.isFinite(v)) {
					const index = Math.max(
						0,
						Math.min(Math.floor(v), current.length)
					)
					verdicts.push({ index, at: applications.length })
					record({
						...base,
						result: "ok",
						verdict: index,
						logs: res.logs,
						durationMs: res.durationMs
					})
				} else if (v === undefined) {
					record({
						...base,
						result: "ok",
						logs: res.logs,
						durationMs: res.durationMs
					})
				} else {
					record({
						...base,
						result: "err",
						reason: "a stop script returns an index, or nothing",
						logs: res.logs,
						durationMs: res.durationMs
					})
				}
			}
		}

		// The min-reduction (18 §5): earliest verdict wins, marked so the
		// receipt answers "why did my reply cut off" from a row (S4).
		if (verdicts.length && typeof current === "string") {
			const winner = verdicts.reduce((a, b) =>
				b.index < a.index ? b : a
			)
			applications[winner.at]!.won = true
			current = current.slice(0, winner.index)
		}

		return { value: current, applications }
	}
}

/**
 * The values for the write hook's declared extras, read once per run.
 *
 * Best-effort on purpose: extras are nullable in the contract and a script
 * must tolerate absence — a failed lookup costs the extras, never the turn.
 */
export async function scriptExtras(
	db: Db,
	scope: { sessionId?: number; currentCharacterId?: number | null }
): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {}
	try {
		if (scope.currentCharacterId != null) {
			const [c] = await db
				.select({ name: schema.characters.name })
				.from(schema.characters)
				.where(
					inArray(schema.characters.id, [scope.currentCharacterId])
				)
			if (c?.name) out.speakerName = c.name
		}
		if (scope.sessionId != null) {
			const rows = await db
				.select({ name: schema.characters.name })
				.from(schema.sessionCharacters)
				.innerJoin(
					schema.characters,
					eq(
						schema.sessionCharacters.characterId,
						schema.characters.id
					)
				)
				.where(eq(schema.sessionCharacters.sessionId, scope.sessionId))
			out.castNames = (rows as any[]).map((r) => r.name).filter(Boolean)
		}
	} catch {
		// Extras are conveniences; the turn is not.
	}
	return out
}

/**
 * The run's connection and its stop guards, by the one rule the runtime uses:
 * the instance default (`system_settings.default_connection_id`) — the same
 * connection dispatch resolves for the generate step. Best-effort like
 * `scriptExtras`: no default, no rows, or a failed read means no guards, never
 * a failed turn.
 */
export async function connectionStopsFor(
	db: Db
): Promise<ScriptApplierOptions["connectionStops"]> {
	try {
		const [settings] = await db
			.select({
				defaultConnectionId: schema.systemSettings.defaultConnectionId
			})
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.id, 1))
			.limit(1)
		const connectionId = settings?.defaultConnectionId
		if (connectionId == null) return undefined
		const [conn] = await db
			.select({
				id: schema.connections.id,
				name: schema.connections.name
			})
			.from(schema.connections)
			.where(eq(schema.connections.id, connectionId))
			.limit(1)
		if (!conn) return undefined
		const { listConnectionScripts } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const rows = await listConnectionScripts(db, conn.id)
		if (!rows.length) return undefined
		return {
			connectionId: conn.id,
			connectionName: conn.name,
			rows: rows.map((r) => ({
				id: r.id,
				name: r.name,
				typeId: r.typeId,
				enabled: r.enabled,
				source: r.source,
				varsIn: r.varsIn
			}))
		}
	} catch {
		return undefined
	}
}

/**
 * The kill switch (18 §10). Off means the host supplies no engine at all —
 * every spec runs exactly as before scripts existed, chains and attachments
 * kept in place, waiting. Default on: nothing executes until an admin authors
 * or imports a script, so the switch is a recovery lever rather than a gate.
 */
export async function scriptsEnabledFor(db: Db): Promise<boolean> {
	try {
		const [settings] = await db
			.select({ scriptsEnabled: schema.systemSettings.scriptsEnabled })
			.from(schema.systemSettings)
			.where(eq(schema.systemSettings.id, 1))
			.limit(1)
		return settings?.scriptsEnabled !== false
	} catch {
		return true
	}
}
