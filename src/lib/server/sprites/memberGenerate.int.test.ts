/**
 * 🚧 The card actions on a CAST MEMBER (ruling ★7, 2026-11-08): sprite fill,
 * portrait and the two outlets run on `{ castMemberId }` beside a card's
 * `{ characterId }`. The pictures are the member's — its sprite set, its
 * gallery (`cast_member_files`) — and the book owner's files with the book as
 * provenance; whoever may edit the member's lorebook may run them, and no one
 * else (a share recipient reads; an administrator who cannot edit the book is
 * refused; an outsider gets "Cast member not found.").
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let nextPicture = 1
function picture(): string {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(200)
	img.data[0] = nextPicture % 256
	img.data[1] = Math.floor(nextPicture / 256) % 256
	img.data[3] = 0
	nextPicture++
	return PNG.sync.write(img).toString("base64")
}

class FakeImageAdapter {
	constructor(public connection: any) {}
	async generateImage() {
		return {
			media: [{ kind: "image", mime: "image/png", base64: picture() }],
			isAborted: false,
			applied: ["seed"],
			ignored: []
		}
	}
}
vi.mock("$lib/server/utils/getImageAdapter", async () => {
	const { A1111_SHEET } = await import(
		"$lib/server/imageAdapters/A1111Adapter"
	)
	return {
		getImageAdapter: async () => ({
			Adapter: FakeImageAdapter,
			sheet: { ...A1111_SHEET, references: { max: 4 }, perCall: 1 }
		})
	}
})

let db: TestDb
let dataDir: string
let n = 0

const socket = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin } }) as any
const noop = () => {}

interface World {
	owner: any
	reader: any
	stranger: any
	admin: any
	host: any
	guest: any
	book: any
	member: any
	notesMember: any
	notesBook: any
	card: any
}

async function user(label: string, isAdmin = false) {
	const [u] = await db
		.insert(schema.users)
		.values({ username: `${label}-${++n}`, isAdmin })
		.returning()
	return u!
}

async function world(): Promise<World> {
	const owner = await user("owner")
	const reader = await user("reader")
	const stranger = await user("stranger")
	const admin = await user("admin", true)
	const host = await user("host")
	const guest = await user("guest")
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${n}` })
		.returning()
	await db
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id })
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const { member } = await insertCastMember(
		db as any,
		{
			lorebookId: book!.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		} as any
	)
	// A session's own notes: its host and guests edit them; the host's row owns the book.
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: host.id,
			isGroup: false,
			lorebookId: book!.id,
			genreId: "core:genre/story",
			presetId: null,
			genreFields: {}
		} as any)
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id } as any)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const notesBook = await ownBookFor(db as any, session!.id)
	const { member: notesMember } = await insertCastMember(
		db as any,
		{
			lorebookId: notesBook.id,
			binding: `{{char:${n + 900}}}`,
			name: "Echo"
		} as any
	)
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Card", description: "" } as any)
		.returning()
	return {
		owner,
		reader,
		stranger,
		admin,
		host,
		guest,
		book: book!,
		member,
		notesMember,
		notesBook,
		card: card!
	}
}

async function setOf(castMemberId: number) {
	const { ensureDefaultSpriteSet } = await import("$lib/server/sprites")
	return ensureDefaultSpriteSet(db, { castMemberId })
}

async function spritesOf(setId: number) {
	return db
		.select()
		.from(schema.sprites)
		.where(eq(schema.sprites.spriteSetId, setId))
}

async function fileRow(id: number) {
	const [f] = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, id))
	return f!
}

/** Run the portrait, approving the review card it parks on. */
async function runPortraitApproved(
	req: Record<string, unknown>,
	userId: number
) {
	const { runCardAction } = await import(
		"$lib/server/pipelines/runtime/cardAction"
	)
	const { pendingReviewsFor, resolveReview } = await import(
		"$lib/server/pipelines/runtime/reviewGate"
	)
	const running = runCardAction({
		db,
		specId: "core:spec/character-portrait",
		userId,
		fields: { count: 2 },
		...req
	} as any)
	const approve = (async () => {
		for (let i = 0; i < 400; i++) {
			const [card] = pendingReviewsFor(userId)
			if (card) {
				resolveReview(card.id, userId, "approve")
				return
			}
			await new Promise((r) => setTimeout(r, 25))
		}
	})()
	const receipt = await running
	await approve
	return receipt
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberGenerate-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Image",
			type: "a1111",
			baseUrl: "http://image",
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = (await ensureConnectionModel(
		db,
		conn!.id,
		"sdxl.safetensors"
	))!
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Image test",
			isImmutable: false,
			shape: "core:shape/image-gen@1",
			values: { steps: 4, width: 512, height: 512, seed: -1 },
			enabled: ["steps", "width", "height", "seed"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->image", {
		connectionId: conn!.id,
		connectionModelId: model.id,
		samplingConfigId: sampling!.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("a sprite fill on a cast member", () => {
	test("the pictures land in the member's set as the book owner's files, the book their provenance", async () => {
		const w = await world()
		const set = await setOf(w.member.id)
		const { addEmptySprites } = await import("$lib/server/sprites")
		await addEmptySprites(db, { castMemberId: w.member.id }, set.id, [
			"joy",
			"anger"
		])
		const cardSet = await (
			await import("$lib/server/sprites")
		).ensureDefaultSpriteSet(db, w.card.id)
		const { runCardAction } = await import(
			"$lib/server/pipelines/runtime/cardAction"
		)
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			castMemberId: w.member.id,
			userId: w.owner.id,
			fields: { setName: "default", labels: ["joy"] }
		})
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")
		const joy = (await spritesOf(set.id)).find((r) => r.label === "joy")!
		expect(joy.fileId).not.toBeNull()
		expect(joy.source).toBe("generated")
		expect(await spritesOf(cardSet.id)).toHaveLength(0)
		expect(await fileRow(joy.fileId!)).toMatchObject({
			userId: w.owner.id,
			lorebookId: w.book.id,
			characterId: null
		})
		// The outlet's output is the `sprites-attached` payload: the member, and no card.
		expect(receipt.emitted.map((e) => e.event)).toContain(
			"core:event/sprites-attached@1"
		)
		const attach = receipt.nodes.find((x) => x.nodeKey === "attach")
		expect((attach?.output as any)?.ids).toMatchObject({
			castMemberId: w.member.id,
			characterId: null
		})
	})

	test("a card's run carries castMemberId: null", async () => {
		const w = await world()
		const { addEmptySprites, ensureDefaultSpriteSet } = await import(
			"$lib/server/sprites"
		)
		const set = await ensureDefaultSpriteSet(db, w.card.id)
		await addEmptySprites(db, w.card.id, set.id, ["joy"])
		const { runCardAction } = await import(
			"$lib/server/pipelines/runtime/cardAction"
		)
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			characterId: w.card.id,
			userId: w.owner.id,
			fields: { setName: "default", labels: ["joy"] }
		})
		expect(receipt.outcome).toBe("ok")
		const attach = receipt.nodes.find((x) => x.nodeKey === "attach")
		expect((attach?.output as any)?.ids).toMatchObject({
			characterId: w.card.id,
			castMemberId: null
		})
	})

	test("a session's notes editor who is not the book owner leaves the book owner's copy", async () => {
		const w = await world()
		const set = await setOf(w.notesMember.id)
		const { addEmptySprites } = await import("$lib/server/sprites")
		await addEmptySprites(db, { castMemberId: w.notesMember.id }, set.id, [
			"joy"
		])
		const { runCardAction } = await import(
			"$lib/server/pipelines/runtime/cardAction"
		)
		const receipt = await runCardAction({
			db,
			specId: "core:spec/sprite-set-fill",
			castMemberId: w.notesMember.id,
			userId: w.guest.id,
			fields: { setName: "default", labels: ["joy"] }
		})
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")
		const joy = (await spritesOf(set.id)).find((r) => r.label === "joy")!
		expect(joy.fileId).not.toBeNull()
		const file = await fileRow(joy.fileId!)
		expect(file.userId).toBe(w.notesBook.userId)
		expect(file.userId).not.toBe(w.guest.id)
		expect(file.lorebookId).toBe(w.notesBook.id)
	})

	test("a share recipient and an admin who cannot edit the book are refused at the write", async () => {
		const w = await world()
		const set = await setOf(w.member.id)
		const { addEmptySprites } = await import("$lib/server/sprites")
		await addEmptySprites(db, { castMemberId: w.member.id }, set.id, [
			"joy"
		])
		const { runCardAction } = await import(
			"$lib/server/pipelines/runtime/cardAction"
		)
		for (const who of [w.reader, w.admin, w.stranger]) {
			const receipt = await runCardAction({
				db,
				specId: "core:spec/sprite-set-fill",
				castMemberId: w.member.id,
				userId: who.id,
				fields: { setName: "default", labels: ["joy"] }
			})
			expect(receipt.outcome).not.toBe("ok")
		}
		expect(
			(await spritesOf(set.id)).find((r) => r.label === "joy")!.fileId
		).toBeNull()
	})

	test("naming both or neither owner is refused; a missing member is named", async () => {
		const w = await world()
		const { runCardAction } = await import(
			"$lib/server/pipelines/runtime/cardAction"
		)
		const base = {
			db,
			specId: "core:spec/sprite-set-fill",
			userId: w.owner.id,
			fields: {}
		}
		await expect(
			runCardAction({
				...base,
				characterId: w.card.id,
				castMemberId: w.member.id
			})
		).rejects.toThrow("Name a character or a cast member, not both.")
		await expect(runCardAction(base)).rejects.toThrow(
			"Name a character or a cast member, not both."
		)
		await expect(
			runCardAction({ ...base, castMemberId: 999999 })
		).rejects.toThrow("That cast member no longer exists.")
	})

	test("the preview keys the owner and says the member has no likeness", async () => {
		const w = await world()
		const { previewSpriteFill } = await import("./fillAction")
		const set = await setOf(w.member.id)
		const { addEmptySprites } = await import("$lib/server/sprites")
		await addEmptySprites(db, { castMemberId: w.member.id }, set.id, [
			"joy"
		])
		const out = await previewSpriteFill(db, {
			castMemberId: w.member.id,
			userId: w.owner.id,
			isAdmin: false
		})
		expect(out.castMemberId).toBe(w.member.id)
		expect("characterId" in out).toBe(false)
		expect(out.labels).toEqual(["joy"])
		expect(out.notices).toContain(
			"This cast member has no likeness yet, so each picture is drawn from its sprite label alone."
		)
	})
})

