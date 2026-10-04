/**
 * `emitSessionEvent` and the cause at every emitter (PLAN-turn-order §4.1,
 * unit A2; R1). One function is the emitter for every session event: it
 * writes the `session_changes` ledger row, fans out to plugin listeners,
 * and dispatches a bound spec. Every site that recorded a data event before
 * goes through it, and every payload carries the cause §4.1 names:
 *
 *   a user send                     → message-completed  { kind: 'user', userId }
 *   a run's finishing write         → message-completed  { kind: 'run', runId }
 *   a seeded greeting               → message-completed  { kind: 'run', runId }
 *   a person's delete / hide / edit → message-*          { kind: 'edit', userId, runId }
 *   settings and cast toggles       → session-updated / cast-changed { kind: 'settings', userId }
 *
 * and a generating placeholder yields NO `message-completed`: the event is
 * for a row that landed, never for one still being written.
 *
 * Exercised through the socket handlers and the shipped specs, as the
 * built-ins suite is, with a fake adapter standing in for the model.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { sessionEvents } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))

const REPLY = "The gate was sealed with old iron."
/** Set to make the NEXT model call fail — the placeholder never completes. */
let failNextCall = false
class FakeAdapter {
	constructor(_p: any) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		if (failNextCall) {
			failNextCall = false
			throw new Error("the model fell over")
		}
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(REPLY)
				return { content: REPLY, isAborted: false }
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number

const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: true }, io: {} }) as any
const emit = (_event: string, _data: any) => {}

const changesOf = async (sessionId: number) => {
	// Event work runs after the writer, on the session's queue (PLAN §8 (27)).
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return db
		.select()
		.from(schema.sessionChanges)
		.where(eq(schema.sessionChanges.sessionId, sessionId))
		.orderBy(schema.sessionChanges.id)
}

const ofEvent = async (sessionId: number, event: string) =>
	(await changesOf(sessionId)).filter((c) => c.event === event)

const cause = (row: { payload: unknown }) =>
	(row.payload as { cause?: unknown }).cause

/**
 * The chat preset, which is what binds the turn-order spec per event
 * (PLAN-turn-order §4.5). A session with no preset falls through to the
 * inlet lock, and `pipeline_spec_versions.input_event` holds ONE event —
 * see PLAN §8 (21) — so a multi-event spec is reachable through its
 * preset's per-event rows and not through the lock.
 */
const chatPresetId = async (): Promise<number | null> => {
	const [row] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-chat-default"))
		.limit(1)
	return row?.id ?? null
}

/** A session with one character and one settled reply, nothing pending. */
async function makeSession(tag: string) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `emit ${tag}`,
			presetId: await chatPresetId()
		})
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
	})
	const [reply] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			userId,
			role: "assistant",
			characterId,
			content: `The gate (${tag}) is old.`,
			metadata: {}
		} as any)
		.returning()
	return { sessionId: session.id, replyId: reply.id }
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-events-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "session-events")).id
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alice",
			description: "A knight.",
			firstMessage: "Alice raises her visor."
		})
		.returning()
	characterId = character.id

	// The annex declarations the annex writes below are held to (one
	// declaration per owner, ruling 2026-09-26): installed as a plugin's
	// stored manifest, where the host reads them.
	const { annexField } = await import("@serene-pub/sdk")
	const declare = async (pluginId: string, annexFields: unknown[]) =>
		db.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "1.0.0",
			bundleSource: "// none",
			bundleHash: `hash-${pluginId}`,
			enabled: true,
			manifest: { annexFields }
		} as any)
	await declare("acme.rp", [
		annexField({ key: "clock", shape: { type: "integer" } }),
		annexField({ key: "culprit", shape: { type: "string" } }),
		annexField({ key: "clue", shape: { type: "string" }, see: ["participant"] }),
		annexField({ key: "note", shape: { type: "string" }, see: [`user:${userId}`] }),
		annexField({ key: "hunch", shape: { type: "string" }, see: ["ai"] })
	])
	// The loop spec keeps `annex-changed`'s payload under `last`; the
	// listener, a recorded event's envelope under `heard`.
	await declare("test", [
		annexField({ key: "tick", shape: { type: "integer" } }),
		annexField({
			key: "last",
			shape: { type: "object", fields: { sessionId: { type: "integer" }, owner: { type: "string" } } }
		})
	])
	await declare("acme.dice", [
		annexField({ key: "heard", shape: { type: "object", fields: { event: { type: "string" } } } })
	])

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn.id, "default-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.5 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("emitSessionEvent", () => {
	it("writes one ledger row carrying the payload with its cause, and fans out to plugin listeners", async () => {
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { pluginEvents } = await import("$lib/server/plugins/eventHost")
		const notify = vi.spyOn(pluginEvents(), "notify")
		const s = await makeSession("emit")
		const at = Date.now()
		const result = await emitSessionEvent(db, {
			sessionId: s.sessionId,
			userId,
			event: sessionEvents.messageHidden,
			payload: {
				event: sessionEvents.messageHidden,
				sessionId: s.sessionId,
				messageId: s.replyId,
				at,
				hidden: true,
				cause: { kind: "edit", userId }
			},
			wait: true
		})
		// Chat binds `core:spec/<genre>-turn-order` to this event since A6
		// (PLAN-turn-order §4.5), so the emit dispatches it — which is the
		// whole road: an event recomputes the order.
		expect(result.dispatched?.specSlug).toBe("core:spec/chat-turn-order")
		// Scoped to the event under test: since A6 a session event also
		// recomputes the turn order, whose write lands on this same ledger.
		const rows = await ofEvent(s.sessionId, sessionEvents.messageHidden)
		expect(rows.length).toBe(1)
		expect(rows[0]).toMatchObject({
			event: sessionEvents.messageHidden,
			messageId: s.replyId,
			runId: null
		})
		expect(rows[0]!.payload).toMatchObject({
			hidden: true,
			at,
			cause: { kind: "edit", userId }
		})
		// The fan-out ran for this event — and for the `turn-order-changed`
		// the recompute it dispatched went on to emit, which is the road
		// working rather than a second emitter.
		const events = notify.mock.calls.map((c) => c[1])
		expect(events).toContain(sessionEvents.messageHidden)
		const call = notify.mock.calls.find(
			(c) => c[1] === sessionEvents.messageHidden
		)!
		expect(call[2]).toMatchObject({ messageId: s.replyId })
		notify.mockRestore()
	})

	it("the ledger's run column is the cause's run, whatever the cause's kind", async () => {
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const s = await makeSession("run-column")
		await emitSessionEvent(db, {
			sessionId: s.sessionId,
			userId,
			event: sessionEvents.messageEdited,
			payload: {
				event: sessionEvents.messageEdited,
				sessionId: s.sessionId,
				messageId: s.replyId,
				previous: { content: "old" },
				cause: { kind: "edit", userId, runId: "run-edit-1" }
			}
		})
		const [row] = await ofEvent(s.sessionId, sessionEvents.messageEdited)
		expect(row!.runId).toBe("run-edit-1")
		// `at` is filled when the payload does not carry it.
		expect(typeof (row!.payload as any).at).toBe("number")
	})
})

