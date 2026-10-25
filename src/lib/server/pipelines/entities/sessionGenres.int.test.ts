/**
 * Session modes, read from rows (19 §0–§2, U-C1/U-C2).
 *
 * What is pinned: the mode *is* the input type — the picker is one SELECT
 * over shape-bearing input rows; the standard mode is present (the F29
 * floor) and states today's behaviour exactly; the shape validator refuses
 * in sentences; and every existing session resolves to the standard mode with
 * behaviour unchanged, which is the parity posture for this arc.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	STANDARD_GENRE_ID,
	sessionShapeFacts,
	getSessionGenre,
	listSessionGenres,
	listSessionFunctions,
	sessionPipeline,
	enabledSessionFunctions,
	setSessionFunction,
	setPresetActions,
	listGenreActions,
	genreFieldsFor,
	sessionGenreAvailable,
	resolveSubjectSpec,
	shapeViolations,
	upgradeSessionGenre
} from "$lib/server/pipelines/entities/sessionGenres"
import { sessionEvents } from "@serene-pub/sdk"
import { STORY_NARRATE_SPEC_ID } from "$lib/server/pipelines/specs/narrate"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs/respond"
import { writePresetChanges } from "$lib/server/pipelines/registrations/presetRows"
import {
	actionRegistrationKey,
	eventRegistration,
	rowOfDecl,
	rowOfDrop
} from "$lib/server/pipelines/registrations/rows"
import { upsertRow } from "$lib/server/pipelines/registrations/write"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

describe("the picker", () => {
	it("lists exactly the shape-bearing input types — the F29 floor among them", async () => {
		const modes = await listSessionGenres(db)
		const standard = modes.find((m) => m.genreId === STANDARD_GENRE_ID)
		expect(standard).toBeTruthy()
		// The standard genre is Story since 2026-10-19 (the roleplay Chat and
		// Adventure in one); the container is a session.
		expect(standard!.name).toBe("Story")
		// The card's subtitle rides the same row — display text, refreshed by
		// the boot sync without a version bump.
		expect(standard!.description).toContain("Roleplay and adventure in one")
		// Today's behaviour, stated: both participant systems optional and
		// unbounded above, lorebook optional, a text composer, character voice.
		expect(standard!.shape).toMatchObject({
			characters: { min: 0 },
			personas: { min: 0 },
			lorebook: "optional",
			composer: "text",
			voice: "character"
		})
		// Non-mode input types are not modes: summarize-request has no shape.
		expect(
			modes.some((m) => m.genreId.startsWith("core:inlet/summarize"))
		).toBe(false)
	})
})

describe("the shape validator", () => {
	it("refuses in sentences, per capability", () => {
		// The persona-only prose mode from the design session.
		const crawl = {
			characters: { min: 0, max: 0 },
			personas: { min: 1, max: 1 }
			// no lorebook capability: none permitted
		} as any

		expect(
			shapeViolations(crawl, {
				characters: 0,
				personas: 1,
				hasLorebook: false
			})
		).toEqual([])

		const violations = shapeViolations(crawl, {
			characters: 5,
			personas: 0,
			hasLorebook: true
		})
		expect(violations).toEqual([
			"this genre has no characters — the session has 5",
			"this genre needs at least 1 persona — the session has 0",
			"this genre has no lorebook attachment — the session has one"
		])
	})

	it("an omitted capability means none permitted; an omitted max means unbounded", () => {
		const prose = { personas: { min: 0 } } as any // no characters at all
		expect(
			shapeViolations(prose, {
				characters: 1,
				personas: 40,
				hasLorebook: false
			})
		).toEqual(["this genre has no characters — the session has 1"])
	})

	it("⏳ 'required' is retired (RF fix 2): a session may start without a lorebook — its own is its world", () => {
		const shape = { characters: { min: 0 }, personas: { min: 0 }, lorebook: "required" } as any
		expect(shapeViolations(shape, { characters: 1, personas: 0, hasLorebook: false })).toEqual([])
		expect(shapeViolations({ ...shape, lorebook: "optional" }, { characters: 1, personas: 0, hasLorebook: false })).toEqual([])
	})
})

describe("existing sessions", () => {
	it("every session resolves to the standard mode and satisfies its shape", async () => {
		const [user] = await db
			.insert(schema.users)
			.values({ username: "mode-test", isAdmin: false })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// The column default is the backfill: rows created with no knowledge
		// of modes land on the F29 floor.
		expect(session.genreId).toBe(STANDARD_GENRE_ID)

		const mode = await getSessionGenre(db, session.genreId)
		const facts = await sessionShapeFacts(db, session.id)
		expect(shapeViolations(mode!.shape, facts)).toEqual([])
	})

	it("a removed persona seat does not count toward the shape (U5g review, W2)", async () => {
		const [user] = await db
			.insert(schema.users)
			.values({ username: "persona-removed-test", isAdmin: false })
			.returning()
		const [active, departed] = await db
			.insert(schema.characters)
			.values([
				{
					userId: user.id,
					isPersona: true,
					name: "Active Persona",
					description: "Still here."
				},
				{
					userId: user.id,
					isPersona: true,
					name: "Departed Persona",
					description: "Not any more."
				}
			])
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		await db.insert(schema.sessionPersonas).values([
			{ sessionId: session.id, personaId: active!.id },
			{ sessionId: session.id, personaId: departed!.id, removedAt: new Date() }
		])
		const facts = await sessionShapeFacts(db, session.id)
		expect(facts.personas).toBe(1)
	})
})

describe("subject routing (19 §3, U-C3; plans/31 V2)", () => {
	it("the primary turn is the bucket: the inlet lock pins (genre, event)", async () => {
		expect(
			await resolveSubjectSpec(db, STANDARD_GENRE_ID, sessionEvents.messageRespond)
		).toBe(STORY_RESPOND_SPEC_ID)
	})

	it("the narrator action resolves to its declarer through contributed data, not a hardcoded branch", async () => {
		// This is the U-C3 proof: the narrate button reaching the narrate spec
		// is now a fact in a `contributes.actions` row, and deleting that
		// declaration from the spec would break this test — not a string
		// comparison in generateResponse.
		expect(
			await resolveSubjectSpec(db, STANDARD_GENRE_ID, `${STORY_NARRATE_SPEC_ID}#narrate`)
		).toBe(STORY_NARRATE_SPEC_ID)
	})

	it("a subject nothing serves resolves to null — the caller keeps its floor; so does a bare key", async () => {
		expect(
			await resolveSubjectSpec(db, STANDARD_GENRE_ID, "core:spec/summon#summon-dragon")
		).toBe(null)
		// Neither an identity nor an event id names anything.
		expect(await resolveSubjectSpec(db, STANDARD_GENRE_ID, "narrate")).toBe(null)
		// An unknown mode has no bucket and no contributors either.
		expect(
			await resolveSubjectSpec(
				db,
				"chariot.dungeon:inlet/crawl@1",
				sessionEvents.messageRespond
			)
		).toBe(null)
	})
})

describe("the fields round-trip (19 §1, U-C2)", () => {
	it("supplies stored values under declared keys only — a mode switch cannot smuggle facts", async () => {
		// A mode is a registry row, and rows are data: a synthetic
		// shape-bearing input stands in for the extension that would
		// declare one.
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "chariot.dungeon:inlet/crawl",
			version: 1,
			kind: "inlet",
			ports: { out: {} },
			slots: {},
			i18n: {
				name: { en: "Dungeon Crawl" },
				description: { en: "Torchlit. One persona, no cast." }
			},
			sessionShape: {
				personas: { min: 1, max: 1 },
				composer: "text",
				fields: {
					difficulty: { type: "enum", of: ["easy", "hard"] },
					torchCount: { type: "integer", min: 0 }
				}
			}
		} as any)

		const [user] = await db
			.insert(schema.users)
			.values({ username: "fields-test", isAdmin: false })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.dungeon:inlet/crawl@1",
				genreFields: {
					difficulty: "hard",
					torchCount: 3,
					// A key no shape declares — stale from an imagined
					// earlier mode, or simply forged. It must not reach
					// the run.
					smuggled: "payload"
				}
			} as any)
			.returning()

		expect(await genreFieldsFor(db, session.id)).toEqual({
			difficulty: "hard",
			torchCount: 3
		})

		// An extension mode's card text takes the same road as core's.
		const crawl = await getSessionGenre(
			db,
			"chariot.dungeon:inlet/crawl@1"
		)
		expect(crawl!.description).toBe("Torchlit. One persona, no cast.")
	})

	it("a standard-mode session supplies only its own fields' defaults — never a stored stray", async () => {
		const [user] = await db
			.insert(schema.users)
			.values({ username: "fields-std", isAdmin: false })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreFields: { anything: "at all" }
			} as any)
			.returning()
		// The standard mode is Story, and Story declares the author's note
		// and, from Adventure, its tone and difficulty.
		expect(await genreFieldsFor(db, session.id)).toEqual({
			// The note goes at the end unless moved (owner ruling 2026-10-03).
			authorsNote: { text: "", depth: 0, interval: 1, role: "system" },
			autoAdvance: "round",
			characterDetail: "full",
			difficulty: "normal",
			tone: "grounded",
			turnMode: "rules",
			// 🚧 The voices, genre settings since the tasks retired
			// (PLAN-layering §4, 2026-10-20). Rest's apply-or-propose follows
			// the reckoning's mode (R55, 2026-10-21) — no field.
			sideCast: false,
			narratorInterjections: false
		})
	})
})

// "The Turn order list" block retired 2026-09-23 with `listTurnStrategies`
// (R28): the offered list is the turn-order spec's own `expose.swaps` plus
// enabled contributions, pinned in entities/bindings.int.test.ts.

describe("the trigger set (19 §4, U-C5)", () => {
	it("the narrate button is a row: contributed by the narrate spec, for the standard mode", async () => {
		const triggers = await listGenreActions(db, STANDARD_GENRE_ID)
		// The narrate row specifically, not the whole set: any core spec that
		// contributes a button lands here too, and this test is about narrate's
		// row being a ROW — whole-list equality would make every new spec a
		// failure in a test that has nothing to say about it.
		// The action model's shape (R-15, U5c): a key, a venue LIST, the
		// audience defaults, `quick`, and the slash name derived from the key.
		expect(triggers.find((t) => t.key === "narrate")).toEqual({
			key: "narrate",
			venues: [{ kind: "composer" }],
			audience: { see: ["participant"], act: ["owner"] },
			// The effects line (U5d): a message-writing action stays in the fiction.
			effects: "fiction",
			quick: true,
			slash: "narrate",
			icon: "book-open-text",
			name: "Narrate",
			// Required since 2026-09-28: the action legend lists it.
			description: "Ask the narrator to describe what happens next.",
			// What should happen next, optionally (genre uplift C2,
			// 2026-09-29): what `/narrate <text>` fires with.
			collects: {
				text: {
					need: "optional",
					label: "What should happen next?",
					placeholder: "The storm breaks over the harbour.",
					ifEmpty: "The narrator decides."
				}
			},
			specSlug: STORY_NARRATE_SPEC_ID,
			// Classified where it is read, not where it is used (19 §3):
			// `core:spec/story-narrate` contributing to `core:inlet/user-message@1`
			// is the mode owner's own namespace, so a companion — present by
			// default. A foreign spec's would be an attachment, opt-in.
			origin: "companion",
			enabledByDefault: true
		})
	})

	it("a spec contributing a button gets one, with no client code at all", async () => {
		// The whole claim behind contributed triggers, checked on the newest one
		// rather than on narrate: a spec declares `contributes.actions`, the boot
		// sync writes a row, and the composer renders it through the generic
		// `fireOfferedAction` path. Nothing in the client knows what image generation is.
		//
		// This is also the image feature's entry point — if this row is missing
		// there is no way for a person to reach any of it.
		const triggers = await listGenreActions(db, STANDARD_GENRE_ID)
		expect(triggers.find((t) => t.key === "generate-image")).toEqual({
			key: "generate-image",
			venues: [{ kind: "composer" }],
			audience: { see: ["participant"], act: ["owner"] },
			// The effects line (U5d): a message-writing action stays in the fiction.
			effects: "fiction",
			quick: true,
			// The prompt is collected in the collect modal (lair pass R3).
			collects: { text: { need: "required", label: "What should the image show?" } },
			slash: "generate-image",
			icon: "image",
			name: "Image",
			description: "Describe an image, make it and post it in the session.",
			specSlug: "core:spec/story-generate-image",
			origin: "companion",
			enabledByDefault: true
		})
	})

	it("retiring the contributor removes its button — no UI code involved", async () => {
		const { eq } = await import("drizzle-orm")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_NARRATE_SPEC_ID))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: null })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		try {
			const gone = await listGenreActions(db, STANDARD_GENRE_ID)
			expect(gone.find((t) => t.key === "narrate")).toBeUndefined()
			// And routing agrees in the same breath: the same rows feed both.
			expect(
				await resolveSubjectSpec(
					db,
					STANDARD_GENRE_ID,
					`${STORY_NARRATE_SPEC_ID}#narrate`
				)
			).toBe(null)
		} finally {
			await db
				.update(schema.pipelineSpecs)
				.set({ activeVersionId: spec.activeVersionId })
				.where(eq(schema.pipelineSpecs.id, spec.id))
		}
	})
})

describe("mode lifecycle (19 §6, ruled 2026-08-23)", () => {
	it("there is no mid-session swap; a mode upgrades along its own type, shape-checked", async () => {
		// The crawl mode grows a v2 — same bare type, higher version, one
		// more field. Rows are data.
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "chariot.dungeon:inlet/crawl",
			version: 2,
			kind: "inlet",
			ports: { out: {} },
			slots: {},
			i18n: { name: { en: "Dungeon Crawl II" } },
			sessionShape: {
				characters: { min: 0, max: 0 },
				personas: { min: 1, max: 1 },
				fields: {
					difficulty: { type: "enum", of: ["easy", "hard"] },
					torchCount: { type: "integer" },
					lanternOil: { type: "integer" }
				}
			}
		} as any)

		const [user] = await db
			.insert(schema.users)
			.values({ username: "lifecycle-test", isAdmin: false })
			.returning()
		const [persona] = await db
			.insert(schema.characters)
			.values({
				userId: user.id,
				isPersona: true,
				name: "Wanderer",
				description: "A lone traveller."
			})
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.dungeon:inlet/crawl@1",
				genreFields: { difficulty: "hard", torchCount: 3 }
			} as any)
			.returning()
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: persona.id })

		// A cross-type swap refuses, however well the cast would fit.
		const swap = await upgradeSessionGenre(
			db,
			session.id,
			STANDARD_GENRE_ID
		)
		expect(swap.error).toContain("keeps its genre for life")

		// The upgrade along the same type passes, and the field values ride.
		expect(
			await upgradeSessionGenre(
				db,
				session.id,
				"chariot.dungeon:inlet/crawl@2"
			)
		).toEqual({})
		expect(await genreFieldsFor(db, session.id)).toEqual({
			difficulty: "hard",
			torchCount: 3
		})

		// Versions move one way.
		const down = await upgradeSessionGenre(
			db,
			session.id,
			"chariot.dungeon:inlet/crawl@1"
		)
		expect(down.error).toContain("versions move one way")

		// An upgrade whose shape the session violates refuses with the
		// sentences: v3 forbids personas.
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "chariot.dungeon:inlet/crawl",
			version: 3,
			kind: "inlet",
			ports: { out: {} },
			slots: {},
			i18n: { name: { en: "Dungeon Crawl III" } },
			sessionShape: { personas: { min: 0, max: 0 } }
		} as any)
		const tightened = await upgradeSessionGenre(
			db,
			session.id,
			"chariot.dungeon:inlet/crawl@3"
		)
		expect(tightened.error).toContain("does not fit")
		expect(tightened.error).toContain("no personas — the session has 1")
	})

	it("a missing mode makes the session read-only; the standard mode never can", async () => {
		const [user] = await db
			.insert(schema.users)
			.values({ username: "readonly-test", isAdmin: false })
			.returning()

		// A session on a mode nothing registers: read-only, with the reason.
		const [orphan] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.gone:inlet/vanished@1"
			} as any)
			.returning()
		const check = await sessionGenreAvailable(db, orphan.id)
		expect(check.available).toBe(false)
		expect(check.reason).toContain("read-only")
		expect(check.reason).toContain("chariot.gone:inlet/vanished@1")

		// A registered custom mode is available.
		const [crawler] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.dungeon:inlet/crawl@1"
			} as any)
			.returning()
		expect(
			(await sessionGenreAvailable(db, crawler.id)).available
		).toBe(true)

		// The standard mode is the F29 floor — available by definition.
		const [standard] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		expect(
			(await sessionGenreAvailable(db, standard.id)).available
		).toBe(true)
	})
})

describe("a genre upgrade seats the defaults the new version brings (U5g review, W3)", () => {
	/**
	 * A genre is a create spec's version row (24 §3), so two versions of one
	 * genre are two rows: `lodge@1` declaring no envoys, `lodge@2` declaring
	 * a default `keeper`. Rows are data — inserted directly, as the registry
	 * rows above are.
	 */
	const createSpecRow = async (
		slug: string,
		genreId: string,
		envoys: unknown[] | undefined
	) => {
		const [spec] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()
		const [version] = await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec!.id,
				semver: "1.0.0",
				schemaVersion: 1,
				canonicalHash: `${slug}-hash`,
				status: "published",
				publishedAt: new Date(),
				genre: {
					name: { en: genreId },
					family: "chat",
					shape: { characters: { min: 0, max: 0 }, personas: { min: 0, max: 1 } },
					...(envoys ? { envoys } : {})
				},
				inputGenre: genreId,
				inputEvent: sessionEvents.sessionCreated
			} as any)
			.returning()
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version!.id })
			.where(eq(schema.pipelineSpecs.id, spec!.id))
	}

	it("lodge@1 → lodge@2 seats the keeper; a seat the person unseated is not revived", async () => {
		await createSpecRow("test.lodge:spec/create-v1", "test.lodge:genre/lodge@1", undefined)
		await createSpecRow("test.lodge:spec/create-v2", "test.lodge:genre/lodge@2", [
			{ key: "keeper", name: { en: "Keeper" }, default: true, speaks: "in-turn" },
			{ key: "porter", name: { en: "Porter" }, speaks: "in-turn" }
		])
		const { invalidateDeclaredEnvoys, seatedEnvoys, unseatEnvoy } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		invalidateDeclaredEnvoys()

		const [user] = await db
			.insert(schema.users)
			.values({ username: "lodge-upgrade", isAdmin: false })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user!.id, isGroup: false, genreId: "test.lodge:genre/lodge@1" } as any)
			.returning()
		const seats = () =>
			db
				.select({
					envoySlug: schema.sessionCharacters.envoySlug,
					removedAt: schema.sessionCharacters.removedAt
				})
				.from(schema.sessionCharacters)
				.where(eq(schema.sessionCharacters.sessionId, session!.id))
		expect(await seats()).toEqual([])

		expect(
			await upgradeSessionGenre(db, session!.id, "test.lodge:genre/lodge@2")
		).toEqual({})
		// The default is seated, the offered one is not, and the seat reads
		// back joined to its declaration.
		expect(await seats()).toEqual([{ envoySlug: "keeper", removedAt: null }])
		expect(
			(await seatedEnvoys(db, session!.id)).map((e) => [e.slug, e.default, e.speaks])
		).toEqual([["keeper", true, "in-turn"]])

		// A person's choice survives: unseated, then a third version that
		// still declares the keeper as default does not put it back.
		await unseatEnvoy(db, session!.id, "keeper")
		await createSpecRow("test.lodge:spec/create-v3", "test.lodge:genre/lodge@3", [
			{ key: "keeper", name: { en: "Keeper" }, default: true, speaks: "in-turn" }
		])
		invalidateDeclaredEnvoys()
		expect(
			await upgradeSessionGenre(db, session!.id, "test.lodge:genre/lodge@3")
		).toEqual({})
		const after = await seats()
		expect(after.length).toBe(1)
		expect(after[0]!.envoySlug).toBe("keeper")
		expect(after[0]!.removedAt).not.toBeNull()
	})
})

