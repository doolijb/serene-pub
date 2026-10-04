/**
 * Gathering the admin **support report** (`admin:supportReport`).
 *
 * Reads what a bug report needs and nothing else: versions, the runtime,
 * instance switches, which environment variables are set, database and
 * backup state, connections without their keys, capability defaults,
 * plugins with their sources and recent failures, failed pipeline runs, the
 * log ring, and the Overview's **Needs you** list. Message text, character
 * and lore content are never read.
 *
 * Every value then passes through `redactForSupport` once, as a whole, and
 * `renderSupportReport` formats the result. Nothing here formats or
 * redacts on its own, so one function decides what is safe to share.
 *
 * Read-only, like the Overview: it writes nothing and fixes nothing.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import * as dbConfig from "$lib/server/db/drizzle.config"
import { rawRows } from "$lib/server/db/rawRows"
import { buildAdminOverview } from "$lib/server/sockets/adminOverview"
import { combosFor } from "$lib/server/sockets/connectionDefaults"
import { capabilityDefaults } from "$lib/server/connections/capabilityDefaults"
import { readLogRing, type LogRingLine } from "$lib/server/utils/logRing"
import { redactForSupport, REDACTION_SUMMARY } from "./redact"
import {
	renderSupportReport,
	SUPPORT_REPORT_FORMAT,
	type SupportReportFacts
} from "./render"

/** How far back plugin hook failures are counted. */
const FAILURE_WINDOW_DAYS = 7
const FAILED_RUN_LIMIT = 20
/** Per connection; a synced catalogue can hold hundreds. */
const MODEL_LIST_LIMIT = 12

/**
 * Packages whose version decides behaviour — the SDK family first, then the
 * runtime pieces bug reports most often turn on.
 */
const REPORTED_PACKAGES = [
	"@serene-pub/sdk",
	"@serene-pub/core-catalog",
	"@serene-pub/contracts",
	"@serene-pub/controls",
	"@serene-pub/component-client",
	"@electric-sql/pglite",
	"drizzle-orm",
	"socket.io",
	"svelte",
	"@sveltejs/kit"
]

/**
 * Environment variables worth naming. Their VALUES are reported only when
 * listed in `ENV_VALUE_SHOWN`; everything else reads `(set)`. Any variable
 * carrying the app's own prefixes is named too, so a new one is never
 * silently left out.
 */
const ENV_NAMED = [
	"NODE_ENV",
	"PORT",
	"HOST",
	"ORIGIN",
	"PUBLIC_URL",
	"ALLOWED_ORIGINS",
	"TRUSTED_PROXIES",
	"ADDRESS_HEADER",
	"HOST_HEADER",
	"PORT_HEADER",
	"PROTOCOL_HEADER",
	"XFF_DEPTH",
	"BODY_SIZE_LIMIT",
	"IDLE_TIMEOUT",
	"SHUTDOWN_TIMEOUT",
	"AUTO_OPEN_CLIENT",
	"DEFAULT_CLIENT",
	"USER_TOKEN_EXPIRATION_HOURS",
	"ENABLE_UNSAFE_CHARACTER_BROWSING",
	"CI"
]
const ENV_PREFIXES = ["SERENE_PUB_", "SERENE_", "SP_", "PUBLIC_", "SOCKETS_", "KOBOLDCPP_", "CSP_"]
const ENV_VALUE_SHOWN = new Set([
	"NODE_ENV",
	"PORT",
	"XFF_DEPTH",
	"BODY_SIZE_LIMIT",
	"IDLE_TIMEOUT",
	"SHUTDOWN_TIMEOUT",
	"AUTO_OPEN_CLIENT",
	"DEFAULT_CLIENT",
	"USER_TOKEN_EXPIRATION_HOURS",
	"ENABLE_UNSAFE_CHARACTER_BROWSING",
	"SP_PLUGINS_ENABLED",
	"SERENE_PUB_ENABLE_ACCOUNTS",
	"SERENE_PUB_SECURE_COOKIES",
	"PUBLIC_DOCUMENT_VIEW_DEFAULT",
	"CI"
])