describe("cause at every emitter", () => {
	it("a user send yields one message-completed with cause user, and the reply's finish one with cause run", async () => {
		const s = await makeSession("send")
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId, personaId: null, content: "Who goes there?" },
			emit
		)
		expect(res.error).toBeUndefined()
		const sent = res.sessionMessage.id

		const completed = await ofEvent(s.sessionId, sessionEvents.messageCompleted)
		const byUser = completed.filter((c) => (cause(c) as any)?.kind === "user")
		expect(byUser.length).toBe(1)
		expect(byUser[0]!.messageId).toBe(sent)
		expect(byUser[0]!.runId).toBeNull()
		expect(cause(byUser[0]!)).toEqual({ kind: "user", userId })

		// The send triggered a reply (the one-decider road, until A7): its
		// finishing write completed the reply row under the run's cause.
		const byRun = completed.filter((c) => (cause(c) as any)?.kind === "run")
		expect(byRun.length).toBe(1)
		const [reply] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, byRun[0]!.messageId!))
		expect(reply!.role).toBe("assistant")
		expect(reply!.isGenerating).toBe(false)
		expect(reply!.content).toBe(REPLY)
		expect((cause(byRun[0]!) as any).runId).toBe(byRun[0]!.runId)
		expect(typeof byRun[0]!.runId).toBe("string")
		// A fresh reply's finish is not a verb's rewrite: no message-updated.
		expect(await ofEvent(s.sessionId, "core:event/message-updated@1")).toEqual([])
	})

	it("a generating placeholder yields no message-completed", async () => {
		const s = await makeSession("placeholder")
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		failNextCall = true
		await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId, personaId: null, content: "Anyone?" },
			emit
		)
		// The reply auto-advance fires runs on the session's queue after the
		// send returns (PLAN §8 (27)): let it run, and fail, before resetting.
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		failNextCall = false
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, s.sessionId))
		const placeholder = rows.find(
			(r) => r.role === "assistant" && r.id !== s.replyId
		)
		// The placeholder was made (generating) and then failed: never completed.
		expect(placeholder).toBeDefined()
		expect(placeholder!.isGenerating).toBe(false)
		expect(placeholder!.error ?? placeholder!.generationOutcome).toBeTruthy()
		const completed = await ofEvent(s.sessionId, sessionEvents.messageCompleted)
		expect(completed.map((c) => (cause(c) as any).kind)).toEqual(["user"])
		expect(completed.some((c) => c.messageId === placeholder!.id)).toBe(false)
	})

	it("a seeded greeting yields one message-completed per seeded row, cause run", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId,
				isGroup: false,
				name: "emit seed",
				presetId: await chatPresetId()
			})
			.returning()
		await db.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId,
			isActive: true,
		})
		const { dispatchSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const dispatched = await dispatchSessionEvent(db, {
			sessionId: session.id,
			userId,
			genreId: "core:genre/chat",
			event: sessionEvents.sessionCreated,
			input: {
				main: {},
				sessionScope: { sessionId: session.id, userId },
				sessionId: session.id,
				request: {},
				fields: {}
			}
		})
		expect(dispatched?.specSlug).toBe("core:spec/create-chat")
		expect((dispatched?.receipt as any).outcome).not.toBe("err")
		const seeded = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
		expect(seeded.length).toBe(1)
		expect(seeded[0]!.content).toBe("Alice raises her visor.")
		const completed = await ofEvent(session.id, sessionEvents.messageCompleted)
		expect(completed.map((c) => c.messageId)).toEqual([seeded[0]!.id])
		expect(cause(completed[0]!)).toEqual({
			kind: "run",
			runId: dispatched!.receipt!.runId
		})
		expect(completed[0]!.runId).toBe(dispatched!.receipt!.runId)
	})

	it("a person's delete yields message-deleted with cause edit, naming the person and the run that wrote it", async () => {
		const s = await makeSession("delete")
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toBeUndefined()
		const rows = await ofEvent(s.sessionId, sessionEvents.messageDeleted)
		expect(rows.length).toBe(1)
		expect(rows[0]!.messageId).toBe(s.replyId)
		expect(typeof rows[0]!.runId).toBe("string")
		expect(cause(rows[0]!)).toEqual({
			kind: "edit",
			userId,
			runId: rows[0]!.runId
		})
	})

	it("a person's hide yields message-hidden with cause edit", async () => {
		const s = await makeSession("hide")
		const { sessionMessagesUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId, isHidden: true },
			emit
		)
		expect(res.error).toBeUndefined()
		const rows = await ofEvent(s.sessionId, sessionEvents.messageHidden)
		expect(rows.length).toBe(1)
		expect(cause(rows[0]!)).toMatchObject({ kind: "edit", userId })
		expect((rows[0]!.payload as any).hidden).toBe(true)
	})

	it("sessions:update yields one session-updated with the changed columns and cause settings; an update that changes nothing yields none", async () => {
		const s = await makeSession("update")
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsUpdateHandler.handler(
			fakeSocket(userId),
			{
				session: {
					id: s.sessionId,
					name: "emit update (renamed)",
					scenario: "A gate at dusk."
				},
				tags: []
			} as any,
			emit
		)
		let rows = await ofEvent(s.sessionId, sessionEvents.sessionUpdated)
		expect(rows.length).toBe(1)
		expect(rows[0]!.messageId).toBeNull()
		expect(rows[0]!.payload).toMatchObject({
			changed: ["name", "scenario"],
			cause: { kind: "settings", userId }
		})

		// The same values again: nothing changed, nothing emitted.
		await sessionsUpdateHandler.handler(
			fakeSocket(userId),
			{
				session: {
					id: s.sessionId,
					name: "emit update (renamed)",
					scenario: "A gate at dusk."
				},
				tags: []
			} as any,
			emit
		)
		rows = await ofEvent(s.sessionId, sessionEvents.sessionUpdated)
		expect(rows.length).toBe(1)
	})

	it("switching a cast seat off yields cast-changed { ref, change: 'enabled', value }, cause settings", async () => {
		const s = await makeSession("toggle-active")
		const { sessionsSetCastSeatEnabledHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionsSetCastSeatEnabledHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId, characterId, enabled: false },
			emit
		)
		expect(res.error).toBeUndefined()
		expect(res.enabled).toBe(false)
		const rows = await ofEvent(s.sessionId, sessionEvents.castChanged)
		expect(rows.length).toBe(1)
		expect(rows[0]!.payload).toMatchObject({
			ref: `character:${characterId}`,
			change: "enabled",
			value: false,
			cause: { kind: "settings", userId }
		})
	})

	it("reordering the cast through sessions:update yields cast-changed { change: 'position' } per moved row, and no session-updated", async () => {
		const s = await makeSession("reorder")
		const [bob] = await db
			.insert(schema.characters)
			.values({ userId, name: "Bob", description: "A squire." })
			.returning()
		await db.insert(schema.sessionCharacters).values({
			sessionId: s.sessionId,
			characterId: bob.id,
			isActive: true,
			position: 1
		})
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsUpdateHandler.handler(
			fakeSocket(userId),
			{
				session: { id: s.sessionId },
				characterIds: [bob.id, characterId]
			} as any,
			emit
		)
		const moved = await ofEvent(s.sessionId, sessionEvents.castChanged)
		const byRef = Object.fromEntries(
			moved.map((r) => r.payload as any).map((p) => [p.ref, [p.change, p.value]])
		)
		expect(byRef).toEqual({
			[`character:${bob.id}`]: ["position", 0],
			[`character:${characterId}`]: ["position", 1]
		})
		expect(cause(moved[0]!)).toEqual({ kind: "settings", userId })
		expect(await ofEvent(s.sessionId, sessionEvents.sessionUpdated)).toEqual([])
	})
})

