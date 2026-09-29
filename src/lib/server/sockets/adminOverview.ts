/**
 * The admin Overview (`admin:overview`, the admin overhaul 2026-09-27).
 *
 * One read that gathers what the other admin sections already know — the
 * Defaults matrix's combos, the tunnel row and supervisor, the backups
 * directory, the pipeline library and run records, the plugin gate — and the
 * **Needs you** list derived from it (`admin/attention.ts`). It stores nothing
 * and owns no rule: every number here is the same function its own section
 * calls, so the Overview cannot disagree with the page it links to.
 *
 * Read-only, unlike `tunnels:get`, which self-heals a stale tunnel row on
 * read: liveness is asked of the supervisor directly and the row is left for
 * that page to correct.
 *
 * Admin only; `admin:` is a restricted interest prefix as well.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, count, eq, gte, isNotNull } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { combosFor } from "./connectionDefaults"
import { capabilityDefaults } from "$lib/server/connections/capabilityDefaults"
import { tunnelsUnavailableReason } from "./tunnels"
import { isWildcardAllowed, listAllowedHosts } from "./originAllowlist"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { needsReview, type PluginManifest } from "$lib/server/plugins/permissions"
import { listNamespaces } from "$lib/server/pipelines/config/panel/read"
import { attentionFor, type OverviewFacts } from "$lib/server/admin/attention"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `__APP_VERSION_DISPLAY__` is a Vite define that does not exist under
 * vitest, and referencing an undeclared identifier throws — so a `typeof`
 * guard, never an import of `constants/version` at module scope (which
 * would break every test that loads the socket index).
 */
function versionDisplay(): string {
	// @ts-ignore
	return typeof __APP_VERSION_DISPLAY__ === "string"
		? // @ts-ignore
			__APP_VERSION_DISPLAY__
		: ""
}

async function countOf(table: any): Promise<number> {
	const [row] = await db.select({ n: count() }).from(table)
	return Number(row?.n ?? 0)
}

