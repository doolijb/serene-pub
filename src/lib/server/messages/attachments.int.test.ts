import { describe, it, expect, beforeAll } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { getAppDataDir } from "$lib/server/db/drizzle.config"
import { insertLegacy, getMessage, updateLegacy, messageText } from "./store"
import { createSessionAsset, readSessionAsset } from "./assets"
import { createHost } from "$lib/server/pipelines/runtime/host"

/**
 * Attachments (20 §1): bytes into the session's hash-addressed asset store, a
 * typed part onto the message, through the same consumer contract the review
 * gate sees — and surviving the legacy mirror like every native part.
 */

let db: TestDb
let sessionId: number
let otherSessionId: number

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "attach-user")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session.id
	const [other] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	otherSessionId = other.id
}, 60_000)

describe("the asset store", () => {
	it("hash-addresses, dedupes within a session, and reads back", async () => {
		const a = await createSessionAsset(db, {
			sessionId,
			bytes: PNG,
			mime: "image/png"
		})
		const b = await createSessionAsset(db, {
			sessionId,
			bytes: PNG,
			mime: "image/png"
		})
		expect(b.id).toBe(a.id) // same bytes, same session → one row
		expect(a.bytes).toBe(PNG.byteLength)
		// Since 28 a session asset is a media row and lives in the shared
		// layout — under the session it belongs to (28 §8 rule 1), not in a
		// separate session_assets/ tree.
		expect(a.path).toMatch(
			new RegExp(`^data/users/\\d+/sessions/${sessionId}/`)
		)

		const read = await readSessionAsset(db, a.id)
		expect(read).toBeTruthy()
		expect(Buffer.compare(read!.bytes, PNG)).toBe(0)

		// The file really is jailed under the data dir.
		const abs = path.resolve(getAppDataDir(), a.path)
		await fs.access(abs)
	})
})

describe("the attach-image consumer", () => {
	it("writes the asset, appends a core:image part, and survives the mirror", async () => {
		const msg = await insertLegacy(db, {
			sessionId,
			role: "assistant",
			content: "Behold the map."
		})
		const host = createHost(db as any, { sessionId })
		const result: any = await host.commit!(
			{
				image: {
					messageId: msg.id,
					data: PNG.toString("base64"),
					mime: "image/png",
					alt: "the map"
				}
			},
			{ key: "attach", typeId: "core:consumer/attach-image" } as any
		)
		expect(result.messageId).toBe(msg.id)

		const after = (await getMessage(db, msg.id))!
		const image = after.parts.find((p) => p.type === "core:image")
		expect(image).toBeTruthy()
		expect((image!.data as any).assetId).toBe(result.id)
		expect((image!.data as any).alt).toBe("the map")
		// Native ordinal — the armistice address space.
		expect(image!.ordinal).toBeGreaterThanOrEqual(10)
		// The default projection is unchanged: attachments are not prompt text.
		expect(messageText(after)).toBe("Behold the map.")

		// A later legacy edit re-mirrors the body and spares the attachment.
		await updateLegacy(db, msg.id, { content: "Behold the OTHER map." })
		const again = (await getMessage(db, msg.id))!
		expect(again.parts.some((p) => p.type === "core:image")).toBe(true)
		expect(messageText(again)).toBe("Behold the OTHER map.")
	})

	it("refuses to attach across the run's session scope", async () => {
		const foreign = await insertLegacy(db, {
			sessionId: otherSessionId,
			role: "assistant",
			content: "elsewhere"
		})
		const host = createHost(db as any, { sessionId })
		await expect(
			host.commit!(
				{
					image: {
						messageId: foreign.id,
						data: PNG.toString("base64"),
						mime: "image/png"
					}
				},
				{
					key: "attach",
					typeId: "core:consumer/attach-image"
				} as any
			)
		).rejects.toThrow(/scoped/)
	})
})
