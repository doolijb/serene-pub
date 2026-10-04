/**
 * Send with attachments, and what follows from a sent attachment
 * (PLAN-composer-attachments phase 2, lane D).
 *
 *  - **Commit on Send**: the sender's ready tray items become `core:image` /
 *    `core:file` parts in tray order at native ordinals ≥ 10, in one
 *    transaction with the row; fresh files get `files.message_id`; the tray
 *    rows go. Any refusal sends nothing and keeps the tray.
 *  - **Guests** send the same way (D8), with their own tray only.
 *  - **Access through a part** (§6.3): a file a part in a session refers to
 *    is viewable by that session's members and sendable by its runs — the
 *    deduped-avatar case — and by nobody else.
 *  - **Branch** carries the attachment parts.
 *  - **Remove only** (D9): whoever may edit the message may take an
 *    attachment off it; the file stays (no-cascade).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
/**
 * The reading rule is its own suite (`readers.int.test.ts`); here the reply
 * reads images and text and not PDFs, whatever the session's genre — the
 * fixed verdict this suite's send claims are about.
 */
const PDF_REFUSED = "No model in this reply can read PDFs."
vi.mock("$lib/server/attachments/readers", async (importOriginal) => {
	const real = await importOriginal<typeof import("./readers")>()
	return {
		...real,
		attachmentReaders: async () => ({
			kinds: {
				image: { allowed: true },
				text: { allowed: true },
				pdf: { allowed: false, reason: PDF_REFUSED }
			},
			calls: [],
			accepts: { image: [], text: [], pdf: [] },
			limits: { filesPerMessage: 10, bytesPerKind: { image: 1, text: 1, pdf: 1 } }
		})
	}
})
// The send starts nothing itself, but turn order may ask; never a model.
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: async () => ({ ok: true })
}))

const T = 60_000

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-attachments-send-int-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, T)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(db, `att-send-${++seq}`)
}
async function makeSession(userId: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	return session
}
async function addGuest(sessionId: number, userId: number) {
	await db.insert(schema.sessionGuests).values({ sessionId, userId })
}

function png(seed: number, size = 3): Buffer {
	const img = new PNG({ width: size, height: size })
	for (let i = 0; i < img.data.length; i++) img.data[i] = (i * seed + seq) % 256
	return PNG.sync.write(img)
}

/** A ready tray item, as `finishTrayUpload` leaves one. */
async function trayItem(
	userId: number,
	sessionId: number,
	opts: {
		bytes?: Buffer
		filename?: string
		position?: number
		status?: "uploading" | "ready" | "refused"
		/** Reuse an existing file (a dedupe hit: fresh = false). */
		fileId?: number
	} = {}
) {
	const { createMedia } = await import("$lib/server/media")
	let fileId = opts.fileId ?? null
	let fresh = false
	if (fileId == null && opts.status !== "uploading") {
		const created = await createMedia(db as any, {
			userId,
			sessionId,
			bytes: opts.bytes ?? png(++seq),
			filename: opts.filename ?? "cat.png",
			allowDocuments: true
		})
		fileId = created.file.id
		fresh = created.created
	}
	const [row] = await db
		.insert(schema.trayItems)
		.values({
			userId,
			sessionId,
			fileId,
			fresh,
			filename: opts.filename ?? "cat.png",
			bytes: 10,
			status: opts.status ?? "ready",
			position: opts.position ?? 0
		})
		.returning()
	return row
}

/** A socket whose pushes go nowhere. */
const fakeSocket = (userId: number) =>
	({
		user: { id: userId },
		emit: () => {},
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	}) as any

function recorder() {
	const sent: { event: string; data: any }[] = []
	return { sent, emit: (event: string, data: any) => sent.push({ event, data }) }
}

async function send(
	userId: number,
	params: Record<string, unknown>
): Promise<{ res: any; sent: { event: string; data: any }[] }> {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { sent, emit } = recorder()
	const res = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		params as any,
		emit
	)
	return { res, sent }
}

async function partsOf(messageId: number) {
	const { getMessage } = await import("$lib/server/messages/store")
	return (await getMessage(db as any, messageId))!.parts
}

async function trayRows(userId: number, sessionId: number) {
	return db
		.select()
		.from(schema.trayItems)
		.where(
			and(
				eq(schema.trayItems.userId, userId),
				eq(schema.trayItems.sessionId, sessionId)
			)
		)
}

async function messageCount(sessionId: number) {
	return (
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
	).length
}

