/**
 * `pipelines:promptWording` — the prompt dialog's request (2026-10-13).
 *
 * A member reads exactly the prompts their session settings let them pick:
 * the handler rebuilds the member's own `pipelines:get` view, so the test
 * drives it the way the client does — fetch the view, find the prompt row,
 * ask for each wording.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { groupOptions } from "$lib/server/pipelines/config/panel/groups"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "prompt-wording-test-secret" }
})

let member: { id: number }
let sessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-prompt-wording-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	member = await createTestUser(testDb, "wording-member")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: member.id, isGroup: false })
		.returning()
	sessionId = session.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

function recordingEmit() {
	const seen: Array<[string, any]> = []
	return {
		emit: (event: string, data: any) => seen.push([event, data]),
		last: (e: string) => seen.filter(([k]) => k === e).at(-1)?.[1]
	}
}

/** The member's prompt row, as the session settings receive it. */
async function memberPromptRow() {
	const { pipelinesGet } = await import("./pipelines")
	const res: any = await pipelinesGet.handler(
		socketFor(member.id),
		{ slug: CHAT_RESPOND_SPEC_ID, sessionId },
		() => {}
	)
	const option = groupOptions(res.pipeline.groups).find(
		(o: any) => o.control === "prompts-ref"
	) as any
	if (!option) throw new Error("the member's view has no prompt row")
	return option
}

const ask = async (params: Record<string, unknown>) => {
	const { pipelinesPromptWording } = await import("./pipelines")
	const rec = recordingEmit()
	const res: any = await pipelinesPromptWording.handler(
		socketFor(member.id),
		{ slug: CHAT_RESPOND_SPEC_ID, sessionId, ...params } as any,
		rec.emit
	)
	return { res, rec }
}

describe("a member reads the prompts their session offers", () => {
	test("each offered prompt answers with its declared fields, echoed for matching", async () => {
		const option = await memberPromptRow()
		expect(option.choices?.length).toBeGreaterThan(0)
		const plain = option.choices.find(
			(c: any) => c.label === "Roleplay - Plain"
		)
		expect(plain, "Plain is on offer").toBeDefined()

		const { res, rec } = await ask({
			optionId: option.id,
			promptId: plain.id
		})
		expect(res.error).toBeUndefined()
		expect(rec.last("pipelines:promptWording")).toEqual(res)
		expect(res).toMatchObject({
			slug: CHAT_RESPOND_SPEC_ID,
			optionId: option.id,
			promptId: plain.id,
			name: "Roleplay - Plain",
			shipped: true
		})
		expect(res.declared).toEqual(option.promptFields)
		expect(Object.keys(res.fields)).toEqual(option.promptFields)
		expect(res.fields.systemPrompt).toMatch(/in an ongoing story with/)
	}, 60_000)

	test("the prompt in use reads too, even when it is the shipped default", async () => {
		const option = await memberPromptRow()
		expect(typeof option.value).toBe("number")
		const { res } = await ask({
			optionId: option.id,
			promptId: option.value
		})
		expect(res.error).toBeUndefined()
		expect(res.name).toBe("Roleplay - Living Scene")
	}, 60_000)

	test("a prompt from another step's pool is refused, and nothing of it is sent", async () => {
		const option = await memberPromptRow()
		const [narrator] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(
				and(
					eq(
						schema.pipelinePrompts.nodeDefinitionId,
						"core:task/build-narrator-context"
					),
					eq(schema.pipelinePrompts.name, "Narrator")
				)
			)
		expect(narrator).toBeDefined()
		const { res, rec } = await ask({
			optionId: option.id,
			promptId: narrator.id
		})
		expect(res.error).toMatch(/not one this step offers/)
		expect(res.fields).toBeUndefined()
		expect(rec.last("pipelines:promptWording:error")).toEqual(res)
		expect(rec.last("pipelines:promptWording")).toBeUndefined()
	}, 60_000)

	test("an option handle that names no prompt row is refused", async () => {
		const option = await memberPromptRow()
		const { res } = await ask({
			optionId: "not-an-option",
			promptId: option.value
		})
		expect(res.error).toMatch(/does not choose a prompt/)
	}, 60_000)
})