/**
 * Which of a mode's actions a session has (19 §3) — the three layers.
 *
 * The claim worth pinning is not that a checkbox stores a boolean. It is that
 * three sources answer in a fixed order — the session's own row, then its
 * preset's included set, then the companion rule — and that each is consulted
 * only where the one above said nothing. That ordering is what lets a preset
 * change reach sessions that never had a view while leaving alone the ones that
 * did, and it is the only part of this a later edit could quietly break.
 */
describe("session actions resolve through session, preset, then default", () => {
	let sessionId: number
	let userId: number

	beforeAll(async () => {
		const [u] = await db
			.insert(schema.users)
			.values({ username: "fn-actor", isAdmin: false })
			.returning()
		userId = u.id
		const [c] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, genreId: STANDARD_GENRE_ID })
			.returning()
		sessionId = c.id
	}, 30_000)

	const narrate = async () =>
		(
			await listSessionFunctions(
				db,
				sessionId,
				STANDARD_GENRE_ID,
				userId
			)
		).find((f) => f.key === "narrate")!

	it("offers the mode's contributed actions, and not respond", async () => {
		const all = await listSessionFunctions(
			db,
			sessionId,
			STANDARD_GENRE_ID,
			userId
		)
		expect(all.map((f) => f.key)).toContain("narrate")
		// The primary turn is an event (§3), not a contribution — a session
		// that could not reply would not be a session, so it is never in this list.
		expect(all.map((f) => f.key)).not.toContain("respond")
	})

	it("starts a companion on, with the default answering", async () => {
		const n = await narrate()
		// core:spec/story-narrate contributing to core:inlet/user-message@1 — same
		// namespace, so a companion by the mechanical rule.
		expect(n.origin).toBe("companion")
		expect(n.enabled).toBe(true)
		expect(n.explicit).toBe(false)
		expect(n.source).toBe("default")
	})

	it("a session row overrides the default, and says it did", async () => {
		const r = await setSessionFunction(
			db,
			sessionId,
			STANDARD_GENRE_ID,
			"narrate",
			false,
			{ userId, isAdmin: false }
		)
		expect(r.ok).toBe(true)

		const n = await narrate()
		expect(n.enabled).toBe(false)
		expect(n.explicit).toBe(true)
		expect(n.source).toBe("session")

		// And it is gone from what the view renders and what may fire.
		const live = await enabledSessionFunctions(
			db,
			sessionId,
			STANDARD_GENRE_ID,
			userId
		)
		expect(live.map((f) => f.key)).not.toContain("narrate")
	})

	it("returning it to the default deletes the row rather than storing it", async () => {
		await setSessionFunction(
			db,
			sessionId,
			STANDARD_GENRE_ID,
			"narrate",
			true,
			{ userId, isAdmin: false }
		)
		const n = await narrate()
		expect(n.enabled).toBe(true)
		// The distinction the whole layering rests on: "no opinion" has to stay
		// spellable, or a later change of preset reaches nobody.
		expect(n.explicit).toBe(false)

		const rows = await db
			.select()
			.from(schema.sessionFunctions)
			.where(eq(schema.sessionFunctions.sessionId, sessionId))
		expect(rows).toHaveLength(0)
	})

	it("refuses an action the mode was never offered, by name", async () => {
		const r = await setSessionFunction(
			db,
			sessionId,
			STANDARD_GENRE_ID,
			"teleport",
			true,
			{ userId, isAdmin: true }
		)
		expect(r.ok).toBe(false)
		expect(r.error).toContain("teleport")
	})

	it("refuses a mode the session is not in", async () => {
		const r = await setSessionFunction(
			db,
			sessionId,
			"core:inlet/other@1",
			"narrate",
			false,
			{ userId, isAdmin: true }
		)
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/not .*core:inlet\/other@1|is in/)
	})
})

