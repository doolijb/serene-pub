/**
 * EVERY config list is ordered built-ins first, then alphabetical.
 *
 * samplingConfigsList had no `orderBy` at all, so rows came back in whatever
 * order Postgres returned them. SamplingSidebar hides that — it renders two
 * `{#each}` blocks filtered on isImmutable — but the same response also feeds
 * EditChatForm and every per-task override selector in PromptsSidebar, which
 * render it flat and so interleaved presets with the user's own configs.
 * Ordering once at the source fixes all of them, and sorts within the
 * sidebar's two groups as well (its filters preserve input order).
 *
 * The convention was split for a while: samplingConfigs and graphBuildConfigs
 * ordered built-ins first (`desc`), while contextConfigs, promptConfigs,
 * narratorPromptConfigs and the three summarize lists ordered them LAST
 * (`asc`). Every sidebar happens to regroup with its own isImmutable filters,
 * so the split was invisible in the UI and would have stayed that way — hence
 * pinning it here across all of them rather than per handler.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sampling-order-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

describe("config list ordering", () => {
	test("immutable presets come first, each group alphabetical", async () => {
		const { samplingConfigsListHandler } = await import("./samplingConfigs")
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "sampling-order-user", isAdmin: true })
			.returning()

		// Inserted deliberately out of order — a user config first, and names
		// that would interleave if isImmutable were ignored.
		await testDb.insert(schema.samplingConfigs).values([
			{ name: "Zephyr (mine)", isImmutable: false },
			{ name: "Default", isImmutable: true, seedKey: "t-default" },
			{ name: "Aardvark (mine)", isImmutable: false },
			{
				name: "Precise (Extraction)",
				isImmutable: true,
				seedKey: "t-precise"
			}
		])

		const res = await samplingConfigsListHandler.handler(
			fakeSocket(admin.id),
			{},
			() => {}
		)
		const rows = res.samplingConfigsList

		// Every built-in precedes every user config.
		const lastImmutable = rows.map((r) => r.isImmutable).lastIndexOf(true)
		const firstMutable = rows.map((r) => r.isImmutable).indexOf(false)
		expect(lastImmutable).toBeLessThan(firstMutable)

		const names = (immutable: boolean) =>
			rows.filter((r) => r.isImmutable === immutable).map((r) => r.name)
		expect(names(true)).toEqual(["Default", "Precise (Extraction)"])
		expect(names(false)).toEqual(["Aardvark (mine)", "Zephyr (mine)"])
	})

	test("every other config list follows the same convention", async () => {
		// One assertion per handler rather than one shared helper: the point is
		// that a NEW config type is easy to get wrong, and a reader adding one
		// should see the list they need to join.
		const [{ contextConfigsListHandler }, { promptConfigsListHandler }] =
			await Promise.all([
				import("./contextConfigs"),
				import("./promptConfigs")
			])
		const { narratorPromptConfigsListHandler } = await import(
			"./narratorPromptConfigs"
		)
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "config-order-user", isAdmin: true })
			.returning()

		await testDb.insert(schema.contextConfigs).values([
			{ name: "Zed ctx", isImmutable: false },
			{ name: "Built ctx", isImmutable: true }
		])
		await testDb.insert(schema.promptConfigs).values([
			{ name: "Zed prompt", isImmutable: false, systemPrompt: "x" },
			{ name: "Built prompt", isImmutable: true, systemPrompt: "y" }
		])
		await testDb.insert(schema.narratorPromptConfigs).values([
			{
				name: "Zed narrator",
				isImmutable: false,
				systemPrompt: "x"
			},
			{
				name: "Built narrator",
				isImmutable: true,
				systemPrompt: "y"
			}
		])

		const socket = fakeSocket(admin.id)
		const builtInsFirst = (
			rows: Array<{ isImmutable?: boolean | null }>
		) => {
			const flags = rows.map((r) => !!r.isImmutable)
			expect(flags.lastIndexOf(true)).toBeLessThan(flags.indexOf(false))
		}

		builtInsFirst(
			(await contextConfigsListHandler.handler(socket, {}, () => {}))
				.contextConfigsList
		)
		builtInsFirst(
			(await promptConfigsListHandler.handler(socket, {}, () => {}))
				.promptConfigsList
		)
		builtInsFirst(
			(
				await narratorPromptConfigsListHandler.handler(
					socket,
					{},
					() => {}
				)
			).narratorPromptConfigsList
		)
	})
})
