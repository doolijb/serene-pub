/**
 * `mentioned`, derived from annotations rather than stored (plan §1).
 *
 * Three claims, and each of them is the reason a stored column had to go:
 *
 *  1. **It is right.** The scene's own message span names somebody the roster
 *     knows, and they come back — minus whoever was actually present, because
 *     "mentioned" means *named and not there*.
 *  2. **It is retroactive.** Widen the vocabulary — add an alias — and a scene
 *     nobody touched gains the mention it always should have had. A stored row
 *     cannot do this: it was written once, against the names that existed then,
 *     and no one would ever go back and rewrite it.
 *  3. **It says when it does not know.** Annotation is a background lane, so a
 *     scene read before the lane reaches it derives an incomplete list. That is
 *     reported as `pending`, under a different property name, rather than being
 *     handed over as though it were the answer — a silently-incomplete answer is
 *     worse than a stale one.
 *
 * ⚠ Nothing here writes an annotation by hand. The rows come from
 * `annotateSessionMessages` — the real lane's own function against the real
 * `EXTRACTOR_VERSION` and the real gazetteer — because the claim under test is
 * that the annotation store already holds this fact, and a hand-written row
 * would let that be false while the test stayed green.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scene-mentions-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * A book with Aria present and Bram absent, and one message that names both.
 *
 * Aria is written into `scene_characters` as a participant — the stored half,
 * which this file never derives — so a result containing her would mean the
 * "present beats mentioned" rule had gone.
 */
async function makeScene(messages: string[]) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `scene-mentions-${seq++}`
	const user = await createTestUser(testDb, label)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [aria] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Aria", description: "" })
		.returning()
	const [bram] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Bramwell", description: "" })
		.returning()
	const [ariaBinding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: aria.id,
			binding: "{{char:1}}",
			name: "Aria"
		})
		.returning()
	const [bramBinding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: bram.id,
			binding: "{{char:2}}",
			name: "Bramwell"
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()

	const messageIds: number[] = []
	for (const content of messages) {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", content })
			.returning()
		// The store writes the legacy row and mirrors it under the same id; the
		// annotation's foreign key points at `messages`, so both must exist.
		await testDb
			.insert(schema.messages)
			.values({ id: legacy.id, sessionId: session.id, role: "assistant" })
		messageIds.push(legacy.id)
	}

	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			sessionId: session.id,
			historyEntryId: historyEntry.id,
			selectedMessageIds: messageIds
		})
		.returning()

	// The stored half of the cast: Aria was there.
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: scene.id,
		bindingId: ariaBinding.id,
		role: "participant",
		ordinal: 0
	})

	return { user, lorebook, session, scene, ariaBinding, bramBinding }
}

/** The real lane's pass over this session's transcript. */
async function annotate(lorebookId: number, sessionId: number) {
	const { annotateSessionMessages, loadVocabulary } = await import(
		"$lib/server/annotations"
	)
	await annotateSessionMessages(
		testDb as any,
		sessionId,
		await loadVocabulary(testDb as any, lorebookId)
	)
}

const derive = async (
	lorebookId: number,
	scene: { id: number; selectedMessageIds: number[] | null }
) => {
	const { deriveSceneMentionsFor } = await import("./sceneMentions")
	return deriveSceneMentionsFor(testDb as any, lorebookId, scene)
}

