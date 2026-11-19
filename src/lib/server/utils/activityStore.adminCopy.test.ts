/**
 * An administrator is told that someone else's activity exists, never the draft
 * it waits on (owner ruling, 2026-11-16: in another person's session an
 * administrator is a guest). Read off the serialised copy `getFor` returns and
 * the one the push sends; the owner's copy keeps the draft.
 */
import { afterEach, describe, expect, test } from "vitest"
import { activityStore } from "./activityStore"

const DRAFT = { content: "Draft-secret-content", raw: "Draft-secret-raw" }
const ids: string[] = []
const emitters: Array<(...a: any[]) => void> = []

afterEach(() => {
	for (const fn of emitters.splice(0)) activityStore.unregisterEmitter(fn)
	for (const id of ids.splice(0)) activityStore.remove(id)
})

function draftScene(userId: number, sceneId: number) {
	const id = activityStore.startScene({
		userId,
		sceneId,
		lorebookId: 1,
		lorebookLabel: "Book"
	})
	ids.push(id)
	activityStore.updateScene(id, {
		status: "review",
		pendingResult: {
			content: DRAFT.content,
			raw: DRAFT.raw,
			participantCharacters: [],
			mentionedCharacters: []
		}
	})
	return id
}

describe("activityStore.getFor", () => {
	test("an administrator's copy of someone else's activity has no draft; the activity itself stays", () => {
		const id = draftScene(11, 9001)
		const copy = activityStore.getFor(99, true).find((a) => a.id === id)!
		expect(copy).toMatchObject({ id, userId: 11, status: "review", kind: "scene_summarize" })
		expect(JSON.stringify(copy)).not.toContain(DRAFT.content)
		expect(JSON.stringify(copy)).not.toContain(DRAFT.raw)
		expect(copy).not.toHaveProperty("pendingResult")
	})

	test("the owner, and an administrator who owns it, keep the draft", () => {
		const id = draftScene(11, 9002)
		for (const [uid, admin] of [
			[11, false],
			[11, true]
		] as const) {
			const mine = activityStore.getFor(uid, admin).find((a) => a.id === id)!
			expect(JSON.stringify(mine)).toContain(DRAFT.content)
		}
	})

	test("the push to an administrator carries no draft; the owner's push does", () => {
		const sent: Record<string, string[]> = { admin: [], owner: [] }
		const adminFn = (_e: string, data: unknown) => void sent.admin!.push(JSON.stringify(data))
		const ownerFn = (_e: string, data: unknown) => void sent.owner!.push(JSON.stringify(data))
		emitters.push(adminFn, ownerFn)
		activityStore.registerEmitter(adminFn, 99, true)
		activityStore.registerEmitter(ownerFn, 11, false)
		draftScene(11, 9003)
		expect(sent.admin!.length).toBeGreaterThan(0)
		expect(sent.admin!.join("")).not.toContain(DRAFT.content)
		expect(sent.owner!.join("")).toContain(DRAFT.content)
	})
})