describe("send with attachments (PGlite integration)", () => {
	test(
		"parts land in tray order at ordinals ≥ 10; the text is untouched; fresh files get message_id; the tray empties",
		async () => {
			const user = await makeUser()
			const session = await makeSession(user.id)
			// An avatar the person re-attaches: a dedupe hit, not fresh.
			const { createMedia } = await import("$lib/server/media")
			const [card] = await db
				.insert(schema.characters)
				.values({ userId: user.id, name: "Mara", description: "" })
				.returning()
			const avatar = await createMedia(db as any, {
				userId: user.id,
				characterId: card.id,
				bytes: png(901)
			})
			const second = await trayItem(user.id, session.id, { position: 1 })
			const first = await trayItem(user.id, session.id, {
				position: 0,
				bytes: Buffer.from("# Notes\nThe bell rings twice.\n"),
				filename: "notes.md"
			})
			const third = await trayItem(user.id, session.id, {
				position: 2,
				fileId: avatar.file.id,
				filename: "mara.png"
			})

			const { res, sent } = await send(user.id, {
				sessionId: session.id,
				content: "  Look at these.  ",
				// Not in tray order on purpose.
				trayItemIds: [third.id, second.id, first.id]
			})
			expect(res.error).toBeUndefined()
			expect(res.sessionId).toBe(session.id)
			const message = res.sessionMessage
			expect(message.content).toBe("Look at these.")

			const parts = await partsOf(message.id)
			const attached = parts.filter(
				(p) => p.type === "core:image" || p.type === "core:file"
			)
			expect(attached.map((p) => p.type)).toEqual([
				"core:file",
				"core:image",
				"core:image"
			])
			expect(attached.every((p) => p.ordinal >= 10)).toBe(true)
			expect(attached.map((p) => (p.data as any).assetId)).toEqual([
				first.fileId,
				second.fileId,
				avatar.file.id
			])
			expect((attached[0].data as any).name).toBe("notes.md")
			expect((attached[1].data as any).width).toBe(3)

			const { messageText, getMessage } = await import(
				"$lib/server/messages/store"
			)
			expect(messageText((await getMessage(db as any, message.id))!)).toBe(
				"Look at these."
			)
			// The push carries the parts, so the strip draws from it.
			expect(message.parts?.length).toBeGreaterThanOrEqual(3)

			const { getMedia } = await import("$lib/server/media")
			expect((await getMedia(db as any, second.fileId!))!.messageId).toBe(
				message.id
			)
			// The avatar keeps its own provenance.
			expect((await getMedia(db as any, avatar.file.id))!.messageId).toBeNull()

			expect(await trayRows(user.id, session.id)).toHaveLength(0)
			const list = sent.find((s) => s.event === "attachments:list")
			expect(list?.data).toEqual({ sessionId: session.id, tray: [] })
		},
		T
	)

	test(
		"an attachment with no text sends",
		async () => {
			const user = await makeUser()
			const session = await makeSession(user.id)
			const item = await trayItem(user.id, session.id)
			const { res } = await send(user.id, {
				sessionId: session.id,
				content: "",
				trayItemIds: [item.id]
			})
			expect(res.error).toBeUndefined()
			const parts = await partsOf(res.sessionMessage.id)
			expect(parts.some((p) => p.type === "core:image")).toBe(true)
		},
		T
	)

	test(
		"a kind the reply can't read sends nothing and keeps the tray",
		async () => {
			const user = await makeUser()
			const session = await makeSession(user.id)
			const image = await trayItem(user.id, session.id, { position: 0 })
			const pdf = await trayItem(user.id, session.id, {
				position: 1,
				bytes: Buffer.from(
					"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
				),
				filename: "map.pdf"
			})
			const { res } = await send(user.id, {
				sessionId: session.id,
				content: "Two things",
				trayItemIds: [image.id, pdf.id]
			})
			expect(res.error).toBe(PDF_REFUSED)
			expect(res.sessionId).toBe(session.id)
			expect(await messageCount(session.id)).toBe(0)
			expect(await trayRows(user.id, session.id)).toHaveLength(2)
		},
		T
	)

	test(
		"another person's tray item, a malformed id or a still-uploading item is refused whole",
		async () => {
			const owner = await makeUser()
			const stranger = await makeUser()
			const session = await makeSession(owner.id)
			const theirs = await trayItem(stranger.id, (await makeSession(stranger.id)).id)
			const mine = await trayItem(owner.id, session.id)
			const { TRAY_ITEM_GONE } = await import("./tray")
			const { TRAY_ITEM_STILL_UPLOADING } = await import("./send")

			for (const trayItemIds of [[mine.id, theirs.id], ["not-an-id"], "x"]) {
				const { res } = await send(owner.id, {
					sessionId: session.id,
					content: "hi",
					trayItemIds
				})
				expect(res.error).toBe(TRAY_ITEM_GONE)
				expect(res.sessionId).toBe(session.id)
			}
			const uploading = await trayItem(owner.id, session.id, {
				status: "uploading"
			})
			const { res } = await send(owner.id, {
				sessionId: session.id,
				content: "hi",
				trayItemIds: [mine.id, uploading.id]
			})
			expect(res.error).toBe(TRAY_ITEM_STILL_UPLOADING)
			expect(await messageCount(session.id)).toBe(0)
			expect(await trayRows(owner.id, session.id)).toHaveLength(2)
			// The stranger's tray is untouched.
			const [still] = await db
				.select()
				.from(schema.trayItems)
				.where(eq(schema.trayItems.id, theirs.id))
			expect(still).toBeTruthy()
		},
		T
	)

	test(
		"a guest sends their own attachments, never the owner's",
		async () => {
			const owner = await makeUser()
			const guest = await makeUser()
			const session = await makeSession(owner.id)
			await addGuest(session.id, guest.id)
			const ownersItem = await trayItem(owner.id, session.id)
			const guestsItem = await trayItem(guest.id, session.id)
			const { TRAY_ITEM_GONE } = await import("./tray")

			const refused = await send(guest.id, {
				sessionId: session.id,
				content: "mine now",
				trayItemIds: [ownersItem.id]
			})
			expect(refused.res.error).toBe(TRAY_ITEM_GONE)

			const { res } = await send(guest.id, {
				sessionId: session.id,
				content: "from me",
				trayItemIds: [guestsItem.id]
			})
			expect(res.error).toBeUndefined()
			const parts = await partsOf(res.sessionMessage.id)
			expect(
				parts.find((p) => p.type === "core:image")?.data
			).toMatchObject({ assetId: guestsItem.fileId })
			expect(await trayRows(owner.id, session.id)).toHaveLength(1)
		},
		T
	)
})

