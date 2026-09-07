/**
 * A session is not a way to choose a connection.
 *
 * ## The hole this closes
 *
 * `sessions.connection_id` is the HIGHEST-precedence tier in
 * `resolveCapabilityTarget` — above the pipeline's config, above the instance
 * default — and both `sessions:create` and `sessions:update` took it straight
 * from the client. Create spread the whole `params.session` into the insert;
 * update carried it on an explicit allowlist under a comment saying a reference
 * to an "admin-managed global table … needs no such check". Owning a session is
 * not administering the instance, so a non-admin could point every run in a
 * session they own at any connection on the box, permanently, by id alone — no
 * review card, no pipeline panel, nothing to notice.
 *
 * This is the same violation as the review card and the worse of the two,
 * because it persists.
 *
 * ## The awkward half, pinned here too
 *
 * A non-admin's copy of their own session now arrives with `connectionId`
 * redacted, so their client round-trips a NULL on an ordinary rename. Refusing
 * that would make every session uneditable for anyone who is not an
 * administrator; writing it would silently clear the connection an
 * administrator chose. It is dropped, and only a real id is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { CONNECTION_REFUSAL } from "$lib/server/connections/visibility"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-connchoice-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number, isAdmin: boolean) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function makeUser(username: string, isAdmin = false) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin })
		.returning()
	return user!
}

/** The administrator's compute, which nobody else is to point a run at. */
async function makeConnection(name: string) {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name, type: "openai_chat", model: "gpt-secret" } as any)
		.returning()
	return connection!
}

const readSession = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
			.limit(1)
	)[0]!

/** Collects `{event}:error` so the refusal can be read, not merely inferred. */
function errorSink() {
	const errors: { event: string; error: string }[] = []
	return {
		errors,
		emit: (event: string, data: any) => {
			if (event.endsWith(":error"))
				errors.push({ event, error: data?.error })
		}
	}
}

describe("creating a session", () => {
	test("a non-admin naming a connection is refused, and creates nothing", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser("create-refused")
		const connection = await makeConnection("Studio A")
		const sink = errorSink()

		await expect(
			sessionsCreateHandler.handler(
				fakeSocket(user.id, false),
				{
					session: {
						name: "Mine",
						connectionId: connection.id
					}
				} as any,
				sink.emit
			)
		).rejects.toThrow()

		expect(sink.errors[0]?.error).toBe(CONNECTION_REFUSAL)
		// Refused before the write, not corrected after it.
		const rows = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, user.id))
		expect(rows).toHaveLength(0)
	}, 60_000)

	test("a non-admin's ordinary create still works, with no connection on it", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser("create-ordinary")
		const sink = errorSink()

		await sessionsCreateHandler.handler(
			fakeSocket(user.id, false),
			{ session: { name: "A walk", connectionId: null } } as any,
			sink.emit
		)

		expect(sink.errors).toEqual([])
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, user.id))
		expect(row!.name).toBe("A walk")
		expect(row!.connectionId).toBeNull()
	}, 60_000)

	test("an administrator may still name one", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const admin = await makeUser("create-admin", true)
		const connection = await makeConnection("Studio B")

		await sessionsCreateHandler.handler(
			fakeSocket(admin.id, true),
			{
				session: { name: "Admin's", connectionId: connection.id }
			} as any,
			() => {}
		)

		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, admin.id))
		expect(row!.connectionId).toBe(connection.id)
	}, 60_000)
})

describe("updating a session", () => {
	test("a non-admin owner cannot redirect their own session, even with a real id", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const user = await makeUser("update-refused")
		const chosen = await makeConnection("Chosen by the admin")
		const coveted = await makeConnection("Coveted")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				connectionId: chosen.id
			} as any)
			.returning()
		const sink = errorSink()

		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(user.id, false),
				{
					session: { id: session!.id, connectionId: coveted.id }
				} as any,
				sink.emit
			)
		).rejects.toThrow()

		expect(sink.errors[0]?.error).toBe(CONNECTION_REFUSAL)
		// The administrator's choice is exactly where they left it.
		expect((await readSession(session!.id)).connectionId).toBe(chosen.id)
	}, 60_000)

	test("the refusal reads the same for an id that does not exist", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const user = await makeUser("update-oracle")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false } as any)
			.returning()

		const real = errorSink()
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(user.id, false),
				{
					session: {
						id: session!.id,
						connectionId: (await makeConnection("Real")).id
					}
				} as any,
				real.emit
			)
		).rejects.toThrow()

		const invented = errorSink()
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(user.id, false),
				{ session: { id: session!.id, connectionId: 999_999 } } as any,
				invented.emit
			)
		).rejects.toThrow()

		// No probe: the answer carries nothing that varies with the id, so a
		// walk from 1 upward learns which connections exist from neither the
		// message nor the outcome.
		expect(invented.errors).toEqual(real.errors)
	}, 60_000)

	test("a redacted null is dropped, not written — an admin's choice survives an ordinary rename", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const user = await makeUser("update-echo")
		const chosen = await makeConnection("Set by the admin")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				connectionId: chosen.id
			} as any)
			.returning()
		const sink = errorSink()

		// Exactly what `EditSessionForm` now sends for a non-admin: the field
		// is on the payload because the form has one, and it is null because
		// their copy of the row arrived redacted.
		await sessionsUpdateHandler.handler(
			fakeSocket(user.id, false),
			{
				session: {
					id: session!.id,
					name: "Renamed",
					connectionId: null
				}
			} as any,
			sink.emit
		)

		expect(sink.errors).toEqual([])
		const after = await readSession(session!.id)
		expect(after.name).toBe("Renamed")
		expect(after.connectionId).toBe(chosen.id)
	}, 60_000)

	test("an administrator may still set and clear one", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const admin = await makeUser("update-admin", true)
		const connection = await makeConnection("Studio C")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: admin.id, isGroup: false } as any)
			.returning()

		await sessionsUpdateHandler.handler(
			fakeSocket(admin.id, true),
			{
				session: { id: session!.id, connectionId: connection.id }
			} as any,
			() => {}
		)
		expect((await readSession(session!.id)).connectionId).toBe(
			connection.id
		)

		await sessionsUpdateHandler.handler(
			fakeSocket(admin.id, true),
			{ session: { id: session!.id, connectionId: null } } as any,
			() => {}
		)
		expect((await readSession(session!.id)).connectionId).toBeNull()
	}, 60_000)
})
