/**
 * 🚧 Describe from image, end to end (DESIGN-image-generation §5; D1):
 * `core:spec/describe-likeness` published by the bootstrap with its prompt
 * row, run as a CARD ACTION (no session) against a faked vision model, and
 * the socket's owner-or-admin rule.
 *
 *  1. The spec and the *Describe a likeness* row are seeded.
 *  2. With no `text+image->text` default the helper is unavailable.
 *  3. With one, the run goes to THAT pair (not the chat default), carries
 *     the instruction and the likeness image, and returns the cleaned tags.
 *  4. The form's unsaved pick (a gallery picture) is the one sent.
 *  5. The socket refuses a member who does not own the card.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

/** Every request the fake model saw: the connection, the prompt, the files. */
const calls: Array<{ connectionId: number; prompt: string; files: any[] }> = []

/** What the fake answers: wrapping quotes, line breaks and bullets to clean. */
const REPLY = '"adult woman, red braid\n- green eyes\n- freckles, green cloak"'

class FakeVisionAdapter {
	consumesAttachments = true
	private prompt = ""
	private files: any[] = []
	constructor(public opts: any) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(compiled: unknown) {
		this.prompt = JSON.stringify(compiled)
		return this
	}
	withAttachments(files: any[]) {
		this.files = files
		return this
	}
	withMessageAttachments() {
		return this
	}
	async generateText() {
		calls.push({
			connectionId: this.opts.connection.id,
			prompt: this.prompt,
			files: this.files
		})
		return {
			compiledPrompt: { prompt: undefined, messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: REPLY
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeVisionAdapter })
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let n = 1
function picture(): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(180)
	img.data[0] = n++ % 256
	return PNG.sync.write(img)
}

let testDb: TestDb
let dataDir: string
let ownerId: number
let memberId: number
let characterId: number
let galleryFileId: number
let visionConnId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-describe-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)

	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: "describe-owner" })
		.returning()
	ownerId = owner.id
	const [member] = await testDb
		.insert(schema.users)
		.values({ username: "describe-member" })
		.returning()
	memberId = member.id

	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Mara", description: "A harbor pilot." } as any)
		.returning()
	characterId = character.id

	const { createMedia } = await import("$lib/server/media")
	const file = async (filename: string) =>
		(
			await createMedia(testDb as any, {
				userId: ownerId,
				characterId,
				bytes: picture(),
				filename
			} as any)
		).file.id
	const likenessFileId = await file("likeness.png")
	galleryFileId = await file("gallery.png")
	await testDb
		.update(schema.characters)
		.set({
			extensions: { serenepub: { likeness: { imageMediaId: likenessFileId } } }
		} as any)
		.where(eq(schema.characters.id, characterId))

	const [textConn] = await testDb
		.insert(schema.connections)
		.values({ name: "Chat", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const [visionConn] = await testDb
		.insert(schema.connections)
		.values({
			name: "Eyes",
			type: "anthropic",
			baseUrl: "http://vision",
			capabilities: { overrides: { "text+image->text": "good" } }
		} as any)
		.returning()
	visionConnId = visionConn.id
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const textModel = (await ensureConnectionModel(testDb as any, textConn.id, "text-7b"))!.id
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: textConn.id,
		connectionModelId: textModel
	})
}, 120_000)

afterAll(async () => {
	const { releaseDataDir } = await import("$lib/server/utils/testDb")
	await releaseDataDir(dataDir)
})

describe("Describe from image", () => {
	test("the spec and its prompt row are seeded", async () => {
		const { DESCRIBE_LIKENESS_SPEC_ID, DESCRIBE_LIKENESS_PROMPT_SEED_KEY } =
			await import("@serene-pub/core-catalog")
		const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
		const doc = await loadPublished(testDb as any, DESCRIBE_LIKENESS_SPEC_ID)
		expect(doc?.nodes.map((n: any) => n.definitionId)).toEqual([
			"core:inlet/card-action",
			"core:oracle/describe-image",
			"core:task/clean-image-prompt"
		])
		const row = await testDb.query.pipelinePrompts.findFirst({
			where: eq(schema.pipelinePrompts.seedKey, DESCRIBE_LIKENESS_PROMPT_SEED_KEY)
		})
		expect(row?.name).toBe("Describe a likeness")
		expect(String((row?.fields as any)?.instruction)).toMatch(/comma-separated tags/)
	})

	test("unavailable until a model that reads pictures is set up", async () => {
		const { describeLikeness, describeLikenessAvailable } = await import(
			"./describeLikeness"
		)
		expect(await describeLikenessAvailable(testDb as any)).toBe(false)
		await expect(
			describeLikeness(testDb as any, { characterId, userId: ownerId })
		).rejects.toThrow(/reads pictures/)
		expect(calls).toHaveLength(0)
	})

	test("runs on the vision job's pair and returns the cleaned tags", async () => {
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		const { ensureConnectionModel } = await import("$lib/server/connections/models")
		const visionModel = (await ensureConnectionModel(
			testDb as any,
			visionConnId,
			"claude-vision"
		))!.id
		await setCapabilityDefault(testDb as any, "text+image->text", {
			connectionId: visionConnId,
			connectionModelId: visionModel
		})
		const { describeLikeness, describeLikenessAvailable } = await import(
			"./describeLikeness"
		)
		expect(await describeLikenessAvailable(testDb as any)).toBe(true)

		const prompt = await describeLikeness(testDb as any, {
			characterId,
			userId: ownerId
		})
		expect(prompt).toBe("adult woman, red braid, green eyes, freckles, green cloak")
		expect(calls).toHaveLength(1)
		// The vision job's connection, not the chat default.
		expect(calls[0].connectionId).toBe(visionConnId)
		expect(calls[0].prompt).toMatch(/comma-separated tags/)
		expect(calls[0].files).toHaveLength(1)
		expect(calls[0].files[0].mime).toBe("image/png")
	})

	test("the form's unsaved pick is the picture sent", async () => {
		const { describeLikeness } = await import("./describeLikeness")
		calls.length = 0
		await describeLikeness(testDb as any, {
			characterId,
			userId: ownerId,
			imageMediaId: galleryFileId
		})
		const { readMedia } = await import("$lib/server/media")
		const gallery = await readMedia(testDb as any, galleryFileId)
		expect(Buffer.compare(calls[0].files[0].bytes, gallery!.bytes)).toBe(0)
	})

	test("the socket refuses a member who does not own the card", async () => {
		const { charactersDescribeLikeness } = await import(
			"$lib/server/sockets/describeLikeness"
		)
		const emitted: Array<[string, any]> = []
		const socket = { user: { id: memberId, isAdmin: false } } as any
		calls.length = 0
		await expect(
			charactersDescribeLikeness.handler(
				socket,
				{ characterId },
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow(/owner or an admin/)
		expect(emitted).toEqual([
			[
				"characters:describeLikeness:error",
				expect.objectContaining({ characterId })
			]
		])
		expect(calls).toHaveLength(0)

		// The owner's probe answers availability and runs nothing.
		const res = await charactersDescribeLikeness.handler(
			{ user: { id: ownerId, isAdmin: false } } as any,
			{ characterId, probe: true },
			() => {}
		)
		expect(res).toEqual({ characterId, available: true })
		expect(calls).toHaveLength(0)
	})
})
