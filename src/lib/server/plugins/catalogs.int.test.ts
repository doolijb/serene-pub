/**
 * Plugin string catalogs (M0, SHAPES L5; lane P3): `lang/<locale>.json`
 * `asset` rows are read into a per-plugin cache that `pluginCatalogOf` answers
 * from synchronously.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

const reads = vi.hoisted(() => ({ n: 0 }))
vi.mock("./frameHost", () => ({
	readPluginFileBytes: async (row: { content: string | null }) => {
		reads.n++
		return Buffer.from(row.content ?? "", "base64")
	}
}))

import {
	loadPluginCatalogs,
	pluginCatalogLocaleFor,
	pluginCatalogOf
} from "./catalogs"

let db: TestDb
let n = 0

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

beforeEach(() => {
	reads.n = 0
})

async function put(pluginId: string, file: string, text: string, hash = `h${++n}`) {
	const content = Buffer.from(text).toString("base64")
	await db
		.insert(schema.pluginFiles)
		.values({
			pluginId,
			path: `lang/${file}`,
			mime: "application/json",
			content,
			hash,
			bytes: text.length,
			storedAt: "db",
			kind: "asset"
		})
		.onConflictDoNothing()
}

describe("plugin catalogs", () => {
	it("pluginCatalogOf answers a loaded locale", async () => {
		await put("acme.a", "pt-BR.json", JSON.stringify({ Save: "Salvar", "Hi {0}": "Oi {0}" }))
		expect(await loadPluginCatalogs(db as never, "acme.a")).toEqual(["pt-br"])
		const cat = pluginCatalogOf("acme.a", "pt-br")
		expect(cat.get("Save")).toBe("Salvar")
		expect(cat.get("Hi {0}")).toBe("Oi {0}")
		expect(pluginCatalogOf("acme.a", "de").size).toBe(0)
		expect(pluginCatalogOf("acme.none", "pt-br").size).toBe(0)
	}, 60_000)

	it("pluginCatalogLocaleFor: exact, base, first region variant, none", async () => {
		await put("acme.b", "pt.json", "{}")
		await put("acme.b", "es-mx.json", "{}")
		await put("acme.b", "es-ar.json", "{}")
		await put("acme.b", "en-gb.json", "{}")
		await loadPluginCatalogs(db as never, "acme.b")
		expect(pluginCatalogLocaleFor("acme.b", "en-GB")).toBe("en-gb")
		expect(pluginCatalogLocaleFor("acme.b", "pt-br")).toBe("pt")
		expect(pluginCatalogLocaleFor("acme.b", "es")).toBe("es-ar")
		expect(pluginCatalogLocaleFor("acme.b", "ja")).toBeNull()
		expect(pluginCatalogLocaleFor("acme.unloaded", "en")).toBeNull()
	}, 60_000)

	it("a malformed catalog is skipped, the rest load", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await put("acme.c", "fr.json", JSON.stringify({ Save: "Enregistrer", Bad: 3 }))
		await put("acme.c", "de.json", "[1,2]")
		await put("acme.c", "it.json", "{nope")
		expect(await loadPluginCatalogs(db as never, "acme.c")).toEqual(["fr"])
		expect(pluginCatalogOf("acme.c", "fr").get("Save")).toBe("Enregistrer")
		expect(pluginCatalogOf("acme.c", "fr").has("Bad")).toBe(false)
		expect(warn).toHaveBeenCalledTimes(2)
		warn.mockRestore()
	}, 60_000)

	it("an unchanged hash list is not re-read", async () => {
		await put("acme.d", "es.json", JSON.stringify({ Save: "Guardar" }), "same-1")
		await loadPluginCatalogs(db as never, "acme.d")
		const first = reads.n
		expect(first).toBe(1)
		await loadPluginCatalogs(db as never, "acme.d")
		expect(reads.n).toBe(first)
		await db
			.update(schema.pluginFiles)
			.set({ hash: "same-2" })
			.where(eq(schema.pluginFiles.pluginId, "acme.d"))
		await loadPluginCatalogs(db as never, "acme.d")
		expect(reads.n).toBe(first + 1)
	}, 60_000)
})
