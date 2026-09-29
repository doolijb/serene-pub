/**
 * The admin **support report** as Markdown — the text a person pastes into a
 * bug report or hands to an AI assistant.
 *
 * Written for both readers at once: a short header that says what the
 * document is and what was redacted, then sections with stable `##`
 * headings, `key: value` lines and compact tables, and at the end the same
 * facts as one fenced `json` block for a program (or a model) to read
 * exactly. Headings and JSON keys are a contract: rename one and every
 * saved report stops lining up with the next.
 *
 * Pure: it formats `SupportReportFacts` that `gather.ts` has already
 * collected and `redact.ts` has already cleaned. It never redacts.
 */
import type { LogRingLine } from "$lib/server/utils/logRing"

/** The report's own format version; bump when a heading or JSON key changes. */
export const SUPPORT_REPORT_FORMAT = 1

/** A report longer than this sheds its oldest log lines first. */
export const SUPPORT_REPORT_MAX_BYTES = 50_000

export interface SupportReportFacts {
	format: number
	generatedAt: string
	redacted: string
	app: {
		version: string
		/** The version stamped in `meta.json` — what the database was last migrated by. */
		databaseVersion: string | null
		mode: string
		uptimeSeconds: number
	}
	packages: Array<{ name: string; version: string | null; source: "installed" | "linked" | "missing" }>
	runtime: {
		node: string
		platform: string
		arch: string
		osRelease: string
		container: boolean
		cpus: number
		memoryTotalMb: number
		memoryFreeMb: number
		processRssMb: number
		heapUsedMb: number
	}
	settings: Record<string, boolean | number | string | null>
	environment: Array<{ name: string; value: string }>
	database: {
		appliedMigrations: number | null
		lastMigrationAt: string | null
		pendingMigrations: boolean | null
		backupCount: number
		lastBackupAt: string | null
		dailyBackups: boolean
		setAsideDirectories: number
		recentRecoveryActions: Array<{ at: string; action: string }>
	}
	counts: Record<string, number>
	attention: Array<{ level: string; title: string; detail: string }>
	connections: Array<{
		id: number
		name: string
		type: string
		modality: string
		preset: string | null
		endpoint: string | null
		tokenCounter: string
		promptFormat: string | null
		capabilities: string[]
		modelCount: number
		models: Array<{ model: string; enabled: boolean; contextWindow: number | null }>
		modelsSyncedAt: string | null
		modelsSyncError: string | null
	}>
	capabilityDefaults: Array<{
		capability: string
		connectionId: number | null
		connectionModelId: number | null
		samplingConfigId: number | null
		requiredBy: string[]
	}>
	plugins: {
		sandboxEnabled: boolean
		installed: Array<{
			slug: string
			name: string
			version: string
			enabled: boolean
			backend: string
			source: string | null
			author: string | null
			supportsServerRange: string | null
			builtAgainstSdk: string[]
			bundleDigest: string
			deniedPermissions: string[]
			disabledSwaps: number
			installedAt: string | null
			updatedAt: string | null
		}>
		/** Failed hook calls in the window, grouped by plugin, hook and outcome. */
		failures: Array<{
			slug: string
			name: string
			hook: string
			outcome: string
			count: number
			lastAt: string
			lastReason: string | null
		}>
		failureWindowDays: number
	}
	pipelines: {
		published: number
		enabled: number
		runs24h: { ok: number; failed: number; total: number }
		failedRuns: Array<{
			runId: string
			spec: string
			outcome: string
			startedAt: string
			elapsedMs: number
			trigger: string
			node: string | null
			definition: string | null
			reason: string | null
		}>
	}
	logs: LogRingLine[]
	browser: { userAgent: string | null; language: string | null; timeZone: string | null; viewport: string | null }
	/** What the size budget cut, when it cut anything. */
	omitted: string[]
}

const cell = (v: unknown): string => {
	if (v == null || v === "") return "—"
	return String(v).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ⏎ ")
}

function table(headers: string[], rows: unknown[][]): string {
	if (!rows.length) return "_none_\n"
	return (
		`| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n` +
		rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n") +
		"\n"
	)
}

const kv = (pairs: Array<[string, unknown]>): string =>
	pairs.map(([k, v]) => `- ${k}: ${v == null || v === "" ? "—" : String(v)}`).join("\n") + "\n"

