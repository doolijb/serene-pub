/**
 * R-F: the settings document carries `timeline`, the governing lorebook's
 * Timeline switch (`sessionTimelineOf`).
 *
 * What is pinned:
 *
 *  1. A session on an attached lorebook with the switch on reads `true`.
 *  2. After the lorebook's switch is turned off, the next
 *     `resolveSessionSettings` reads `false`.
 *  3. A session with no attached lorebook reads its own notes' switch, off
 *     and on.
 *  4. `widgetSessionProjection` carries no `timeline` key.
 *  5. `timeline` and `cast.storyTime.timeline` agree, switch on and off, on the
 *     session's own notes and on an attached lorebook.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { insertOwnBook } from "$lib/server/lorebooks/ownBook"
import {
	resolveSessionSettings,
	widgetSessionProjection
} from "$lib/server/sessions/settings"

let db: TestDb
let userId: number

const timelineOf = async (sessionId: number) =>
	(await resolveSessionSettings(db, sessionId))!.timeline

async function makeSession(lorebookId: number | null = null) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: null, lorebookId })
		.returning()
	return session!
}

async function makeBook(timelineEnabled: boolean) {
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Book", timelineEnabled })
		.returning()
	return book!
}

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	userId = (await createTestUser(db, "timeline-fact-owner")).id
}, 60_000)

describe("settings document `timeline` (R-F)", () => {
	it("follows the attached lorebook's switch, read afresh each run", async () => {
		const book = await makeBook(true)
		const session = await makeSession(book.id)
		expect(await timelineOf(session.id)).toBe(true)
		await db
			.update(schema.lorebooks)
			.set({ timelineEnabled: false })
			.where(eq(schema.lorebooks.id, book.id))
		expect(await timelineOf(session.id)).toBe(false)
	})

	it.each([false, true])(
		"with no lorebook attached reads the session's own notes (%s)",
		async (on) => {
			const session = await makeSession()
			await insertOwnBook(db as any, {
				sessionId: session.id,
				userId,
				name: null,
				overlayOf: null,
				primaryRuleset: "core:ruleset/none",
				rulesetVersion: null,
				timelineEnabled: on
			})
			expect(await timelineOf(session.id)).toBe(on)
		}
	)

	it.each([
		{ on: true, attached: false },
		{ on: false, attached: false },
		{ on: true, attached: true },
		{ on: false, attached: true }
	])(
		"`timeline` equals `cast.storyTime.timeline` (switch $on, attached lorebook $attached)",
		async ({ on, attached }) => {
			let session
			if (attached) {
				session = await makeSession((await makeBook(on)).id)
			} else {
				session = await makeSession()
				await insertOwnBook(db as any, {
					sessionId: session.id,
					userId,
					name: null,
					overlayOf: null,
					primaryRuleset: "core:ruleset/none",
					rulesetVersion: null,
					timelineEnabled: on
				})
			}
			const settings = (await resolveSessionSettings(db, session.id))!
			expect(settings.timeline).toBe(on)
			expect(settings.cast.storyTime.timeline).toBe(settings.timeline)
		}
	)

	it("is not part of the widget projection", async () => {
		const session = await makeSession()
		const doc = (await resolveSessionSettings(db, session.id))!
		expect("timeline" in widgetSessionProjection(doc)).toBe(false)
	})
})