/**
 * The preset layer, and the permission line that runs through it.
 *
 * A preset excluding an action is the interesting case: the action is still
 * contributed to the mode and still resolvable, so nothing stops it *except*
 * this layer — and a non-admin may not step over it.
 */
/**
 * 🚧 A preset decides what a session includes by its registrations (PLAN-
 * layering D7, R2): a preset that drops an action's registration leaves it
 * out of every session on it; a session's own row is the exception.
 */
describe("a preset decides what a session includes", () => {
	let sessionId: number
	let userId: number
	let presetId: number

	beforeAll(async () => {
		const [u] = await db
			.insert(schema.users)
			.values({ username: "preset-actor", isAdmin: false })
			.returning()
		userId = u.id
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({ name: "No narrator", genreId: STANDARD_GENRE_ID })
			.returning()
		presetId = preset.id
		await writePresetChanges(db as any, presetId, {
			drop: [actionRegistrationKey(`${STORY_NARRATE_SPEC_ID}#narrate`)]
		})
		const [c] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, genreId: STANDARD_GENRE_ID, presetId })
			.returning()
		sessionId = c.id
	}, 30_000)

	it("excluding an action turns it off for sessions on that preset", async () => {
		const n = (
			await listSessionFunctions(db, sessionId, STANDARD_GENRE_ID, userId)
		).find((f) => f.key === "narrate")!
		expect(n.included).toBe(false)
		expect(n.enabled).toBe(false)
		expect(n.source).toBe("preset")
	})

	it("a non-admin may not switch on what the preset left out", async () => {
		const r = await setSessionFunction(db, sessionId, STANDARD_GENRE_ID, "narrate", true, {
			userId,
			isAdmin: false
		})
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/administrator/i)
	})

	it("an admin may, and it lands on that session alone", async () => {
		const r = await setSessionFunction(db, sessionId, STANDARD_GENRE_ID, "narrate", true, {
			userId,
			isAdmin: true
		})
		expect(r.ok).toBe(true)
		const n = (
			await listSessionFunctions(db, sessionId, STANDARD_GENRE_ID, userId)
		).find((f) => f.key === "narrate")!
		expect(n.enabled).toBe(true)
		expect(n.source).toBe("session")
		// The preset is unchanged — the exception is the session's own row.
		const presetRows = await db
			.select()
			.from(schema.registrations)
			.where(eq(schema.registrations.presetId, presetId))
		expect(presetRows.map((r) => [r.key, r.dropped])).toEqual([
			[actionRegistrationKey(`${STORY_NARRATE_SPEC_ID}#narrate`), true]
		])
	})

	it("a non-admin may still switch an excluded action back off", async () => {
		// Only turning *on* is gated. Refusing someone the ability to give up
		// something they already have would be a rule with nobody to protect.
		const r = await setSessionFunction(db, sessionId, STANDARD_GENRE_ID, "narrate", false, {
			userId,
			isAdmin: false
		})
		expect(r.ok).toBe(true)
	})

	it("a configuration no longer carries actions (R38)", async () => {
		const r = await setPresetActions(db, 1, { includedActions: [] })
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/configurations are retired/)
	})
})

