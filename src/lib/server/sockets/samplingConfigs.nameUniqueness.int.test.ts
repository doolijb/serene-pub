/**
 * Sampling config names are unique PER MODALITY (0179).
 *
 * `seed_key` was the only unique thing on this table and it constrains the
 * seeder, not people — so two configs called "Default (Image)" were always
 * possible, and every picker in the app shows a config by name alone. Users
 * clone configs constantly (the sidebars build "New" by spreading the selected
 * row), so the name arriving already taken is the ordinary case, not the exotic
 * one.
 *
 * Scoped to the modality because "Default" is a fair name for a text preset AND
 * for an image one; they are never offered in the same list. Modality is PARSED
 * from `shape` — `split_part(split_part(shape,'/',2),'@',1)`, the exact inverse
 * of `shapeOfModality()` — so the tests below pin the three properties of that
 * parse that would otherwise fail silently: version tolerance, the modality
 * boundary itself, and an unknown plugin shape getting its own namespace.
 *
 * The rest is about what a PERSON sees. A raw Postgres unique violation reaching
 * the client names a constraint they have never heard of and does not say which
 * rule they tripped, so the handlers check first and translate the race.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { S } from "@serene-pub/sdk"
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
		path.join(os.tmpdir(), "serene-pub-sampling-name-unique-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	// "Default" and "Disabled" are seeded at explicit legacy ids 1 and 2. This
	// file creates its own sampling rows before sync() ever runs, and an empty
	// test database hands out id 2 first — colliding with a seed that has
	// occupied that id on every real install since before seedKey existed.
	// Stepping the sequence past them keeps this file measuring name uniqueness
	// instead of that test-database artefact.
	await testDb.execute(
		`SELECT setval(pg_get_serial_sequence('sampling_configs', 'id'), 100)`
	)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const INDEX = "sampling_configs_modality_name_unique"

/** The insert's error message, or null if it was accepted. */
async function insertError(values: any): Promise<string | null> {
	try {
		await testDb.insert(schema.samplingConfigs).values(values)
		return null
	} catch (e) {
		return String((e as Error).message)
	}
}

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

/** Collects what a handler emitted, so the message a person would see is testable. */
function collector() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => {
			events.push({ event, data })
		},
		errorOn: (event: string) =>
			events.find((e) => e.event === event)?.data?.error as
				| string
				| undefined
	}
}

describe("the index", () => {
	test("two image configs cannot share a name", async () => {
		expect(
			await insertError({ name: "Portrait", shape: S.imageGen })
		).toBeNull()
		expect(
			await insertError({ name: "Portrait", shape: S.imageGen })
		).toContain(INDEX)
	}, 60_000)

	test("the same name across the modality line is fine", async () => {
		// The whole reason this is scoped rather than global: "Portrait" for text
		// and "Portrait" for images are never shown in one list.
		expect(
			await insertError({ name: "Portrait", shape: S.textGen })
		).toBeNull()
	}, 60_000)

	test("case and surrounding space are one name to a person", async () => {
		// `lower` because "Default"/"default" are the same name to a reader.
		// `btrim` because NewNameModal's zod trims for VALIDATION and then hands
		// onConfirm the untrimmed string, so " Portrait" reaches the table intact.
		expect(
			await insertError({ name: "  portrait ", shape: S.imageGen })
		).toContain(INDEX)
	}, 60_000)

	test("a later shape VERSION still buckets with the same modality", async () => {
		// The parse takes the segment before '@', so `@2` is the same modality as
		// `@1`. A mapping keyed on whole shape ids would silently let a v2 row
		// duplicate every v1 name.
		expect(
			await insertError({
				name: "Portrait",
				shape: "core:shape/image-gen@2"
			})
		).toContain(INDEX)
	}, 60_000)

	test("an unknown plugin shape gets its OWN namespace", async () => {
		// The safe failure direction: a shape this build has never heard of
		// competes for names only with its own kind, rather than being folded
		// into text and colliding with the chat presets.
		expect(
			await insertError({
				name: "Portrait",
				shape: "acme:shape/holo-gen@1"
			})
		).toBeNull()
	}, 60_000)
})

