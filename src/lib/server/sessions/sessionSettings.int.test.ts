/**
 * The settings document (PLAN-turn-order §4.12, R13) and its cascade (§4.13,
 * R14) — unit A3.
 *
 * What is pinned:
 *
 *  1. A declared field with no stored value resolves to its declared default
 *     (core's layer of the cascade).
 *  2. A genre-pinned value (`GenreDecl.settings[key]`) wins over the field's
 *     default and loses to a stored session value.
 *  3. A pinned key the genre declares no field for reaches `fields` and is
 *     never written to `genre_fields`: the resolver reads, it does not store.
 *  4. A session-scope rebind and a session-scope param override appear under
 *     `pipelines[<spec slug>]`, keyed by node.
 *  5. `guests` is present server-side and absent from the widget projection,
 *     as `pipelines` is.
 *  6. `metadata` and `annex` are present (the annex is `{}` until 0153 lands
 *     the column — A5).
 *  7. `cast` carries the seated envoys (`session-cast@1`'s `envoys` port).
 *  8. The document reaches a script hook as the read-only extra `session`.
 *
 * The genre layer is exercised by editing the chat create spec's version row
 * — `listSessionGenres` reads `meta.genre` off that row, never the running
 * registry — because no core genre pins a value at this unit (§4.13: core
 * pins nothing on any genre but its own, and its own pin nothing yet).
 */

import { beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs/respond"
import { CHAT_CREATE_SPEC_ID } from "@serene-pub/core-catalog"
import {
	resolveSessionSettings,
	widgetSessionProjection
} from "$lib/server/sessions/settings"

let db: TestDb
let userId: number
let guestId: number

/** The chat genre's declaration row, as `listSessionGenres` reads it. */
async function chatGenreRow() {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_CREATE_SPEC_ID))
		.limit(1)
	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec!.activeVersionId!))
		.limit(1)
	return version!
}

/** Rewrite the chat genre's declared fields and pinned settings on the row. */
async function declareOnChat(opts: {
	fields?: Record<string, unknown>
	settings?: Record<string, unknown>
}) {
	const row = await chatGenreRow()
	const genre = { ...(row.genre as Record<string, any>) }
	genre.shape = { ...(genre.shape ?? {}) }
	if (opts.fields) genre.shape.fields = opts.fields
	else delete genre.shape.fields
	if (opts.settings) genre.settings = opts.settings
	else delete genre.settings
	await db
		.update(schema.pipelineSpecVersions)
		.set({ genre })
		.where(eq(schema.pipelineSpecVersions.id, row.id))
}

async function makeSession(
	opts: {
		name?: string
		genreFields?: Record<string, unknown>
		metadata?: Record<string, unknown>
	} = {}
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: opts.name ?? null,
			genreFields: opts.genreFields ?? {},
			metadata: opts.metadata ?? {}
		})
		.returning()
	return session!
}

const TONE = { type: "text", default: "warm" }

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	userId = (await createTestUser(db, "settings-owner")).id
	guestId = (await createTestUser(db, "settings-guest")).id
}, 60_000)

describe("the cascade (§4.13)", () => {
	it("a declared field with no stored value resolves to its default", async () => {
		await declareOnChat({ fields: { tone: TONE } })
		const session = await makeSession()
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc).toBeTruthy()
		expect(doc.v).toBe(1)
		expect(doc.sessionId).toBe(session.id)
		expect(doc.genreId).toBe("core:genre/chat")
		expect(doc.fields.tone).toBe("warm")
	})

	it("a genre-pinned value wins over the field's default and loses to a stored session value", async () => {
		await declareOnChat({
			fields: { tone: TONE },
			settings: { tone: "brisk" }
		})
		const bare = await makeSession()
		const stored = await makeSession({ genreFields: { tone: "cold" } })
		expect((await resolveSessionSettings(db, bare.id))!.fields.tone).toBe(
			"brisk"
		)
		expect((await resolveSessionSettings(db, stored.id))!.fields.tone).toBe(
			"cold"
		)
	})

	it("a pinned key with no field reaches `fields` and is never written to genre_fields", async () => {
		await declareOnChat({
			fields: { tone: TONE },
			settings: { pace: "slow" }
		})
		const session = await makeSession({ genreFields: { tone: "cold" } })
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc.fields.pace).toBe("slow")
		expect(doc.fields.tone).toBe("cold")
		const [row] = await db
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(row!.genreFields).toEqual({ tone: "cold" })
		// A stored value for a key the genre never declared is not a field:
		// declaration is the only way in (§4.11), and a pinned key stores nothing.
		const smuggled = await makeSession({
			genreFields: { pace: "fast", junk: 1 }
		})
		const smuggledDoc = (await resolveSessionSettings(db, smuggled.id))!
		expect(smuggledDoc.fields.pace).toBe("slow")
		expect("junk" in smuggledDoc.fields).toBe(false)
	})
})