/**
 * 🚧 The session's "Configuration" menu is retired with configurations (R38,
 * PLAN-layering D7): nothing to pick, and an old client's pick is refused in
 * a sentence. What a session runs follows its preset.
 */
describe("a session runs on a preset", () => {
	let sessionId: number
	let userId: number

	beforeAll(async () => {
		const [u] = await db
			.insert(schema.users)
			.values({ username: "preset-picker", isAdmin: false })
			.returning()
		userId = u.id
		const [c] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, genreId: STANDARD_GENRE_ID })
			.returning()
		sessionId = c.id
	}, 30_000)

	it("changing preset changes which actions the session includes", async () => {
		const narrateOn = async () =>
			(await listSessionFunctions(db, sessionId, STANDARD_GENRE_ID, userId)).find((f) => f.key === "narrate")!
		expect((await narrateOn()).included).toBe(true)
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({ name: "No narrator either", genreId: STANDARD_GENRE_ID })
			.returning()
		await writePresetChanges(db as any, preset.id, {
			drop: [actionRegistrationKey(`${STORY_NARRATE_SPEC_ID}#narrate`)]
		})
		await db.update(schema.sessions).set({ presetId: preset.id }).where(eq(schema.sessions.id, sessionId))
		const n = await narrateOn()
		expect(n.included).toBe(false)
		expect(n.source).toBe("preset")
	})
})