describe("M3 · the emitters the modder pass adds (R30/R45 annex, R31 members)", () => {
	it("an annex write emits annex-changed once, naming the owner, under the run's cause; an unchanged write emits nothing", async () => {
		const s = await makeSession("annex")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, {
			sessionId: s.sessionId,
			userId,
			specId: "acme.rp:spec/clock",
			runId: "run-annex"
		} as any)
		const node = { key: "save", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
		await host.commit!({ value: { clock: 3 } }, node)
		let rows = await ofEvent(s.sessionId, sessionEvents.annexChanged)
		expect(rows.length).toBe(1)
		expect(rows[0]!.payload).toMatchObject({
			owner: "acme.rp",
			cause: { kind: "run", runId: "run-annex" }
		})
		expect(rows[0]!.runId).toBe("run-annex")

		// The same value again changes nothing, so it causes nothing — the
		// loop damper a spec bound to annex-changed relies on.
		await host.commit!({ value: { clock: 3 } }, node)
		rows = await ofEvent(s.sessionId, sessionEvents.annexChanged)
		expect(rows.length).toBe(1)

		await host.commit!({ value: { clock: 4 } }, node)
		expect((await ofEvent(s.sessionId, sessionEvents.annexChanged)).length).toBe(2)
	})

	it("adding and removing a character through sessions:update lands member-added / member-removed in the ledger with a cast-change payload", async () => {
		const s = await makeSession("members")
		const [bob] = await db
			.insert(schema.characters)
			.values({ userId, name: "Bob", description: "A squire." })
			.returning()
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const update = (characterIds: number[]) =>
			sessionsUpdateHandler.handler(
				fakeSocket(userId),
				{ session: { id: s.sessionId }, characterIds } as any,
				emit
			)
		await update([characterId, bob.id])
		const added = await ofEvent(s.sessionId, sessionEvents.memberAdded)
		expect(added.length).toBe(1)
		expect(added[0]!.payload).toMatchObject({
			ref: `character:${bob.id}`,
			change: "added",
			cause: { kind: "settings", userId }
		})
		await update([characterId])
		const removed = await ofEvent(s.sessionId, sessionEvents.memberRemoved)
		expect(removed.length).toBe(1)
		expect(removed[0]!.payload).toMatchObject({
			ref: `character:${bob.id}`,
			change: "removed",
			cause: { kind: "settings", userId }
		})
	})

	it("seating and unseating an envoy emits member-added / member-removed with envoy:<slug>", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, name: "emit envoy", genreId: "core:genre/guide" })
			.returning()
		const { sessionsSetEnvoySeatHandler } = await import("$lib/server/sockets/sessions")
		const seat = (seated: boolean) =>
			sessionsSetEnvoySeatHandler.handler(
				fakeSocket(userId),
				{ sessionId: session.id, slug: "mascot", seated } as any,
				emit
			)
		await seat(true)
		const added = await ofEvent(session.id, sessionEvents.memberAdded)
		expect(added.map((r) => (r.payload as any).ref)).toEqual(["envoy:mascot"])
		expect(added[0]!.payload).toMatchObject({ change: "added", cause: { kind: "settings", userId } })
		await seat(false)
		const removed = await ofEvent(session.id, sessionEvents.memberRemoved)
		expect(removed.map((r) => (r.payload as any).ref)).toEqual(["envoy:mascot"])
	})

	it("an imported session announces itself with session-updated, cause system, so it has an order on first open", async () => {
		const s = await makeSession("imported")
		const { announceImportedSession } = await import("$lib/server/sockets/import")
		await announceImportedSession(db as any, { sessionId: s.sessionId, userId })
		const rows = await ofEvent(s.sessionId, sessionEvents.sessionUpdated)
		expect(rows.length).toBe(1)
		expect(rows[0]!.payload).toMatchObject({ cause: { kind: "system" } })
	})
})