export async function buildAdminOverview(): Promise<Sockets.Admin.Overview.Response> {
	const now = Date.now()

	const [settings] = await db
		.select({ isAccountsEnabled: schema.systemSettings.isAccountsEnabled })
		.from(schema.systemSettings)
		.limit(1)
	const accountsEnabled = settings?.isAccountsEnabled ?? false

	// Models — the Defaults screen's own two reads, and its own two counts.
	const combos = await combosFor(db)
	const defaults = await capabilityDefaults(db)
	const isSet = (id: string) => defaults[id]?.connectionId != null
	const missing = combos
		.filter((c) => c.demanded && !isSet(c.id))
		.map((c) => ({
			capability: c.id,
			requiredBy: [...new Set(c.requiredBy.map((r) => r.definitionId))]
		}))
	// Connections whose last model sync failed, each with the jobs it is the
	// default for — attention.ts decides which of them are worth a row.
	const syncErrorRows = await db
		.select({
			id: schema.connections.id,
			name: schema.connections.name,
			error: schema.connections.modelsSyncError
		})
		.from(schema.connections)
		.where(isNotNull(schema.connections.modelsSyncError))
	const syncErrors = syncErrorRows.map((c) => ({
		connectionId: c.id,
		name: c.name,
		error: c.error ?? "",
		capabilities: Object.keys(defaults).filter(
			(id) => defaults[id]?.connectionId === c.id
		)
	}))

	// Network — the tunnel row plus the supervisor's word on liveness.
	const unavailable = tunnelsUnavailableReason()
	const tunnel = await db.query.tunnels.findFirst()
	let tunnelRunning = false
	if (tunnel) {
		const { isSupervising } = await import("$lib/server/tunnels/supervisor")
		tunnelRunning = isSupervising(tunnel.id)
	}

	// Data — the backups directory, newest first, and the daily setting.
	const { listBackups } = await import("$lib/server/db/recovery")
	const { readBackupSettings } = await import("$lib/server/db/backup")
	const backups = listBackups()
	const backupSettings = await readBackupSettings(db)
	const { lastDailyBackupFailure } = await import(
		"$lib/server/services/dailyBackup"
	)
	const lastBackupFailure = lastDailyBackupFailure()

	// Pipelines — the library list and the last day's non-preview runs.
	const library = await listNamespaces(db)
	const runRows = await db
		.select({ outcome: schema.pipelineRuns.outcome, n: count() })
		.from(schema.pipelineRuns)
		.where(
			and(
				gte(schema.pipelineRuns.startedAt, new Date(now - DAY_MS)),
				eq(schema.pipelineRuns.isPreview, false)
			)
		)
		.groupBy(schema.pipelineRuns.outcome)
	const runs24h = { ok: 0, failed: 0, total: 0 }
	for (const r of runRows) {
		const n = Number(r.n)
		runs24h.total += n
		if (r.outcome === "ok") runs24h.ok += n
		else if (r.outcome === "err") runs24h.failed += n
	}

	// Extensions — plugins waiting on an admin: a changed bundle that arrived
	// disabled (`update_from_version`, store.ts), or declared permissions
	// nobody has reviewed (the Plugins page's "Needs review" badge).
	const pluginRows = await db
		.select({
			name: schema.plugins.name,
			enabled: schema.plugins.enabled,
			updateFromVersion: schema.plugins.updateFromVersion,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
	const awaitingReview = pluginRows
		.filter(
			(p) =>
				(p.updateFromVersion != null && !p.enabled) ||
				needsReview(p.manifest as PluginManifest, p.adminDenied)
		)
		.map((p) => p.name)

	const facts: OverviewFacts = {
		app: {
			version: versionDisplay(),
			accountsEnabled,
			uptimeSeconds: Math.round(process.uptime())
		},
		people: {
			userCount: await countOf(schema.users),
			sessionCount: await countOf(schema.sessions)
		},
		models: {
			jobsTotal: combos.length,
			jobsSet: combos.filter((c) => isSet(c.id)).length,
			missing,
			syncErrors
		},
		network: {
			tunnelAvailable: !unavailable,
			tunnelConfigured: !!tunnel,
			tunnelRunning,
			tunnelHostname: tunnel?.hostname ?? null,
			tunnelStatus: tunnel?.status ?? null,
			tunnelLastError: tunnel?.lastError ?? null,
			allowedHostCount: listAllowedHosts().length,
			wildcard: isWildcardAllowed()
		},
		data: {
			lastBackupAt: backups[0]?.modifiedAt ?? null,
			backupCount: backups.length,
			dailyBackups: !!backupSettings.backupDaily,
			lastBackupFailure
		},
		pipelines: {
			published: library.length,
			enabled: library.filter((p) => p.enabled).length,
			runs24h
		},
		extensions: {
			sandboxEnabled: pluginsEnabled(),
			pluginCount: pluginRows.length,
			scriptCount: await countOf(schema.pipelineScripts),
			componentCount: await countOf(schema.authoredComponents),
			awaitingReview
		}
	}

	return { ...facts, attention: attentionFor(facts, now) }
}

export const adminOverview: Handler<
	Sockets.Admin.Overview.Params,
	Sockets.Admin.Overview.Response
> = {
	event: "admin:overview",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res = await buildAdminOverview()
		emitToUser("admin:overview", res)
		return res
	}
}

/**
 * The support report (Admin → Diagnostics). Loaded on demand: it reads a
 * dozen tables and the log ring, and nothing else in this module needs it.
 * Admin only; `admin:` is a restricted interest prefix as well.
 */
export const adminSupportReport: Handler<
	Sockets.Admin.SupportReport.Params,
	Sockets.Admin.SupportReport.Response
> = {
	event: "admin:supportReport",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const { buildSupportReport } = await import(
			"$lib/server/admin/supportReport/gather"
		)
		const str = (v: unknown) => (typeof v === "string" ? v : null)
		const markdown = await buildSupportReport({
			userAgent: str(params?.userAgent),
			language: str(params?.language),
			timeZone: str(params?.timeZone),
			viewport: str(params?.viewport)
		})
		const res = {
			markdown,
			generatedAt: new Date().toISOString(),
			bytes: Buffer.byteLength(markdown, "utf8")
		}
		emitToUser("admin:supportReport", res)
		return res
	}
}

export function registerAdminOverviewHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, adminOverview, emitToUser)
	register(socket, adminSupportReport, emitToUser)
}