/**
 * Bucket membership is both ends of the pipeline (19 §0).
 *
 * ⚠ This exists because the `respond` bucket checked only the entry input.
 * `core:spec/graph-build` pins `core:inlet/user-message@1` — it reads a session
 * exactly the way a reply does — and writes a *graph proposal*. Without the
 * primary-write half of the signature it sat in the standard mode's respond
 * bucket, so "which pipeline answers a message" could resolve to the graph
 * builder. `generateResponse` asks this resolver, so that is the session path.
 *
 * It surfaced as a preset picker showing one pipeline's presets while the
 * session ran on another's, and it was invisible in tests because the tie-break
 * rode on an unordered SELECT: a freshly seeded database happened to return
 * the right spec first, and a long-lived one did not.
 */
/**
 * R-6 (ruled 2026-09-15, built 2026-09-16): a session's own binding resolves
 * before its preset — a session is a work, not a preference (12 §2). Until
 * this the preset answered first and the session's own row could never win,
 * which inverted the one ordering rule the layer model states.
 *
 * Three pins: the session's binding beats the preset; a session binding whose
 * spec is no longer a candidate falls through to the preset (eligibility is
 * re-checked at every layer, as it always was); and the instance's binding
 * still sits below the preset.
 */
describe("a session's own binding beats its preset (R-6)", () => {
	const OTHER = "test:spec/respond-other"
	let presetId: number
	let sessionId: number

	/** A second pipeline that writes a reply, so "which layer chose" is visible. */
	async function cloneRespondSpec(slug: string): Promise<number> {
		const [spec] = (await db
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()) as any[]
		const [version] = (await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: `hash-${slug}`,
				publishedAt: new Date()
			})
			.returning()) as any[]
		await db.insert(schema.pipelineNodes).values({
			specVersionId: version.id,
			nodeKey: "write",
			kind: "outlet",
			definitionId: "core:outlet/create-message",
			position: 0
		})
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		return spec.id
	}

	const REPLY_KEY = eventRegistration(sessionEvents.messageRespond, STORY_RESPOND_SPEC_ID).key
	const scope = () => ({ kind: "session" as const, sessionId })
	const own = async (pipeline: string) => {
		await upsertRow(db as any, rowOfDrop(REPLY_KEY, scope(), "owner"))
		await upsertRow(db as any, rowOfDecl(eventRegistration(sessionEvents.messageRespond, pipeline), scope(), "owner"))
	}
	const clear = async () =>
		db
			.delete(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(sessionId))))

	const verdict = async () => {
		const { resolveSubjectVerdict } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		return resolveSubjectVerdict(db, STANDARD_GENRE_ID, sessionEvents.messageRespond, {
			sessionId
		})
	}

	beforeAll(async () => {
		await cloneRespondSpec(OTHER)
		// An administrator's preset that changes nothing — the genre's defaults.
		const [preset] = (await db
			.insert(schema.sessionPresets)
			.values({ name: "R-6 preset", genreId: STANDARD_GENRE_ID })
			.returning()) as any[]
		presetId = preset.id
		const [u] = await db
			.insert(schema.users)
			.values({ username: "r6-owner", isAdmin: false })
			.returning()
		const [c] = (await db
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, genreId: STANDARD_GENRE_ID, presetId })
			.returning()) as any[]
		sessionId = c.id
	}, 60_000)

	it("with no row of its own, the preset decides", async () => {
		await clear()
		expect((await verdict()).spec).toBe(STORY_RESPOND_SPEC_ID)
	})

	it("a session's own registration beats its preset", async () => {
		await clear()
		await own(OTHER)
		try {
			const v = await verdict()
			expect(v.spec).toBe(OTHER)
			// The preset decided nothing here, so there is no substitution to report.
			expect(v.fallback).toBeUndefined()
		} finally {
			await clear()
		}
	})

	it("a session registration whose pipeline is gone falls back to the preset's", async () => {
		await clear()
		await own("test:spec/never-published")
		try {
			expect((await verdict()).spec).toBe(STORY_RESPOND_SPEC_ID)
		} finally {
			await clear()
		}
	})

	it("a pub-wide binding answers nothing any more (R33)", async () => {
		await clear()
		const [other] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, OTHER))
			.limit(1)
		await db.insert(schema.pipelineBindings).values({
			scopeKind: "pub",
			scopeId: 0,
			genreId: STANDARD_GENRE_ID,
			subject: sessionEvents.messageRespond,
			specId: other!.id
		})
		try {
			expect((await verdict()).spec).toBe(STORY_RESPOND_SPEC_ID)
			const { resolveSubjectVerdict } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			expect(
				(await resolveSubjectVerdict(db, STANDARD_GENRE_ID, sessionEvents.messageRespond)).spec
			).toBe(STORY_RESPOND_SPEC_ID)
		} finally {
			await db.delete(schema.pipelineBindings).where(eq(schema.pipelineBindings.genreId, STANDARD_GENRE_ID))
		}
	})
})

