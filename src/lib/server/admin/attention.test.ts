import { describe, expect, it } from "vitest"
import { attentionFor, STALE_BACKUP_MS, type OverviewFacts } from "./attention"

const NOW = Date.parse("2026-09-27T12:00:00Z")

function facts(over: Partial<{ [K in keyof OverviewFacts]: Partial<OverviewFacts[K]> }> = {}): OverviewFacts {
	const base: OverviewFacts = {
		app: { version: "0.6.0", accountsEnabled: true, uptimeSeconds: 10 },
		people: { userCount: 1, sessionCount: 0 },
		models: { jobsTotal: 3, jobsSet: 3, missing: [], syncErrors: [] },
		network: {
			tunnelAvailable: true,
			tunnelConfigured: false,
			tunnelRunning: false,
			tunnelHostname: null,
			tunnelStatus: null,
			tunnelLastError: null,
			allowedHostCount: 2,
			wildcard: false
		},
		data: {
			lastBackupAt: new Date(NOW - 60_000).toISOString(),
			backupCount: 1,
			dailyBackups: true,
			lastBackupFailure: null
		},
		pipelines: { published: 4, enabled: 4, runs24h: { ok: 3, failed: 0, total: 3 } },
		extensions: {
			sandboxEnabled: false,
			pluginCount: 0,
			scriptCount: 0,
			componentCount: 0,
			awaitingReview: []
		}
	}
	for (const [k, v] of Object.entries(over)) Object.assign((base as any)[k], v)
	return base
}

const ids = (f: OverviewFacts) => attentionFor(f, NOW).map((a) => a.id)

