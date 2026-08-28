/**
 * Creation as a run (24 §12, T8), gated by byte parity.
 *
 * The create pipeline's two nodes call the same halves the imperative floor
 * calls (sessions/greetings.ts), so parity holds by construction — and this
 * test is the gate that keeps it true: twin sessions, one seeded through the
 * pipeline dispatch, one through the floor, compared row for row. If either
 * path drifts — a node stops calling the shared half, the half forks — the
 * twin comparison is where it shows.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { eq, asc } from "drizzle-orm"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let userId: number
let characterId: number
let personaId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "parity-user", isAdmin: false })
		.returning()
	userId = user.id
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alva",
			description: "A cartographer.",
			firstMessage: "{{char}} unrolls a map for {{user}}.",
			alternateGreetings: ["{{char}} nods at {{user}}.", "A quiet wave."]
		})
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			name: "Bram",
			description: "A traveller.",
			isDefault: false
		})
		.returning()
	personaId = persona.id
}, 120_000)

/** A session with the shared cast, ready to seed. */
async function makeSession(name: string) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name })
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
		visibility: "visible",
		position: 0
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session.id, personaId, position: 0 })
	return session
}

/** The comparable face of a seeded message — everything creation decides. */
async function seededRows(sessionId: number) {
	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
	return (rows as any[]).map((m) => ({
		role: m.role,
		characterId: m.characterId,
		personaId: m.personaId,
		content: m.content,
		metadata: m.metadata
	}))
}

describe("creation as a run (24 §12)", () => {
	test("the pipeline path and the imperative floor seed identical rows", async () => {
		const { dispatchSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const {
			collectSessionGreetings,
			writeSessionGreetings
		} = await import("$lib/server/sessions/greetings")

		const viaPipeline = await makeSession("via-pipeline")
		const dispatched = await dispatchSessionEvent(db as any, {
			sessionId: viaPipeline.id,
			userId,
			genreId: "core:genre/chat",
			event: "session-created",
			input: {
				main: {},
				sessionScope: { sessionId: viaPipeline.id, userId },
				sessionId: viaPipeline.id,
				request: {},
				fields: {}
			}
		})
		expect(dispatched?.specSlug).toBe("core:spec/create-chat")
		expect((dispatched?.receipt as any)?.outcome).not.toBe("err")

		const viaFloor = await makeSession("via-floor")
		const { entries } = await collectSessionGreetings(db, viaFloor.id)
		await writeSessionGreetings(db, {
			sessionId: viaFloor.id,
			userId,
			entries,
			channel: "main"
		})

		const a = await seededRows(viaPipeline.id)
		const b = await seededRows(viaFloor.id)
		expect(a.length).toBeGreaterThan(0)
		expect(a).toEqual(b)

		// The seeded content is the interpolated greeting, swipes and all.
		expect(a[0]).toMatchObject({
			role: "assistant",
			characterId,
			personaId: null,
			content: "Alva unrolls a map for Bram."
		})
		expect((a[0]!.metadata as any)?.isGreeting).toBe(true)
		expect((a[0]!.metadata as any)?.swipes?.history).toEqual([
			"Alva unrolls a map for Bram.",
			"Alva nods at Bram.",
			"A quiet wave."
		])
	}, 120_000)

	test("a genre with no create pipeline dispatches to nothing — the caller keeps its floor", async () => {
		const { dispatchSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const session = await makeSession("no-create-genre")
		const dispatched = await dispatchSessionEvent(db as any, {
			sessionId: session.id,
			userId,
			genreId: "acme:input/crawl@1",
			event: "session-created",
			input: {}
		})
		expect(dispatched).toBeNull()
	}, 120_000)

	test("member events resolve to nothing today — the seam, not a subscriber", async () => {
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		expect(
			await resolveSessionEventSpec(
				db as any,
				"core:genre/chat",
				"member-added"
			)
		).toBeNull()
	}, 120_000)
})
