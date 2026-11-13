/**
 * `sessions:channelLanes` newest line names its speaker's cast member (plan
 * §27, S3 "Host fills"): `latest.castMemberId` is `session_messages.cast_member_id`,
 * null when the row stores none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lanes-member-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

describe("sessions:channelLanes latest.castMemberId", () => {
	test("the newest line carries its speaker's cast member; a line with none carries null", async () => {
		const { sessionsChannelLanesHandler: h } = await import("./sessions")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, `lanes-member-${Date.now()}`)
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: "Book" } as any)
			.returning()
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book!.id,
				characterId: null,
				binding: "{{char:1}}",
				name: "Maren"
			} as any)
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: true, lorebookId: book!.id })
			.returning()
		await testDb.insert(schema.sessionMessages).values([
			{
				sessionId: session!.id,
				userId: owner.id,
				role: "assistant",
				content: "spoken",
				channel: "phone:1",
				castMemberId: member!.id
			},
			{
				sessionId: session!.id,
				userId: owner.id,
				role: "user",
				content: "no member",
				channel: "phone:2"
			}
		] as any)
		const res = await h.handler(
			fakeSocket(owner.id),
			{ sessionId: session!.id, channel: "phone" },
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(
			res.lanes.map((l) => [l.channel, l.latest.castMemberId])
		).toEqual([
			["phone", member!.id],
			["phone:2", null]
		])
	})
})
