/**
 * The live row routes reasoning into the fold AS IT STREAMS (owner notes 39 and
 * 43, 2026-10-03): the body never carries the trace, starts with the first
 * token after it, and never carries the speaker's own label — frame by frame,
 * not only once the reply is stored. And the phase it reports is what the
 * status follows (*{speaker} is reasoning* → *is typing*).
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { createLiveRow } from "./liveRow"
import type { ReplyPhase } from "$lib/shared/utils/reasoningDelimiters"
import type { ReplyFacts } from "$lib/server/messages/replyView"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "live-row-reasoning")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

async function placeholder() {
	return insertLegacy(db, {
		sessionId,
		role: "assistant",
		content: "",
		isGenerating: true,
		metadata: {}
	})
}

const read = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
	)[0]!

/**
 * Drive a live row the way the host does: facts first, then each chunk, then a
 * flush — and wait out the throttle between chunks so every chunk is a frame.
 */
async function streamInto(
	chunks: string[],
	facts: ReplyFacts,
	native: string[] = []
) {
	const row = await placeholder()
	const live = createLiveRow({
		db: db as any,
		sessionId,
		streamingNodes: new Set(["generate"])
	})
	live.opened(row)
	const phases: ReplyPhase[] = []
	const stream = live.attach(row.id, "generate", {
		onPhase: (p) => phases.push(p)
	})!
	stream.onReplyFacts(facts)
	const frames: { content: string; reasoning: unknown }[] = []
	const count = Math.max(chunks.length, native.length)
	for (let i = 0; i < count; i++) {
		await new Promise((r) => setTimeout(r, 140))
		if (native[i]) stream.onReasoning(native[i]!)
		if (chunks[i]) stream.onChunk(chunks[i]!)
		await live.flush()
		const now = await read(row.id)
		frames.push({
			content: now.content,
			reasoning: (now.metadata as any)?.reasoning
		})
	}
	return { row, live, frames, phases }
}

describe("the live row — reasoning streams into the fold", () => {
	it("a template-opened block: reasoning in the fold from the first token, the body from the first token after the close, no label", async () => {
		const { frames, phases } = await streamInto(
			["Okay, the user", " waves.</think>", "\n\nAlice: Hi", " there!"],
			{ opensInReasoning: "requested", ownLabels: ["Alice"] }
		)
		expect(frames[0]).toEqual({ content: "", reasoning: "Okay, the user" })
		expect(frames[1]).toEqual({
			content: "",
			reasoning: "Okay, the user waves."
		})
		expect(frames[2]!.content).toBe("Hi")
		expect(frames[3]!.content).toBe("Hi there!")
		expect(frames[3]!.reasoning).toBe("Okay, the user waves.")
		expect(phases).toEqual(["reasoning", "writing"])
	})

	it("native reasoning streams into the fold before any body token", async () => {
		const { frames, phases } = await streamInto(
			["", "", "Sure."],
			{ opensInReasoning: "requested" },
			["Think", "ing", ""]
		)
		expect(frames[0]).toEqual({ content: "", reasoning: "Think" })
		expect(frames[1]).toEqual({ content: "", reasoning: "Thinking" })
		expect(frames[2]).toEqual({ content: "Sure.", reasoning: "Thinking" })
		expect(phases).toEqual(["reasoning", "writing"])
	})

	it("no reasoning: the body streams as before and the fold stays empty", async () => {
		const { frames, phases } = await streamInto(["Hel", "lo."], {})
		expect(frames.map((f) => f.content)).toEqual(["Hel", "Hello."])
		expect(frames.every((f) => f.reasoning === undefined)).toBe(true)
		expect(phases).toEqual(["writing"])
	})

	it("a Stop mid-reasoning keeps the partial trace on the row's swipe slot", async () => {
		const { row, live } = await streamInto(["Weighing the"], {
			opensInReasoning: "requested"
		})
		await live.finish({ kind: "cancelled", liveRow: row.id })
		const settled = await read(row.id)
		expect(settled.isGenerating).toBe(false)
		expect((settled.metadata as any)?.reasoning).toBe("Weighing the")
	})
})