describe("the pipelines block", () => {
	it("a session rebind and a param override appear under pipelines[slug]", async () => {
		await declareOnChat({})
		const session = await makeSession()
		const { setNodeRebind } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		// The respond spec's `speaker` node moved to the turn-order spec
		// (A6), so a genuine cross-definition swap is no longer the fixture;
		// a stored rebind is the point, and shape rules (§19) admit only
		// same-shape substitutes — a session node pinned back to its own
		// definition is a valid (degenerate) entry.
		const rebound = await setNodeRebind(db, {
			scope: { kind: "session", id: session.id },
			specSlug: CHAT_RESPOND_SPEC_ID,
			nodeKey: "context",
			definitionId: "core:task/build-template-context@1",
			userId
		})
		expect(rebound.error).toBeUndefined()
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec!.id,
			scopeKind: "session",
			scopeId: session.id,
			nodeKey: "generate",
			slot: "params",
			path: "streaming",
			value: "off",
			updatedBy: userId
		})
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc.pipelines[CHAT_RESPOND_SPEC_ID]).toEqual({
			rebinds: { context: "core:task/build-template-context@1" },
			params: { generate: { streaming: "off" } }
		})
		// Another session sees none of it: the rows are session-scoped.
		const other = await makeSession()
		expect((await resolveSessionSettings(db, other.id))!.pipelines).toEqual(
			{}
		)
	})
})

describe("the document and its widget projection (§4.12)", () => {
	it("guests are present server-side and absent from the widget projection", async () => {
		await declareOnChat({ fields: { tone: TONE } })
		const session = await makeSession({
			name: "The gate",
			metadata: { note: "kept" }
		})
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guestId })
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc.title).toBe("The gate")
		expect(doc.guests).toEqual([guestId])
		expect(doc.channels).toEqual(["main"])
		expect(doc.tags).toEqual([])
		expect(doc.lorebookId).toBeNull()
		expect(doc.scenario).toBeNull()
		expect(doc.presetId).toBeNull()

		const widget = widgetSessionProjection(doc)
		expect(widget.id).toBe(session.id)
		expect(widget.name).toBe("The gate")
		expect(widget.fields).toEqual({ tone: "warm" })
		expect(widget.channels).toEqual(["main"])
		expect(widget.turnOrder).toEqual(doc.turnOrder)
		expect(widget.cast).toBe(doc.cast)
		expect("annex" in widget).toBe(false)
		expect("guests" in widget).toBe(false)
		expect("pipelines" in widget).toBe(false)
	})

	it("metadata and annex are present; the annex is the column, namespaced by owner", async () => {
		const session = await makeSession({ metadata: { note: "kept" } })
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc.metadata).toEqual({ note: "kept" })
		// Empty by default (migration 0153's `NOT NULL DEFAULT '{}'`, A5)…
		expect(doc.annex).toEqual({})
		// …and the whole column once an owner has written to it (§4.3): a
		// spec reads its own key out of it.
		await db
			.update(schema.sessions)
			.set({ annex: { "acme.rp": { clock: 3 } } })
			.where(eq(schema.sessions.id, session.id))
		const written = (await resolveSessionSettings(db, session.id))!
		expect(written.annex).toEqual({ "acme.rp": { clock: 3 } })
		// …which a widget never gets: it is given the viewer's own view (R57).
		expect("annex" in widgetSessionProjection(written)).toBe(false)
		// The turn-order state reads off metadata through `readTurnOrder`:
		// missing means the empty document, never undefined.
		expect(doc.turnOrder.v).toBe(1)
		expect(doc.turnOrder.order).toEqual([])
		// The state only (R28): no declared list and no `selected` — what a
		// session chose is `pipelines[slug].rebinds`, what it may choose is
		// on the registry.
		expect("strategies" in doc.turnOrder).toBe(false)
		expect("selected" in doc.turnOrder).toBe(false)
	})

	it("a session that does not exist resolves to null", async () => {
		expect(await resolveSessionSettings(db, 999_999)).toBeNull()
	})

	it("the cast carries the seated envoys, as session-cast@1 publishes them", async () => {
		const session = await makeSession()
		const [character] = await db
			.insert(schema.characters)
			.values({ userId, name: "Alice", description: "A knight." })
			.returning()
		await db.insert(schema.sessionCharacters).values({
			sessionId: session.id,
			characterId: character!.id,
			isActive: true,
		})
		const doc = (await resolveSessionSettings(db, session.id))!
		expect(doc.cast.sessionCharacters.map((c) => c.character.name)).toEqual(
			["Alice"]
		)
		expect(doc.cast.envoys).toEqual([])
		expect(doc.cast.sessionPersonas).toEqual([])
		// The book's roster is retrieval's, not the document's — the same
		// drop `session-cast@1`'s binding makes.
		expect("lorebookBindings" in doc.cast).toBe(false)
	})

	it("reaches a script hook as the read-only extra `session`", async () => {
		const session = await makeSession({ name: "Scripted" })
		const doc = (await resolveSessionSettings(db, session.id))!
		const { scriptExtras } = await import(
			"$lib/server/pipelines/scripts/chains"
		)
		const extras = await scriptExtras(db, {
			sessionId: session.id,
			session: doc
		})
		expect(extras.session).toBe(doc)
		expect((extras.session as any).title).toBe("Scripted")
	})
})