function duration(seconds: number): string {
	const d = Math.floor(seconds / 86400)
	const h = Math.floor((seconds % 86400) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`
}

function renderOnce(f: SupportReportFacts): string {
	const out: string[] = []
	out.push(
		"# Serene Pub support report\n\n" +
			"A diagnostic snapshot of one Serene Pub install, made to attach to a bug report. " +
			"It is written for people and for AI assistants alike: every section has a stable heading, " +
			"facts are `key: value` lines or tables, and the same data is repeated as JSON at the end.\n\n" +
			kv([
				["Generated", f.generatedAt],
				["App version", f.app.version],
				["Report format", f.format],
				["Redacted", f.redacted]
			]) +
			(f.omitted.length ? `- Shortened to fit: ${f.omitted.join("; ")}\n` : "")
	)

	out.push(
		"## Needs you\n\n" +
			(f.attention.length
				? f.attention.map((a) => `- [${a.level}] ${a.title} — ${a.detail}`).join("\n") + "\n"
				: "_nothing_\n")
	)

	out.push(
		"## Versions\n\n" +
			kv([
				["App", f.app.version],
				["Database last migrated by", f.app.databaseVersion],
				["Mode", f.app.mode],
				["Uptime", duration(f.app.uptimeSeconds)]
			]) +
			"\n" +
			table(
				["Package", "Version", "Source"],
				f.packages.map((p) => [p.name, p.version, p.source])
			)
	)

	const rt = f.runtime
	out.push(
		"## Runtime\n\n" +
			kv([
				["Node", rt.node],
				["Platform", `${rt.platform} ${rt.arch} (${rt.osRelease})`],
				["Container", rt.container ? "yes" : "no"],
				["CPUs", rt.cpus],
				["Memory", `${rt.memoryFreeMb} MB free of ${rt.memoryTotalMb} MB`],
				["Process", `${rt.processRssMb} MB resident, ${rt.heapUsedMb} MB heap used`]
			])
	)

	out.push("## Instance settings\n\n" + kv(Object.entries(f.settings)))

	out.push(
		"## Environment\n\nVariables that are set. Values are shown only for a short list of harmless ones; the rest say `(set)`.\n\n" +
			(f.environment.length
				? kv(f.environment.map((e) => [e.name, e.value]))
				: "_none_\n")
	)

	const d = f.database
	out.push(
		"## Database and backups\n\n" +
			kv([
				["Applied migrations", d.appliedMigrations],
				["Last migration applied", d.lastMigrationAt],
				["Pending migrations", d.pendingMigrations == null ? "unknown" : d.pendingMigrations ? "yes" : "no"],
				["Backups", d.backupCount],
				["Newest backup", d.lastBackupAt],
				["Daily backups", d.dailyBackups ? "on" : "off"],
				["Set-aside database directories", d.setAsideDirectories]
			]) +
			(d.recentRecoveryActions.length
				? "\nRecent recovery actions:\n\n" +
					table(["At", "Action"], d.recentRecoveryActions.map((a) => [a.at, a.action]))
				: "")
	)

	out.push("## Counts\n\n" + kv(Object.entries(f.counts)))

	out.push(
		"## Connections\n\nNo keys, tokens or credentials are included; endpoints show only the scheme, a local or well-known host, and the port.\n\n" +
			table(
				["Id", "Name", "Type", "Modality", "Endpoint", "Capabilities", "Models", "Last sync", "Sync error"],
				f.connections.map((c) => [
					c.id,
					c.name,
					c.preset ? `${c.type} (${c.preset})` : c.type,
					c.modality,
					c.endpoint,
					c.capabilities.join(", "),
					c.models.length
						? c.models
								.map((m) => `${m.model}${m.enabled ? "" : " (off)"}${m.contextWindow ? ` [${m.contextWindow}]` : ""}`)
								.join(", ") + (c.modelCount > c.models.length ? ` +${c.modelCount - c.models.length} more` : "")
						: c.modelCount
							? `${c.modelCount}`
							: "",
					c.modelsSyncedAt,
					c.modelsSyncError
				])
			)
	)

	out.push(
		"## Capability defaults\n\n" +
			table(
				["Capability", "Connection", "Model row", "Sampling config", "Required by"],
				f.capabilityDefaults.map((c) => [
					c.capability,
					c.connectionId ?? "not set",
					c.connectionModelId,
					c.samplingConfigId,
					c.requiredBy.join(", ")
				])
			)
	)

	const p = f.plugins
	out.push(
		"## Plugins\n\n" +
			kv([["Plugin sandbox", p.sandboxEnabled ? "enabled" : "disabled (SP_PLUGINS_ENABLED)"]]) +
			"\n" +
			table(
				["Plugin", "Name", "Version", "Enabled", "Backend", "Source", "Author", "Built against SDK", "Supports", "Bundle", "Denied permissions", "Updated"],
				p.installed.map((x) => [
					x.slug,
					x.name,
					x.version,
					x.enabled ? "yes" : "no",
					x.backend,
					x.source ?? "no link in its manifest",
					x.author,
					x.builtAgainstSdk.join(", "),
					x.supportsServerRange,
					x.bundleDigest,
					x.deniedPermissions.join(", "),
					x.updatedAt
				])
			)
	)

	out.push(
		`## Plugin failures (last ${p.failureWindowDays} days)\n\nHook calls that did not end \`ok\`, grouped by plugin, hook and outcome. A plugin listed here is an affected plugin.\n\n` +
			table(
				["Plugin", "Name", "Hook", "Outcome", "Count", "Last", "Last reason"],
				p.failures.map((x) => [x.slug, x.name, x.hook, x.outcome, x.count, x.lastAt, x.lastReason])
			)
	)

	const pl = f.pipelines
	out.push(
		"## Pipelines\n\n" +
			kv([
				["Published", pl.published],
				["Enabled", pl.enabled],
				["Runs in the last 24 hours", `${pl.runs24h.total} (${pl.runs24h.ok} ok, ${pl.runs24h.failed} failed)`]
			])
	)

	out.push(
		"## Recent failed runs\n\nNon-preview runs that ended in an error or a halt, newest first, with the node that stopped them.\n\n" +
			table(
				["Started", "Spec", "Outcome", "Trigger", "Node", "Definition", "Reason", "Run"],
				pl.failedRuns.map((r) => [r.startedAt, r.spec, r.outcome, r.trigger, r.node, r.definition, r.reason, r.runId])
			)
	)

	out.push(
		"## Recent warnings and errors\n\nThe server's last console warnings and errors since it started, oldest first.\n\n" +
			(f.logs.length
				? "```text\n" +
					f.logs
						.map((l) => `${l.at} ${l.level.toUpperCase()} ${l.text.replace(/```/g, "'''")}`)
						.join("\n") +
					"\n```\n"
				: "_none since the server started_\n")
	)

	const b = f.browser
	out.push(
		"## Browser\n\n" +
			kv([
				["User agent", b.userAgent],
				["Language", b.language],
				["Time zone", b.timeZone],
				["Viewport", b.viewport]
			])
	)

	out.push(
		"## Machine-readable copy\n\nThe same facts as above, as JSON.\n\n```json\n" +
			JSON.stringify(f) +
			"\n```\n"
	)

	return out.join("\n")
}