describe("M3 review · annex-changed is bounded, and the envoy seat emits only on a change", () => {
	it("a spec bound to annex-changed that keeps writing a changing value parks at the run-depth cap (E1c)", async () => {
		const s = await makeSession("annex-loop")
		const { spec, compile, use, sessionEvents: ev } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { bindSubject } = await import("$lib/server/pipelines/entities/bindings")
		const { MAX_RUN_DEPTH } = await import("$lib/server/pipelines/runtime/lineage")
		// Answers annex-changed by writing the event's own payload back —
		// which carries a fresh `at`, so every write changes the value.
		const loop = compile(
			spec("test:spec/annex-loop", { version: "1.0.0" })
				.inlet("event", C.sessionEvent.v1(), {
					genre: use("core:genre/chat"),
					events: [ev.annexChanged]
				})
				.outlet("write", ($) => C.setSessionAnnex.v1({ value: { last: $.event.payload } as never }))
				.build()
		)
		await saveDocument(db as any, loop, { publish: true })
		const bound = await bindSubject(db as any, {
			scope: { kind: "session", id: s.sessionId },
			genreId: "core:genre/chat",
			subject: ev.annexChanged,
			specSlug: "test:spec/annex-loop",
			userId
		})
		expect(bound.error).toBeUndefined()

		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		// `runSpec` notes every root it runs; a host wired by hand is noted here.
		const { noteRun } = await import("$lib/server/pipelines/runtime/capPause")
		noteRun("run-root", "test:spec/annex-loop")
		await createHost(db as any, {
			sessionId: s.sessionId,
			userId,
			specId: "test:spec/annex-loop",
			runId: "run-root",
			auto: true
		} as any).commit!(
			{ value: { tick: 1 } },
			{ key: "write", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
		)

		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents(s.sessionId)
		const rows = await ofEvent(s.sessionId, sessionEvents.annexChanged)
		// The root's write, then one per admitted child: the tree waits at
		// the depth cap instead of recursing without bound…
		expect(rows.length).toBe(MAX_RUN_DEPTH + 1)
		// Raised mid-run, never automatic (R34): an auto run's annex write
		// does not continue the round.
		for (const r of rows) expect((r.payload as any).cause.auto).toBeUndefined()
		// …parked for the session owner, the chain named, the root first.
		const { pendingCapPausesFor, resolveCapPause } = await import("$lib/server/pipelines/runtime/capPause")
		const [pause] = pendingCapPausesFor(userId).filter((p) => p.sessionId === s.sessionId)
		expect(pause!.event).toBe(ev.annexChanged)
		expect(pause!.waiting).toBe(1)
		// Named by pipeline name, every step — the root included.
		const [{ name }] = await db
			.select({ name: schema.pipelineSpecs.name })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "test:spec/annex-loop"))
		expect(pause!.chain).toEqual(Array(MAX_RUN_DEPTH + 2).fill(name))
		// The parked branch holds the tree, so its count is still there.
		const { descendantCount, releaseRoot, _treeCount } = await import(
			"$lib/server/pipelines/runtime/lineage"
		)
		expect(descendantCount("run-root")).toBe(MAX_RUN_DEPTH)
		releaseRoot("run-root")
		expect(descendantCount("run-root")).toBe(MAX_RUN_DEPTH)
		// Continue, on the queued path: one more window of four, then it
		// waits again.
		await resolveCapPause(db as any, pause!.id, userId, "continue")
		await settleSessionEvents(s.sessionId)
		expect((await ofEvent(s.sessionId, sessionEvents.annexChanged)).length).toBe(2 * MAX_RUN_DEPTH + 1)
		const [second] = pendingCapPausesFor(userId).filter((p) => p.sessionId === s.sessionId)
		expect(second!.depth).toBe(2 * MAX_RUN_DEPTH + 1)
		// Stop here: nothing more runs, the parked run is receipted as
		// cancelled, and the tree is forgotten.
		const trees = _treeCount()
		await resolveCapPause(db as any, second!.id, userId, "cancel")
		await settleSessionEvents(s.sessionId)
		expect((await ofEvent(s.sessionId, sessionEvents.annexChanged)).length).toBe(2 * MAX_RUN_DEPTH + 1)
		const [stopped] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.rootRunId, "run-root"))
			.orderBy(desc(schema.pipelineRuns.depth))
			.limit(1)
		expect(stopped!.outcome).toBe("cancelled")
		expect(stopped!.depth).toBe(2 * MAX_RUN_DEPTH + 1)
		expect(stopped!.haltReason).toMatch(/stopped at the cycle cap by the session owner/)
		expect(descendantCount("run-root")).toBe(0)
		expect(_treeCount()).toBe(trees - 1)
	})

	it("E1c · one pause per tree: later refusals join it, one Continue grants one window to all, a gone session drops it, a changed binding does not run", async () => {
		const s = await makeSession("cap-group")
		const { parkAtCap, pendingCapPausesFor, resolveCapPause } = await import(
			"$lib/server/pipelines/runtime/capPause"
		)
		const { capsOf, openBranch, closeBranch } = await import("$lib/server/pipelines/runtime/lineage")
		const lineage = { parentRunId: "grp-parent", rootRunId: "grp-root", depth: 5 }
		const ran: string[] = []
		// As the real redispatch does (`queueChild`), each run re-holds the tree.
		const requeue = (tag: string) => {
			openBranch("grp-root")
			ran.push(tag)
		}
		const park = (tag: string) =>
			parkAtCap(db as any, {
				sessionId: s.sessionId,
				userId,
				event: sessionEvents.annexChanged,
				specSlug: "test:spec/annex-loop",
				lineage,
				cap: "cycle guard: test",
				redispatch: () => requeue(tag)
			})
		// Two refusals at once: one pause, two runs waiting on it.
		const [a, b] = await Promise.all([park("a"), park("b")])
		expect(a!.id).toBe(b!.id)
		const mine = pendingCapPausesFor(userId).filter((p) => p.sessionId === s.sessionId)
		expect(mine.map((p) => p.waiting)).toEqual([2])
		await resolveCapPause(db as any, a!.id, userId, "continue")
		expect(ran.sort()).toEqual(["a", "b"])
		// One window, not two.
		expect(capsOf("grp-root").depth).toBe(8)
		closeBranch("grp-root")
		closeBranch("grp-root")

		// A session deleted while it waits: the answer drops it, nothing runs.
		const gone = await makeSession("cap-gone")
		const c = await parkAtCap(db as any, {
			sessionId: gone.sessionId,
			userId,
			event: sessionEvents.annexChanged,
			specSlug: "test:spec/annex-loop",
			lineage: { ...lineage, rootRunId: "gone-root" },
			cap: "cycle guard: test",
			redispatch: () => ran.push("gone")
		})
		await db.delete(schema.sessions).where(eq(schema.sessions.id, gone.sessionId))
		await expect(resolveCapPause(db as any, c!.id, userId, "continue")).rejects.toThrow(
			/no longer exists/
		)
		expect(ran).not.toContain("gone")
		expect(pendingCapPausesFor(userId).some((p) => p.id === c!.id)).toBe(false)

		// Continue runs only the pipeline the owner approved.
		const { dispatchSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const out = await dispatchSessionEvent(db as any, {
			sessionId: s.sessionId,
			userId,
			genreId: "core:genre/chat",
			event: sessionEvents.sessionCreated,
			input: {},
			lineage: { parentRunId: "x", rootRunId: "pin-root", depth: 1 },
			expectSpec: "test:spec/not-what-answers"
		})
		expect(out!.refused).toMatch(/changed while this waited at the cycle cap/)
		expect(out!.receipt!.outcome).toBe("halt")
	})

	it("R65 · a listener-lane park shows every hop of its chain, not just its depth", async () => {
		// A lane run keeps its parent's depth and counts its own hops as
		// `echo`; the pause walked `depth` hops and showed only the start.
		const s = await makeSession("cap-echo")
		const { parkAtCap, noteRun, resolveCapPause } = await import(
			"$lib/server/pipelines/runtime/capPause"
		)
		noteRun("echo-root", "test:spec/root")
		noteRun("echo-1", "test:spec/a", "echo-root")
		noteRun("echo-2", "test:spec/b", "echo-1")
		noteRun("echo-3", "test:spec/a", "echo-2")
		const view = await parkAtCap(db as any, {
			sessionId: s.sessionId,
			userId,
			event: sessionEvents.annexChanged,
			specSlug: "test:spec/b",
			lineage: { parentRunId: "echo-3", rootRunId: "echo-root", depth: 1, echo: 3 } as any,
			cap: "cycle guard: test",
			redispatch: () => {}
		})
		expect(view!.chain).toEqual([
			"test:spec/root",
			"test:spec/a",
			"test:spec/b",
			"test:spec/a",
			"test:spec/b"
		])
		expect(view!.depth).toBe(4)
		await resolveCapPause(db as any, view!.id, userId, "cancel")
	})

	it("an unchanged annex write leaves no artifact", async () => {
		const s = await makeSession("annex-quiet")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const artifacts: any[] = []
		const host = createHost(db as any, {
			sessionId: s.sessionId,
			userId,
			specId: "acme.rp:spec/clock",
			runId: "run-quiet",
			artifacts
		} as any)
		const node = { key: "save", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
		await host.commit!({ value: { clock: 1 } }, node)
		const after = artifacts.length
		const again: any = await host.commit!({ value: { clock: 1 } }, node)
		expect(artifacts.length).toBe(after)
		// …and says it wrote nothing, so the executor skips the event (W1).
		expect(again.written).toBe(false)
	})

	it("W1 · one run writes the reply and the annex both — many writes, one live row", async () => {
		const s = await makeSession("reply-and-annex")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, {
			sessionId: s.sessionId,
			userId,
			specId: "acme.rp:spec/clock",
			runId: "run-both"
		} as any)
		const reply: any = await host.commit!(
			{ text: "The clock struck." },
			{ key: "reply", definitionId: "core:outlet/create-message", definitionVersion: 1 } as any
		)
		const annex: any = await host.commit!(
			{ value: { clock: 9 } },
			{ key: "save", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
		)
		expect(typeof reply.id).toBe("number")
		expect(annex.written).toBe(true)
		expect(annex.annex).toMatchObject({ clock: 9 })
	})

	it("seating an envoy that is already seated emits nothing more", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, name: "emit envoy twice", genreId: "core:genre/guide" })
			.returning()
		const { sessionsSetEnvoySeatHandler } = await import("$lib/server/sockets/sessions")
		const seat = (seated: boolean) =>
			sessionsSetEnvoySeatHandler.handler(
				fakeSocket(userId),
				{ sessionId: session.id, slug: "mascot", seated } as any,
				emit
			)
		await seat(true)
		await seat(true)
		expect((await ofEvent(session.id, sessionEvents.memberAdded)).length).toBe(1)
		await seat(false)
		await seat(false)
		expect((await ofEvent(session.id, sessionEvents.memberRemoved)).length).toBe(1)
	})
})

