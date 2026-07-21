import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-personas-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

function toBase64(card: unknown): string {
	return Buffer.from(JSON.stringify(card), "utf-8").toString("base64")
}

const minimalPersonaCard = {
	name: "Jordan",
	description: "A curious traveler",
	creator: "tester",
	extensions: {}
}

describe("personas import/export (PGlite integration)", () => {
	test("imports a plain persona card, creating a row with correct fields", async () => {
		const { personasImportCard } = await import("./personas")
		const user = await makeUser("persona-v2-import-user")

		const res = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalPersonaCard) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.persona?.name).toBe("Jordan")
		expect(res.persona?.description).toBe("A curious traveler")
	})

	test("re-importing the exact bytes of a previously-imported persona (same uuid) reports unchanged with no new row", async () => {
		const { personasImportCard, personasExportCard } = await import(
			"./personas"
		)
		const user = await makeUser("persona-unchanged-user")

		const created = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalPersonaCard) },
			noopEmit
		)
		expect(created.status).toBe("created")

		const exported = await personasExportCard.handler(
			fakeSocket(user.id),
			{ id: created.persona!.id, format: "json" },
			noopEmit
		)
		const exportedBase64 = exported.blob.toString("base64")

		const reimported = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: exportedBase64 },
			noopEmit
		)

		expect(reimported.status).toBe("unchanged")
		expect(reimported.persona?.id).toBe(created.persona!.id)

		const rows = await testDb.query.personas.findMany({
			where: (p, { eq }) => eq(p.userId, user.id)
		})
		expect(rows).toHaveLength(1)
	})

	test("importing an edited version of an already-imported persona (same uuid, different content) conflicts, then resolves via overwrite/createNew", async () => {
		const { personasImportCard, personasImportResolve, personasExportCard } =
			await import("./personas")
		const user = await makeUser("persona-conflict-user")

		const created = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalPersonaCard) },
			noopEmit
		)
		const exported = await personasExportCard.handler(
			fakeSocket(user.id),
			{ id: created.persona!.id, format: "json" },
			noopEmit
		)
		const exportedCard = JSON.parse(exported.blob.toString("utf-8"))
		exportedCard.description = "A completely different description"
		const editedBase64 = Buffer.from(
			JSON.stringify(exportedCard),
			"utf-8"
		).toString("base64")

		const conflictRes = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: editedBase64 },
			noopEmit
		)
		expect(conflictRes.status).toBe("conflict")
		expect(conflictRes.conflict?.existingPersona.id).toBe(created.persona!.id)

		const overwritten = await personasImportResolve.handler(
			fakeSocket(user.id),
			{
				file: editedBase64,
				action: "overwrite",
				existingId: created.persona!.id
			},
			noopEmit
		)
		expect(overwritten.persona.id).toBe(created.persona!.id)
		expect(overwritten.persona.description).toBe(
			"A completely different description"
		)

		const asNew = await personasImportResolve.handler(
			fakeSocket(user.id),
			{ file: editedBase64, action: "createNew", existingId: -1 },
			noopEmit
		)
		expect(asNew.persona.id).not.toBe(created.persona!.id)

		const rows = await testDb.query.personas.findMany({
			where: (p, { eq }) => eq(p.userId, user.id)
		})
		expect(rows).toHaveLength(2)
	})

	test("a malformed extensions.serenepub.uuid is treated as absent — imports as new, no raw DB error", async () => {
		const { personasImportCard } = await import("./personas")
		const user = await makeUser("persona-malformed-uuid-user")

		const malformedCard = {
			...minimalPersonaCard,
			extensions: { serenepub: { uuid: "not-a-real-uuid" } }
		}

		const res = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(malformedCard) },
			noopEmit
		)

		expect(res.status).toBe("created")
		expect(res.persona?.name).toBe("Jordan")
	})

	test("exporting as PNG with no avatar throws a clean error", async () => {
		const { personasImportCard, personasExportCard } = await import(
			"./personas"
		)
		const user = await makeUser("persona-no-avatar-user")

		const created = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: toBase64(minimalPersonaCard) },
			noopEmit
		)

		await expect(
			personasExportCard.handler(
				fakeSocket(user.id),
				{ id: created.persona!.id, format: "png" },
				noopEmit
			)
		).rejects.toThrow(/no avatar/i)
	})
})
