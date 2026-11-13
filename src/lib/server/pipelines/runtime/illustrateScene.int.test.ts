/**
 * 🚧 The Scene action, end to end (DESIGN-image-generation §6.4, I9) —
 * `core:spec/story-illustrate-scene` on the real document, config store,
 * bindings, host and dispatch, with the text and image adapters faked.
 *
 *  1. The spec is published and seeded with its Default config and its two
 *     scene prompt rows.
 *  2. The quiet call's prompt carries the cast's likeness tags and the
 *     no-names instruction; the picture step gets the likeness images as
 *     references, landscape, and the cleaned prompt.
 *  3. Placement `both` (the default) posts a message AND points the
 *     session's backdrop at the picture; a press with
 *     `{ placement: 'backdrop' }` sets the backdrop and posts nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import { createTestDb, releaseDataDir, type TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const SPEC = "core:spec/story-illustrate-scene"

/** Every text request the fake saw, whole. */
const textCalls: string[] = []
/** Every picture request, as `buildImageRequest` produced it. */
const imageCalls: any[] = []

/** What the fake text model answers: a fence, a label, quotes and a list. */
const REPLY =
	'```\nPrompt: "harbor at dawn, light fog\n- woman with a red braid and green cloak\n- wide shot."\n```'

/** Stringify, dropping repeats (the session row is shared). */
function flat(v: unknown): string {
	const seen = new WeakSet()
	return JSON.stringify(v ?? null, (_k, x) => {
		if (x && typeof x === "object") {
			if (seen.has(x)) return undefined
			seen.add(x)
		}
		return x
	})
}

class FakeTextAdapter {
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt(compiled: unknown) {
		textCalls.push(flat(compiled))
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: undefined, messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(REPLY)
			}
		}
	}
}

/** A distinct 2×1 PNG per call, so createMedia's dedupe keeps them apart. */
let nextPicture = 0
function picture(): string {
	const img = new PNG({ width: 2, height: 1 })
	img.data.fill(200)
	img.data[0] = ++nextPicture % 256
	return PNG.sync.write(img).toString("base64")
}

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

class FakeImageAdapter {
	constructor(public connection: any) {}
	async generateImage(req: any) {
		imageCalls.push(req)
		return {
			media: [{ kind: "image", mime: "image/png", base64: PNG_1x1 }],
			isAborted: false,
			applied: [],
			ignored: []
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeTextAdapter })
}))
vi.mock("$lib/server/utils/getImageAdapter", async () => {
	const { A1111_SHEET } = await import("$lib/server/imageAdapters/A1111Adapter")
	return {
		getImageAdapter: async () => ({
			Adapter: FakeImageAdapter,
			sheet: { ...A1111_SHEET, references: { max: 4 }, perCall: 1 }
		})
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let likenessFileId: number
let avatarFileId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-scene-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "scene-action", isAdmin: true })
		.returning()
	userId = user.id

	const { createMedia } = await import("$lib/server/media")
	const file = async (filename: string) =>
		(
			await createMedia(db as any, {
				userId,
				bytes: Buffer.from(picture(), "base64"),
				filename
			} as any)
		).file.id
	likenessFileId = await file("likeness.png")
	avatarFileId = await file("avatar.png")

	// Mara has a likeness (prompt + image); Osk has only an avatar, which
	// stands in for the image.
	const [mara] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Mara",
			description: "A harbor pilot.",
			extensions: {
				serenepub: {
					likeness: {
						prompt: "woman, red braid, green cloak, freckles",
						imageMediaId: likenessFileId
					}
				}
			}
		} as any)
		.returning()
	const [osk] = await db
		.insert(schema.characters)
		.values({ userId, name: "Osk", description: "A dockhand.", avatarMediaId: avatarFileId } as any)
		.returning()

	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true } as any)
		.returning()
	sessionId = s.id
	await db.insert(schema.sessionCharacters).values([
		{ sessionId, characterId: mara.id, position: 0 },
		{ sessionId, characterId: osk.id, position: 1 }
	] as any)
	await db.insert(schema.sessionMessages).values([
		{ sessionId, role: "user", content: "We reach the harbor as the sun comes up." },
		{
			sessionId,
			role: "assistant",
			characterId: mara.id,
			content: "Mara pulls her cloak tight against the fog."
		}
	] as any)

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const [imageConn] = await db
		.insert(schema.connections)
		.values({
			name: "Image",
			type: "a1111",
			baseUrl: "http://image",
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const textModel = (await ensureConnectionModel(db, textConn.id, "text-7b"))!.id
	const imageModel = (await ensureConnectionModel(db, imageConn.id, "sd.safetensors"))!.id
	const [textSampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Scene text",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 120, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const [imageSampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Scene image",
			isImmutable: false,
			shape: "core:shape/image-gen@1",
			// Upright on purpose: landscape must turn it.
			values: { steps: 20, width: 512, height: 768 },
			enabled: ["steps", "width", "height"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: textModel,
		samplingConfigId: textSampling.id
	})
	await setCapabilityDefault(db, "text->image", {
		connectionId: imageConn.id,
		connectionModelId: imageModel,
		samplingConfigId: imageSampling.id
	})
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function runScene(payload?: Record<string, unknown>) {
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	return (await runSpec({
		db,
		sessionId,
		userId,
		specId: SPEC,
		input: {
			text: "",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null },
			...(payload ? { payload } : {})
		},
		skipReceipt: true
	})) as any
}

const node = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

async function messages() {
	return db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
}

async function backdrop() {
	const [row] = await db
		.select({ id: schema.sessions.backdropMediaId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row.id
}

describe("the Scene action — seeding", () => {
	it("is published with a Default config and both scene prompt rows", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, SPEC))
		expect(spec).toBeTruthy()
		const configs = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, spec.id))
		expect(configs.some((c) => c.isImmutable)).toBe(true)
		const rows = await db.select().from(schema.pipelinePrompts)
		const names = rows
			.filter((r) => r.nodeDefinitionId === "core:task/build-narrator-context")
			.map((r) => r.name)
		expect(names).toContain("Scene prompt from the last lines")
		expect(names).toContain("Scene prompt, prose")
	})
})

