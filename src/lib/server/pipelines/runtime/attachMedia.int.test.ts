/**
 * `attach-image` after `create-message`, end to end (plans/29 R-2, 2026-09-17).
 *
 * The host's commit for the two attach outlets existed and no binding reached
 * it, so a spec placing one halted on "no binding registered". Bound now, and
 * given the `target` in-port `update-message` takes: fed from the write that
 * created the row, the two are one primary row (F7, R-17), and the part lands
 * on the message the same run wrote. Real rows, the suite's fake asset store.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { spec, compile, run, validate } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

/** Every asset the fake store created, in order. */
const created: Array<Record<string, unknown>> = []
vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: unknown, input: { userId: number; sessionId?: number; bytes: Buffer }) => {
		const file = {
			id: 100 + created.length,
			uuid: `uuid-${created.length}`,
			rev: 0,
			userId: input.userId,
			sessionId: input.sessionId ?? null,
			kind: "image",
			displayMime: "image/webp",
			displayBytes: 111,
			width: 1,
			height: 1
		}
		const original = {
			id: 900 + created.length,
			fileId: file.id,
			variant: "original",
			mime: "image/png",
			bytes: input.bytes.length,
			isOriginal: true
		}
		created.push(file)
		return { file, original }
	},
	mediaUrl: (uuid: string, rev: number) => `/media/${uuid}?r=${rev}`
}))

let db: TestDb
let sessionId: number
let userId: number

/** A 1x1 PNG. */
const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

/**
 * The chain, with the image handed in as `image` — bytes (the base64 path) or
 * a reference to a stored file (the uuid path) — and an `update-message`
 * chained off the attach's own write result, so the ruling that its `id` is
 * the MESSAGE row on both paths is exercised where it matters: `target:
 * $.attach.main` must resolve the message, never the asset.
 */
const createAttachUpdate = (slug: string, image: Record<string, unknown>) =>
	compile(
		spec(slug, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
			// The row is the one `save` created; the image is a literal
			// payload here, as a caller outside the graph would hand one in.
			.outlet("attach", ($) => C.attachImage.v1({ target: $.save.main, image }))
			.outlet("caption", ($) =>
				C.updateMessage.v1({ target: $.attach.main, text: "captioned" })
			)
			.build()
	)

const createThenAttach = () =>
	createAttachUpdate("test.u6:spec/attach", { data: PNG_B64, mime: "image/png", alt: "a dot" })

const runIt = async (doc: ReturnType<typeof compile>) => {
	const saved = await saveDocument(db, doc, { publish: true })
	const loaded = await loadDocument(db, saved.specVersionId)
	return run(loaded, {
		input: { text: "a picture follows", sessionScope: { sessionId } },
		seed: "seed:attach",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		// `attach-image` defaults review ON (F14); approved as-is.
		reviewer: async () => ({ action: "approve", by: "test", at: 1 })
	})
}

/** The write-result ids a node published, as the next node reads them. */
const idsOf = (receipt: Awaited<ReturnType<typeof run>>, nodeKey: string) =>
	(receipt.nodes.find((n) => n.nodeKey === nodeKey)!.output as {
		ids: Record<string, unknown>
	}).ids

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "attach-test", isAdmin: false })
		.returning()
	userId = user.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

describe("attach-image after create-message", () => {
	it("validates as one primary row — the attach targets the write before it", () => {
		expect(validate(createThenAttach()).filter((f) => f.severity === "error")).toEqual([])
	})

	it("appends the image part to the message the run created (bytes), and its id is the message", async () => {
		const receipt = await runIt(createThenAttach())
		expect(receipt.outcome, receipt.haltReason).toBe("ok")

		const attach = receipt.nodes.find((n) => n.nodeKey === "attach")!
		expect(attach.result).toBe("ok")
		const messageId = idsOf(receipt, "save").id as number
		expect(typeof messageId).toBe("number")

		// The write-result's `id` is the MESSAGE row; the asset rides under
		// its own key — so a node chained off `$.attach.main` reaches the
		// message, which `caption` proves by updating it.
		expect(idsOf(receipt, "attach").id).toBe(messageId)
		expect(idsOf(receipt, "attach").assetId).toBe(created[0]!.id)
		expect(idsOf(receipt, "caption").id).toBe(messageId)
		const [row] = await db
			.select({ content: schema.sessionMessages.content })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
		expect(row?.content).toBe("captioned")

		// The part is on that row, addressing the stored asset.
		const parts = await db
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, messageId))
		const image = parts.find((p) => p.type === "core:image")
		expect(image, "no core:image part on the message").toBeTruthy()
		expect((image!.data as { assetId: number; alt?: string }).assetId).toBe(
			created[0]!.id
		)
		expect((image!.data as { alt?: string }).alt).toBe("a dot")
		expect(created[0]!.sessionId).toBe(sessionId)
	}, 60_000)

	it("attaches a stored file by reference (uuid), and its id is the message there too", async () => {
		// A file this session owns, as the render path stores one: the
		// reference path reads the FILE row by uuid, never the fake store.
		const [file] = await db
			.insert(schema.files)
			.values({
				userId,
				sessionId,
				kind: "image",
				hash: "u6-attach-ref",
				displayMime: "image/webp",
				displayBytes: 111
			})
			.returning({ id: schema.files.id, uuid: schema.files.uuid })
		const receipt = await runIt(
			createAttachUpdate("test.u6:spec/attach-ref", { uuid: file!.uuid, text: "by reference" })
		)
		expect(receipt.outcome, receipt.haltReason).toBe("ok")

		const messageId = idsOf(receipt, "save").id as number
		expect(idsOf(receipt, "attach").id).toBe(messageId)
		expect(idsOf(receipt, "attach").assetId).toBe(file!.id)
		expect(idsOf(receipt, "caption").id).toBe(messageId)

		const parts = await db
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, messageId))
		const image = parts.find((p) => p.type === "core:image")
		expect((image?.data as { assetId?: number; alt?: string })?.assetId).toBe(file!.id)
		expect((image?.data as { alt?: string })?.alt).toBe("by reference")
	}, 60_000)
})
