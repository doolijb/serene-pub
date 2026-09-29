import { describe, expect, test } from "vitest"
import { redactForSupport, REDACTION_SUMMARY } from "./redact"
import {
	renderSupportReport,
	SUPPORT_REPORT_FORMAT,
	SUPPORT_REPORT_MAX_BYTES,
	type SupportReportFacts
} from "./render"

function facts(over: Partial<SupportReportFacts> = {}): SupportReportFacts {
	return {
		format: SUPPORT_REPORT_FORMAT,
		generatedAt: "2026-09-27T12:00:00.000Z",
		redacted: REDACTION_SUMMARY,
		app: { version: "0.6.0", databaseVersion: "0.6.0", mode: "development", uptimeSeconds: 3725 },
		packages: [
			{ name: "@serene-pub/sdk", version: "0.6.0-preview.0", source: "linked" },
			{ name: "@serene-pub/core-catalog", version: "0.6.0-preview.0", source: "linked" }
		],
		runtime: {
			node: "v24.1.0",
			platform: "linux",
			arch: "x64",
			osRelease: "7.0.0",
			container: false,
			cpus: 16,
			memoryTotalMb: 32000,
			memoryFreeMb: 12000,
			processRssMb: 700,
			heapUsedMb: 300
		},
		settings: { isAccountsEnabled: false, pipelinesEnabled: true },
		environment: [{ name: "NODE_ENV", value: "development" }, { name: "SERENE_PUB_DATA_DIR", value: "(set)" }],
		database: {
			appliedMigrations: 190,
			lastMigrationAt: "2026-09-26T00:00:00.000Z",
			pendingMigrations: false,
			backupCount: 2,
			lastBackupAt: "2026-09-27T00:00:00.000Z",
			dailyBackups: true,
			setAsideDirectories: 0,
			recentRecoveryActions: []
		},
		counts: { users: 1, sessions: 4 },
		attention: [{ level: "error", title: "Text has no model", detail: "Runs that need it will fail." }],
		connections: [
			{
				id: 1,
				name: "Kobold | local",
				type: "koboldcpp",
				modality: "text-gen",
				preset: null,
				endpoint: "http://localhost:5001",
				tokenCounter: "estimate",
				promptFormat: "chatml",
				capabilities: ["text->text"],
				modelCount: 3,
				models: [{ model: "qwen", enabled: true, contextWindow: 8192 }],
				modelsSyncedAt: null,
				modelsSyncError: null
			}
		],
		capabilityDefaults: [
			{ capability: "text->text", connectionId: null, connectionModelId: null, samplingConfigId: null, requiredBy: ["core:reply"] }
		],
		plugins: {
			sandboxEnabled: true,
			installed: [
				{
					slug: "acme.dice",
					name: "Dice",
					version: "1.2.0",
					enabled: true,
					backend: "quickjs",
					source: "https://github.com/acme/dice",
					author: "Acme",
					supportsServerRange: ">=0.6",
					builtAgainstSdk: ["0.6.0-preview.0"],
					bundleDigest: "abc123def456",
					deniedPermissions: [],
					disabledSwaps: 0,
					installedAt: null,
					updatedAt: null
				}
			],
			failures: [
				{ slug: "acme.dice", name: "Dice", hook: "roll", outcome: "timeout", count: 3, lastAt: "2026-09-27T11:00:00.000Z", lastReason: "exceeded 5000ms" }
			],
			failureWindowDays: 7
		},
		pipelines: { published: 3, enabled: 2, runs24h: { ok: 10, failed: 1, total: 11 }, failedRuns: [] },
		logs: [{ at: "2026-09-27T11:59:00.000Z", level: "error", text: "[KoboldCPP] refused" }],
		browser: { userAgent: "Mozilla/5.0", language: "en-GB", timeZone: "Europe/London", viewport: "1440×900" },
		omitted: [],
		...over
	}
}