describe("the Scene action — Adventure's spec (§16 follow-up D3)", () => {
	it("is published with a Default config, and the scene prompt rows are its defaults too", async () => {
		const ADVENTURE = "core:spec/story-illustrate-scene"
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, ADVENTURE))
		expect(spec).toBeTruthy()
		const configs = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, spec.id))
		expect(configs.some((c) => c.isImmutable)).toBe(true)
		const rows = await db.select().from(schema.pipelinePrompts)
		const tags = rows.find((r) => r.name === "Scene prompt from the last lines")!
		expect(tags.defaultForSpecs).toContain(ADVENTURE)
		expect(tags.defaultForSpecs).toContain(SPEC)
		// No lock any more (PLAN-layering, lane 3): the action is offered under
		// Story because Story's defaults register it.
		const { CORE_SPECS, STORY_ILLUSTRATE_SCENE_SPEC_ID, STORY_GENRE_ID } = await import(
			"@serene-pub/core-catalog"
		)
		const doc: any = CORE_SPECS.find((c: any) => c.slug === STORY_ILLUSTRATE_SCENE_SPEC_ID)!.build()
		expect(doc.input).toBeUndefined()
		expect(doc.contributes.actions.map((a: any) => a.key)).toEqual(["illustrate-scene"])
		const { genreRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		expect(
			(await genreRegistrations(db as any, STORY_GENRE_ID)).some(
				(r) => r.trigger.family === "action" && r.pipeline === STORY_ILLUSTRATE_SCENE_SPEC_ID
			)
		).toBe(true)
	})
})