/** `system_settings` columns that are switches or sizes, never ids or secrets. */
function settingsSummary(row: Record<string, unknown> | undefined): SupportReportFacts["settings"] {
	const out: SupportReportFacts["settings"] = {}
	if (!row) return out
	for (const [k, v] of Object.entries(row)) {
		if (k === "id" || /id$/i.test(k)) continue
		if (typeof v === "boolean" || typeof v === "number") out[k] = v
	}
	return out
}

function envSummary(): SupportReportFacts["environment"] {
	const names = new Set<string>()
	for (const name of Object.keys(process.env)) {
		if (ENV_NAMED.includes(name) || ENV_PREFIXES.some((p) => name.startsWith(p))) names.add(name)
	}
	return [...names].sort().map((name) => ({
		name,
		value: ENV_VALUE_SHOWN.has(name) ? String(process.env[name]) : "(set)"
	}))
}

/** The nearest `node_modules/<name>` at or above the working directory, as Node would find it. */
function packageInfo(name: string): SupportReportFacts["packages"][number] {
	let dir = process.cwd()
	for (;;) {
		const candidate = path.join(dir, "node_modules", name)
		const manifest = path.join(candidate, "package.json")
		if (fs.existsSync(manifest)) {
			try {
				const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version ?? null
				const linked = fs.lstatSync(candidate).isSymbolicLink()
				return { name, version, source: linked ? "linked" : "installed" }
			} catch {
				return { name, version: null, source: "installed" }
			}
		}
		const up = path.dirname(dir)
		if (up === dir) return { name, version: null, source: "missing" }
		dir = up
	}
}

function databaseVersion(): string | null {
	try {
		const meta = JSON.parse(fs.readFileSync(path.join(dbConfig.dataDir, "meta.json"), "utf8"))
		return typeof meta.version === "string" ? meta.version : null
	} catch {
		return null
	}
}

function appVersion(): string {
	// Vite defines; absent under vitest (see adminOverview's `versionDisplay`).
	// @ts-ignore
	const display = typeof __APP_VERSION_DISPLAY__ === "string" ? __APP_VERSION_DISPLAY__ : ""
	// @ts-ignore
	const plain = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""
	return display || plain || "unknown"
}

const mb = (n: number) => Math.round(n / 1024 / 1024)
const iso = (d: Date | string | null | undefined) =>
	d == null ? null : d instanceof Date ? d.toISOString() : String(d)

/** A manifest's name is a string or a locale map (R-20). */
function i18nText(v: unknown): string | null {
	if (typeof v === "string") return v
	if (v && typeof v === "object") {
		const m = v as Record<string, unknown>
		const t = m.en ?? Object.values(m)[0]
		return typeof t === "string" ? t : null
	}
	return null
}

/** Where a plugin's source lives, if its manifest says. */
function pluginSource(manifest: Record<string, any>): string | null {
	const repo = manifest.repo ?? manifest.repository ?? manifest.homepage ?? manifest.url
	if (typeof repo === "string") return repo
	if (repo && typeof repo === "object" && typeof repo.url === "string") return repo.url
	return null
}

function builtAgainstSdk(manifest: Record<string, any>): string[] {
	const out = new Set<string>()
	for (const c of Array.isArray(manifest.components) ? manifest.components : []) {
		const sdk = c?.builtAgainst?.sdk
		if (typeof sdk === "string") out.add(sdk)
	}
	return [...out]
}

/** Runs of the same line become one, marked with its count: a burst says itself once. */
function collapseRepeats(lines: LogRingLine[]): LogRingLine[] {
	const out: LogRingLine[] = []
	let run = 1
	for (let i = 0; i < lines.length; i++) {
		const next = lines[i + 1]
		if (next && next.text === lines[i].text && next.level === lines[i].level) {
			run++
			continue
		}
		out.push(run > 1 ? { ...lines[i], text: `${lines[i].text} (×${run})` } : lines[i])
		run = 1
	}
	return out
}

export interface SupportReportBrowser {
	userAgent?: string | null
	language?: string | null
	timeZone?: string | null
	viewport?: string | null
}

