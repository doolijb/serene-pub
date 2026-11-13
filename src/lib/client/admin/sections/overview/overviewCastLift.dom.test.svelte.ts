/** The Overview's Data and backups card: the cast-upgrade line shows at count > 0, with its link, and not at 0. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { health } = vi.hoisted(() => ({
	health: {
		overview: null as any,
		attention: [] as any[],
		loading: false,
		connect: () => () => {},
		refresh: () => {}
	}
}))
vi.mock("$lib/client/admin/adminHealth.svelte", () => ({ adminHealth: health }))
vi.mock("$lib/shared/constants/version", () => ({
	appVersion: "0",
	appVersionDisplay: "0"
}))
vi.mock("$lib/client/admin/adminRouter.svelte", async (importOriginal) => ({
	...(await importOriginal<object>()),
	adminPage: { data: {} }
}))

import Page from "./Page.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const overview = (castLiftCount: number) => ({
	app: { accountsEnabled: false, uptimeSeconds: 100 },
	people: { userCount: 1, sessionCount: 0 },
	models: { missing: [], refusedDefaults: [] },
	pipelines: {
		published: 1,
		enabled: 1,
		runs24h: { ok: 0, failed: 0, total: 0 }
	},
	network: {
		tunnelAvailable: true,
		tunnelConfigured: false,
		tunnelRunning: false,
		tunnelHostname: null,
		allowedHostCount: 0,
		wildcard: false
	},
	data: {
		lastBackupAt: null,
		backupCount: 0,
		dailyBackups: true,
		lastBackupFailure: null,
		castLiftCount
	},
	extensions: {
		componentCount: 0,
		pluginCount: 0,
		sandboxEnabled: false,
		scriptCount: 0
	},
	attention: []
})

const render = (count: number) => {
	health.overview = overview(count)
	app = mount(Page, {
		target: document.body,
		context: new Map([["userCtx", { user: { isAdmin: true } }]])
	})
	flushSync()
	return [...document.querySelectorAll("a")].find((a) =>
		a.textContent?.includes("Data and backups")
	)
}

describe("Overview cast-upgrade line", () => {
	test("one member, singular, and the card leads to the list", () => {
		const card = render(1)!
		expect(card.textContent).toContain(
			"1 cast member reads differently since the upgrade"
		)
		expect(card.getAttribute("href")).toBe("/admin/data#cast-upgrade")
	})

	test("several, plural", () => {
		const card = render(3)!
		expect(card.textContent).toContain(
			"3 cast members read differently since the upgrade"
		)
	})

	test("none, no line and the card keeps its own link", () => {
		const card = render(0)!
		expect(card.textContent).not.toContain("since the upgrade")
		expect(card.getAttribute("href")).toBe("/admin/data")
	})
})
