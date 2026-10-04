/**
 * `attachments:*` handlers (PLAN-composer-attachments phase 1, lane B).
 *
 * Fail-first cases from the plan: an SVG head is refused at `begin`; lying
 * about the declared size is refused mid-chunk; a guest with session access
 * can stage and a stranger can't; an out-of-order chunk is refused; progress
 * acks arrive — to the asking socket, not every tab.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

/**
 * The reading rule has its own suite (`attachments/readers.int.test.ts`);
 * here the reply reads what each test says — images and text by default —
 * so `begin`'s use of it is what is under test.
 */
const verdict = vi.hoisted(() => ({
	image: { allowed: true } as { allowed: boolean; reason?: string },
	connection: { id: 7, name: "Studio", model: "m", type: "anthropic" }
}))
vi.mock("$lib/server/attachments/readers", async (importOriginal) => {
	const real = await importOriginal<any>()
	return {
		...real,
		attachmentReaders: async () => ({
			kinds: {
				image: verdict.image,
				text: { allowed: true },
				pdf: { allowed: false, reason: "No PDFs here." }
			},
			calls: [
				{
					key: "generate",
					label: "Reply",
					reads: verdict.image.allowed ? ["image", "text"] : ["text"],
					placeholderFor: verdict.image.allowed ? ["pdf"] : ["image", "pdf"],
					reasons: {},
					connection: verdict.connection
				}
			],
			accepts: { image: [], text: [], pdf: [] },
			limits: { filesPerMessage: 10, bytesPerKind: { image: 1, text: 1, pdf: 1 } }
		})
	}
})

const T = 60_000
const MiB = 1024 * 1024

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-attachments-sockets-int-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, T)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(async () => {
	const { __resetTrayMemoryForTests } = await import(
		"$lib/server/attachments/tray"
	)
	__resetTrayMemoryForTests()
})

/** A socket that records what was sent to it alone. */
function fakeSocket(userId: number) {
	const asked: { event: string; data: any }[] = []
	return {
		user: { id: userId },
		emit: (event: string, data: any) => asked.push({ event, data }),
		asked
	} as any
}

/** Records what went to every tab of the person (`emitToUser`). */
function recorder() {
	const sent: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		sent.push({ event, data })
	}
	return { sent, emit }
}

let seq = 0
async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(db, `att-sock-${++seq}`)
}
async function makeSession(userId: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	return session
}

function png(seed: number, size = 2): Buffer {
	const img = new PNG({ width: size, height: size })
	for (let i = 0; i < img.data.length; i++) img.data[i] = (i * seed) % 256
	return PNG.sync.write(img)
}

async function handlers() {
	return import("./attachments")
}