describe("the attach-sprite and offer-media outlets on a member run", () => {
	test("a wired card id is refused with the sentence; unwired writes to the member", async () => {
		const w = await world()
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db, {
			userId: w.owner.id,
			cardActionCastMemberId: w.member.id
		} as any)
		for (const key of [
			"core:outlet/attach-sprite",
			"core:outlet/offer-media"
		]) {
			await expect(
				host.commit!(
					{ characterId: w.card.id, media: [] } as any,
					{
						key: "out",
						kind: "outlet",
						definitionId: key,
						definitionVersion: 1
					} as any
				)
			).rejects.toThrow(
				"out runs on a cast member — leave 'characterId' unwired; the pictures go to the member."
			)
		}
		// Nothing placed is no write, and it still names the member.
		const res: any = await host.commit!(
			{ characterId: null, media: [] } as any,
			{
				key: "out",
				kind: "outlet",
				definitionId: "core:outlet/offer-media",
				definitionVersion: 1
			} as any
		)
		expect(res).toMatchObject({
			written: false,
			characterId: null,
			castMemberId: w.member.id
		})
	})
})

describe("a portrait on a cast member", () => {
	test("the pictures are in the member's gallery as the book owner's files", async () => {
		const w = await world()
		const receipt = await runPortraitApproved(
			{ castMemberId: w.member.id },
			w.owner.id
		)
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")
		const links = await db
			.select()
			.from(schema.castMemberFiles)
			.where(eq(schema.castMemberFiles.castMemberId, w.member.id))
		expect(links).toHaveLength(2)
		for (const l of links)
			expect(await fileRow(l.fileId)).toMatchObject({
				userId: w.owner.id,
				lorebookId: w.book.id,
				characterId: null
			})
		const { CHARACTER_PORTRAIT_NODES } = await import(
			"@serene-pub/core-catalog"
		)
		const offer = receipt.nodes.find(
			(x) => x.nodeKey === CHARACTER_PORTRAIT_NODES.offer
		)
		expect((offer?.output as any)?.ids).toMatchObject({
			castMemberId: w.member.id,
			characterId: null
		})
		expect(receipt.emitted.map((e) => e.event)).toContain(
			"core:event/media-offered@1"
		)
	})

	test("a notes editor leaves the book owner's copies; a reader is refused", async () => {
		const w = await world()
		const receipt = await runPortraitApproved(
			{ castMemberId: w.notesMember.id },
			w.guest.id
		)
		expect(receipt.outcome, JSON.stringify(receipt.haltReason)).toBe("ok")
		const links = await db
			.select()
			.from(schema.castMemberFiles)
			.where(eq(schema.castMemberFiles.castMemberId, w.notesMember.id))
		expect(links).toHaveLength(2)
		for (const l of links) {
			const f = await fileRow(l.fileId)
			expect(f.userId).toBe(w.notesBook.userId)
			expect(f.lorebookId).toBe(w.notesBook.id)
		}
		const refused = await runPortraitApproved(
			{ castMemberId: w.member.id },
			w.reader.id
		)
		expect(refused.outcome).not.toBe("ok")
		expect(
			await db
				.select()
				.from(schema.castMemberFiles)
				.where(eq(schema.castMemberFiles.castMemberId, w.member.id))
		).toHaveLength(0)
	})

	test("a picture already in the member's gallery is offered as is; a stranger's picture is refused", async () => {
		const w = await world()
		const { createMedia, addToMemberGallery } = await import(
			"$lib/server/media"
		)
		const { offerMediaToGallery, OfferMediaRefusal } = await import(
			"$lib/server/characters/portrait"
		)
		const { file: mine } = await createMedia(db, {
			userId: w.owner.id,
			lorebookId: w.book.id,
			bytes: Buffer.from(picture(), "base64")
		})
		await addToMemberGallery(db, w.member.id, [mine.id])
		const ref = (f: any) => ({ uuid: f.uuid, kind: "image", key: "1" })
		const again = await offerMediaToGallery(db, {
			castMemberId: w.member.id,
			media: [ref(mine)],
			userId: w.owner.id
		})
		expect(again.offered).toEqual([{ mediaId: mine.id, key: "1" }])
		const { file: theirs } = await createMedia(db, {
			userId: w.stranger.id,
			bytes: Buffer.from(picture(), "base64")
		})
		await expect(
			offerMediaToGallery(db, {
				castMemberId: w.member.id,
				media: [ref(theirs)],
				userId: w.owner.id
			})
		).rejects.toThrow(OfferMediaRefusal)
		// The owner's own loose file is stamped with the book.
		const { file: loose } = await createMedia(db, {
			userId: w.owner.id,
			bytes: Buffer.from(picture(), "base64")
		})
		await offerMediaToGallery(db, {
			castMemberId: w.member.id,
			media: [ref(loose)],
			userId: w.owner.id
		})
		expect((await fileRow(loose.id)).lorebookId).toBe(w.book.id)
	})

	test("the preview keys the owner and refuses a member with no likeness (owner ruling 2026-11-08)", async () => {
		const w = await world()
		const { previewPortrait } = await import(
			"$lib/server/characters/portrait"
		)
		const out = await previewPortrait(db, {
			castMemberId: w.member.id,
			userId: w.owner.id,
			isAdmin: false
		})
		expect(out.castMemberId).toBe(w.member.id)
		expect("characterId" in out).toBe(false)
		expect(out.refusal).toBe(
			"Add a likeness first: this cast member has no likeness image or likeness line, so there is nothing to draw them from."
		)
		expect(out.calls).toBeNull()
	})
})