describe("E1b · a package's declared event, recorded", () => {
	it("records in scope as a ledger row the event names; refuses out of scope, undeclared and withdrawn", async () => {
		const s = await makeSession("recorded")
		const { spec, compile, sessionEvents: ev, use } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const { registerPluginEvents, withdrawPluginEvents } = await import("$lib/server/plugins/pluginEvents")
		const { createHost, HostScopeError } = await import("$lib/server/pipelines/runtime/host")

		// Registered from a manifest, as boot and install do.
		const refused = registerPluginEvents(
			{
				events: [
					{
						event: "acme.dice:event/rolled@1",
						payload: "core:shape/json@1",
						name: { en: "Dice rolled" },
						description: "A roll landed.",
						domain: "session",
						genre: "core:genre/chat",
						recordedBy: [ev.messageRespond]
					}
				]
			},
			"acme.dice"
		)
		expect(refused).toEqual([])
		// A manifest may not declare another package's event. (A second
		// package: registering replaces the registering package's events.)
		expect(registerPluginEvents({ events: [{ event: "acme.dice:event/x@1" }] }, "acme.other")[0]).toMatch(
			/not under 'acme.other'/
		)

		const publishLocked = async (slug: string, event: string) =>
			saveDocument(
				db as any,
				compile(
					spec(slug, { version: "1.0.0" })
						.inlet("input", C.userMessage.v1(), { genre: use("core:genre/chat"), event })
						.build()
				),
				{ publish: true }
			)
		await publishLocked("acme.dice:spec/respond", ev.messageRespond)
		await publishLocked("acme.dice:spec/created", ev.sessionCreated)

		const node = { key: "rolled", definitionId: "core:outlet/record-event", definitionVersion: 1 } as any
		// The scope is judged on the running document's lock, carried on the scope.
		const locks: Record<string, string> = {
			"acme.dice:spec/respond": ev.messageRespond,
			"acme.dice:spec/created": ev.sessionCreated
		}
		const hostFor = (specId: string, over: Record<string, unknown> = {}) =>
			createHost(db as any, {
				sessionId: s.sessionId,
				userId,
				specId,
				input: { event: locks[specId] },
				runId: `run-${specId}`,
				...over
			} as any)

		const res: any = await hostFor("acme.dice:spec/respond").commit!(
			{ event: "acme.dice:event/rolled@1", payload: { total: 12 } },
			node
		)
		expect(res.written).toBe(true)
		const rows = await ofEvent(s.sessionId, "acme.dice:event/rolled@1")
		expect(rows.length).toBe(1)
		expect(rows[0]!.payload).toMatchObject({ payload: { total: 12 }, cause: { kind: "run" } })

		// A spec bound to the event hears it: it writes the annex, which
		// leaves its own ledger row — proof the bound listener ran.
		const listener = compile(
			spec("acme.dice:spec/cheer", { version: "1.0.0" })
				.inlet("event", C.sessionEvent.v1(), {
					genre: use("core:genre/chat"),
					events: ["acme.dice:event/rolled@1"]
				})
				.outlet("note", ($) => C.setSessionAnnex.v1({ value: { heard: $.event.payload } as never }))
				.build()
		)
		await saveDocument(db as any, listener, { publish: true })
		const { bindSubject } = await import("$lib/server/pipelines/entities/bindings")
		const bound = await bindSubject(db as any, {
			scope: { kind: "session", id: s.sessionId },
			genreId: "core:genre/chat",
			subject: "acme.dice:event/rolled@1",
			specSlug: "acme.dice:spec/cheer",
			userId
		})
		expect(bound.error).toBeUndefined()
		await hostFor("acme.dice:spec/respond").commit!(
			{ event: "acme.dice:event/rolled@1", payload: { total: 7 } },
			node
		)
		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents()
		expect((await ofEvent(s.sessionId, ev.annexChanged)).length).toBeGreaterThan(0)
		// …and heard the envelope: the event it names and what was recorded.
		const [annexed] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.sessionId))
		expect(JSON.stringify(annexed!.annex)).toContain('"total":7')

		// The payload is judged again at the write, whatever publish saw.
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		await expect(
			hostFor("acme.dice:spec/respond").commit!({ event: "acme.dice:event/rolled@1", payload: cyclic }, node)
		).rejects.toThrow(/not plain JSON/)
		// A run with no user records for nobody: refused, not a silent success.
		await expect(
			hostFor("acme.dice:spec/respond", { userId: undefined }).commit!(
				{ event: "acme.dice:event/rolled@1", payload: {} },
				node
			)
		).rejects.toThrow(/no user to record an event for/)

		// Out of scope: this spec serves session-created only.
		await expect(
			hostFor("acme.dice:spec/created").commit!({ event: "acme.dice:event/rolled@1", payload: {} }, node)
		).rejects.toThrow(
			/refused — 'acme.dice:event\/rolled@1' may be recorded in 'core:genre\/chat' by core:event\/message-respond@1/
		)
		// …and the publish door says so first, for a literal recording.
		await expect(
			saveDocument(
				db as any,
				compile(
					spec("acme.dice:spec/created-records", { version: "1.0.0" })
						.inlet("input", C.sessionEvent.v1(), { genre: use("core:genre/chat"), event: ev.sessionCreated })
						.outlet("rolled", () => C.recordEvent.v1({ event: "acme.dice:event/rolled@1", payload: {} as never }))
						.build()
				),
				{ publish: true }
			)
		).rejects.toThrow(/records outside its scope/)
		// Undeclared.
		await expect(
			hostFor("acme.dice:spec/respond").commit!({ event: "acme.dice:event/nope@1", payload: {} }, node)
		).rejects.toThrow(HostScopeError)
		// Scope is per genre: declared for chat, so a session of another
		// genre is refused even for a subject in chat's scope.
		await db.update(schema.sessions).set({ genreId: "acme.dice:genre/table" }).where(eq(schema.sessions.id, s.sessionId))
		await expect(
			hostFor("acme.dice:spec/respond").commit!({ event: "acme.dice:event/rolled@1", payload: {} }, node)
		).rejects.toThrow(/not declared for the genre 'acme.dice:genre\/table'/)
		await db.update(schema.sessions).set({ genreId: "core:genre/chat" }).where(eq(schema.sessions.id, s.sessionId))

		// A reinstall replaces the scopes: the new manifest names another subject.
		const reinstall = registerPluginEvents(
			{
				events: [
					{
						event: "acme.dice:event/rolled@1",
						payload: "core:shape/json@1",
						name: { en: "Dice rolled" },
						description: "A roll landed.",
						domain: "session",
						genre: "core:genre/chat",
						recordedBy: [ev.sessionCreated]
					}
				]
			},
			"acme.dice"
		)
		expect(reinstall).toEqual([])
		await expect(
			hostFor("acme.dice:spec/respond").commit!({ event: "acme.dice:event/rolled@1", payload: {} }, node)
		).rejects.toThrow(/may be recorded in 'core:genre\/chat' by core:event\/session-created@1/)
		expect(
			(await hostFor("acme.dice:spec/created").commit!({ event: "acme.dice:event/rolled@1", payload: {} }, node) as any)
				.written
		).toBe(true)
		// Malformed entries are refused by name, not half-registered.
		expect(
			registerPluginEvents({ events: [{ event: "acme.dice:event/bad@1", genre: "chat", recordedBy: "any" }] }, "acme.dice")[0]
		).toMatch(/names no genre/)

		// Withdrawn with its package.
		registerPluginEvents(
			{
				events: [
					{
						event: "acme.dice:event/rolled@1",
						payload: "core:shape/json@1",
						name: { en: "Dice rolled" },
						description: "A roll landed.",
						domain: "session",
						genre: "core:genre/chat",
						recordedBy: [ev.messageRespond]
					}
				]
			},
			"acme.dice"
		)
		const { missingRequirements } = await import("$lib/server/plugins/requirements")
		// Another package requiring the event finds it while it is installed…
		expect(await missingRequirements(db as any, ["acme.dice:event/rolled@1"])).toEqual([])
		withdrawPluginEvents("acme.dice")
		// …and not after.
		expect(await missingRequirements(db as any, ["acme.dice:event/rolled@1"])).toEqual(["acme.dice:event/rolled@1"])
		await expect(
			hostFor("acme.dice:spec/respond").commit!({ event: "acme.dice:event/rolled@1", payload: {} }, node)
		).rejects.toThrow(/not an event any installed package declares/)
	})
})

