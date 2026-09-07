/**
 * A failed generation says what happened — to whoever is allowed to be told.
 *
 * ## The bug this pins
 *
 * A Round-12 fix sent guests a generic sentence and the session OWNER the raw
 * service error, on the reasoning that the connection was "their own". Two
 * things were wrong with that under the 0.6 ruling ("connections must be
 * invisible, unmuteable and unchooseable to non-admins"):
 *
 *  1. The axis. A non-admin owner has no more relationship to the instance's
 *     compute than a guest does, and `managedPreflight` fills these errors with
 *     the model file path and the base URL.
 *  2. The moment. The error is STORED, and `projectLegacy` re-serves it on every
 *     reload — so redacting the broadcast alone was undone by the next page
 *     load. That is why the last case below asserts on the SECOND serving of
 *     the row rather than the first: it is the one the old fix passed.
 *
 * The fix is the shape of the stored row. Service text goes under `connection`,
 * the one key `withoutConnectionIdentity` removes at every egress, so redaction
 * happens on every serving without any code path having to remember. Sentences
 * this codebase composed (`ComposedError`) name nobody and are shown as written.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
		path.join(os.tmpdir(), "serene-pub-genstatus-redaction-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string, isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	if (isAdmin)
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, user.id))
	return user
}

function makeIoSpy() {
	const received: Record<string, any[]> = {}
	const io = {
		to: (room: string) => ({
			emit: (_event: string, data: any) => {
				received[room] = received[room] ?? []
				received[room].push(data)
			}
		})
	}
	return { io, received }
}

/**
 * Everything a service error can name, in one string: the base URL, the model
 * path on the administrator's disk, and a credential fragment.
 */
const SERVICE_TEXT =
	"KoboldCPP API error at http://192.168.1.5:5001: model " +
	"/home/admin/models/mythomax-q4.gguf not loaded (invalid API key " +
	"sk-real-secret-fragment)"

/** A session with a non-admin owner, a non-admin guest and an admin guest. */
async function scenario(tag: string) {
	const owner = await makeUser(`${tag}-owner`)
	const guest = await makeUser(`${tag}-guest`)
	const admin = await makeUser(`${tag}-admin`, true)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true })
		.returning()
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId: session.id, userId: guest.id, isPlayer: true },
		{ sessionId: session.id, userId: admin.id, isPlayer: true }
	])
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			isGenerating: true,
			content: ""
		})
		.returning()
	return { owner, guest, admin, session, message }
}

describe("a stored generation error", () => {
	test("names no connection to a non-admin — owner or guest — and still names one to an administrator", async () => {
		const { persistGenerationErrorRow } = await import("./generationStatus")
		const { owner, guest, admin, session, message } =
			await scenario("stored")

		const { io, received } = makeIoSpy()
		await persistGenerationErrorRow(
			io,
			session.id,
			message.id,
			new Error(SERVICE_TEXT)
		)

		const seenBy = (id: number) => received[`user_${id}`]?.[0]

		// The owner is not an administrator, so the axis that used to hand them
		// the raw text no longer exists.
		for (const nonAdmin of [owner, guest]) {
			const payload = seenBy(nonAdmin.id)
			const serialised = JSON.stringify(payload)
			expect(serialised).not.toContain("sk-real-secret-fragment")
			expect(serialised).not.toContain("192.168.1.5")
			expect(serialised).not.toContain("mythomax-q4.gguf")
			expect(payload.sessionMessage.error).not.toHaveProperty(
				"connection"
			)
			// A redaction, not a blank: it still reads as a sentence that tells
			// somebody what to do next.
			expect(payload.sessionMessage.error.message).toMatch(
				/generation failed/i
			)
			expect(payload.sessionMessage.error.message).toMatch(
				/administrator/i
			)
		}

		// The administrator keeps the whole diagnostic — which is what storing a
		// pre-redacted string would have destroyed for everyone, forever.
		expect(
			seenBy(admin.id).sessionMessage.error.connection.detail
		).toContain("sk-real-secret-fragment")
	})

	test("is STILL redacted the second time it is served — the reload the old fix missed", async () => {
		const { persistGenerationErrorRow } = await import("./generationStatus")
		const { broadcastToSessionUsers } = await import(
			"../sockets/utils/broadcastHelpers"
		)
		const { owner, admin, session, message } = await scenario("reload")

		await persistGenerationErrorRow(
			makeIoSpy().io,
			session.id,
			message.id,
			new Error(SERVICE_TEXT)
		)

		// The reload: the row read back out of the database and served again.
		// The old fix redacted the broadcast and left the column alone, so this
		// is the read that handed the raw text back.
		const stored = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, message.id)
		})
		const { io, received } = makeIoSpy()
		await broadcastToSessionUsers(io, session.id, "sessionMessage", {
			sessionMessage: stored
		})

		const reserved = received[`user_${owner.id}`]?.[0]
		expect(JSON.stringify(reserved)).not.toContain(
			"sk-real-secret-fragment"
		)
		expect(JSON.stringify(reserved)).not.toContain("192.168.1.5")
		expect(reserved.sessionMessage.error).not.toHaveProperty("connection")

		// And the column really does still hold it — the redaction is on the
		// way out, not a truncation of the evidence.
		expect((stored?.error as any)?.connection?.detail).toContain(
			"sk-real-secret-fragment"
		)
		expect(
			received[`user_${admin.id}`]?.[0].sessionMessage.error.connection
				.detail
		).toContain("sk-real-secret-fragment")
	})

	test("shows this codebase's own sentence verbatim, and the connection it was about to nobody else", async () => {
		const { persistGenerationErrorRow } = await import("./generationStatus")
		const { ComposedError } = await import(
			"$lib/server/connections/visibility"
		)
		const { owner, admin, session, message } = await scenario("composed")

		const { io, received } = makeIoSpy()
		await persistGenerationErrorRow(
			io,
			session.id,
			message.id,
			new ComposedError(
				"This connection cannot do Image generation. Enable it on the " +
					"connection, or choose one that can.",
				{ id: 7, name: "Studio", model: "sd-1.5", type: "a1111" }
			)
		)

		// Ours, so it survives: replacing it would throw away the one sentence
		// that says what to fix, and it names nobody by construction.
		const ownerError =
			received[`user_${owner.id}`]?.[0].sessionMessage.error
		expect(ownerError.message).toMatch(/cannot do Image generation/)
		expect(JSON.stringify(ownerError)).not.toContain("Studio")
		expect(JSON.stringify(ownerError)).not.toContain("sd-1.5")

		expect(
			received[`user_${admin.id}`]?.[0].sessionMessage.error.connection
		).toMatchObject({ id: 7, name: "Studio", model: "sd-1.5" })
	})
})