describe("attentionFor", () => {
	it("is empty for a healthy instance, sandbox off with nothing installed included", () => {
		expect(attentionFor(facts(), NOW)).toEqual([])
	})

	it("chat with no default is an error pointing at its row on Defaults", () => {
		const [item] = attentionFor(
			facts({ models: { missing: [{ capability: "text->text", requiredBy: ["core:node/reply"] }] } }),
			NOW
		)
		expect(item).toMatchObject({
			id: "models:missing:text->text",
			level: "error",
			section: "/admin/defaults",
			action: { href: "/admin/defaults#default:text->text" }
		})
		expect(item.detail).toContain("core:node/reply")
	})

	// Demanded by some node on every fresh pub; a row nobody can act on is noise.
	it("other unset capabilities stay off the list", () => {
		const items = attentionFor(
			facts({
				models: {
					missing: [
						{ capability: "text->image", requiredBy: ["core:oracle/generate-image"] },
						{ capability: "text->embedding", requiredBy: ["core:query/semantic"] }
					]
				}
			}),
			NOW
		)
		expect(items.filter((i) => i.id.startsWith("models:missing"))).toEqual([])
	})

	it("failed runs in the last day are an error on Pipelines", () => {
		const [item] = attentionFor(
			facts({ pipelines: { runs24h: { ok: 1, failed: 2, total: 3 } } }),
			NOW
		)
		expect(item).toMatchObject({ level: "error", section: "/admin/pipelines" })
		expect(item.title).toBe("2 pipeline runs failed today")
	})

	it("a configured tunnel with accounts off asks for accounts, unless tunnels are unavailable", () => {
		const f = facts({ app: { accountsEnabled: false }, network: { tunnelConfigured: true } })
		expect(attentionFor(f, NOW)).toMatchObject([
			{ id: "network:tunnelNeedsAccounts", level: "attention", section: "/admin/general" }
		])
		f.network.tunnelAvailable = false
		expect(ids(f)).toEqual([])
	})

	it("no backup in 48 hours while daily backups are on is attention on Data", () => {
		const old = new Date(NOW - STALE_BACKUP_MS - 1).toISOString()
		expect(ids(facts({ data: { lastBackupAt: old } }))).toEqual(["data:staleBackup"])
		expect(ids(facts({ data: { lastBackupAt: null, backupCount: 0 } }))).toEqual(["data:staleBackup"])
		expect(ids(facts({ data: { lastBackupAt: old, dailyBackups: false } }))).toEqual([])
	})

	it("the sandbox being off is attention only while plugins are installed", () => {
		expect(ids(facts({ extensions: { pluginCount: 2 } }))).toEqual(["extensions:sandboxOff"])
		expect(ids(facts({ extensions: { pluginCount: 2, sandboxEnabled: true } }))).toEqual([])
	})

	it("a tunnel the supervisor marked `error` is an error on its Network card", () => {
		const f = facts({
			network: {
				tunnelConfigured: true,
				tunnelStatus: "error",
				tunnelLastError: "cloudflared exited with code 1. Gave up after 3 restart attempts."
			}
		})
		const [item] = attentionFor(f, NOW)
		expect(item).toMatchObject({
			id: "network:tunnelFailed",
			level: "error",
			section: "/admin/network",
			action: { href: "/admin/network#tunnel-heading" }
		})
		expect(item.detail).toContain("Gave up after 3 restart attempts")
		// Keyed on the status, not on a lingering `last_error`.
		f.network.tunnelStatus = "stopped"
		expect(ids(f)).toEqual([])
		f.network.tunnelStatus = "running"
		expect(ids(f)).toEqual([])
		// No tunnels on this platform: nothing to say.
		f.network.tunnelStatus = "error"
		f.network.tunnelAvailable = false
		expect(ids(f)).toEqual([])
	})

	it("a failed tunnel with accounts off shows only the accounts fix", () => {
		const f = facts({
			app: { accountsEnabled: false },
			network: { tunnelConfigured: true, tunnelStatus: "error" }
		})
		expect(ids(f)).toEqual(["network:tunnelNeedsAccounts"])
	})

	it("a failed daily backup is an error on Data, and replaces the stale row", () => {
		const failedAt = new Date(NOW - 60_000).toISOString()
		const lastBackupFailure = { at: failedAt, message: "ENOSPC: no space left on device" }
		// Newest backup older than the failure: the failure stands.
		const old = new Date(NOW - STALE_BACKUP_MS - 1).toISOString()
		const [item] = attentionFor(facts({ data: { lastBackupAt: old, lastBackupFailure } }), NOW)
		expect(item).toMatchObject({
			id: "data:backupFailed",
			level: "error",
			section: "/admin/data",
			action: { href: "/admin/data#backup-now" }
		})
		expect(item.detail).toContain("ENOSPC")
		// Stale AND failed is one row, the failure.
		expect(ids(facts({ data: { lastBackupAt: old, lastBackupFailure } }))).toEqual([
			"data:backupFailed"
		])
		// Never any backup at all, and the first attempt failed.
		expect(
			ids(facts({ data: { lastBackupAt: null, backupCount: 0, lastBackupFailure } }))
		).toEqual(["data:backupFailed"])
	})

	it("a backup taken after the failure answers it; daily backups off silences it", () => {
		const lastBackupFailure = {
			at: new Date(NOW - 120_000).toISOString(),
			message: "boom"
		}
		const newer = new Date(NOW - 60_000).toISOString()
		expect(ids(facts({ data: { lastBackupAt: newer, lastBackupFailure } }))).toEqual([])
		expect(
			ids(facts({ data: { lastBackupAt: null, lastBackupFailure, dailyBackups: false } }))
		).toEqual([])
	})

	it("a sync error on a capability default is an error linking to that connection", () => {
		const [item] = attentionFor(
			facts({
				models: {
					syncErrors: [
						{
							connectionId: 7,
							name: "Home OpenAI",
							error: "401 Unauthorized",
							capabilities: ["text->text"]
						}
					]
				}
			}),
			NOW
		)
		expect(item).toMatchObject({
			id: "connections:syncError:7",
			level: "error",
			section: "/admin/connections",
			action: { href: "/admin/connections/7#models" }
		})
		expect(item.title).toContain("Home OpenAI")
		expect(item.detail).toContain("401 Unauthorized")
	})

	// An endpoint nothing relies on may be off on purpose.
	it("a sync error on a connection that is no default stays off the list", () => {
		expect(
			ids(
				facts({
					models: {
						syncErrors: [
							{ connectionId: 3, name: "Spare box", error: "ECONNREFUSED", capabilities: [] }
						]
					}
				})
			)
		).toEqual([])
	})

	it("plugins waiting for review are one attention item on Plugins, counted", () => {
		const [item] = attentionFor(
			facts({
				extensions: { pluginCount: 3, sandboxEnabled: true, awaitingReview: ["Dice tray", "Weather"] }
			}),
			NOW
		)
		expect(item).toMatchObject({
			id: "plugins:awaitingReview",
			level: "attention",
			title: "2 plugins waiting for review",
			section: "/admin/plugins",
			action: { href: "/admin/plugins#installed-plugins" }
		})
		expect(item.detail).toContain("Dice tray, Weather")
		expect(
			attentionFor(
				facts({ extensions: { pluginCount: 1, sandboxEnabled: true, awaitingReview: ["Dice tray"] } }),
				NOW
			)[0].title
		).toBe("1 plugin waiting for review")
		expect(ids(facts({ extensions: { pluginCount: 3, sandboxEnabled: true } }))).toEqual([])
	})

	it("orders errors before attention items", () => {
		const out = attentionFor(
			facts({
				extensions: { pluginCount: 1 },
				pipelines: { runs24h: { ok: 0, failed: 1, total: 1 } }
			}),
			NOW
		)
		expect(out.map((a) => a.level)).toEqual(["error", "attention"])
	})
})