describe("deriveSceneMentions", () => {
	it("names who the scene's text names, minus whoever was present", async () => {
		const { lorebook, session, scene, ariaBinding, bramBinding } =
			await makeScene([
				"Aria set down her cup. She had not heard from Bramwell in weeks."
			])
		await annotate(lorebook.id, session.id)

		const mentions = await derive(lorebook.id, scene)
		expect(mentions.status).toBe("derived")
		if (mentions.status !== "derived") throw new Error("unreachable")
		// Bramwell is named and was not there. Aria is named and WAS there, so
		// she is a participant and not "merely mentioned" — the whole
		// distinction §6's bound turns on.
		expect(mentions.bindingIds).toEqual([bramBinding.id])
		expect(mentions.bindingIds).not.toContain(ariaBinding.id)
		expect(mentions.coverage).toEqual({ total: 1, annotated: 1 })
	}, 60_000)

	it("distinguishes 'names nobody' from 'not looked at yet'", async () => {
		// Not looked at yet: the message exists, the lane has not run.
		const unread = await makeScene([
			"Aria set down her cup. She had not heard from Bramwell in weeks."
		])
		const before = await derive(unread.lorebook.id, unread.scene)
		expect(before.status).toBe("pending")
		if (before.status !== "pending") throw new Error("unreachable")
		// ⚠ The floor, under a name that says so. A caller cannot spell
		// `.bindingIds` here — that is the point of the union.
		expect(before.knownBindingIds).toEqual([])
		expect(before.coverage).toEqual({ total: 1, annotated: 0 })
		expect((before as { bindingIds?: number[] }).bindingIds).toBeUndefined()

		// Names nobody: the lane HAS run, and found nothing. Same empty list,
		// entirely different claim — this is the state the annotation store's
		// empty-extraction sentinel exists to make expressible.
		const silent = await makeScene(["The rain kept on, and nothing moved."])
		await annotate(silent.lorebook.id, silent.session.id)
		const after = await derive(silent.lorebook.id, silent.scene)
		expect(after.status).toBe("derived")
		if (after.status !== "derived") throw new Error("unreachable")
		expect(after.bindingIds).toEqual([])
		expect(after.coverage).toEqual({ total: 1, annotated: 1 })
	}, 60_000)

	it("gains a mention retroactively when the vocabulary widens", async () => {
		// "Bram" is a nickname the world does not know yet, so it starts as an
		// open-tier string that resolves to nobody.
		const { lorebook, session, scene, bramBinding } = await makeScene([
			"Aria set down her cup. She had not heard from Bram in weeks."
		])
		await annotate(lorebook.id, session.id)

		const before = await derive(lorebook.id, scene)
		expect(before.status).toBe("derived")
		if (before.status !== "derived") throw new Error("unreachable")
		expect(before.bindingIds).toEqual([])

		// Widen the vocabulary. Nothing about the scene, its cast rows or its
		// transcript moves — only what the world knows Bramwell is called.
		const castRowsBefore = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		await testDb
			.update(schema.lorebookBindings)
			.set({ aliases: ["Bram"] })
			.where(eq(schema.lorebookBindings.id, bramBinding.id))

		// The vocabulary moved, so every annotation over it is stale — and the
		// derivation says so rather than answering from rows that describe a
		// different alphabet. Correct-and-verbose, never silently-wrong.
		const stale = await derive(lorebook.id, scene)
		expect(stale.status).toBe("pending")
		if (stale.status !== "pending") throw new Error("unreachable")
		expect(stale.coverage).toEqual({ total: 1, annotated: 0 })

		await annotate(lorebook.id, session.id)
		const after = await derive(lorebook.id, scene)
		expect(after.status).toBe("derived")
		if (after.status !== "derived") throw new Error("unreachable")
		// ⚠ The claim a stored column could not make. This scene was written
		// once, before "Bram" meant anybody, and nothing rewrote it.
		expect(after.bindingIds).toEqual([bramBinding.id])
		const castRowsAfter = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		expect(castRowsAfter).toEqual(castRowsBefore)
	}, 60_000)

	it("refuses an annotation whose sentence has since been edited", async () => {
		// §13.3's rule at the reader, and the only place it can be enforced:
		// the message side is never repaired inline (extraction must not block a
		// turn), so a hit justified by text that no longer says it is exactly
		// the silent wrongness the source hash rides on every row to prevent.
		const { lorebook, session, scene, bramBinding } = await makeScene([
			"Aria set down her cup. She had not heard from Bramwell in weeks."
		])
		await annotate(lorebook.id, session.id)
		const before = await derive(lorebook.id, scene)
		expect(before.status).toBe("derived")
		if (before.status !== "derived") throw new Error("unreachable")
		expect(before.bindingIds).toEqual([bramBinding.id])

		await testDb
			.update(schema.sessionMessages)
			.set({ content: "Aria set down her cup. The rain kept on." })
			.where(
				eq(
					schema.sessionMessages.id,
					(scene.selectedMessageIds ?? [])[0]!
				)
			)

		const after = await derive(lorebook.id, scene)
		// Not "derived, and Bramwell is still in it" — the annotation is no
		// longer a fact about this sentence, so it is not evidence at all.
		expect(after.status).toBe("pending")
		if (after.status !== "pending") throw new Error("unreachable")
		expect(after.knownBindingIds).toEqual([])
		expect(after.coverage).toEqual({ total: 1, annotated: 0 })
	}, 60_000)

	it("refuses an annotation an older extractor wrote", async () => {
		// The third leg of the freshness triple. It cannot be reached by moving
		// the text or the vocabulary, so it is reached by ageing the rows the
		// real pass wrote — the stored version is what a future EXTRACTOR_VERSION
		// bump will look like from here, and the answer must be "not looked at
		// by this extractor", never a quiet reuse of the old one's opinion.
		const { lorebook, session, scene, bramBinding } = await makeScene([
			"Aria set down her cup. She had not heard from Bramwell in weeks."
		])
		await annotate(lorebook.id, session.id)
		const before = await derive(lorebook.id, scene)
		expect(before.status).toBe("derived")
		if (before.status !== "derived") throw new Error("unreachable")
		expect(before.bindingIds).toEqual([bramBinding.id])

		await testDb
			.update(schema.messageAnnotations)
			.set({ extractorVersion: "entities@0-ancient" })
			.where(
				eq(
					schema.messageAnnotations.messageId,
					(scene.selectedMessageIds ?? [])[0]!
				)
			)

		const after = await derive(lorebook.id, scene)
		expect(after.status).toBe("pending")
		if (after.status !== "pending") throw new Error("unreachable")
		expect(after.knownBindingIds).toEqual([])
		expect(after.coverage).toEqual({ total: 1, annotated: 0 })
	}, 60_000)

	it("counts the span's messages that still exist", async () => {
		// Plan A23(a): a deleted message can never be annotated, so counting it
		// in `total` kept its scene `pending` for ever. A gone message is no
		// text to fall behind on.
		const { lorebook, session, scene, bramBinding } = await makeScene([
			"Aria set down her cup. She had not heard from Bramwell in weeks.",
			"The rain kept on."
		])
		await annotate(lorebook.id, session.id)
		const goneId = (scene.selectedMessageIds ?? [])[1]!
		// Deleted underneath the scene; its span keeps the id.
		await testDb
			.delete(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, goneId))
		await testDb
			.delete(schema.messages)
			.where(eq(schema.messages.id, goneId))

		const mentions = await derive(lorebook.id, scene)
		expect(mentions.status).toBe("derived")
		if (mentions.status !== "derived") throw new Error("unreachable")
		expect(mentions.bindingIds).toEqual([bramBinding.id])
		expect(mentions.coverage).toEqual({ total: 1, annotated: 1 })
	}, 60_000)

	it("answers completely when every message of the span is gone", async () => {
		const { lorebook, scene } = await makeScene(["The rain kept on."])
		for (const id of scene.selectedMessageIds ?? []) {
			await testDb
				.delete(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))
			await testDb
				.delete(schema.messages)
				.where(eq(schema.messages.id, id))
		}
		const mentions = await derive(lorebook.id, scene)
		expect(mentions.status).toBe("derived")
		expect(mentions.coverage).toEqual({ total: 0, annotated: 0 })
	}, 60_000)

	it("answers a scene with no message span completely, not pendingly", async () => {
		// No text is not unread text: there is nothing for the lane to fall
		// behind on, so "nobody" is the whole answer.
		const { lorebook, scene } = await makeScene([])
		const mentions = await derive(lorebook.id, scene)
		expect(mentions.status).toBe("derived")
		if (mentions.status !== "derived") throw new Error("unreachable")
		expect(mentions.bindingIds).toEqual([])
		expect(mentions.coverage).toEqual({ total: 0, annotated: 0 })
	}, 60_000)
})