describe("access through a message part", () => {
	test(
		"a guest sees a deduped avatar once a message part shows it; a stranger never does; a run may send it",
		async () => {
			const owner = await makeUser()
			const guest = await makeUser()
			const stranger = await makeUser()
			const session = await makeSession(owner.id)
			await addGuest(session.id, guest.id)
			const [card] = await db
				.insert(schema.characters)
				.values({ userId: owner.id, name: "Private card", description: "" })
				.returning()
			const { createMedia, getMedia } = await import("$lib/server/media")
			const avatar = await createMedia(db as any, {
				userId: owner.id,
				characterId: card.id,
				bytes: png(777)
			})
			const { canViewMedia } = await import("$lib/server/media/access")
			const { resolveAttachments } = await import(
				"$lib/server/pipelines/runtime/dispatch"
			)
			const file = () => getMedia(db as any, avatar.file.id).then((f) => f!)

			// Before: the card is the owner's own, not shared with the guest.
			expect(await canViewMedia(await file(), guest.id, db as any)).toBe(false)
			await expect(
				resolveAttachments(db as any, [avatar.file.uuid], {
					sessionId: session.id,
					userId: guest.id
				})
			).rejects.toThrow(/belongs to neither/)

			const item = await trayItem(owner.id, session.id, {
				fileId: avatar.file.id
			})
			const { res } = await send(owner.id, {
				sessionId: session.id,
				content: "Her portrait",
				trayItemIds: [item.id]
			})
			expect(res.error).toBeUndefined()

			expect(await canViewMedia(await file(), guest.id, db as any)).toBe(true)
			expect(await canViewMedia(await file(), stranger.id, db as any)).toBe(false)
			const inputs = await resolveAttachments(db as any, [avatar.file.uuid], {
				sessionId: session.id,
				userId: guest.id
			})
			expect(inputs).toHaveLength(1)
			// Another session's run is still refused.
			const elsewhere = await makeSession(stranger.id)
			await expect(
				resolveAttachments(db as any, [avatar.file.uuid], {
					sessionId: elsewhere.id,
					userId: stranger.id
				})
			).rejects.toThrow(/belongs to neither/)
		},
		T
	)
})