const HEADINGS = [
	"# Serene Pub support report",
	"## Needs you",
	"## Versions",
	"## Runtime",
	"## Instance settings",
	"## Environment",
	"## Database and backups",
	"## Counts",
	"## Connections",
	"## Capability defaults",
	"## Plugins",
	"## Plugin failures (last 7 days)",
	"## Pipelines",
	"## Recent failed runs",
	"## Recent warnings and errors",
	"## Browser",
	"## Machine-readable copy"
]

function jsonBlock(md: string): unknown {
	const m = /```json\n([\s\S]*?)\n```\n?$/.exec(md)
	if (!m) throw new Error("no closing json block")
	return JSON.parse(m[1])
}

describe("renderSupportReport", () => {
	test("stable headings, in order", () => {
		const md = renderSupportReport(facts())
		const found = md.split("\n").filter((l) => /^#{1,2} /.test(l))
		expect(found).toEqual(HEADINGS)
	})

	test("says what it is and what was redacted before anything else", () => {
		const md = renderSupportReport(facts())
		const header = md.slice(0, md.indexOf("## Needs you"))
		expect(header).toContain("- App version: 0.6.0")
		expect(header).toContain("- Redacted: API keys")
		expect(header).toContain("- Generated: 2026-09-27T12:00:00.000Z")
	})

	test("ends with a JSON copy of the same facts", () => {
		const f = facts()
		expect(jsonBlock(renderSupportReport(f))).toEqual(f)
	})

	test("names affected plugins with version and source", () => {
		const md = renderSupportReport(facts())
		expect(md).toMatch(/\| acme\.dice \| Dice \| 1\.2\.0 \| yes \| quickjs \| https:\/\/github\.com\/acme\/dice \|/)
		expect(md).toMatch(/\| acme\.dice \| Dice \| roll \| timeout \| 3 \|/)
	})

	test("escapes table pipes", () => {
		expect(renderSupportReport(facts())).toContain("Kobold \\| local")
	})

	test("stays under the size budget by shedding the oldest log lines, and says so", () => {
		const logs = Array.from({ length: 300 }, (_, i) => ({
			at: "2026-09-27T11:00:00.000Z",
			level: "warn" as const,
			text: `line ${i} ` + "x".repeat(500)
		}))
		const md = renderSupportReport(facts({ logs }))
		expect(Buffer.byteLength(md, "utf8")).toBeLessThanOrEqual(SUPPORT_REPORT_MAX_BYTES)
		expect(md).toContain("line 299 ")
		expect(md).not.toContain("line 0 ")
		expect(md).toMatch(/- Shortened to fit: \d+ oldest log lines/)
		const json = jsonBlock(md) as SupportReportFacts
		expect(json.omitted[0]).toMatch(/oldest log lines/)
	})

	test("does not mutate its input", () => {
		const f = facts({ logs: Array.from({ length: 300 }, () => ({ at: "x", level: "warn" as const, text: "y".repeat(500) })) })
		renderSupportReport(f)
		expect(f.logs).toHaveLength(300)
	})
})

describe("gathered facts through the redactor", () => {
	test("keeps the report's own fields and scrubs what leaks in", () => {
		const f = facts({
			logs: [{ at: "2026-09-27T11:59:00.000Z", level: "error", text: "fetch http://bob:pw@10.0.0.5:5001/x?key=1 as bob failed" }],
			database: { ...facts().database, recentRecoveryActions: [{ at: "t", action: "restore" }] }
		})
		const out = redactForSupport(f, { homeDir: "/home/bob", people: [{ id: 1, names: ["bob"] }] })
		expect(out.connections[0].tokenCounter).toBe("estimate")
		expect(out.database.recentRecoveryActions).toEqual([{ at: "t", action: "restore" }])
		expect(out.plugins.installed[0].source).toBe("https://github.com/acme/dice")
		expect(out.logs[0].text).toBe("fetch http://[redacted]@[host]:5001/… as user#1 failed")
	})
})
