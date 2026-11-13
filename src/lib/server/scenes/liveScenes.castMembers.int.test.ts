/**
 * 🚧 A live scene's cast proposal maps a `cast_member:<id>` key straight to
 * that member (owner ruling 2026-11-06; ★9 2026-11-08: the key is stored
 * alone, readers filter members that no longer exist).
 *
 * The first two tests need `loadVocabulary` to resolve a named card-less
 * member to `cast_member:<id>`; the third drives a stale key through a
 * vocabulary stand-in, so it does not.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { buildGazetteer } from "$lib/server/pipelines/ranking/entities"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

vi.mock("$lib/server/annotations", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/annotations")>()
	return { ...actual, loadVocabulary: vi.fn(actual.loadVocabulary) }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-livescenescastmembers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

/** An open live scene on `main`, opened by a first line; `lines` follow. */
async function openScene(lines: string[]) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `livescenes-castmembers-${seq++}`
	const u = await createTestUser(testDb, label)
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: label } as any)
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: u.id,
			isGroup: false,
			name: label,
			lorebookId: b.id
		} as any)
		.returning()
	const ids: number[] = []
	for (const content of lines) {
		const m = await insertLegacy(db(), {
			sessionId: s.id,
			role: "assistant",
			content
		})
		ids.push(m.id)
	}
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: b.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: b.id,
			sessionId: s.id,
			historyEntryId: entry.id,
			channel: "main",
			openedAtMessageId: ids[0]
		} as any)
		.returning()
	return { user: u, book: b, session: s, scene, messageIds: ids }
}

const participantsOf = async (sceneId: number) =>
	(
		await testDb
			.select({ bindingId: schema.sceneCharacters.bindingId })
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, sceneId))
	).map((r) => r.bindingId)

const bindingCount = async (lorebookId: number) =>
	(
		await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).length

describe("refreshOpenSceneCast — a card-less member", () => {
	test("is written as that member, no binding minted, and a repeat writes nothing", async () => {
		const { refreshOpenSceneCast } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const { book, session, scene, messageIds } = await openScene([
			'Grust poured two. "Two it is," Grust said.'
		])
		const [grust] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				characterId: null,
				binding: "{{char:grust}}",
				name: "Grust"
			})
			.returning()
		const before = await bindingCount(book.id)

		const wrote = await refreshOpenSceneCast(db(), {
			sessionId: session.id,
			channel: "main",
			messageId: messageIds[0]
		})
		expect(wrote).toBe(true)
		expect(await participantsOf(scene.id)).toEqual([grust.id])
		expect(await bindingCount(book.id)).toBe(before)

		const again = await refreshOpenSceneCast(db(), {
			sessionId: session.id,
			channel: "main",
			messageId: messageIds[0]
		})
		expect(again).toBe(false)
	})

	test("whose card is soft-deleted still compares as the same cast", async () => {
		const { refreshOpenSceneCast } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const { user, book, session, scene, messageIds } = await openScene([
			'Grust poured two. "Two it is," Grust said.'
		])
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Grust",
				description: "",
				isDeleted: true
			})
			.returning()
		const [grust] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				characterId: card.id,
				binding: "{{char:grust2}}",
				name: "Grust"
			})
			.returning()
		const args = {
			sessionId: session.id,
			channel: "main",
			messageId: messageIds[0]
		}
		await refreshOpenSceneCast(db(), args)
		expect(await participantsOf(scene.id)).toEqual([grust.id])
		expect(await refreshOpenSceneCast(db(), args)).toBe(false)
	})

	test("who speaks by a soft-deleted card and is named is one member, and a repeat writes nothing", async () => {
		const { refreshOpenSceneCast } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const { user, book, session, scene } = await openScene([
			"The cellar door creaked open."
		])
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Grust",
				description: "",
				isDeleted: true
			})
			.returning()
		const [grust] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				characterId: card.id,
				binding: "{{char:grust3}}",
				name: "Grust"
			})
			.returning()
		// Sent by the card (`character:<card>`) and naming Grust
		// (`cast_member:<member>`, the card being gone): one person.
		const spoken = await insertLegacy(db(), {
			sessionId: session.id,
			role: "assistant",
			characterId: card.id,
			content: '"Two it is," Grust said.'
		} as any)
		const args = {
			sessionId: session.id,
			channel: "main",
			messageId: spoken.id
		}
		await refreshOpenSceneCast(db(), args)
		expect(await participantsOf(scene.id)).toEqual([grust.id])
		expect(await refreshOpenSceneCast(db(), args)).toBe(false)
	})
})