describe("the respond bucket is read *and* write", () => {
	it("resolves the standard mode to the reply pipeline", async () => {
		const slug = await resolveSubjectSpec(
			db,
			STANDARD_GENRE_ID,
			sessionEvents.messageRespond
		)
		expect(slug).toBe(STORY_RESPOND_SPEC_ID)
	})

	it("leaves out a pipeline that reads a session but writes something else", async () => {
		// graph-build's entry input is the standard mode's type, so the input
		// half alone would admit it. Its consumer writes a proposal.
		const nodes = await db.select().from(schema.pipelineNodes)
		const [graph] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/graph-build"))
			.limit(1)
		const mine = (nodes as any[]).filter(
			(n) => n.specVersionId === graph.activeVersionId
		)
		expect(
			mine.some(
				(n) =>
					n.kind === "inlet" && n.definitionId === "core:inlet/user-message"
			),
			"the fixture no longer reproduces the case"
		).toBe(true)
		expect(
			mine.some(
				(n) =>
					n.kind === "outlet" &&
					n.definitionId === "core:outlet/create-message"
			)
		).toBe(false)

		// …so it must not be *eligible*, which is stronger than "does not
		// happen to win". Asserted through a binding, because eligibility is
		// re-checked at read (19 §3): binding respond to graph-build should
		// fall through to the reply pipeline rather than route to it.
		//
		// Written this way deliberately. Asserting only on the winner passed
		// with the check removed — respond sorts first either way — so the
		// test proved nothing about the rule it was named for.
		await db.insert(schema.pipelineBindings).values({
			scopeKind: "pub",
			scopeId: 0,
			genreId: STANDARD_GENRE_ID,
			subject: sessionEvents.messageRespond,
			specId: graph.id
		})
		try {
			const slug = await resolveSubjectSpec(
				db,
				STANDARD_GENRE_ID,
				sessionEvents.messageRespond
			)
			expect(slug).toBe(STORY_RESPOND_SPEC_ID)
		} finally {
			await db
				.delete(schema.pipelineBindings)
				.where(eq(schema.pipelineBindings.specId, graph.id))
		}
	})

	it("a session's pipeline is the one that answers it", async () => {
		const [u] = await db
			.insert(schema.users)
			.values({ username: "bucket-actor", isAdmin: false })
			.returning()
		const [c] = await db
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, genreId: STANDARD_GENRE_ID })
			.returning()

		const pipeline = await sessionPipeline(
			db,
			c.id,
			STANDARD_GENRE_ID,
			u.id
		)
		expect(pipeline?.specSlug).toBe(STORY_RESPOND_SPEC_ID)
	})
})
