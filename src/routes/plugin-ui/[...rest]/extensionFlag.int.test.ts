/**
 * `/plugin-ui/` (a plugin's frame documents and component modules) and `/x/`
 * (a plugin's page) are part of the extension subsystem: with
 * SP_PLUGINS_ENABLED off they answer as if no plugin were installed — a 404
 * and the not-found page — and with it on they serve as before.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const PLUGIN = "acme.flagged"

beforeAll(async () => {
	const { db } = (await import("$lib/server/db")) as unknown as { db: TestDb }
	await db.insert(schema.plugins).values({
		pluginId: PLUGIN,
		name: "Flagged",
		bundleSource: "// x",
		bundleHash: "deadbeef",
		enabled: true,
		manifest: { surfaces: { page: { entry: "ui/page.html", title: "Page" } } }
	})
	await db.insert(schema.pluginFiles).values({
		pluginId: PLUGIN,
		path: "ui/page.html",
		mime: "text/html",
		content: Buffer.from("<h1>page</h1>").toString("base64"),
		hash: "abc",
		bytes: 13
	})
}, 60_000)

afterEach(() => {
	vi.unstubAllEnvs()
})

async function frame(rest: string): Promise<Response> {
	const { GET } = await import("./+server")
	return GET({ params: { rest }, request: new Request(`http://localhost/plugin-ui/${rest}`) } as never) as Promise<Response>
}

async function page(rest: string): Promise<Record<string, unknown>> {
	const { load } = await import("../../x/[...rest]/+page.server")
	return load({ params: { rest } } as never) as Promise<Record<string, unknown>>
}

describe("the extension flag gates plugin UI routes", () => {
	test("off: /plugin-ui/ answers 404 and /x/ resolves no page", async () => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "")
		expect((await frame(`${PLUGIN}/ui/page.html`)).status).toBe(404)
		expect(await page(PLUGIN)).toEqual({})
	})

	test("on: both serve as before", async () => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		const res = await frame(`${PLUGIN}/ui/page.html`)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe("<h1>page</h1>")
		expect(await page(PLUGIN)).toMatchObject({ src: `/plugin-ui/${PLUGIN}/ui/page.html`, title: "Page" })
	})
})
