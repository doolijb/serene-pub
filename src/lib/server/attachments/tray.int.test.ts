/**
 * The tray store (PLAN-composer-attachments phase 1, lane A).
 *
 * The cases the plan names fail-first: finish dedupes and records `fresh =
 * false` on a hit; the sweep deletes only a fresh, unreferenced file; a
 * deduped avatar survives it; the TTL; the per-person and server ceilings;
 * and the asset expression index existing in PGlite at all.
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
import { eq, sql } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { ATTACHMENT_CAPS } from "$lib/shared/attachments/caps"
import {
	TRAY_ITEM_GONE,
	TRAY_LIMITS,
	TRAY_UPLOAD_INTERRUPTED,
	__resetTrayMemoryForTests,
	appendTrayChunk,
	beginTrayUpload,
	finishTrayUpload,
	isFileReferenced,
	listTray,
	removeTrayItem,
	sweepTray
} from "./tray"

const T = 60_000
const MiB = 1024 * 1024

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-tray-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, T)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => __resetTrayMemoryForTests())

let seq = 0
async function makeUserAndSession() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `tray-user-${++seq}`)
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	return { user, session }
}

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(seed % 256)
	img.data[0] = Math.floor(seed / 256) % 256
	return PNG.sync.write(img)
}

/** A whole upload through begin → chunks → finish. */
async function upload(
	userId: number,
	sessionId: number,
	bytes: Buffer,
	filename = "file.png"
) {
	const { trayItemId, chunkBytes } = await beginTrayUpload(db as any, {
		userId,
		sessionId,
		filename,
		bytes: bytes.length,
		head: bytes.subarray(0, ATTACHMENT_CAPS.headBytes)
	})
	for (let i = 0, index = 0; i < bytes.length; i += chunkBytes, index++)
		await appendTrayChunk(db as any, userId, {
			trayItemId,
			index,
			data: bytes.subarray(i, i + chunkBytes)
		})
	return finishTrayUpload(db as any, userId, trayItemId)
}

async function rowOf(id: string) {
	return db.query.trayItems.findFirst({ where: eq(schema.trayItems.id, id) })
}

async function fileExists(fileId: number) {
	return !!(await db.query.files.findFirst({
		where: eq(schema.files.id, fileId)
	}))
}

/** A declared-only begin: a head that sniffs as `kind`, no body sent. */
function headFor(kind: "png" | "pdf", bytes: number): Buffer {
	const head = Buffer.alloc(Math.min(bytes, ATTACHMENT_CAPS.headBytes), 0x20)
	if (kind === "png") png(1).copy(head)
	else Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1").copy(head)
	return head
}