describe("refreshOpenSceneCast — a stale cast_member key", () => {
	test("writes nothing for a member that is gone, and never throws", async () => {
		const { refreshOpenSceneCast, readCastProposal } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const annotations = await import("$lib/server/annotations")
		const { book, session, scene, messageIds } = await openScene([
			'Ghost poured two. "Two it is," Ghost said.'
		])
		const real = await annotations.loadVocabulary(db(), book.id)
		vi.mocked(annotations.loadVocabulary).mockResolvedValue({
			...real,
			gazetteer: buildGazetteer([
				{ name: "Ghost", ref: { kind: "cast_member", id: 987654 } }
			])
		})
		try {
			const proposal = await readCastProposal(db(), scene as any)
			expect(proposal!.participants.map((p) => p.key)).toContain(
				"cast_member:987654"
			)
			await refreshOpenSceneCast(db(), {
				sessionId: session.id,
				channel: "main",
				messageId: messageIds[0]
			})
			expect(await participantsOf(scene.id)).toEqual([])
		} finally {
			vi.mocked(annotations.loadVocabulary).mockRestore()
		}
	})
})

describe("readCastProposal — a seat is keyed by its member (S4)", () => {
	async function seatedNamedWorld() {
		const { user, book, session, scene } = await openScene([
			"The cellar door creaked open."
		])
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: user.id,
				name: "Grust",
				description: "",
				isDeleted: true
			})
			.returning()
		const [grust] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				characterId: card.id,
				binding: `{{char:grust-seat-${seq++}}}`,
				name: "Grust"
			})
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: session.id,
				characterId: card.id,
				castMemberId: grust.id
			} as any)
		await insertLegacy(db(), {
			sessionId: session.id,
			role: "assistant",
			characterId: card.id,
			content: '"Two it is," Grust said.'
		} as any)
		return { scene, card, grust }
	}

	for (const on of [true, false])
		test(`flip ${on ? "on" : "off"}: a soft-deleted-card seat who is also named shows once, as cast_member:<member>`, async () => {
			const { memberFormSwitch } = await import(
				"$lib/server/state/memberForm"
			)
			const was = memberFormSwitch.on
			memberFormSwitch.on = on
			try {
				const { readCastProposal } = await import(
					"$lib/server/scenes/liveScenes"
				)
				const { scene, grust } = await seatedNamedWorld()
				const proposal = await readCastProposal(db(), scene as any)
				expect(proposal!.participants.map((p) => p.key)).toEqual([
					`cast_member:${grust.id}`
				])
			} finally {
				memberFormSwitch.on = was
			}
		})

	test("flip on: a carded seat who is also named shows once, by its card", async () => {
		const { memberFormSwitch } = await import(
			"$lib/server/state/memberForm"
		)
		const was = memberFormSwitch.on
		memberFormSwitch.on = true
		try {
			const { readCastProposal } = await import(
				"$lib/server/scenes/liveScenes"
			)
			const { user, book, session, scene } = await openScene([
				"The cellar door creaked open."
			])
			const [card] = await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name: "Vell", description: "" })
				.returning()
			const [vell] = await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book.id,
					characterId: card.id,
					binding: `{{char:vell-seat-${seq++}}}`,
					name: "Vell"
				})
				.returning()
			await testDb
				.insert(schema.sessionCharacters)
				.values({
					sessionId: session.id,
					characterId: card.id,
					castMemberId: vell.id
				} as any)
			await insertLegacy(db(), {
				sessionId: session.id,
				role: "assistant",
				characterId: card.id,
				content: '"Two it is," Vell said.'
			} as any)
			const proposal = await readCastProposal(db(), scene as any)
			expect(proposal!.participants.map((p) => p.key)).toEqual([
				`character:${card.id}`
			])
		} finally {
			memberFormSwitch.on = was
		}
	})
})