describe("the handlers answer a collision in words", () => {
	test("create refuses a taken name and writes nothing", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("name-unique-create-admin")
		const c = collector()

		await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Studio Light", shape: S.imageGen })

		await expect(
			samplingConfigsCreate.handler(
				fakeSocket(admin.id),
				{
					sampling: { name: "Studio Light", shape: S.imageGen }
				} as any,
				c.emit as any
			)
		).rejects.toThrow()

		const message = c.errorOn("samplingConfigs:create:error")
		expect(message).toBeTruthy()
		// It has to name the thing and the rule, not the constraint.
		expect(message).toContain("Studio Light")
		expect(message).toContain("image generation")
		expect(message).not.toContain(INDEX)

		const rows = await testDb.query.samplingConfigs.findMany({
			where: eq(schema.samplingConfigs.name, "Studio Light")
		})
		expect(rows).toHaveLength(1)
	}, 60_000)

	test("create accepts the same name for the other modality", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("name-unique-cross-admin")
		const c = collector()

		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { name: "Studio Light", shape: S.textGen } } as any,
			c.emit as any
		)
		expect(res.sampling.name).toBe("Studio Light")
		expect(c.errorOn("samplingConfigs:create:error")).toBeUndefined()
	}, 60_000)

	test("renaming onto a taken name is refused and the row is untouched", async () => {
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("name-unique-rename-admin")
		const c = collector()

		const [mine] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Sketch", shape: S.imageGen })
			.returning()

		await expect(
			samplingConfigsUpdate.handler(
				fakeSocket(admin.id),
				{ sampling: { id: mine.id, name: "Studio Light" } } as any,
				c.emit as any
			)
		).rejects.toThrow()

		expect(c.errorOn("samplingConfigs:update:error")).toContain(
			"Studio Light"
		)
		const [after] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, mine.id))
		expect(after.name).toBe("Sketch")
	}, 60_000)

	test("saving a row under the name it already has is not a self-collision", async () => {
		// Every save the form makes sends the name back unchanged. Without the
		// `excludeId`, the row would collide with itself and no config could ever
		// be edited again — a failure that would look like "saving is broken".
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("name-unique-self-admin")
		const c = collector()

		const [mine] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "Wide Shot",
				shape: S.imageGen,
				values: { steps: 20 },
				enabled: ["steps"]
			})
			.returning()

		const res = await samplingConfigsUpdate.handler(
			fakeSocket(admin.id),
			{
				sampling: {
					id: mine.id,
					name: "Wide Shot",
					values: { steps: 22 },
					enabled: ["steps"]
				}
			} as any,
			c.emit as any
		)
		expect(res.sampling.values.steps).toBe(22)
		expect(c.errorOn("samplingConfigs:update:error")).toBeUndefined()
	}, 60_000)

	test("re-shaping a row into a modality where its name is taken is refused", async () => {
		// The collision the name alone does not reveal: nothing about the name
		// changed, the row moved. Caught because the check is asked about the
		// shape being written, not the one stored.
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("name-unique-reshape-admin")
		const c = collector()

		const [textRow] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Sketch", shape: S.textGen })
			.returning()

		await expect(
			samplingConfigsUpdate.handler(
				fakeSocket(admin.id),
				{ sampling: { id: textRow.id, shape: S.imageGen } } as any,
				c.emit as any
			)
		).rejects.toThrow()

		expect(c.errorOn("samplingConfigs:update:error")).toContain(
			"image generation"
		)
		const [after] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, textRow.id))
		expect(after.shape).toBe(S.textGen)
	}, 60_000)
})

