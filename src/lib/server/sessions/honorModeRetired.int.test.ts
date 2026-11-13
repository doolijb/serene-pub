/**
 * ⏳ The retired `honorMode` key (lane ed, plan §25, ★6; owner 2026-11-05): the
 * pure mapping, and the boot pass over sessions and presets — including that
 * a second pass finds nothing and changes nothing.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { fromHonorMode, retireHonorMode } from "./honorModeRetired"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

describe("fromHonorMode", () => {
	test("old true: keep every turn off, players as the rules say", () => {
		expect(fromHonorMode({ honorMode: true, other: 1 })).toEqual({
			other: 1,
			keepEveryTurn: false,
			playerSheetLatitude: "as-ruled"
		})
	})

	test("old false: keep every turn on, no edits by players", () => {
		expect(fromHonorMode({ honorMode: false })).toEqual({
			keepEveryTurn: true,
			playerSheetLatitude: "no-edits"
		})
	})

	test("absent: null, nothing to do", () => {
		expect(fromHonorMode({ other: 1 })).toBeNull()
		expect(fromHonorMode({})).toBeNull()
	})

	test("a preset wrapper keeps its lock and askAtStart on each new key", () => {
		expect(
			fromHonorMode({
				honorMode: { value: true, lock: true, askAtStart: false }
			})
		).toEqual({
			keepEveryTurn: { value: false, lock: true, askAtStart: false },
			playerSheetLatitude: {
				value: "as-ruled",
				lock: true,
				askAtStart: false
			}
		})
	})

	test("a new key already present wins, honorMode is still dropped", () => {
		expect(fromHonorMode({ honorMode: true, keepEveryTurn: true })).toEqual(
			{
				keepEveryTurn: true,
				playerSheetLatitude: "as-ruled"
			}
		)
		expect(
			fromHonorMode({
				honorMode: false,
				keepEveryTurn: false,
				playerSheetLatitude: "all-own"
			})
		).toEqual({
			keepEveryTurn: false,
			playerSheetLatitude: "all-own"
		})
	})

	test("a non-boolean old value maps nothing but is dropped", () => {
		expect(fromHonorMode({ honorMode: "yes", a: 1 })).toEqual({ a: 1 })
		expect(
			fromHonorMode({ honorMode: { value: null, lock: true } })
		).toEqual({})
	})

	test("the input record is never changed", () => {
		const input = { honorMode: true }
		fromHonorMode(input)
		expect(input).toEqual({ honorMode: true })
	})
})

describe("retireHonorMode", () => {
	test("maps sessions and core-owned presets once; a shipped plugin preset is left to the projection, an older mutable one is mapped; a second pass changes nothing", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "honor-retired")
		const mkSession = async (genreFields: Record<string, unknown>) =>
			(
				await testDb
					.insert(schema.sessions)
					.values({
						userId: user.id,
						isGroup: false,
						genreId: "core:genre/dungeon-crawler",
						genreFields
					})
					.returning()
			)[0]!
		const sOn = await mkSession({ honorMode: true, autoAdvance: 3 })
		const sOff = await mkSession({ honorMode: false })
		const sNone = await mkSession({ autoAdvance: 1 })
		const sBad = await mkSession({ honorMode: "maybe" })

		const mkPreset = async (
			key: string,
			settings: Record<string, unknown>,
			ownerPluginId: number | null,
			isImmutable = false
		) =>
			(
				await testDb
					.insert(schema.sessionPresets)
					.values({
						seedKey: key,
						name: key,
						genreId: "core:genre/dungeon-crawler",
						settings,
						ownerPluginId,
						isImmutable
					})
					.returning()
			)[0]!
		const pCore = await mkPreset(
			"honor-retired-core",
			{ honorMode: { value: true, lock: true, askAtStart: false } },
			null
		)
		// A shipped (immutable) plugin preset is re-projected each boot and mapped there (Q1); an older,
		// mutable plugin row is mapped here, or the projection's "untouched" check would read it as edited
		// (scope review 2026-11-05).
		const pPlugin = await mkPreset(
			"honor-retired-plugin",
			{ honorMode: { value: true, lock: true } },
			987654,
			true
		)
		const pPluginMutable = await mkPreset(
			"honor-retired-plugin-mutable",
			{ honorMode: { value: false } },
			987654
		)
		const pPlain = await mkPreset("honor-retired-plain", { other: 1 }, null)

		const firstRun = await retireHonorMode(testDb as never)
		expect(firstRun).toEqual({ sessions: 3, presets: 2 })

		const sessionOf = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, id))
			)[0]!.genreFields
		const presetOf = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.id, id))
			)[0]!.settings

		expect(await sessionOf(sOn.id)).toEqual({
			autoAdvance: 3,
			keepEveryTurn: false,
			playerSheetLatitude: "as-ruled"
		})
		expect(await sessionOf(sOff.id)).toEqual({
			keepEveryTurn: true,
			playerSheetLatitude: "no-edits"
		})
		expect(await sessionOf(sNone.id)).toEqual({ autoAdvance: 1 })
		expect(await sessionOf(sBad.id)).toEqual({})
		expect(await presetOf(pCore.id)).toEqual({
			keepEveryTurn: { value: false, lock: true, askAtStart: false },
			playerSheetLatitude: {
				value: "as-ruled",
				lock: true,
				askAtStart: false
			}
		})
		expect(await presetOf(pPlugin.id)).toEqual({
			honorMode: { value: true, lock: true }
		})
		expect(await presetOf(pPluginMutable.id)).toEqual({
			keepEveryTurn: { value: true },
			playerSheetLatitude: { value: "no-edits" }
		})
		expect(await presetOf(pPlain.id)).toEqual({ other: 1 })

		// A second boot: nothing found, every row unchanged.
		const before = {
			sessions: await Promise.all(
				[sOn, sOff, sNone, sBad].map((r) => sessionOf(r.id))
			),
			presets: await Promise.all(
				[pCore, pPlugin, pPlain].map((r) => presetOf(r.id))
			)
		}
		expect(await retireHonorMode(testDb as never)).toEqual({
			sessions: 0,
			presets: 0
		})
		expect({
			sessions: await Promise.all(
				[sOn, sOff, sNone, sBad].map((r) => sessionOf(r.id))
			),
			presets: await Promise.all(
				[pCore, pPlugin, pPlain].map((r) => presetOf(r.id))
			)
		}).toEqual(before)
	}, 60_000)
})