describe("V1a · sessions:get carries no pipeline state and nobody else's draft", () => {
	it("sends each member their own draft, never the annex, the drafts map, or a guest's account", async () => {
		const s = await makeSession("v1a-get")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(db, "v1a-guest")
		await db.insert(schema.sessionGuests).values({ sessionId: s.sessionId, userId: guest.id })
		await db
			.update(schema.sessions)
			.set({
				annex: { "acme.rp": { culprit: "the butler" } },
				annexAudiences: { "acme.rp": { hand: ["character:7"] } },
				drafts: { [String(userId)]: "owner's unsent", [String(guest.id)]: "guest's unsent" }
			})
			.where(eq(schema.sessions.id, s.sessionId))

		const { sessionsGetHandler } = await import("$lib/server/sockets/sessions")
		for (const [who, mine] of [
			[userId, "owner's unsent"],
			[guest.id, "guest's unsent"]
		] as const) {
			const res: any = await sessionsGetHandler.handler(fakeSocket(who), { id: s.sessionId } as any, () => {})
			expect(res.session.id).toBe(s.sessionId)
			expect(res.session.annex).toBeUndefined()
			expect(res.session.annexAudiences).toBeUndefined()
			expect(res.session.drafts).toBeUndefined()
			expect(res.userDraft).toBe(mine)
			expect(JSON.stringify(res)).not.toContain("the butler")
			expect(JSON.stringify(res)).not.toContain("character:7")
			for (const g of res.session.sessionGuests) {
				expect(Object.keys(g.user).sort()).toEqual(["displayName", "id", "username"])
			}
		}
	})
})