describe("seeding under the constraint", () => {
	test("a seed YIELDS its name to a user's config rather than aborting sync", async () => {
		// The live hazard this change set creates: the image presets ship under
		// names ("SD 1.5", "Flux") a person may already have used. A rejected
		// write is not local — it aborts the whole try block in defaults.ts, so
		// context configs never seed, the system_settings insert fails its
		// foreign key, and the install comes up with a blank page. That cascade
		// has happened before and is documented in that file.
		const [theirs] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "SD 1.5",
				shape: S.imageGen,
				values: { steps: 12 },
				enabled: ["steps"]
			})
			.returning()

		await (await import("$lib/server/db/defaults")).sync()

		// Their row is untouched, byte for byte.
		const [stillTheirs] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, theirs.id))
		expect(stillTheirs).toEqual(theirs)

		// The built-in moved instead, and it is still identified by its seedKey.
		const [seeded] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-image-default"))
		expect(seeded.name).toBe("SD 1.5 (Built-in)")
		expect(seeded.values).toEqual({
			steps: 25,
			cfg: 7,
			width: 512,
			height: 512
		})

		// And the rest of sync() ran — this is the half that proves no cascade.
		const contexts = await testDb.select().from(schema.contextConfigs)
		expect(contexts.length).toBeGreaterThan(0)
	}, 60_000)

	test("the yield is stable across boots", async () => {
		// Re-derived from the same snapshot every time, so it must not walk:
		// "SD 1.5 (Built-in) (Built-in)" on the second boot would be a new row
		// name every restart.
		await (await import("$lib/server/db/defaults")).sync()
		const [seeded] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-image-default"))
		expect(seeded.name).toBe("SD 1.5 (Built-in)")
	}, 60_000)
})

describe("the 0179 migration", () => {
	// Deliberately last: it drops the index, so anything after it would be
	// running against a table without the constraint under test.
	test("de-duplicates an install that already collided, and converges", async () => {
		const file = path.resolve(
			process.cwd(),
			"drizzle/0179_sampling_name_unique_per_modality.sql"
		)
		const migration = await fs.readFile(file, "utf8")

		await testDb.execute(`DROP INDEX "${INDEX}"`)

		// Three rows on one name — and a fourth already holding the name the
		// ranked rename will produce. One ranked pass turns the first collision
		// into a second one, which is exactly why the migration loops; without
		// the loop, CREATE UNIQUE INDEX fails here.
		const [oldest] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Legacy", shape: S.imageGen })
			.returning()
		const [newer] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Legacy", shape: S.imageGen })
			.returning()
		const [seeded] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "Legacy",
				shape: S.imageGen,
				isImmutable: true,
				seedKey: "sampling-legacy-fixture"
			})
			.returning()
		await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Legacy (2)", shape: S.imageGen })

		for (const statement of migration.split("--> statement-breakpoint"))
			if (statement.trim()) await testDb.execute(statement)

		// The user's oldest row keeps the name. A built-in yields because its
		// identity is its seedKey and the seeder re-derives its name on the next
		// boot anyway; a user's name is theirs and renaming it would be a silent
		// edit to their data.
		const nameOf = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.samplingConfigs)
					.where(eq(schema.samplingConfigs.id, id))
			)[0].name
		expect(await nameOf(oldest.id)).toBe("Legacy")
		expect(await nameOf(newer.id)).not.toBe("Legacy")
		expect(await nameOf(seeded.id)).not.toBe("Legacy")

		// Nothing collides any more, measured with the index's own expressions.
		const dupes: any = await testDb.execute(`
			SELECT count(*)::int AS n FROM (
				SELECT 1 FROM "sampling_configs"
				GROUP BY split_part(split_part("shape", '/', 2), '@', 1),
				         lower(btrim("name"))
				HAVING count(*) > 1
			) d
		`)
		expect((dupes.rows ?? dupes)[0].n).toBe(0)

		// And the index is back — the statement above would have thrown if the
		// de-duplication had missed a group.
		const idx: any = await testDb.execute(
			`SELECT indexname FROM pg_indexes WHERE indexname = '${INDEX}'`
		)
		expect((idx.rows ?? idx).length).toBe(1)
	}, 60_000)
})