/**
 * The report, kept under `SUPPORT_REPORT_MAX_BYTES`.
 *
 * Over budget, it sheds in order of least value per byte: the oldest log
 * lines, then connection model lists, then the oldest failed runs and plugin
 * failures. What it shed is named in the header.
 */
export function renderSupportReport(input: SupportReportFacts): string {
	const f: SupportReportFacts = structuredClone(input)
	const bytes = (s: string) => Buffer.byteLength(s, "utf8")
	let text = renderOnce(f)
	let droppedLogs = 0
	while (bytes(text) > SUPPORT_REPORT_MAX_BYTES && f.logs.length) {
		const n = Math.min(25, f.logs.length)
		f.logs.splice(0, n)
		droppedLogs += n
		f.omitted = [`${droppedLogs} oldest log lines`]
		text = renderOnce(f)
	}
	if (bytes(text) > SUPPORT_REPORT_MAX_BYTES && f.connections.some((c) => c.models.length)) {
		for (const c of f.connections) c.models = []
		f.omitted.push("connection model lists (counts kept)")
		text = renderOnce(f)
	}
	while (
		bytes(text) > SUPPORT_REPORT_MAX_BYTES &&
		(f.pipelines.failedRuns.length > 5 || f.plugins.failures.length > 5)
	) {
		f.pipelines.failedRuns = f.pipelines.failedRuns.slice(0, Math.max(5, f.pipelines.failedRuns.length - 5))
		f.plugins.failures = f.plugins.failures.slice(0, Math.max(5, f.plugins.failures.length - 5))
		if (!f.omitted.includes("older failed runs and plugin failures"))
			f.omitted.push("older failed runs and plugin failures")
		text = renderOnce(f)
	}
	return text
}