describe("branching", () => {
	test(
		"a branch carries the attachment parts, pointing at the same file",
		async () => {
			const owner = await makeUser()
			const session = await makeSession(owner.id)
			const item = await trayItem(owner.id, session.id)
			const { res } = await send(owner.id, {
				sessionId: session.id,
				content: "Before the fork",
				trayItemIds: [item.id]
			})
			const sourceParts = (await partsOf(res.sessionMessage.id)).filter(
				(p) => p.type === "core:image"
			)
			const { branchSession } = await import("$lib/server/sessions/branch")
			const branch = await branchSession(db as any, {
				sessionId: session.id,
				fromMessageId: res.sessionMessage.id
			})
			const [copy] = await db
				.select()
				.from(schema.messages)
				.where(eq(schema.messages.sessionId, branch.id))
			const copyParts = (await partsOf(copy.id)).filter(
				(p) => p.type === "core:image"
			)
			expect(copyParts).toHaveLength(1)
			expect(copyParts[0]).toMatchObject({
				step: sourceParts[0].step,
				revision: sourceParts[0].revision,
				ordinal: sourceParts[0].ordinal,
				data: sourceParts[0].data
			})
			const { isFileReferencedInSession } = await import("./references")
			expect(
				await isFileReferencedInSession(db as any, item.fileId!, branch.id)
			).toBe(true)
		},
		T
	)
})

describe("remove only (D9)", () => {
	test(
		"only someone who may edit the message removes an attachment; the file stays",
		async () => {
			const owner = await makeUser()
			const guest = await makeUser()
			const session = await makeSession(owner.id)
			await addGuest(session.id, guest.id)
			const item = await trayItem(owner.id, session.id)
			const { res } = await send(owner.id, {
				sessionId: session.id,
				content: "A picture",
				trayItemIds: [item.id]
			})
			const part = (await partsOf(res.sessionMessage.id)).find(
				(p) => p.type === "core:image"
			)!
			const { attachmentsRemoveFromMessage } = await import(
				"$lib/server/sockets/attachments"
			)
			const { MESSAGE_ACTION_REFUSAL } = await import(
				"$lib/server/messages/permissions"
			)

			// The guest is not the line's author.
			const asGuest = recorder()
			await attachmentsRemoveFromMessage.handler(
				fakeSocket(guest.id),
				{ messageId: res.sessionMessage.id, partId: part.id },
				asGuest.emit
			)
			expect(asGuest.sent).toHaveLength(1)
			expect(asGuest.sent[0].event).toBe("attachments:removeFromMessage:error")
			expect(asGuest.sent[0].data.error).toBe(MESSAGE_ACTION_REFUSAL)
			expect(await partsOf(res.sessionMessage.id)).toContainEqual(part)

			// Not an attachment part (the body): refused with the gone sentence.
			const body = (await partsOf(res.sessionMessage.id)).find(
				(p) => p.type === "core:markdown"
			)
			const { ATTACHMENT_PART_GONE } = await import("./remove")
			if (body) {
				const wrong = recorder()
				await attachmentsRemoveFromMessage.handler(
					fakeSocket(owner.id),
					{ messageId: res.sessionMessage.id, partId: body.id },
					wrong.emit
				)
				expect(wrong.sent[0].data).toMatchObject({
					error: ATTACHMENT_PART_GONE,
					sessionId: session.id
				})
			}

			const asOwner = recorder()
			await attachmentsRemoveFromMessage.handler(
				fakeSocket(owner.id),
				{ messageId: res.sessionMessage.id, partId: part.id },
				asOwner.emit
			)
			expect(asOwner.sent[0]).toEqual({
				event: "attachments:removeFromMessage",
				data: {
					sessionId: session.id,
					messageId: res.sessionMessage.id,
					partId: part.id
				}
			})
			const left = await partsOf(res.sessionMessage.id)
			expect(left.find((p) => p.id === part.id)).toBeUndefined()
			// The text survives; the file stays (no-cascade).
			const { getMedia } = await import("$lib/server/media")
			expect(await getMedia(db as any, item.fileId!)).toBeTruthy()

			// A second remove: the part is gone, and the reply says so.
			const again = recorder()
			await attachmentsRemoveFromMessage.handler(
				fakeSocket(owner.id),
				{ messageId: res.sessionMessage.id, partId: part.id },
				again.emit
			)
			expect(again.sent[0].data).toMatchObject({
				error: ATTACHMENT_PART_GONE,
				sessionId: session.id
			})
		},
		T
	)
})
