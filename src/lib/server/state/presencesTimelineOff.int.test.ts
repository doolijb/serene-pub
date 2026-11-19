/**
 * Owner 2026-11-16 (T2): "While the timeline is off, dated presences are
 * ignored: everyone listed is present." The two places the server judges
 * presence: lore gating (`core:query/cast-presences@1` into
 * `core:task/eligibility@1`) and `cardMemberAt` (sprites). With the timeline on,
 * a member whose presence ended is gone from both.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { splitCandidates } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { characterLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "presences-timeline-off-secret" }
})

let db: TestDb
let dataDir: string
let bookId = 0
let sessionId = 0
let memberId = 0
let cardId = 0

type Binding = (input: unknown, ctx: unknown) => Promise<any>
const bindings = coreBindings() as unknown as Record<string, Binding>

const invoke = async (definitionId: string, input: unknown) => {
	const host = createHost(db as any, { sessionId })
	const node = { key: "gate", definitionId, definitionVersion: 1, kind: "query" }
	const out = await bindings[definitionId]!(input, {
		signal: new AbortController().signal,
		progress: () => {},
		log: () => {},
		status: () => {},
		countTokens: (text: string) => Math.ceil(text.length / 4),
		read: (table: string, query: unknown) => host.read!(table as any, query, node as any)
	})
	expect(out?.kind, JSON.stringify(out)?.slice(0, 400)).toBe("ok")
	return out.value
}

const setTimeline = (timelineEnabled: boolean) =>
	db.update(schema.lorebooks).set({ timelineEnabled }).where(eq(schema.lorebooks.id, bookId))

/** The cast presences read, then the eligibility gate over the narrator's character lore. */
async function gate() {
	const presences = await invoke("core:query/cast-presences@1", { scope: { sessionId } })
	const lore = await invoke("core:query/character-lore@1", { scope: { sessionId, currentCharacterId: null } })
	const verdict = await invoke("core:task/eligibility@1", {
		candidates: lore.main,
		exclusions: [],
		speaker: null,
		presences: presences.main,
		at: presences.at
	})
	const verity = splitCandidates<any>(verdict.main).items.find((c) => c?.payload?.name === "Verity's secret")
	return { presences, verity }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-presences-timeline-off-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const [user] = await db.insert(schema.users).values({ username: "presences-tl-off", isAdmin: false }).returning()
	const [book] = await db.insert(schema.lorebooks).values({ name: "Ashfall", userId: user!.id }).returning()
	bookId = book!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, lorebookId: bookId, storyClockYear: 12 } as any)
		.returning()
	sessionId = session!.id
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: user!.id, name: "Verity", description: "Verity." })
		.returning()
	cardId = card!.id
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const made = await insertCastMember(db as any, {
		lorebookId: bookId,
		binding: "{{char:1}}",
		name: "Verity",
		characterId: cardId
	} as any)
	memberId = made.member!.id
	// Her one presence ended in Y10; the session reads Y12.
	await db.insert(schema.castPresences).values({
		lorebookId: bookId,
		lorebookBindingId: memberId,
		branchId: null,
		personalPosition: 1,
		fromYear: 1,
		untilYear: 10
	})
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId: bookId,
				name: "Verity's secret",
				keys: "",
				content: "She has the key already.",
				constant: true,
				lorebookBindingId: memberId
			}
		] as any)
	)
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("presences with the timeline on and off", () => {
	it("on: the rows carry their dates, and a member whose presence ended has their lore left out and no appearance", async () => {
		await setTimeline(true)
		const { presences, verity } = await gate()
		expect(presences.main).toEqual([
			{ bindingId: memberId, from: { year: 1 }, until: { year: 10 }, position: 1 }
		])
		expect(verity?.ineligible?.reason).toMatch(/Verity is not in the world/)
		const { cardMemberAt } = await import("$lib/server/sockets/amendments")
		const read = await cardMemberAt(db as any, {
			lorebookId: bookId,
			characterId: cardId,
			at: { moment: { year: 12 } },
			timelineOff: false
		})
		expect(read!.appearances).toEqual([])
	})

	it("off: from and until are null, the member's lore is retrieved, and cardMemberAt answers one appearance", async () => {
		await setTimeline(false)
		try {
			const { presences, verity } = await gate()
			expect(presences.main).toEqual([{ bindingId: memberId, from: null, until: null, position: 1 }])
			expect(presences.at).toBeNull()
			expect(verity).toBeTruthy()
			expect(verity.ineligible).toBeUndefined()
			const { cardMemberAt } = await import("$lib/server/sockets/amendments")
			const read = await cardMemberAt(db as any, {
				lorebookId: bookId,
				characterId: cardId,
				at: { moment: { year: 12 } },
				timelineOff: true
			})
			expect(read!.appearances.map((a) => a.personalPosition)).toEqual([null])
			// Unchanged when the flag is absent.
			const judged = await cardMemberAt(db as any, {
				lorebookId: bookId,
				characterId: cardId,
				at: { moment: { year: 12 } },
				timelineOff: false
			})
			expect(judged!.appearances).toEqual([])
		} finally {
			await setTimeline(true)
		}
	})
})