describe("V1c · annex audiences (R57, R59)", () => {
	it("stores who may see each key, merges per reader, refuses a second audience, and defaults to pipelines only", async () => {
		const s = await makeSession("v1c-annex")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(db, "v1c-guest")
		await db.insert(schema.sessionGuests).values({ sessionId: s.sessionId, userId: guest.id })
		const { createHost, HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, {
			sessionId: s.sessionId,
			userId,
			specId: "acme.rp:spec/clue",
			runId: "run-v1c"
		} as any)
		const node = { key: "keep", definitionId: "core:outlet/set-session-annex", definitionVersion: 1 } as any
		// Three audiences in one owner's document — each key's own, from the
		// declaration.
		await host.commit!({ value: { culprit: "the butler" } }, node) // R59: pipelines only
		await host.commit!({ value: { clue: "a glove" } }, node)
		await host.commit!({ value: { note: "for the owner" } }, node)
		await host.commit!({ value: { hunch: "the garden" } }, node)

		// A pipeline still reads everything, exactly as before.
		const read = (q: Record<string, unknown>) =>
			(host as any).read("session_annex", { sessionId: s.sessionId, ...q }, {
				key: "annex",
				definitionId: "core:query/session-annex",
				definitionVersion: 1
			})
		expect(await read({})).toEqual({
			culprit: "the butler",
			clue: "a glove",
			note: "for the owner",
			hunch: "the garden"
		})
		// The AI's view: participant and ai — never the owner's note, never the secret.
		expect(await read({ view: "ai" })).toEqual({ clue: "a glove", hunch: "the garden" })

		// A person's view: what their audience holds, never `ai`, never the secret.
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		expect(await annexViewFor(db as any, s.sessionId, userId)).toEqual({
			"acme.rp": { clue: "a glove", note: "for the owner" }
		})
		expect(await annexViewFor(db as any, s.sessionId, guest.id)).toEqual({
			"acme.rp": { clue: "a glove" }
		})
		const { createTestUser: make } = await import("$lib/server/utils/testDb")
		const stranger = await make(db, "v1c-stranger")
		expect(await annexViewFor(db as any, s.sessionId, stranger.id)).toBeNull()

		// A key nobody declared is refused.
		await expect(host.commit!({ value: { x: 1 } }, node)).rejects.toThrow(HostScopeError)
		// Replacing the document drops what it leaves out, audiences included.
		await host.commit!({ value: { clue: "a glove" }, params: { merge: false } }, node)
		const [row] = await db
			.select({ annex: schema.sessions.annex, audiences: schema.sessions.annexAudiences })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.sessionId))
		expect((row!.annex as any)["acme.rp"]).toEqual({ clue: "a glove" })
		expect((row!.audiences as any)["acme.rp"]).toEqual({ clue: ["participant"] })
	})
})
