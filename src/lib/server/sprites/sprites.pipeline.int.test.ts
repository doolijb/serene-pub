/**
 * Sprites in a session (DESIGN-sprites §2.3, §5, §6), against a real PGlite
 * database with core's pipelines published: which set a line's speaker is
 * shown in, a person's pick through `core:spec/show-sprite`, and swipes
 * keeping each alternative's face.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-sprites-pipeline-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

const socket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}

let seed = 1000
/** A user, a card with a default set and an "armour" set, seated in a session, and one line. */
async function scene(username: string, opts: { lorebook?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { importSprites } = await import("$lib/server/sprites")
	const user = await createTestUser(testDb, username)
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "" })
		.returning()
	await importSprites(
		testDb as any,
		user.id,
		character.id,
		[
			{ label: "joy", bytes: png(seed++) },
			{ label: "neutral", bytes: png(seed++) },
			{ set: "armour", label: "stern", bytes: png(seed++) }
		],
		"upload"
	)
	let lorebookId: number | null = null
	let bindingId: number | null = null
	if (opts.lorebook) {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Ashfall" })
			.returning()
		lorebookId = book.id
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, characterId: character.id, binding: "{{char:1}}", name: "Verity" })
			.returning()
		bindingId = binding.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId })
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: character.id, position: 0 })
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			characterId: character.id,
			content: "I'm so happy to see you!"
		})
		.returning()
	return { user, character, session, message, lorebookId, bindingId }
}

describe("which set a line's speaker is shown in", () => {
	test("the card's default set, with its labels, when nothing else says", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, message, character } = await scene("sprites-choices-default")
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(c).toMatchObject({
			characterId: character.id,
			set: "default",
			defaultSet: "default",
			labels: ["joy", "neutral"],
			decidedBy: "default",
			has: true,
			text: "I'm so happy to see you!"
		})
	}, 60_000)

	test("the session override wins, and clearing it restores the default", async () => {
		const { spriteChoicesFor, setSessionSpriteSet } = await import("$lib/server/sprites/choices")
		const { session, message, character, user } = await scene("sprites-choices-override")
		await setSessionSpriteSet(testDb as any, {
			sessionId: session.id,
			characterId: character.id,
			set: "Armour",
			updatedBy: "user"
		})
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(c).toMatchObject({ set: "armour", labels: ["stern"], decidedBy: "override" })
		await setSessionSpriteSet(testDb as any, {
			sessionId: session.id,
			characterId: character.id,
			set: null,
			updatedBy: "user"
		})
		const back = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(back).toMatchObject({ set: "default", decidedBy: "default" })
	}, 60_000)

	test("the cast member's set applies; a name the card lacks falls back and says so", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, message, bindingId } = await scene("sprites-choices-member", { lorebook: true })
		await testDb
			.update(schema.lorebookBindings)
			.set({ spriteSet: "armour" })
			.where(eq(schema.lorebookBindings.id, bindingId!))
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(c).toMatchObject({ set: "armour", decidedBy: "amendment" })

		await testDb
			.update(schema.lorebookBindings)
			.set({ spriteSet: "winter" })
			.where(eq(schema.lorebookBindings.id, bindingId!))
		const missing = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(missing).toMatchObject({ set: "default", decidedBy: "default", missing: "winter" })
	}, 60_000)

	test("resolves at the session's reading: its fork cut and its story clock (finding #39)", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, message, bindingId, lorebookId } = await scene("sprites-choices-reading", {
			lorebook: true
		})
		// Main puts her in armour at Y10. A branch forked at Y5 never sees it.
		await testDb.insert(schema.castAmendments).values({
			lorebookId: lorebookId!,
			lorebookBindingId: bindingId!,
			branchId: null,
			year: 10,
			fields: { spriteSet: "armour" }
		})
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: lorebookId!, name: "The quiet year", forkYear: 5 })
			.returning()

		// Main at the head: Y10 has happened.
		const head = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(head).toMatchObject({ set: "armour", decidedBy: "amendment" })

		// Main with the story clock at Y3: Y10 has not happened yet.
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 3 })
			.where(eq(schema.sessions.id, session.id))
		const early = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(early).toMatchObject({ set: "default", decidedBy: "default" })

		// The branch at its head: main's Y10 is past the Y5 fork, so cut.
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: null, lorebookBranchId: fork.id })
			.where(eq(schema.sessions.id, session.id))
		const branch = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(branch).toMatchObject({ set: "default", decidedBy: "default" })
	}, 60_000)

	test("a card swap to a card with no art falls back to the member's own card", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, message, bindingId, lorebookId, character, user } = await scene(
			"sprites-choices-swap-bare",
			{ lorebook: true }
		)
		const [bare] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Verity, older", description: "" })
			.returning()
		await testDb.insert(schema.castAmendments).values({
			lorebookId: lorebookId!,
			lorebookBindingId: bindingId!,
			branchId: null,
			year: 20,
			fields: { characterId: bare.id }
		})
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(c).toMatchObject({ characterId: character.id, set: "default", has: true })
	}, 60_000)

	test("a narrator's line has nothing to choose", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session } = await scene("sprites-choices-narrator")
		const [line] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", isNarratorResponse: true, content: "Rain." })
			.returning()
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: line.id })
		expect(c.has).toBe(false)
	}, 60_000)
})