/**
 * A scene's span outlives the messages it names (plan A23(a)).
 *
 * The ids are the scene's place in play: `scenes:compile` orders a history
 * entry's scenes by their earliest message id (`inPlayOrder`), and a message
 * that no longer exists keeps its id as its place (`placesInPlay`). A delete
 * that emptied a span sent its scene back to the order it was written in, and
 * nothing could restore the ids. `deriveSceneMentions` reads only the
 * messages that still exist, so a kept id costs nothing there.
 */
describe("deletes keep scene spans", () => {
	const scenesOf = async (ids: number[]) => {
		const { inArray } = await import("drizzle-orm")
		return await testDb
			.select({
				id: schema.scenes.id,
				selectedMessageIds: schema.scenes.selectedMessageIds
			})
			.from(schema.scenes)
			.where(inArray(schema.scenes.id, ids))
	}

	/**
	 * Two scenes under one history entry, written out of play order: the
	 * first written covers the later messages, the second the earlier ones.
	 */
	async function twoScenes() {
		const made = await makeScene(["One.", "Two.", "Three.", "Four."])
		const [m1, m2, m3, m4] = made.scene.selectedMessageIds ?? []
		await testDb
			.update(schema.scenes)
			.set({ selectedMessageIds: [m3!, m4!] })
			.where(eq(schema.scenes.id, made.scene.id))
		const [earlier] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: made.lorebook.id,
				sessionId: made.session.id,
				historyEntryId: made.scene.historyEntryId,
				selectedMessageIds: [m1!, m2!]
			})
			.returning()
		const { inPlayOrder } = await import("$lib/shared/lorebooks/sceneOrder")
		const order = async () =>
			inPlayOrder(await scenesOf([made.scene.id, earlier.id])).map(
				(s) => s.id
			)
		expect(await order()).toEqual([earlier.id, made.scene.id])
		return {
			...made,
			later: made.scene,
			earlier,
			ids: [m1!, m2!, m3!, m4!],
			order
		}
	}

	it("deleting one message leaves the span naming it", async () => {
		const { scene } = await makeScene(["First.", "Second.", "Third."])
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(testDb as any, scene.selectedMessageIds![1]!)
		const [row] = await scenesOf([scene.id])
		expect(row.selectedMessageIds).toEqual(scene.selectedMessageIds)
	}, 60_000)

	it("deleting every message of the earlier-played scene keeps the play order", async () => {
		const { earlier, later, ids, order } = await twoScenes()
		const { deleteLegacyWhere } = await import("$lib/server/messages/store")
		const { inArray } = await import("drizzle-orm")
		await deleteLegacyWhere(
			testDb as any,
			inArray(schema.sessionMessages.id, [ids[0]!, ids[1]!])
		)
		expect(await order()).toEqual([earlier.id, later.id])
	}, 60_000)

	it("deleting the session keeps its scenes in play order, and complete", async () => {
		const { user, session, lorebook, earlier, later, order } =
			await twoScenes()
		const { sessionsDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsDeleteHandler.handler(
			{
				user: { id: user.id },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{ id: session.id } as any,
			() => {}
		)
		// The scenes are history and outlive the session, spans and all.
		expect(await order()).toEqual([earlier.id, later.id])
		// Every message they name is gone, which is no text to wait on.
		const [row] = await scenesOf([later.id])
		const mentions = await derive(lorebook.id, row)
		expect(mentions.status).toBe("derived")
		expect(mentions.coverage).toEqual({ total: 0, annotated: 0 })
	}, 60_000)
})
