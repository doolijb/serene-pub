/**
 * ⏳ The one-release re-keying of pre-V2 binding rows (plans/31 V2): a row a
 * previous release keyed by function is re-keyed by subject at boot, by the
 * same sole-declarer rule presets use, and dropped with a notice when the
 * key names no single action any more.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { sessionEvents } from "@serene-pub/sdk"

let db: TestDb
let sessionId: number
let narrateSpecId: number
let respondSpecId: number

const CHAT = "core:genre/chat"

async function publishTwoDeclarers() {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { chatGenre } = await import("@serene-pub/core-catalog")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	for (const [id, slash] of [
		["core:spec/test-sum-a", "sum-a"],
		["acme:spec/sum-b", undefined]
	] as const) {
		const doc = compile(
			spec(id, {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{
							key: "sum",
							venue: { kind: "composer" },
							label: { en: "Sum" },
							description: { en: "A test action." },
							...(slash ? { slash } : {})
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: sessionEvents.sessionAction
				})
				.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
				.build()
		)
		await saveDocument(db, doc, { publish: true })
	}
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	await publishTwoDeclarers()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "binding-subjects", isAdmin: false })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, genreId: CHAT })
		.returning()
	sessionId = session.id
	const slugs = await db.select().from(schema.pipelineSpecs)
	narrateSpecId = slugs.find((s) => s.slug === "core:spec/chat-narrate")!.id
	respondSpecId = slugs.find((s) => s.slug === "core:spec/chat-respond")!.id
}, 60_000)

describe("reprojectBindingSubjects (⏳ plans/31 V2)", () => {
	it("rewrites `respond` to the primary turn's event and a bare key to its sole declarer; drops what names none or several; leaves subjects alone; is a no-op after", async () => {
		const { reprojectBindingSubjects } = await import("$lib/server/pipelines/boot/bindingSubjects")
		const rows = [
			{ scopeKind: "session", scopeId: sessionId, genreId: CHAT, subject: "respond", specId: respondSpecId },
			{ scopeKind: "session", scopeId: sessionId, genreId: CHAT, subject: "narrate", specId: narrateSpecId },
			{ scopeKind: "pub", scopeId: 0, genreId: CHAT, subject: "sum", specId: narrateSpecId },
			{ scopeKind: "pub", scopeId: 0, genreId: CHAT, subject: "summon-dragon", specId: narrateSpecId },
			// Already a subject: untouched.
			{ scopeKind: "pub", scopeId: 0, genreId: CHAT, subject: "core:spec/chat-narrate#narrate", specId: narrateSpecId }
		]
		await db.insert(schema.pipelineBindings).values(rows as any)

		const report = await reprojectBindingSubjects(db)
		expect(report.rewritten).toEqual([
			`(session ${sessionId}, ${CHAT}) 'respond' → '${sessionEvents.messageRespond}'`,
			`(session ${sessionId}, ${CHAT}) 'narrate' → 'core:spec/chat-narrate#narrate'`
		])
		expect(report.dropped).toEqual([
			`(pub, ${CHAT}) 'sum' — 2 actions declare it (core:spec/test-sum-a#sum, acme:spec/sum-b#sum); a binding is about one`,
			`(pub, ${CHAT}) 'summon-dragon' — no published action declares it`
		])
		const left = (
			await db.select().from(schema.pipelineBindings).where(eq(schema.pipelineBindings.genreId, CHAT))
		)
			.map((r) => `${r.scopeKind}:${r.subject}`)
			.sort()
		expect(left).toEqual([
			"pub:core:spec/chat-narrate#narrate",
			"session:core:event/message-respond@1",
			"session:core:spec/chat-narrate#narrate"
		])

		// The second boot finds nothing bare.
		expect(await reprojectBindingSubjects(db)).toEqual({ rewritten: [], dropped: [] })

		// …and the rewritten rows are read by the resolver as the session's own.
		const { resolveSubjectSpec } = await import("$lib/server/pipelines/entities/sessionGenres")
		expect(await resolveSubjectSpec(db, CHAT, sessionEvents.messageRespond, { sessionId })).toBe(
			"core:spec/chat-respond"
		)
	}, 60_000)

	it("a bare row whose subject already exists at the scope yields to it", async () => {
		const { reprojectBindingSubjects } = await import("$lib/server/pipelines/boot/bindingSubjects")
		await db.insert(schema.pipelineBindings).values({
			scopeKind: "session",
			scopeId: sessionId,
			genreId: CHAT,
			subject: "narrate",
			specId: narrateSpecId
		} as any)
		const report = await reprojectBindingSubjects(db)
		expect(report.rewritten).toEqual([])
		expect(report.dropped).toEqual([
			`(session ${sessionId}, ${CHAT}) 'narrate' — a binding on 'core:spec/chat-narrate#narrate' already exists`
		])
	}, 60_000)
})