describe("a person's pick, and swipes", () => {
	test("Change sprite records a person's pick through core:spec/show-sprite", async () => {
		const { sessionMessagesSetSprite } = await import("$lib/server/sockets/sprites")
		const { user, message, session } = await scene("sprites-set-person")
		const res = await sessionMessagesSetSprite.handler(
			socket(user.id),
			{ id: message.id, sprite: { set: "Armour", label: "Stern" } },
			noop
		)
		expect(res.error).toBeUndefined()
		expect((res.sessionMessage?.metadata as any)?.sprite).toEqual({
			set: "armour",
			label: "stern",
			source: "person"
		})
		const runs = await testDb
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, session.id))
		expect(runs.length).toBeGreaterThan(0)
	}, 60_000)

	test("refused on a line the person may not act on, and on a narrator's line", async () => {
		const { sessionMessagesSetSprite } = await import("$lib/server/sockets/sprites")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { message, session } = await scene("sprites-set-refusals")
		const stranger = await createTestUser(testDb, "sprites-set-stranger")
		const denied = await sessionMessagesSetSprite.handler(
			socket(stranger.id),
			{ id: message.id, sprite: { set: "default", label: "joy" } },
			noop
		)
		expect(denied.error).toBeTruthy()
		const [narration] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", isNarratorResponse: true, content: "Rain." })
			.returning()
		const owner = (await testDb.query.sessions.findFirst({ where: eq(schema.sessions.id, session.id) }))!.userId
		const narr = await sessionMessagesSetSprite.handler(
			socket(owner),
			{ id: narration.id, sprite: { set: "default", label: "joy" } },
			noop
		)
		expect(narr.error).toMatch(/character's lines/)
	}, 60_000)

	test("each swipe keeps its own face", async () => {
		const { sessionMessagesSetSprite } = await import("$lib/server/sockets/sprites")
		const { runBuiltIn } = await import("$lib/server/pipelines/runtime/builtins")
		const { user, message, session } = await scene("sprites-swipes")
		await testDb
			.update(schema.sessionMessages)
			.set({ metadata: { swipes: { currentIdx: 0, history: ["I'm so happy to see you!", "Oh. You."] } } })
			.where(eq(schema.sessionMessages.id, message.id))

		await sessionMessagesSetSprite.handler(
			socket(user.id),
			{ id: message.id, sprite: { set: "default", label: "joy" } },
			noop
		)
		const swiped = await runBuiltIn(testDb as any, {
			kind: "swipe",
			sessionId: session.id,
			actor: user.id,
			payload: { target: message.id, index: 1 }
		})
		expect(swiped.ok).toBe(true)
		let row = await testDb.query.sessionMessages.findFirst({ where: eq(schema.sessionMessages.id, message.id) })
		expect((row!.metadata as any).sprite).toBeNull()

		await sessionMessagesSetSprite.handler(
			socket(user.id),
			{ id: message.id, sprite: { set: "armour", label: "stern" } },
			noop
		)
		await runBuiltIn(testDb as any, {
			kind: "swipe",
			sessionId: session.id,
			actor: user.id,
			payload: { target: message.id, index: 0 }
		})
		row = await testDb.query.sessionMessages.findFirst({ where: eq(schema.sessionMessages.id, message.id) })
		const meta = row!.metadata as any
		expect(meta.sprite).toMatchObject({ set: "default", label: "joy" })
		expect(meta.swipes.spriteHistory.map((s: any) => s?.label ?? null)).toEqual(["joy", "stern"])
	}, 60_000)
})

describe("A session's sprite-set override", () => {
	test("the owner changes it, the next line reads it, a stranger and a missing set are refused", async () => {
		const { sessionsSetSpriteSet } = await import("$lib/server/sockets/sprites")
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { user, session, character, message } = await scene("sprites-outfit")

		const ok = await sessionsSetSpriteSet.handler(
			socket(user.id),
			{ sessionId: session.id, characterId: character.id, set: "Armour" },
			noop
		)
		expect(ok).toMatchObject({ set: "armour" })
		expect(ok.error).toBeUndefined()
		const c = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(c).toMatchObject({ set: "armour", decidedBy: "override" })

		const missing = await sessionsSetSpriteSet.handler(
			socket(user.id),
			{ sessionId: session.id, characterId: character.id, set: "winter" },
			noop
		)
		expect(missing.error).toMatch(/no sprite set named "winter"/)

		const stranger = await createTestUser(testDb, "sprites-outfit-stranger")
		const denied = await sessionsSetSpriteSet.handler(
			socket(stranger.id),
			{ sessionId: session.id, characterId: character.id, set: null },
			noop
		)
		expect(denied.error).toBeTruthy()

		const cleared = await sessionsSetSpriteSet.handler(
			socket(user.id),
			{ sessionId: session.id, characterId: character.id, set: null },
			noop
		)
		expect(cleared.set).toBeNull()
		const back = await spriteChoicesFor(testDb as any, { sessionId: session.id, messageId: message.id })
		expect(back.decidedBy).toBe("default")
	}, 60_000)
})

describe("published values", () => {
	test("each cast member's current sprite, by id and by cast key, in the override set", async () => {
		const { sessionMessagesSetSprite, sessionsSetSpriteSet } = await import(
			"$lib/server/sockets/sprites"
		)
		const { publishedValues } = await import("$lib/server/pipelines/entities/publishedValues")
		const { user, session, character, message } = await scene("sprites-published")
		await sessionMessagesSetSprite.handler(
			socket(user.id),
			{ id: message.id, sprite: { set: "default", label: "joy" } },
			noop
		)
		let doc = await publishedValues(testDb as any, session.id)
		expect(doc.sprites.byId[String(character.id)]).toEqual({ set: "default", label: "joy" })
		expect(doc.sprites.verity).toEqual({ set: "default", label: "joy" })

		await sessionsSetSpriteSet.handler(
			socket(user.id),
			{ sessionId: session.id, characterId: character.id, set: "armour" },
			noop
		)
		doc = await publishedValues(testDb as any, session.id)
		expect(doc.sprites.byId[String(character.id)]).toEqual({ set: "armour", label: "joy" })
	}, 60_000)
})
