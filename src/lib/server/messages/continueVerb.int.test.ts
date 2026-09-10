/**
 * `sessionMessages:continue`, refused when the connection cannot continue.
 *
 * The genre's `messageVerbs` was the only thing that could take `continue` away
 * (20 §4), and it answers a different question: whether this KIND of session
 * offers the verb. It says nothing about whether the connection serving the
 * session can resume a partial reply as a true prefill — and most cannot. An
 * OpenAI-compatible connection in chat wire sends the partial as a trailing
 * assistant message, the model starts a fresh reply, and `joinContinuation`
 * glues two beginnings together with nothing reporting it.
 *
 * So the verb refuses through the SAME channel and in the same shape as the
 * genre refusal — `{sessionMessage: undefined, error}` on
 * `sessionMessages:continue` — and the message is never marked generating.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "continue-verb-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let userId: number
let sessionId: number
let messageId: number
let connectionId: number

const fakeSocket = () =>
	({
		user: { id: userId, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

/** What the handler emitted, so the channel is asserted and not just the return. */
const emitted: Array<{ event: string; payload: any }> = []
const record = (event: string, payload: any) => emitted.push({ event, payload })

beforeAll(async () => {
	const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-cvb-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir

	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "continue-verb-user", isAdmin: true })
		.returning()
	userId = user.id

	// Chat wire, which is what an OpenAI-compatible connection resolves to by
	// default (both modes on, the tie-break picks chat) — and the one shape
	// that cannot prefill.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Chat-wire OpenAI",
			type: CONNECTION_TYPE.OPENAI,
			baseUrl: "https://api.example.com/v1",
			model: "gpt-4o",
			promptFormat: "openai"
		})
		.returning()
	connectionId = connection.id

	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId,
		samplingConfigId: null
	})

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	const [message] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			// A narrator response, so the SESSION OWNER controls it: a message
			// with neither a character nor a persona behind it is nobody's, and
			// `checkMessageEditPermission` refuses it before any verb policy is
			// consulted — which would make every assertion below vacuous.
			isNarratorResponse: true,
			content: "She opened the door",
			isGenerating: false
		})
		.returning()
	messageId = message.id
}, 60_000)

/** Point the instance default at a connection, then fire the verb. */
async function fireContinue(): Promise<any> {
	emitted.length = 0
	const { sessionMessagesContinueHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return await sessionMessagesContinueHandler.handler(
		fakeSocket(),
		{ id: messageId } as any,
		record as any
	)
}

describe("continue is refused when the connection cannot prefill", () => {
	test("the refusal names the wire mode and the mode that would work", async () => {
		const res = await fireContinue()
		expect(res.sessionMessage).toBeUndefined()
		expect(res.error).toBeTruthy()
		expect(res.error).toContain("Chat messages")
		expect(res.error).toContain("Text completion")
		// Never the capability id: this sentence reaches a person.
		expect(res.error).not.toContain("continue_reply")
		expect(res.error).not.toContain("wire_")
	})

	test("it travels on the same channel the genre refusal does", async () => {
		await fireContinue()
		expect(emitted.map((e) => e.event)).toContain(
			"sessionMessages:continue"
		)
	})

	test("and the message is never marked generating", async () => {
		await fireContinue()
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
		expect(row.isGenerating).toBe(false)
	})
})

describe("a connection that CAN prefill is not refused for this reason", () => {
	test("llama.cpp defaults to completion wire, and the verb gets past the check", async () => {
		const [llama] = await db
			.insert(schema.connections)
			.values({
				name: "llama.cpp",
				type: CONNECTION_TYPE.LLAMACPP,
				baseUrl: "http://localhost:8080",
				model: "local",
				promptFormat: "vicuna"
			})
			.returning()
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(db, "text->text", {
			connectionId: llama.id,
			samplingConfigId: null
		})

		const { continueVerbRefusal } = await import("./verbs")
		expect(await continueVerbRefusal(db, sessionId, userId)).toBeNull()

		// Put the chat-wire connection back for anything that follows.
		await setCapabilityDefault(db, "text->text", {
			connectionId,
			samplingConfigId: null
		})
	}, 60_000)
})