describe("the sockets on a cast member", () => {
	test("preview and fill reply with castMemberId only; refusals say what to do", async () => {
		const w = await world()
		const s = await import("../sockets/sprites")
		const set = await setOf(w.member.id)
		const { addEmptySprites } = await import("$lib/server/sprites")
		await addEmptySprites(db, { castMemberId: w.member.id }, set.id, [
			"joy"
		])
		const preview = await s.charactersPreviewSpriteFill.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(preview).toMatchObject({ castMemberId: w.member.id })
		expect("characterId" in preview).toBe(false)

		const emitted: [string, any][] = []
		const emit = (e: string, d: any) => emitted.push([e, d])
		const READ_ONLY =
			"Only someone who can edit this cast member's lorebook can change its sprites."
		// A share recipient (readable, not editable), an administrator, an outsider.
		await expect(
			s.charactersPreviewSpriteFill.handler(
				socket(w.reader.id),
				{ castMemberId: w.member.id },
				emit
			)
		).rejects.toThrow(READ_ONLY)
		expect(emitted.at(-1)).toEqual([
			"characters:previewSpriteFill:error",
			{ error: READ_ONLY, castMemberId: w.member.id }
		])
		await expect(
			s.charactersFillSprites.handler(
				socket(w.admin.id, true),
				{ castMemberId: w.member.id },
				noop
			)
		).rejects.toThrow()
		await expect(
			s.charactersFillSprites.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id },
				noop
			)
		).rejects.toThrow("Cast member not found.")
		await expect(
			s.charactersExpressSprite.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id, label: "joy" },
				noop
			)
		).rejects.toThrow("Cast member not found.")

		const both = "Name a character or a cast member, not both."
		for (const params of [
			{ castMemberId: w.member.id, characterId: w.card.id },
			{}
		] as any[]) {
			await expect(
				s.charactersPreviewSpriteFill.handler(
					socket(w.owner.id),
					params,
					noop
				)
			).rejects.toThrow(both)
			await expect(
				s.charactersFillSprites.handler(
					socket(w.owner.id),
					params,
					noop
				)
			).rejects.toThrow(both)
			await expect(
				s.charactersExpressSprite.handler(
					socket(w.owner.id),
					{ ...params, label: "joy" },
					noop
				)
			).rejects.toThrow(both)
		}

		// The owner's fill acks with the member's key and refreshes its list at the end.
		const pushed: [string, any][] = []
		const ack = await s.charactersFillSprites.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id, labels: ["joy"] },
			(e: string, d: any) => pushed.push([e, d])
		)
		expect(ack).toMatchObject({ castMemberId: w.member.id })
		expect("characterId" in ack).toBe(false)
		for (
			let i = 0;
			i < 200 && !pushed.some(([e]) => e === "characters:listSprites");
			i++
		)
			await new Promise((r) => setTimeout(r, 50))
		const progress = pushed.filter(([e]) => e === "characters:spriteFill")
		expect(progress.length).toBeGreaterThan(0)
		for (const [, p] of progress) {
			expect(p.castMemberId).toBe(w.member.id)
			expect("characterId" in p).toBe(false)
		}
		expect(progress.at(-1)![1].phase).toBe("done")
		const list = pushed.find(([e]) => e === "characters:listSprites")![1]
		expect(list.castMemberId).toBe(w.member.id)
		expect("characterId" in list).toBe(false)
		expect(
			(await spritesOf(set.id)).find((r) => r.label === "joy")!.fileId
		).not.toBeNull()
	})

	test("portrait preview and generate: member key only, editor only", async () => {
		const w = await world()
		// A likeness line on the member's own version: a portrait with none
		// is refused since 2026-11-08, and this test is about the owner key
		// and who may press, not about the refusal.
		await db
			.update(schema.characterVersions)
			.set({ likeness: { prompt: "red hair, green coat" } } as any)
			.where(eq(schema.characterVersions.castMemberId, w.member.id))
		const p = await import("../sockets/portrait")
		const preview = await p.charactersPreviewPortrait.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id },
			noop
		)
		expect(preview).toMatchObject({ castMemberId: w.member.id })
		expect("characterId" in preview).toBe(false)

		const READ_ONLY =
			"Only someone who can edit this cast member's lorebook can change its pictures."
		const emitted: [string, any][] = []
		await expect(
			p.charactersGeneratePortrait.handler(
				socket(w.reader.id),
				{ castMemberId: w.member.id },
				(e: string, d: any) => emitted.push([e, d])
			)
		).rejects.toThrow(READ_ONLY)
		expect(emitted).toEqual([
			[
				"characters:generatePortrait:error",
				{ error: READ_ONLY, castMemberId: w.member.id }
			]
		])
		await expect(
			p.charactersPreviewPortrait.handler(
				socket(w.stranger.id),
				{ castMemberId: w.member.id },
				noop
			)
		).rejects.toThrow("Cast member not found.")
		await expect(
			p.charactersGeneratePortrait.handler(
				socket(w.owner.id),
				{ castMemberId: w.member.id, characterId: w.card.id },
				noop
			)
		).rejects.toThrow("Name a character or a cast member, not both.")
		await expect(
			p.charactersPreviewPortrait.handler(socket(w.owner.id), {}, noop)
		).rejects.toThrow("Name a character or a cast member, not both.")

		// Start a run (it parks at review); the ack and every push carry the member only.
		const pushed: [string, any][] = []
		const ack = await p.charactersGeneratePortrait.handler(
			socket(w.owner.id),
			{ castMemberId: w.member.id, count: 1 },
			(e: string, d: any) => pushed.push([e, d])
		)
		expect(ack).toMatchObject({ castMemberId: w.member.id })
		expect("characterId" in ack).toBe(false)
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		for (let i = 0; i < 400; i++) {
			const [card] = pendingReviewsFor(w.owner.id)
			if (card) {
				resolveReview(card.id, w.owner.id, "approve")
				break
			}
			await new Promise((r) => setTimeout(r, 25))
		}
		for (
			let i = 0;
			i < 200 && !pushed.some(([e]) => e === "characters:listGallery");
			i++
		)
			await new Promise((r) => setTimeout(r, 50))
		for (const [e, d] of pushed.filter(
			([e]) => e === "characters:portrait"
		)) {
			expect(d.castMemberId).toBe(w.member.id)
			expect("characterId" in d).toBe(false)
			void e
		}
		const gallery = pushed.find(([e]) => e === "characters:listGallery")![1]
		expect(gallery.castMemberId).toBe(w.member.id)
		expect("characterId" in gallery).toBe(false)
		expect(gallery.images).toHaveLength(1)
		const links = await db
			.select()
			.from(schema.castMemberFiles)
			.where(and(eq(schema.castMemberFiles.castMemberId, w.member.id)))
		expect(links).toHaveLength(1)
	})
})