/**
 * `playerLabel` (lair re-plan R4): the session's override on `metadata`, else
 * the genre's, else absent — and a genre that declares none (Chat, a persona
 * genre) has none whatever the row holds, so its document and its cast read
 * are the objects they were.
 */
describe("playerLabel", () => {
	async function labelChat(label: unknown) {
		const row = await chatGenreRow()
		const genre = { ...(row.genre as Record<string, any>) }
		if (label === undefined) delete genre.playerLabel
		else genre.playerLabel = label
		await db
			.update(schema.pipelineSpecVersions)
			.set({ genre })
			.where(eq(schema.pipelineSpecVersions.id, row.id))
	}

	it("a genre that declares none: absent from the document and the cast, even with a stored value", async () => {
		await labelChat(undefined)
		const session = await makeSession({ metadata: { playerLabel: "Game Master" } })
		const doc = (await resolveSessionSettings(db, session.id))!
		expect("playerLabel" in doc).toBe(false)
		expect("playerLabel" in doc.cast).toBe(false)
	})

	it("the genre's label, then the session's override over it", async () => {
		await labelChat({ en: "Dungeon Master" })
		try {
			const plain = await makeSession()
			const doc = (await resolveSessionSettings(db, plain.id))!
			expect(doc.playerLabel).toBe("Dungeon Master")
			expect((doc.cast as any).playerLabel).toBe("Dungeon Master")

			const renamed = await makeSession({
				metadata: { playerLabel: "Game Master" }
			})
			const over = (await resolveSessionSettings(db, renamed.id))!
			expect(over.playerLabel).toBe("Game Master")
			expect((over.cast as any).playerLabel).toBe("Game Master")
		} finally {
			await labelChat(undefined)
		}
	})

	it("the override is written as its own metadata key, leaving the rest alone", async () => {
		const { writePlayerLabel } = await import("./playerLabel")
		const session = await makeSession({ metadata: { note: "kept" } })
		await writePlayerLabel(db, session.id, "  Game Master ")
		let [row] = await db
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(row!.metadata).toEqual({ note: "kept", playerLabel: "Game Master" })
		await writePlayerLabel(db, session.id, " ")
		;[row] = await db
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session.id))
		expect(row!.metadata).toEqual({ note: "kept" })
	})
})
