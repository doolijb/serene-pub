import { describe, expect, it } from "vitest"
import { attentionFor, STALE_BACKUP_MS, type OverviewFacts } from "./attention"

const NOW = Date.parse("2026-09-27T12:00:00Z")

function facts(over: Partial<{ [K in keyof OverviewFacts]: Partial<OverviewFacts[K]> }> = {}): OverviewFacts {
	const base: OverviewFacts = {
		app: { version: "0.6.0", accountsEnabled: true, uptimeSeconds: 10 },
		people: { userCount: 1, sessionCount: 0 },
		models: {
			jobsTotal: 3,
			jobsSet: 3,
			missing: [],
			syncErrors: [],
			refusedDefaults: []
		},
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

	// Gold until set (owner ruling 2026-10-06): every fresh pub starts here,
	// and unfinished is not broken, so the rail says "needs you", never red.
	it("chat with no default is attention, not an error, pointing at its row on Defaults", () => {
		const items = attentionFor(
			facts({ models: { missing: [{ capability: "text->text", requiredBy: ["core:node/reply"], neededBecause: "replies" }] } }),
			NOW
		)
		expect(items).toHaveLength(1)
		const [item] = items
		expect(item).toMatchObject({
			id: "models:missing:text->text",
			level: "attention",
			section: "/admin/defaults",
			action: { href: "/admin/defaults#default:text->text" }
		})
		expect(item.title).toBe("The Reply loadout needs a model")
		expect(item.title).not.toMatch(/broken|fail|error/i)
		expect(item.detail).toContain("core:node/reply")
		expect(item.detail).toContain("Runs that need it will fail.")
	})

	it("a chosen chat default whose connection stopped answering is still the red row", () => {
		const syncErrors = [
			{ connectionId: 7, name: "Home OpenAI", capabilities: ["text->text"], error: "401 Unauthorized" }
		]
		expect(
			attentionFor(facts({ models: { syncErrors } }), NOW).map((a) => [a.id, a.level])
		).toEqual([["connections:syncError:7", "error"]])
		// Beside an unset chat (here the broken default is images'): the broken
		// one first, red; the unset chat after it, gold.
		const out = attentionFor(
			facts({
				models: {
					missing: [{ capability: "text->text", requiredBy: ["core:node/reply"], neededBecause: "replies" }],
					syncErrors: [{ ...syncErrors[0], capabilities: ["text->image"] }]
				}
			}),
			NOW
		)
		expect(out.map((a) => [a.id, a.level])).toEqual([
			["connections:syncError:7", "error"],
			["models:missing:text->text", "attention"]
		])
	})

	// One rule (plan less-confusing C1): `missing` is already only the jobs
	// this pub NEEDS (jobUse.ts), so every one is an item — the Models card
	// counts the same list, and the rail's dot is the worst of these.
	it("two missing needed jobs are two gold items, each landing on its own row", () => {
		const items = attentionFor(
			facts({
				models: {
					missing: [
						{ capability: "text->text", requiredBy: ["core:node/reply"], neededBecause: "replies" },
						{
							capability: "text->image",
							requiredBy: ["core:oracle/generate-image"],
							neededBecause: "failedRun"
						}
					]
				}
			}),
			NOW
		)
		expect(items.map((i) => [i.id, i.level, i.action.href])).toEqual([
			["models:missing:text->text", "attention", "/admin/defaults#default:text->text"],
			["models:missing:text->image", "attention", "/admin/defaults#default:text->image"]
		])
		expect(items[0].title).toBe("The Reply loadout needs a model")
		expect(items[1].detail).toBe("A run needed it in the last 7 days and failed without it.")
		expect(items.every((i) => i.section === "/admin/defaults")).toBe(true)
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

	// A sync restated the model's modality after it was chosen: the default
	// stays, every run it names is refused, and that is broken — red — for any
	// job, not only chat.
	it("a default whose pair can no longer do its job is an error per job, pointing at its row on Defaults", () => {
		const refused = (capability: string) => ({
			capability,
			connectionId: 4,
			connectionName: "Ollama",
			connectionModelId: 41,
			modelName: "nomic-embed-text",
			refusal: "This model cannot do Chat. Choose a model that can."
		})
		const items = attentionFor(
			facts({
				models: {
					refusedDefaults: [
						refused("text->text"),
						refused("text->image")
					]
				}
			}),
			NOW
		)
		expect(items.map((a) => [a.id, a.level])).toEqual([
			["defaults:refused:text->text", "error"],
			["defaults:refused:text->image", "error"]
		])
		expect(items[0]).toMatchObject({
			title: "The Reply loadout can't use its model",
			section: "/admin/defaults",
			action: {
				label: "Choose a model",
				href: "/admin/defaults#default:text->text"
			}
		})
		expect(items[0].detail).toContain("nomic-embed-text on Ollama")
		expect(items[0].detail).toContain("Runs that need it will fail")
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