export async function gatherSupportReportFacts(
	browser: SupportReportBrowser = {},
	now = Date.now()
): Promise<SupportReportFacts> {
	const overview = await buildAdminOverview()

	const [settingsRow] = await db.select().from(schema.systemSettings).limit(1)

	// Database — the migration journal's high-water mark and the backups.
	let appliedMigrations: number | null = null
	let lastMigrationAt: string | null = null
	try {
		const [row] = rawRows<{ n: unknown; last: unknown }>(
			await db.execute(
				sql.raw(`select count(*) as n, max(created_at) as last from "drizzle"."__drizzle_migrations"`)
			)
		)
		appliedMigrations = Number(row?.n ?? 0)
		lastMigrationAt = row?.last != null ? new Date(Number(row.last)).toISOString() : null
	} catch {
		// Left unknown rather than failing the whole report.
	}
	let pendingMigrations: boolean | null = null
	try {
		const { hasPendingMigrations } = await import("$lib/server/db/backup")
		pendingMigrations = await hasPendingMigrations(db, dbConfig.migrationsDir)
	} catch {
		// A packaged build may not ship the folder where this process looks.
	}
	const { listBrokenDirs, readRecoveryLog } = await import("$lib/server/db/recovery")
	const recovery = readRecoveryLog()
		.slice(-5)
		.map((e) => ({ at: e.at, action: e.action }))

	// Connections — the row's shape, never `extra_json` (keys live there).
	const connectionRows = await db
		.select({
			id: schema.connections.id,
			name: schema.connections.name,
			type: schema.connections.type,
			modality: schema.connections.modality,
			preset: schema.connections.preset,
			baseUrl: schema.connections.baseUrl,
			capabilities: schema.connections.capabilities,
			tokenCounter: schema.connections.tokenCounter,
			promptFormat: schema.connections.promptFormat,
			modelsSyncedAt: schema.connections.modelsSyncedAt,
			modelsSyncError: schema.connections.modelsSyncError
		})
		.from(schema.connections)
		.orderBy(schema.connections.id)
	const modelRows = connectionRows.length
		? await db
				.select({
					connectionId: schema.connectionModels.connectionId,
					model: schema.connectionModels.model,
					enabled: schema.connectionModels.enabled,
					contextWindow: schema.connectionModels.contextWindow
				})
				.from(schema.connectionModels)
				.where(inArray(schema.connectionModels.connectionId, connectionRows.map((c) => c.id)))
				.orderBy(desc(schema.connectionModels.enabled), schema.connectionModels.id)
		: []
	const connections: SupportReportFacts["connections"] = connectionRows.map((c) => {
		const models = modelRows.filter((m) => m.connectionId === c.id)
		return {
			id: c.id,
			name: c.name,
			type: c.type,
			modality: c.modality,
			preset: c.preset ?? null,
			endpoint: c.baseUrl ?? null,
			tokenCounter: c.tokenCounter,
			promptFormat: c.promptFormat ?? null,
			capabilities: Object.entries(c.capabilities ?? {})
				.filter(([, v]) => v === true || (v != null && typeof v === "object"))
				.map(([k]) => k),
			modelCount: models.length,
			models: models.slice(0, MODEL_LIST_LIMIT).map((m) => ({
				model: m.model,
				enabled: m.enabled,
				contextWindow: m.contextWindow ?? null
			})),
			modelsSyncedAt: iso(c.modelsSyncedAt),
			modelsSyncError: c.modelsSyncError ?? null
		}
	})

	const combos = await combosFor(db)
	const defaults = await capabilityDefaults(db)
	const capabilityRows: SupportReportFacts["capabilityDefaults"] = combos.map((c) => ({
		capability: c.id,
		connectionId: defaults[c.id]?.connectionId ?? null,
		connectionModelId: defaults[c.id]?.connectionModelId ?? null,
		samplingConfigId: defaults[c.id]?.samplingConfigId ?? null,
		requiredBy: [...new Set(c.requiredBy.map((r) => r.definitionId))]
	}))

	// Plugins — what is installed, where it came from, and what failed.
	const pluginRows = await db
		.select({
			pluginId: schema.plugins.pluginId,
			name: schema.plugins.name,
			version: schema.plugins.version,
			enabled: schema.plugins.enabled,
			backend: schema.plugins.backend,
			bundleHash: schema.plugins.bundleHash,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied,
			disabledSwaps: schema.plugins.disabledSwaps,
			installedAt: schema.plugins.installedAt,
			updatedAt: schema.plugins.updatedAt
		})
		.from(schema.plugins)
		.orderBy(schema.plugins.pluginId)
	const installed = pluginRows.map((p) => {
		const manifest = (p.manifest ?? {}) as Record<string, any>
		return {
			slug: p.pluginId,
			name: i18nText(p.name) ?? p.pluginId,
			version: p.version,
			enabled: p.enabled,
			backend: p.backend,
			source: pluginSource(manifest),
			author: typeof manifest.author === "string" ? manifest.author : null,
			supportsServerRange:
				typeof manifest.engines?.["serene-pub"] === "string" ? manifest.engines["serene-pub"] : null,
			builtAgainstSdk: builtAgainstSdk(manifest),
			// A short digest identifies the build; the full hash adds nothing.
			bundleDigest: (p.bundleHash ?? "").slice(0, 12),
			deniedPermissions: Array.isArray(p.adminDenied) ? p.adminDenied : [],
			disabledSwaps: Array.isArray(p.disabledSwaps) ? p.disabledSwaps.length : 0,
			installedAt: iso(p.installedAt),
			updatedAt: iso(p.updatedAt)
		}
	})

	const failedCalls = await db
		.select({
			pluginId: schema.pluginHookInvocations.pluginId,
			pluginName: schema.pluginHookInvocations.pluginName,
			hookName: schema.pluginHookInvocations.hookName,
			outcome: schema.pluginHookInvocations.outcome,
			reason: schema.pluginHookInvocations.reason,
			finishedAt: schema.pluginHookInvocations.finishedAt
		})
		.from(schema.pluginHookInvocations)
		.where(
			and(
				eq(schema.pluginHookInvocations.ok, false),
				gte(schema.pluginHookInvocations.finishedAt, new Date(now - FAILURE_WINDOW_DAYS * 86_400_000))
			)
		)
		.orderBy(desc(schema.pluginHookInvocations.finishedAt))
		.limit(500)
	const failureGroups = new Map<string, SupportReportFacts["plugins"]["failures"][number]>()
	for (const f of failedCalls) {
		const key = `${f.pluginId}\u0000${f.hookName}\u0000${f.outcome}`
		const g = failureGroups.get(key)
		if (g) g.count++
		else
			failureGroups.set(key, {
				slug: f.pluginId,
				name: f.pluginName,
				hook: f.hookName,
				outcome: f.outcome,
				count: 1,
				lastAt: iso(f.finishedAt)!,
				lastReason: f.reason ? f.reason.slice(0, 300) : null
			})
	}

	// Failed runs — the run row plus the node that stopped it.
	const failedRunRows = await db
		.select({
			id: schema.pipelineRuns.id,
			runId: schema.pipelineRuns.runId,
			specSlug: schema.pipelineRuns.specSlug,
			specVersion: schema.pipelineRuns.specVersion,
			outcome: schema.pipelineRuns.outcome,
			haltNodeKey: schema.pipelineRuns.haltNodeKey,
			haltReason: schema.pipelineRuns.haltReason,
			triggerSource: schema.pipelineRuns.triggerSource,
			startedAt: schema.pipelineRuns.startedAt,
			elapsedMs: schema.pipelineRuns.elapsedMs
		})
		.from(schema.pipelineRuns)
		.where(
			and(
				inArray(schema.pipelineRuns.outcome, ["err", "halt"]),
				eq(schema.pipelineRuns.isPreview, false)
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(FAILED_RUN_LIMIT)
	const stopNodes = failedRunRows.length
		? await db
				.select({
					runId: schema.pipelineRunNodes.runId,
					nodeKey: schema.pipelineRunNodes.nodeKey,
					definitionId: schema.pipelineRunNodes.definitionId,
					reason: schema.pipelineRunNodes.reason,
					seq: schema.pipelineRunNodes.seq
				})
				.from(schema.pipelineRunNodes)
				.where(
					and(
						inArray(schema.pipelineRunNodes.runId, failedRunRows.map((r) => r.id)),
						inArray(schema.pipelineRunNodes.result, ["err", "halt"])
					)
				)
				.orderBy(schema.pipelineRunNodes.seq)
		: []
	const failedRuns = failedRunRows.map((r) => {
		const node = stopNodes.find((n) => n.runId === r.id)
		return {
			runId: r.runId,
			spec: `${r.specSlug}@${r.specVersion}`,
			outcome: r.outcome,
			startedAt: iso(r.startedAt)!,
			elapsedMs: r.elapsedMs,
			trigger: r.triggerSource,
			node: node?.nodeKey ?? r.haltNodeKey ?? null,
			definition: node?.definitionId ?? null,
			reason: (node?.reason ?? r.haltReason ?? null)?.slice(0, 400) ?? null
		}
	})

	const mem = process.memoryUsage()
	const facts: SupportReportFacts = {
		format: SUPPORT_REPORT_FORMAT,
		generatedAt: new Date(now).toISOString(),
		redacted: REDACTION_SUMMARY,
		app: {
			version: appVersion(),
			databaseVersion: databaseVersion(),
			mode: process.env.NODE_ENV === "production" ? "production" : (process.env.NODE_ENV ?? "development"),
			uptimeSeconds: Math.round(process.uptime())
		},
		packages: REPORTED_PACKAGES.map(packageInfo),
		runtime: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			osRelease: os.release(),
			container: fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv"),
			cpus: os.cpus().length,
			memoryTotalMb: mb(os.totalmem()),
			memoryFreeMb: mb(os.freemem()),
			processRssMb: mb(mem.rss),
			heapUsedMb: mb(mem.heapUsed)
		},
		settings: settingsSummary(settingsRow as Record<string, unknown> | undefined),
		environment: envSummary(),
		database: {
			appliedMigrations,
			lastMigrationAt,
			pendingMigrations,
			backupCount: overview.data.backupCount,
			lastBackupAt: overview.data.lastBackupAt,
			dailyBackups: overview.data.dailyBackups,
			setAsideDirectories: listBrokenDirs().length,
			recentRecoveryActions: recovery
		},
		counts: {
			users: overview.people.userCount,
			sessions: overview.people.sessionCount,
			connections: connections.length,
			plugins: overview.extensions.pluginCount,
			scripts: overview.extensions.scriptCount,
			authoredComponents: overview.extensions.componentCount,
			allowedHosts: overview.network.allowedHostCount
		},
		attention: overview.attention.map((a) => ({ level: a.level, title: a.title, detail: a.detail })),
		connections,
		capabilityDefaults: capabilityRows,
		plugins: {
			sandboxEnabled: overview.extensions.sandboxEnabled,
			installed,
			failures: [...failureGroups.values()],
			failureWindowDays: FAILURE_WINDOW_DAYS
		},
		pipelines: {
			published: overview.pipelines.published,
			enabled: overview.pipelines.enabled,
			runs24h: overview.pipelines.runs24h,
			failedRuns
		},
		logs: collapseRepeats(readLogRing()),
		browser: {
			userAgent: browser.userAgent?.slice(0, 400) ?? null,
			language: browser.language?.slice(0, 40) ?? null,
			timeZone: browser.timeZone?.slice(0, 80) ?? null,
			viewport: browser.viewport?.slice(0, 40) ?? null
		},
		omitted: []
	}

	// Network facts beyond the Overview's are deliberately absent: a tunnel's
	// hostname and the allowed-host list identify the install.
	facts.settings.tunnelConfigured = overview.network.tunnelConfigured
	facts.settings.tunnelRunning = overview.network.tunnelRunning
	facts.settings.allowAnyHost = overview.network.wildcard

	const people = await db
		.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName })
		.from(schema.users)
	return redactForSupport(facts, {
		homeDir: os.homedir(),
		machineName: os.hostname(),
		people: people.map((u) => ({ id: u.id, names: [u.username, u.displayName] }))
	})
}

/** The whole report, redacted and rendered. */
export async function buildSupportReport(browser: SupportReportBrowser = {}): Promise<string> {
	return renderSupportReport(await gatherSupportReportFacts(browser))
}