describe("tray store (PGlite integration)", () => {
	test(
		"the asset expression index exists in PGlite",
		async () => {
			const res: any = await db.execute(
				sql`select indexdef from pg_indexes where indexname = 'message_parts_asset_idx'`
			)
			const rows = res.rows ?? res
			expect(rows).toHaveLength(1)
			expect(String(rows[0].indexdef)).toMatch(/assetId/)
			expect(String(rows[0].indexdef)).toMatch(/WHERE/)
		},
		T
	)

	test(
		"a finished upload is ready, fresh, and stored under the session's directory",
		async () => {
			const { user, session } = await makeUserAndSession()
			const item = await upload(user.id, session.id, png(7))
			expect(item.status).toBe("ready")
			expect(item.attachmentKind).toBe("image")
			expect(item.file?.thumbUrl).toMatch(/v=thumb/)
			const row = await rowOf(item.id)
			expect(row?.fresh).toBe(true)
			const variant = await db.query.variants.findFirst({
				where: eq(schema.variants.fileId, row!.fileId!)
			})
			expect(variant!.path).toContain(
				path.join("data", "users", String(user.id), "sessions", String(session.id))
			)
			expect(variant!.path).not.toContain(os.tmpdir())
		},
		T
	)

	test(
		"finish dedupes and records fresh = false on a hit",
		async () => {
			const { user, session } = await makeUserAndSession()
			const [character] = await db
				.insert(schema.characters)
				.values({ userId: user.id, name: "C", description: "" })
				.returning()
			const { createMedia } = await import("$lib/server/media")
			const bytes = png(11)
			const avatar = await createMedia(db as any, {
				userId: user.id,
				characterId: character.id,
				bytes
			})
			const item = await upload(user.id, session.id, bytes)
			const row = await rowOf(item.id)
			expect(row?.fileId).toBe(avatar.file.id)
			expect(row?.fresh).toBe(false)
		},
		T
	)

	test(
		"the sweep deletes only a fresh, unreferenced file — and keeps a deduped avatar",
		async () => {
			const { user, session } = await makeUserAndSession()
			const [character] = await db
				.insert(schema.characters)
				.values({ userId: user.id, name: "C", description: "" })
				.returning()
			const { createMedia } = await import("$lib/server/media")
			const avatarBytes = png(21)
			const avatar = await createMedia(db as any, {
				userId: user.id,
				characterId: character.id,
				bytes: avatarBytes
			})
			await db
				.update(schema.characters)
				.set({ avatarMediaId: avatar.file.id })
				.where(eq(schema.characters.id, character.id))

			const lonely = await upload(user.id, session.id, png(22))
			const referenced = await upload(user.id, session.id, png(23))
			const deduped = await upload(user.id, session.id, avatarBytes)

			// A message part names `referenced`'s file.
			const [message] = await db
				.insert(schema.messages)
				.values({ sessionId: session.id, role: "user" } as any)
				.returning()
			await db.insert(schema.messageParts).values({
				messageId: message.id,
				ordinal: 10,
				type: "core:image",
				data: { assetId: referenced.file!.id }
			})

			// Young items survive.
			const young = await sweepTray(db as any, Date.now())
			expect(young.expired).toBe(0)
			expect(await rowOf(lonely.id)).toBeTruthy()

			// A day later every one of them expires; only the lonely file goes.
			const later = Date.now() + TRAY_LIMITS.ttlMs + 1000
			const swept = await sweepTray(db as any, later)
			expect(swept.expired).toBeGreaterThanOrEqual(3)
			expect(await rowOf(lonely.id)).toBeUndefined()
			expect(await fileExists(lonely.file!.id)).toBe(false)
			expect(await fileExists(referenced.file!.id)).toBe(true)
			expect(await fileExists(deduped.file!.id)).toBe(true)
			expect(deduped.file!.id).toBe(avatar.file.id)
		},
		T
	)

	test(
		"remove deletes a fresh file only when no other tray item shares it",
		async () => {
			const { user, session } = await makeUserAndSession()
			const bytes = png(31)
			const first = await upload(user.id, session.id, bytes)
			const second = await upload(user.id, session.id, bytes)
			expect(second.file!.id).toBe(first.file!.id)
			expect((await rowOf(second.id))?.fresh).toBe(false)

			await removeTrayItem(db as any, user.id, first.id)
			expect(await fileExists(first.file!.id)).toBe(true)
			expect(
				await isFileReferenced(db as any, first.file!.id)
			).toBe(true)
			await removeTrayItem(db as any, user.id, second.id)
			// `second` was a dedupe hit, so its removal never deletes.
			expect(await fileExists(first.file!.id)).toBe(true)

			const third = await upload(user.id, session.id, png(32))
			await removeTrayItem(db as any, user.id, third.id)
			expect(await fileExists(third.file!.id)).toBe(false)
		},
		T
	)

	test(
		"someone else's tray item is the gone sentence, whatever the verb",
		async () => {
			const a = await makeUserAndSession()
			const b = await makeUserAndSession()
			const item = await upload(a.user.id, a.session.id, png(41))
			await expect(
				removeTrayItem(db as any, b.user.id, item.id)
			).rejects.toThrow(TRAY_ITEM_GONE)
			const { trayItemId } = await beginTrayUpload(db as any, {
				userId: a.user.id,
				sessionId: a.session.id,
				filename: "x.png",
				bytes: png(42).length,
				head: png(42)
			})
			await expect(
				appendTrayChunk(db as any, b.user.id, {
					trayItemId,
					index: 0,
					data: png(42)
				})
			).rejects.toThrow(TRAY_ITEM_GONE)
			await expect(
				finishTrayUpload(db as any, b.user.id, trayItemId)
			).rejects.toThrow(TRAY_ITEM_GONE)
			expect(await listTray(db as any, b.user.id, a.session.id)).toEqual([])
		},
		T
	)

	test(
		"an uploading row with no live upload reads as interrupted, and the sweep marks it",
		async () => {
			const { user, session } = await makeUserAndSession()
			const { trayItemId } = await beginTrayUpload(db as any, {
				userId: user.id,
				sessionId: session.id,
				filename: "x.png",
				bytes: png(51).length,
				head: png(51)
			})
			__resetTrayMemoryForTests() // a restart
			const [view] = await listTray(db as any, user.id, session.id)
			expect(view.status).toBe("refused")
			expect(view.refusal).toBe(TRAY_UPLOAD_INTERRUPTED)
			await sweepTray(db as any)
			expect((await rowOf(trayItemId))?.status).toBe("refused")
		},
		T
	)

	test(
		"an idle upload is dropped by the sweep",
		async () => {
			const { user, session } = await makeUserAndSession()
			const now = Date.now()
			const { trayItemId } = await beginTrayUpload(
				db as any,
				{
					userId: user.id,
					sessionId: session.id,
					filename: "x.png",
					bytes: png(52).length,
					head: png(52)
				},
				now
			)
			const res = await sweepTray(db as any, now + TRAY_LIMITS.idleUploadMs + 1)
			expect(res.idle).toBe(1)
			await expect(
				finishTrayUpload(db as any, user.id, trayItemId)
			).rejects.toThrow(TRAY_ITEM_GONE)
		},
		T
	)

	test(
		"per-person ceilings: two uploads at once, ten files a tray, twenty begins a minute",
		async () => {
			const { user, session } = await makeUserAndSession()
			const begin = (bytes: number, now?: number) =>
				beginTrayUpload(
					db as any,
					{
						userId: user.id,
						sessionId: session.id,
						filename: "a.png",
						bytes,
						head: headFor("png", bytes)
					},
					now
				)
			const one = await begin(2 * MiB)
			await begin(2 * MiB)
			await expect(begin(2 * MiB)).rejects.toThrow(/other uploads/)
			await removeTrayItem(db as any, user.id, one.trayItemId)

			// Ten files a tray (ready items count; refused ones do not).
			__resetTrayMemoryForTests()
			const { session: s2 } = await makeUserAndSession()
			const user2 = (await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, s2.id)
			}))!.userId
			for (let i = 0; i < 10; i++) await upload(user2, s2.id, png(100 + i))
			await expect(upload(user2, s2.id, png(120))).rejects.toThrow(
				/at most 10 files/
			)

			// Twenty begins a minute.
			__resetTrayMemoryForTests()
			const t0 = Date.now()
			for (let i = 0; i < TRAY_LIMITS.beginsPerMinute; i++) {
				const b = await begin(1000, t0)
				await removeTrayItem(db as any, user.id, b.trayItemId)
			}
			await expect(begin(1000, t0)).rejects.toThrow(/Too many/)
			// A minute on, the window has moved.
			const b = await begin(1000, t0 + 61_000)
			await removeTrayItem(db as any, user.id, b.trayItemId)
		},
		T
	)

	test(
		"the server's ceiling: whoever holds the most gives way first",
		async () => {
			const pdf = 32 * MiB
			const people = await Promise.all(
				[0, 1, 2, 3, 4].map(() => makeUserAndSession())
			)
			const held: string[][] = []
			for (const p of people.slice(0, 4)) {
				const ids: string[] = []
				for (let i = 0; i < 2; i++)
					ids.push(
						(
							await beginTrayUpload(db as any, {
								userId: p.user.id,
								sessionId: p.session.id,
								filename: "a.pdf",
								bytes: pdf,
								head: headFor("pdf", pdf)
							})
						).trayItemId
					)
				held.push(ids)
			}
			// 4 × 2 × 32 MiB = the 256 MiB ceiling exactly; a fifth person's
			// begin evicts the oldest upload of the first of the heaviest.
			const fifth = people[4]
			await beginTrayUpload(db as any, {
				userId: fifth.user.id,
				sessionId: fifth.session.id,
				filename: "b.pdf",
				bytes: pdf,
				head: headFor("pdf", pdf)
			})
			const evicted = await rowOf(held[0][0])
			expect(evicted?.status).toBe("refused")
			expect(evicted?.refusal).toMatch(/too busy/)
			expect((await rowOf(held[1][0]))?.status).toBe("uploading")
		},
		T
	)

	test(
		"a text file whose head ends mid-character is still text",
		async () => {
			const { user, session } = await makeUserAndSession()
			// "é" is two bytes; place one across the 4100-byte head boundary,
			// and another across the store's 8192-byte text sample.
			const text = Buffer.concat([
				Buffer.alloc(ATTACHMENT_CAPS.headBytes - 1, "a"),
				Buffer.from("é", "utf-8"),
				Buffer.alloc(8192 - ATTACHMENT_CAPS.headBytes - 2, "b"),
				Buffer.from("é and more text\n", "utf-8")
			])
			expect(text[8191]).toBe(0xc3)
			const item = await upload(user.id, session.id, text, "notes.md")
			expect(item.status).toBe("ready")
			expect(item.attachmentKind).toBe("text")
			expect(item.mime).toBe("text/markdown")
		},
		T
	)

	test(
		"SVG stays refused though it sniffs as text; markdown quoting SVG is text",
		async () => {
			const { user, session } = await makeUserAndSession()
			const begin = (text: string, filename: string) => {
				const bytes = Buffer.from(text)
				return beginTrayUpload(db as any, {
					userId: user.id,
					sessionId: session.id,
					filename,
					bytes: bytes.length,
					head: bytes
				})
			}
			await expect(
				begin(
					'<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
					"drawing.txt"
				)
			).rejects.toThrow(/can't be attached/)
			await expect(begin("just words", "drawing.svg")).rejects.toThrow(
				/can't be attached/
			)
			const ok = await begin("# Icons\n\nUse `<svg>` inline.\n", "notes.md")
			await removeTrayItem(db as any, user.id, ok.trayItemId)
		},
		T
	)

	test(
		"a body that is not what its head claimed is refused at finish and stays in the tray",
		async () => {
			const { user, session } = await makeUserAndSession()
			const real = png(61)
			const svg = Buffer.from(
				`<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(real.length)}</svg>`
			).subarray(0, real.length)
			const { trayItemId } = await beginTrayUpload(db as any, {
				userId: user.id,
				sessionId: session.id,
				filename: "a.png",
				bytes: real.length,
				head: real
			})
			// Every chunk but the head's: the head only previews, the chunks
			// are the file.
			await appendTrayChunk(db as any, user.id, {
				trayItemId,
				index: 0,
				data: Buffer.concat([Buffer.from([0x00]), svg]).subarray(0, real.length)
			})
			const item = await finishTrayUpload(db as any, user.id, trayItemId)
			expect(item.status).toBe("refused")
			expect(item.refusal).toMatch(/can't be attached/)
			expect(item.file).toBeNull()
		},
		T
	)

	test(
		"a PNG's text chunks do not reach the store",
		async () => {
			const { user, session } = await makeUserAndSession()
			const zlib = await import("node:zlib")
			const clean = png(71)
			const data = Buffer.from("Comment\0GPS 51.5 -0.1", "latin1")
			const len = Buffer.alloc(4)
			len.writeUInt32BE(data.length)
			const type = Buffer.from("tEXt", "latin1")
			const crc = Buffer.alloc(4)
			crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0)
			const tagged = Buffer.concat([
				clean.subarray(0, 33),
				len,
				type,
				data,
				crc,
				clean.subarray(33)
			])
			const item = await upload(user.id, session.id, tagged)
			expect(item.status).toBe("ready")
			const variant = await db.query.variants.findFirst({
				where: eq(schema.variants.fileId, item.file!.id)
			})
			const { resolveMediaPath } = await import("$lib/server/media")
			const stored = await fs.readFile(resolveMediaPath(variant!.path))
			expect(stored.includes(Buffer.from("tEXt"))).toBe(false)
			expect(stored.equals(clean)).toBe(true)
		},
		T
	)
})