describe("attachments:* (PGlite integration)", () => {
	test(
		"an SVG head is refused at begin, and nothing is written",
		async () => {
			const { attachmentsBegin } = await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			const svg = Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
			)
			const socket = fakeSocket(user.id)
			const { sent, emit } = recorder()
			await attachmentsBegin.handler(
				socket,
				{ sessionId: session.id, filename: "a.png", bytes: svg.length, head: svg },
				emit
			)
			expect(sent).toHaveLength(1)
			expect(sent[0].event).toBe("attachments:begin:error")
			expect(sent[0].data.error).toMatch(/can't be attached/)
			expect(sent[0].data.sessionId).toBe(session.id)
			expect(socket.asked).toHaveLength(0)
			const rows = await db
				.select()
				.from(schema.trayItems)
				.where(eq(schema.trayItems.sessionId, session.id))
			expect(rows).toHaveLength(0)
		},
		T
	)

	test(
		"a whole upload: begin and chunk acks reach the asker alone; finish reaches every tab",
		async () => {
			const { attachmentsBegin, attachmentsChunk, attachmentsFinish, attachmentsList } =
				await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			// Big enough for two chunks: random pixels do not compress.
			const big = (() => {
				const img = new PNG({ width: 700, height: 700 })
				for (let i = 0; i < img.data.length; i++)
					img.data[i] = Math.floor(Math.random() * 256)
				return PNG.sync.write(img)
			})()
			expect(big.length).toBeGreaterThan(MiB)

			const socket = fakeSocket(user.id)
			const tabs = recorder()
			const opened = await attachmentsBegin.handler(
				socket,
				{
					sessionId: session.id,
					filename: "noise.png",
					bytes: big.length,
					head: big.subarray(0, 4100)
				},
				tabs.emit
			)
			expect(opened.chunkBytes).toBe(MiB)
			for (let i = 0, index = 0; i < big.length; i += MiB, index++)
				await attachmentsChunk.handler(
					socket,
					{
						trayItemId: opened.trayItemId,
						index,
						data: big.subarray(i, i + MiB)
					},
					tabs.emit
				)
			const acks = socket.asked.filter(
				(a: any) => a.event === "attachments:chunk"
			)
			expect(acks.map((a: any) => a.data.received)).toEqual([MiB, big.length])
			expect(acks.every((a: any) => a.data.sessionId === session.id)).toBe(true)
			expect(socket.asked[0].event).toBe("attachments:begin")
			expect(tabs.sent).toHaveLength(0)

			const done = await attachmentsFinish.handler(
				socket,
				{ trayItemId: opened.trayItemId },
				tabs.emit
			)
			expect(done.trayItem.status).toBe("ready")
			expect(tabs.sent.map((s) => s.event)).toEqual(["attachments:finish"])
			expect(tabs.sent[0].data.sessionId).toBe(session.id)

			const listed = await attachmentsList.handler(
				socket,
				{ sessionId: session.id },
				tabs.emit
			)
			expect(listed.tray.map((t) => t.id)).toEqual([opened.trayItemId])
			expect(JSON.stringify(listed)).not.toContain(dataDir)
		},
		T
	)

	test(
		"lying about the declared size is refused mid-chunk",
		async () => {
			const { attachmentsBegin, attachmentsChunk } = await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			const real = png(5, 8)
			const socket = fakeSocket(user.id)
			const tabs = recorder()
			const declared = real.length - 10
			const opened = await attachmentsBegin.handler(
				socket,
				{
					sessionId: session.id,
					filename: "a.png",
					bytes: declared,
					head: real.subarray(0, Math.min(declared, 4100))
				},
				tabs.emit
			)
			await attachmentsChunk.handler(
				socket,
				{ trayItemId: opened.trayItemId, index: 0, data: real },
				tabs.emit
			)
			const err = tabs.sent.find((s) => s.event === "attachments:chunk:error")
			expect(err?.data.error).toMatch(/larger than it said/)
			expect(err?.data.trayItemId).toBe(opened.trayItemId)
			const row = await db.query.trayItems.findFirst({
				where: eq(schema.trayItems.id, opened.trayItemId)
			})
			expect(row?.status).toBe("refused")
		},
		T
	)

	test(
		"an out-of-order chunk is refused and ends the upload",
		async () => {
			const { attachmentsBegin, attachmentsChunk } = await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			const bytes = png(6)
			const socket = fakeSocket(user.id)
			const tabs = recorder()
			const opened = await attachmentsBegin.handler(
				socket,
				{ sessionId: session.id, filename: "a.png", bytes: bytes.length, head: bytes },
				tabs.emit
			)
			await attachmentsChunk.handler(
				socket,
				{ trayItemId: opened.trayItemId, index: 1, data: bytes },
				tabs.emit
			)
			expect(
				tabs.sent.find((s) => s.event === "attachments:chunk:error")?.data.error
			).toMatch(/stopped before it finished/)
			// The upload is over: even the right chunk is now the gone sentence.
			tabs.sent.length = 0
			await attachmentsChunk.handler(
				socket,
				{ trayItemId: opened.trayItemId, index: 0, data: bytes },
				tabs.emit
			)
			expect(tabs.sent[0].data.error).toMatch(/no longer waiting/)
		},
		T
	)

	test(
		"a guest with session access can stage; a stranger can't, and can't touch the guest's item",
		async () => {
			const { attachmentsBegin, attachmentsChunk, attachmentsFinish, attachmentsList, attachmentsRemove } =
				await handlers()
			const owner = await makeUser()
			const guest = await makeUser()
			const stranger = await makeUser()
			const session = await makeSession(owner.id)
			await db
				.insert(schema.sessionGuests)
				.values({ sessionId: session.id, userId: guest.id })

			const bytes = png(8)
			const guestSocket = fakeSocket(guest.id)
			const tabs = recorder()
			const opened = await attachmentsBegin.handler(
				guestSocket,
				{ sessionId: session.id, filename: "g.png", bytes: bytes.length, head: bytes },
				tabs.emit
			)
			await attachmentsChunk.handler(
				guestSocket,
				{ trayItemId: opened.trayItemId, index: 0, data: bytes },
				tabs.emit
			)
			const done = await attachmentsFinish.handler(
				guestSocket,
				{ trayItemId: opened.trayItemId },
				tabs.emit
			)
			expect(done.trayItem.status).toBe("ready")
			// Stored under the GUEST's own data directory, in this session.
			const variant = await db.query.variants.findFirst({
				where: eq(schema.variants.fileId, done.trayItem.file!.id)
			})
			expect(variant!.path).toContain(
				path.join("users", String(guest.id), "sessions", String(session.id))
			)

			const strangerSocket = fakeSocket(stranger.id)
			const strangerTabs = recorder()
			await attachmentsBegin.handler(
				strangerSocket,
				{ sessionId: session.id, filename: "s.png", bytes: bytes.length, head: bytes },
				strangerTabs.emit
			)
			await attachmentsList.handler(
				strangerSocket,
				{ sessionId: session.id },
				strangerTabs.emit
			)
			await attachmentsRemove.handler(
				strangerSocket,
				{ trayItemId: opened.trayItemId },
				strangerTabs.emit
			)
			expect(strangerTabs.sent.map((s) => s.event)).toEqual([
				"attachments:begin:error",
				"attachments:list:error",
				"attachments:remove:error"
			])
			expect(strangerTabs.sent[2].data.error).toMatch(/no longer waiting/)
			// The owner's list is the owner's tray — not the guest's.
			const ownerList = await attachmentsList.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id },
				recorder().emit
			)
			expect(ownerList.tray).toEqual([])
		},
		T
	)

	test(
		"a guest removed mid-upload stores nothing",
		async () => {
			const { attachmentsBegin, attachmentsChunk, attachmentsFinish } =
				await handlers()
			const owner = await makeUser()
			const guest = await makeUser()
			const session = await makeSession(owner.id)
			await db
				.insert(schema.sessionGuests)
				.values({ sessionId: session.id, userId: guest.id })
			const bytes = png(9)
			const socket = fakeSocket(guest.id)
			const tabs = recorder()
			const opened = await attachmentsBegin.handler(
				socket,
				{ sessionId: session.id, filename: "g.png", bytes: bytes.length, head: bytes },
				tabs.emit
			)
			await attachmentsChunk.handler(
				socket,
				{ trayItemId: opened.trayItemId, index: 0, data: bytes },
				tabs.emit
			)
			await db
				.delete(schema.sessionGuests)
				.where(eq(schema.sessionGuests.userId, guest.id))
			await attachmentsFinish.handler(
				socket,
				{ trayItemId: opened.trayItemId },
				tabs.emit
			)
			expect(tabs.sent.map((s) => s.event)).toEqual(["attachments:finish:error"])
			expect(
				await db.query.trayItems.findFirst({
					where: eq(schema.trayItems.id, opened.trayItemId)
				})
			).toBeUndefined()
			const files = await db
				.select()
				.from(schema.files)
				.where(eq(schema.files.userId, guest.id))
			expect(files).toHaveLength(0)
		},
		T
	)

	test(
		"a malformed tray item id is the gone sentence, not a driver error",
		async () => {
			const { attachmentsRemove } = await handlers()
			const user = await makeUser()
			const tabs = recorder()
			await attachmentsRemove.handler(
				fakeSocket(user.id),
				{ trayItemId: "not-a-uuid" },
				tabs.emit
			)
			expect(tabs.sent[0].data.error).toMatch(/no longer waiting/)
		},
		T
	)

	test(
		"a kind no reading call reads is refused at begin with the readers' reason",
		async () => {
			const { attachmentsBegin } = await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			verdict.image = {
				allowed: false,
				reason: "No model in this reply can read images."
			}
			try {
				const bytes = png(41)
				const socket = fakeSocket(user.id)
				const { sent, emit } = recorder()
				await attachmentsBegin.handler(
					socket,
					{ sessionId: session.id, filename: "cat.png", bytes: bytes.length, head: bytes },
					emit
				)
				expect(sent[0].event).toBe("attachments:begin:error")
				expect(sent[0].data.error).toBe("No model in this reply can read images.")
				expect(socket.asked).toHaveLength(0)
				// A text file still goes.
				const note = Buffer.from("# Notes\nA tabby on a sill.\n")
				await attachmentsBegin.handler(
					socket,
					{ sessionId: session.id, filename: "notes.md", bytes: note.length, head: note },
					emit
				)
				expect(socket.asked[0]?.event).toBe("attachments:begin")
			} finally {
				verdict.image = { allowed: true }
			}
		},
		T
	)

	test(
		"attachments:readers answers the asker; a non-admin's carries no connection",
		async () => {
			const { attachmentsReaders } = await handlers()
			const user = await makeUser()
			const session = await makeSession(user.id)
			const socket = fakeSocket(user.id)
			socket.user.isAdmin = false
			const { sent, emit } = recorder()
			await attachmentsReaders.handler(socket, { sessionId: session.id }, emit)
			expect(sent).toHaveLength(0)
			expect(socket.asked[0].event).toBe("attachments:readers")
			const res = socket.asked[0].data
			expect(res.sessionId).toBe(session.id)
			expect(res.readers.calls[0].label).toBe("Reply")
			expect(res.readers.calls[0].connection).toBeUndefined()

			const admin = fakeSocket(user.id)
			admin.user.isAdmin = true
			await attachmentsReaders.handler(admin, { sessionId: session.id }, emit)
			expect(admin.asked[0].data.readers.calls[0].connection?.name).toBe("Studio")

			// A stranger is refused, to the asker.
			const stranger = await makeUser()
			const tabs = recorder()
			await attachmentsReaders.handler(fakeSocket(stranger.id), { sessionId: session.id }, tabs.emit)
			expect(tabs.sent[0].event).toBe("attachments:readers:error")
		},
		T
	)

	test(
		"a Send carries ready tray items as parts and pushes the emptied tray; a kind the reply stopped reading refuses it whole",
		async () => {
			const { attachmentsBegin, attachmentsChunk, attachmentsFinish } = await handlers()
			const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
			const user = await makeUser()
			const session = await makeSession(user.id)
			const [persona] = await db
				.insert(schema.characters)
				.values({ userId: user.id, name: "P", description: "", isPersona: true, aliases: [] } as any)
				.returning()
			const socket = Object.assign(fakeSocket(user.id), {
				io: { to: () => ({ emit: () => {} }) }
			})
			const stage = async (bytes: Buffer, filename: string) => {
				const tabs = recorder()
				const opened = await attachmentsBegin.handler(
					socket,
					{ sessionId: session.id, filename, bytes: bytes.length, head: bytes.subarray(0, 4100) },
					tabs.emit
				)
				await attachmentsChunk.handler(socket, { trayItemId: opened.trayItemId, index: 0, data: bytes }, tabs.emit)
				const done = await attachmentsFinish.handler(socket, { trayItemId: opened.trayItemId }, tabs.emit)
				expect(done.trayItem.status).toBe("ready")
				return opened.trayItemId
			}
			const image = await stage(png(31), "cat.png")
			const notes = await stage(Buffer.from("# Notes\nThe bell rings twice.\n"), "notes.md")

			// The reply stopped reading images since they were staged: nothing is
			// sent, the tray stays, and the sender is told why.
			verdict.image = { allowed: false, reason: "No model in this reply can read images." }
			const refusedTabs = recorder()
			const refused = await sessionMessagesSendPersonaMessageHandler.handler(
				socket,
				{ sessionId: session.id, personaId: persona.id, content: "", trayItemIds: [image, notes] } as any,
				refusedTabs.emit
			)
			expect(refused.error).toMatch(/can't|cannot|No model/i)
			expect(refused.sessionMessage).toBeUndefined()
			expect(refusedTabs.sent.some((s) => s.event === "attachments:list")).toBe(false)
			const kept = await db.select().from(schema.trayItems).where(eq(schema.trayItems.sessionId, session.id))
			expect(kept).toHaveLength(2)

			// Readable again: an empty line with two files is a line.
			verdict.image = { allowed: true }
			const tabs = recorder()
			const res = await sessionMessagesSendPersonaMessageHandler.handler(
				socket,
				{ sessionId: session.id, personaId: persona.id, content: "", trayItemIds: [image, notes] } as any,
				tabs.emit
			)
			expect(res.error).toBeUndefined()
			// The line's own text part (empty here) comes first; the files follow in tray order.
			const parts = (((res.sessionMessage as any)?.parts ?? []) as Array<{ type: string; data: any }>).filter(
				(p) => p.type === "core:image" || p.type === "core:file"
			)
			expect(parts.map((p) => p.type)).toEqual(["core:image", "core:file"])
			expect(parts[0].data).toMatchObject({ filename: "cat.png", width: 2, height: 2 })
			expect(parts[1].data).toMatchObject({ name: "notes.md", mime: "text/markdown" })
			expect(parts[1].data.bytes).toBeGreaterThan(0)
			// Every tab drops the sent tiles from the same list a reload reads.
			const list = tabs.sent.find((s) => s.event === "attachments:list")
			expect(list?.data).toEqual({ sessionId: session.id, tray: [] })
			verdict.image = { allowed: true }
		},
		T
	)
})