describe("the Scene action — a run", () => {
	it("asks for tags with the likenesses, draws landscape with references, and places both", async () => {
		textCalls.length = 0
		imageCalls.length = 0
		const before = (await messages()).length
		const receipt = await runScene()
		if (receipt.outcome !== "ok")
			console.log(JSON.stringify(receipt.nodes.map((n: any) => [n.nodeKey, n.result, n.reason])))
		expect(receipt.outcome, receipt.haltReason).toBe("ok")

		// Two quiet calls (owner ruling 2026-11-08, "Scene posts prose"): the
		// picture prompt — the likeness tags and the no-names instruction —
		// and the caption, one sentence of prose from the same lines, which is
		// what the posted message says; the tags reach only the picture.
		expect(textCalls.length).toBe(2)
		expect(textCalls[0]).toContain("woman, red braid, green cloak, freckles")
		expect(textCalls[0]).toContain("never by their name")
		expect(node(receipt, "caption")?.result).toBe("ok")

		// The clean step: one line, no fence, label, quotes or bullets.
		expect(node(receipt, "clean").output.prompt).toBe(
			"harbor at dawn, light fog, woman with a red braid and green cloak, wide shot"
		)

		// The picture step: the cleaned prompt, the likeness images in stage
		// order (Mara's likeness image, then Osk's avatar), landscape.
		const draw = node(receipt, "draw")
		const refs = draw.input.references as Array<{ uuid: string }>
		expect(refs.length).toBe(2)
		const [likenessFile] = await db
			.select({ uuid: schema.files.uuid })
			.from(schema.files)
			.where(eq(schema.files.id, likenessFileId))
		expect(refs[0].uuid).toBe(likenessFile.uuid)
		expect(draw.input.prompt).toContain("harbor at dawn")
		expect(imageCalls.length).toBe(1)
		expect(imageCalls[0].references?.length).toBe(2)
		expect(imageCalls[0].prompt).toContain("harbor at dawn")
		expect(imageCalls[0].width).toBe(768)
		expect(imageCalls[0].height).toBe(512)

		// Placement `both`: a message with the picture AND the backdrop.
		const after = await messages()
		expect(after.length).toBe(before + 1)
		const id = await backdrop()
		expect(id).not.toBeNull()
		expect(node(receipt, "toMessage.yes.post")?.result).toBe("ok")
		expect(node(receipt, "toBackdrop.yes.set")?.result).toBe("ok")
	})

	it("posts nothing when the press asks for the backdrop only", async () => {
		await db
			.update(schema.sessions)
			.set({ backdropMediaId: null } as any)
			.where(eq(schema.sessions.id, sessionId))
		const before = (await messages()).length
		const receipt = await runScene({ placement: "backdrop" })
		expect(receipt.outcome, receipt.haltReason).toBe("ok")
		expect((await messages()).length).toBe(before)
		expect(await backdrop()).not.toBeNull()
		expect(node(receipt, "placement").output.placement).toBe("backdrop")
	})
})

// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
// ★pT-1 -> "a persona seat reads its cast member like every seat."
// ★pT-2 -> "scene pictures: the card's likeness image, then the member's own
// face, then the card's avatar."
describe("likenessImagesFor — each seat's member over its active card", () => {
	let n = 0
	const uniq = (label: string) => `${label}-${++n}`

	/** A fresh picture: its file id and uuid. */
	async function pic(label: string) {
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db as any, {
			userId,
			bytes: Buffer.from(picture(), "base64"),
			filename: `${uniq(label)}.png`
		} as any)
		return { id: file.id as number, uuid: file.uuid as string }
	}

	async function card(
		over: { avatar?: number; likeness?: number; isPersona?: boolean } = {}
	) {
		const [row] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: uniq("Seat card"),
				description: "",
				isPersona: over.isPersona ?? false,
				avatarMediaId: over.avatar ?? null,
				extensions: over.likeness
					? { serenepub: { likeness: { imageMediaId: over.likeness } } }
					: {}
			} as any)
			.returning()
		return row!
	}

	async function world(clockYear = 30) {
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId, name: uniq("Scene book") } as any)
			.returning()
		const [s] = await db
			.insert(schema.sessions)
			.values({
				userId,
				isGroup: true,
				lorebookId: book!.id,
				storyClockYear: clockYear
			} as any)
			.returning()
		const member = async (
			cardId: number | null,
			over: Record<string, unknown> = {}
		) =>
			(
				await insertCastMember(db, {
					lorebookId: book!.id,
					characterId: cardId,
					binding: `{{char:${++n}}}`,
					name: uniq("member"),
					...over
				} as any)
			).member
		return { book: book!, session: s!, member }
	}

	const uuids = async (sessionId: number) => {
		const { likenessImagesFor } = await import(
			"$lib/server/pipelines/runtime/illustrateScene"
		)
		return (await likenessImagesFor(db as any, sessionId)).map((r) => r.uuid)
	}

	it("the card's likeness image, then the member's own face, then the card's avatar; a seat with no member reads its card", async () => {
		const w = await world()
		const Lx = await pic("likeness")
		const Ax = await pic("avatar-x")
		const Fx = await pic("face-x")
		const Ay = await pic("avatar-y")
		const Fy = await pic("face-y")
		const Az = await pic("avatar-z")
		const Aw = await pic("avatar-w")
		const X = await card({ avatar: Ax.id, likeness: Lx.id })
		const Y = await card({ avatar: Ay.id })
		const Z = await card({ avatar: Az.id })
		const W = await card({ avatar: Aw.id })
		// X: a likeness image beats the member's own face.
		const mx = await w.member(X.id, { faceMediaId: Fx.id, retold: { face: true } })
		// Y: no likeness image, so the member's own face beats the avatar.
		const my = await w.member(Y.id, { faceMediaId: Fy.id, retold: { face: true } })
		// Z: a member with no face of its own: the card's avatar.
		const mz = await w.member(Z.id)
		await db.insert(schema.sessionCharacters).values([
			{ sessionId: w.session.id, characterId: X.id, castMemberId: mx.id, position: 0 },
			{ sessionId: w.session.id, characterId: Y.id, castMemberId: my.id, position: 1 },
			{ sessionId: w.session.id, characterId: Z.id, castMemberId: mz.id, position: 2 },
			// W: no member anywhere: the card as it is.
			{ sessionId: w.session.id, characterId: W.id, position: 3 }
		] as any)
		expect(await uuids(w.session.id)).toEqual([Lx.uuid, Fy.uuid, Az.uuid, Aw.uuid])
	})

	it("a dated card's likeness image is used once the clock reaches it, not before", async () => {
		const LA = await pic("likeness-held")
		const LB = await pic("likeness-dated")
		const A = await card({ likeness: LA.id })
		const B = await card({ likeness: LB.id })
		for (const [year, expected] of [
			[30, LB.uuid],
			[10, LA.uuid]
		] as const) {
			const w = await world(year)
			const m = await w.member(A.id)
			await insertDatedCardVersion(db, m.id, B.id, 20)
			await db.insert(schema.sessionCharacters).values({
				sessionId: w.session.id,
				characterId: A.id,
				castMemberId: m.id,
				position: 0
			} as any)
			expect(await uuids(w.session.id)).toEqual([expected])
		}
	})

	it("a dated card's avatar stands in when it has no likeness image and the member has no face of its own", async () => {
		const AvA = await pic("avatar-held")
		const AvB = await pic("avatar-dated")
		const A = await card({ avatar: AvA.id })
		const B = await card({ avatar: AvB.id })
		const w = await world(30)
		const m = await w.member(A.id)
		await insertDatedCardVersion(db, m.id, B.id, 20)
		await db.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: A.id,
			castMemberId: m.id,
			position: 0
		} as any)
		expect(await uuids(w.session.id)).toEqual([AvB.uuid])
	})

	it("a card-less member's own likeness image is its picture, over the card its seat holds", async () => {
		const w = await world()
		const Ah = await pic("avatar-held")
		const Lm = await pic("likeness-member")
		const held = await card({ avatar: Ah.id })
		const mm = await w.member(null)
		const { isBaseVersion, updateCastVersion } = await import(
			"$lib/server/characters/versions"
		)
		const base = (
			await db
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, mm.id))
		).find(isBaseVersion)!
		await updateCastVersion(db as any, base.id, {
			changes: { likeness: { imageMediaId: Lm.id } }
		})
		await db.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: held.id,
			castMemberId: mm.id,
			position: 0
		} as any)
		expect(await uuids(w.session.id)).toEqual([Lm.uuid])
	})

	it("player seats read their member too, after the cast: a persona seat's member face, a card-less seat's member face", async () => {
		const w = await world()
		const Ac = await pic("avatar-cast")
		const Ap = await pic("avatar-persona")
		const Fp = await pic("face-persona")
		const Fm = await pic("face-cardless")
		const C = await card({ avatar: Ac.id })
		const P = await card({ avatar: Ap.id, isPersona: true })
		const mc = await w.member(C.id)
		const mp = await w.member(P.id, { faceMediaId: Fp.id, retold: { face: true } })
		const mm = await w.member(null, { faceMediaId: Fm.id })
		await db.insert(schema.sessionCharacters).values({
			sessionId: w.session.id,
			characterId: C.id,
			castMemberId: mc.id,
			position: 0
		} as any)
		await db.insert(schema.sessionPersonas).values([
			{ sessionId: w.session.id, personaId: P.id, castMemberId: mp.id, position: 0 },
			{ sessionId: w.session.id, personaId: null, castMemberId: mm.id, position: 1 }
		] as any)
		expect(await uuids(w.session.id)).toEqual([Ac.uuid, Fp.uuid, Fm.uuid])
	})

	// Plan §34.2 (S4): a character seat with no card is a member and nothing else.
	it("a card-less character seat's likeness comes from its member; an envoy seat draws nothing", async () => {
		const w = await world()
		const Ac = await pic("avatar-cast")
		const Fm = await pic("face-cardless-seat")
		const C = await card({ avatar: Ac.id })
		const mc = await w.member(C.id)
		const mm = await w.member(null, { faceMediaId: Fm.id })
		await db.insert(schema.sessionCharacters).values([
			{ sessionId: w.session.id, characterId: C.id, castMemberId: mc.id, position: 0 },
			{ sessionId: w.session.id, characterId: null, castMemberId: mm.id, position: 1 },
			{ sessionId: w.session.id, characterId: null, envoySlug: "herald", position: 2 }
		] as any)
		expect(await uuids(w.session.id)).toEqual([Ac.uuid, Fm.uuid])
	})
})
