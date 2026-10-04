/**
 * Genre field defaults apply at read (PLAN-lair-pass B16x, F16).
 *
 * A genre's declared field `default` is the cascade's floor (§4.13). It is
 * resolved when a run reads the fields, never written at create, so every
 * path — create form with or without a preset, import, API, a row older
 * than this fix — gets it from the same place, and a stored value (or a
 * genre pin) still wins.
 *
 * The Lair is the real case: its respond spec reads `tone` and
 * `trustNarrator`, and a preset-less session ran with `fields: {}`. Its
 * retired `turnStyle` (R12, 2026-09-28) shows the other half of the rule:
 * a stored value under a key the genre no longer declares is not a field.
 */

import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { LAIR_GENRE_ID } from "@serene-pub/core-catalog"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
import { resolveSessionSettings } from "$lib/server/sessions/settings"

let db: TestDb
let userId: number

/**
 * A Lair row as the create path writes one: no preset, and `genre_fields`
 * holding only what the request supplied (the create filter keeps declared
 * keys and adds nothing).
 */
async function lairSession(genreFields: Record<string, unknown>) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			genreId: LAIR_GENRE_ID,
			presetId: null,
			genreFields
		} as any)
		.returning()
	return session!
}

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	userId = (await createTestUser(db, "lair-defaults")).id
}, 60_000)

describe("genre field defaults (B16x)", () => {
	it("a Lair session created with no preset has its declared defaults", async () => {
		const session = await lairSession({})
		// `sanctumSteers` (R13, 2026-09-28): on by default. `partySpeech`
		// (owner ruling 2026-09-30): each delver speaks, by default.
		const expected = {
			tone: "grounded",
			trustNarrator: false,
			sanctumSteers: true,
			partySpeech: "each"
		}
		// The run's read (the inlet's `fields`) and the settings document agree.
		expect(await genreFieldsFor(db, session.id)).toEqual(expected)
		expect((await resolveSessionSettings(db, session.id))!.fields).toEqual(
			expected
		)
	}, 60_000)

	it("an explicit value wins over the declared default", async () => {
		const session = await lairSession({
			tone: "grim",
			trustNarrator: true
		})
		expect(await genreFieldsFor(db, session.id)).toEqual({
			tone: "grim",
			trustNarrator: true,
			sanctumSteers: true,
			partySpeech: "each"
		})
	}, 60_000)

	it("an older session with no stored field resolves to the default", async () => {
		// A row from before `trustNarrator` existed: it stored one field, and
		// nothing has been written since. No migration seats the rest.
		const session = await lairSession({ tone: "pulpy" })
		const fields = await genreFieldsFor(db, session.id)
		expect(fields.tone).toBe("pulpy")
		expect(fields.trustNarrator).toBe(false)
	}, 60_000)

	it("a stored value under a retired key is inert (R12: the Lair's turnStyle)", async () => {
		// The owner ruled no back-compat: the JSON keeps the key, and no read
		// passes it on — not the run's fields, not the settings document.
		const session = await lairSession({ turnStyle: "narrator" })
		const expected = {
			tone: "grounded",
			trustNarrator: false,
			sanctumSteers: true,
			partySpeech: "each"
		}
		expect(await genreFieldsFor(db, session.id)).toEqual(expected)
		expect((await resolveSessionSettings(db, session.id))!.fields).toEqual(
			expected
		)
	}, 60_000)
})
