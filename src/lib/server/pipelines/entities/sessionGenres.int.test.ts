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
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	STANDARD_GENRE_ID,
	sessionShapeFacts,
	getSessionGenre,
	listSessionGenres,
	listSessionFunctions,
	listSessionPresets,
	chooseSessionPreset,
	sessionPipeline,
	enabledSessionFunctions,
	setSessionFunction,
	setPresetActions,
	listGenreTriggers,
	listSpeakerStrategies,
	genreFieldsFor,
	sessionGenreAvailable,
	resolveFunctionSpec,
	shapeViolations,
	upgradeSessionGenre
} from "$lib/server/pipelines/entities/sessionGenres"
import { NARRATE_SPEC_ID } from "$lib/server/pipelines/specs/narrate"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs/respond"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)
}, 60_000)

describe("the picker", () => {
	it("lists exactly the shape-bearing input types — the F29 floor among them", async () => {
		const modes = await listSessionGenres(db as any)
		const standard = modes.find((m) => m.genreId === STANDARD_GENRE_ID)
		expect(standard).toBeTruthy()
		// The one place "Chat" survives: it is the standard MODE's display
		// name (ruled 2026-08-24) — the container is a session.
		expect(standard!.name).toBe("Chat")
		// The card's subtitle rides the same row — display text, refreshed by
		// the boot sync without a version bump.
		expect(standard!.description).toContain("standard roleplay chat")
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
			modes.some((m) => m.genreId.startsWith("core:input/summarize"))
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

		const mode = await getSessionGenre(db as any, session.genreId)
		const facts = await sessionShapeFacts(db as any, session.id)
		expect(shapeViolations(mode!.shape, facts)).toEqual([])
	})
})

describe("function routing (19 §3, U-C3)", () => {
	it("respond is the bucket: the entry node pins the mode's type", async () => {
		expect(
			await resolveFunctionSpec(db as any, STANDARD_GENRE_ID, "respond")
		).toBe(RESPOND_SPEC_ID)
	})

	it("narrate resolves through contributed data, not a hardcoded branch", async () => {
		// This is the U-C3 proof: the narrate button reaching the narrate spec
		// is now a fact in a `contributes.triggers` row, and deleting that
		// declaration from the spec would break this test — not a string
		// comparison in generateResponse.
		expect(
			await resolveFunctionSpec(db as any, STANDARD_GENRE_ID, "narrate")
		).toBe(NARRATE_SPEC_ID)
	})

	it("a function nothing serves resolves to null — the caller keeps its floor", async () => {
		expect(
			await resolveFunctionSpec(
				db as any,
				STANDARD_GENRE_ID,
				"summon-dragon"
			)
		).toBe(null)
		// An unknown mode has no bucket and no contributors either.
		expect(
			await resolveFunctionSpec(
				db as any,
				"chariot.dungeon:input/crawl@1",
				"respond"
			)
		).toBe(null)
	})
})

describe("the fields round-trip (19 §1, U-C2)", () => {
	it("supplies stored values under declared keys only — a mode switch cannot smuggle facts", async () => {
		// A mode is a registry row, and rows are data: a synthetic
		// shape-bearing input stands in for the extension that would
		// declare one.
		await db.insert(schema.pipelineTypeRegistry).values({
			typeId: "chariot.dungeon:input/crawl",
			version: 1,
			kind: "input",
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
				genreId: "chariot.dungeon:input/crawl@1",
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

		expect(await genreFieldsFor(db as any, session.id)).toEqual({
			difficulty: "hard",
			torchCount: 3
		})

		// An extension mode's card text takes the same road as core's.
		const crawl = await getSessionGenre(
			db as any,
			"chariot.dungeon:input/crawl@1"
		)
		expect(crawl!.description).toBe("Torchlit. One persona, no cast.")
	})

	it("a standard-mode session supplies {} — the shape declares no fields", async () => {
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
		expect(await genreFieldsFor(db as any, session.id)).toEqual({})
	})
})

describe("the swap list (19 §5, U-C4)", () => {
	it("lists core's four strategies, by shape rather than by list", async () => {
		const strategies = await listSpeakerStrategies(db as any)
		expect(strategies.map((s) => s.typeId)).toEqual(
			expect.arrayContaining([
				"core:task/turn-round-robin@1",
				"core:task/turn-random@1",
				"core:task/turn-manual@1",
				"core:task/turn-none@1"
			])
		)
		// Non-strategy tasks are not in the dropdown.
		expect(
			strategies.some((s) => s.typeId.startsWith("core:task/assemble"))
		).toBe(false)
	})

	it("an extension-shaped strategy appears by being registered — no registration step", async () => {
		await db.insert(schema.pipelineTypeRegistry).values({
			typeId: "chariot.council:task/turn-seniority",
			version: 1,
			kind: "task",
			ports: {
				in: {},
				out: { main: "core:shape/speaker-selection@1" }
			},
			slots: {},
			i18n: { name: { en: "By seniority" } }
		} as any)
		const strategies = await listSpeakerStrategies(db as any)
		expect(
			strategies.find(
				(s) => s.typeId === "chariot.council:task/turn-seniority@1"
			)?.name
		).toBe("By seniority")
	})
})

describe("the trigger set (19 §4, U-C5)", () => {
	it("the narrate button is a row: contributed by the narrate spec, for the standard mode", async () => {
		const triggers = await listGenreTriggers(db as any, STANDARD_GENRE_ID)
		// The narrate row specifically, not the whole set: any core spec that
		// contributes a button lands here too, and this test is about narrate's
		// row being a ROW — whole-list equality would make every new spec a
		// failure in a test that has nothing to say about it.
		expect(triggers.find((t) => t.function === "narrate")).toEqual({
			function: "narrate",
			kind: "button",
			icon: "book-open-text",
			name: "Narrate",
			specSlug: NARRATE_SPEC_ID,
			// Classified where it is read, not where it is used (19 §3):
			// `core:spec/narrate` contributing to `core:input/user-message@1`
			// is the mode owner's own namespace, so a companion — present by
			// default. A foreign spec's would be an attachment, opt-in.
			origin: "companion",
			enabledByDefault: true
		})
	})

	it("a spec contributing a button gets one, with no client code at all", async () => {
		// The whole claim behind contributed triggers, checked on the newest one
		// rather than on narrate: a spec declares `contributes.triggers`, the boot
		// sync writes a row, and the composer renders it through the generic
		// `fireTrigger` path. Nothing in the client knows what image generation is.
		//
		// This is also the image feature's entry point — if this row is missing
		// there is no way for a person to reach any of it.
		const triggers = await listGenreTriggers(db as any, STANDARD_GENRE_ID)
		expect(triggers.find((t) => t.function === "generate-image")).toEqual({
			function: "generate-image",
			kind: "button",
			icon: "image",
			name: "Image",
			specSlug: "core:spec/generate-image",
			origin: "companion",
			enabledByDefault: true
		})
	})

	it("retiring the contributor removes its button — no UI code involved", async () => {
		const { eq } = await import("drizzle-orm")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: null })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		try {
			const gone = await listGenreTriggers(db as any, STANDARD_GENRE_ID)
			expect(gone.find((t) => t.function === "narrate")).toBeUndefined()
			// And routing agrees in the same breath: the same rows feed both.
			expect(
				await resolveFunctionSpec(
					db as any,
					STANDARD_GENRE_ID,
					"narrate"
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
		await db.insert(schema.pipelineTypeRegistry).values({
			typeId: "chariot.dungeon:input/crawl",
			version: 2,
			kind: "input",
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
			.insert(schema.personas)
			.values({
				userId: user.id,
				name: "Wanderer",
				description: "A lone traveller.",
				isDefault: false
			})
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.dungeon:input/crawl@1",
				genreFields: { difficulty: "hard", torchCount: 3 }
			} as any)
			.returning()
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: persona.id })

		// A cross-type swap refuses, however well the cast would fit.
		const swap = await upgradeSessionGenre(
			db as any,
			session.id,
			STANDARD_GENRE_ID
		)
		expect(swap.error).toContain("keeps its genre for life")

		// The upgrade along the same type passes, and the field values ride.
		expect(
			await upgradeSessionGenre(
				db as any,
				session.id,
				"chariot.dungeon:input/crawl@2"
			)
		).toEqual({})
		expect(await genreFieldsFor(db as any, session.id)).toEqual({
			difficulty: "hard",
			torchCount: 3
		})

		// Versions move one way.
		const down = await upgradeSessionGenre(
			db as any,
			session.id,
			"chariot.dungeon:input/crawl@1"
		)
		expect(down.error).toContain("versions move one way")

		// An upgrade whose shape the session violates refuses with the
		// sentences: v3 forbids personas.
		await db.insert(schema.pipelineTypeRegistry).values({
			typeId: "chariot.dungeon:input/crawl",
			version: 3,
			kind: "input",
			ports: { out: {} },
			slots: {},
			i18n: { name: { en: "Dungeon Crawl III" } },
			sessionShape: { personas: { min: 0, max: 0 } }
		} as any)
		const tightened = await upgradeSessionGenre(
			db as any,
			session.id,
			"chariot.dungeon:input/crawl@3"
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
				genreId: "chariot.gone:input/vanished@1"
			} as any)
			.returning()
		const check = await sessionGenreAvailable(db as any, orphan.id)
		expect(check.available).toBe(false)
		expect(check.reason).toContain("read-only")
		expect(check.reason).toContain("chariot.gone:input/vanished@1")

		// A registered custom mode is available.
		const [crawler] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				genreId: "chariot.dungeon:input/crawl@1"
			} as any)
			.returning()
		expect(
			(await sessionGenreAvailable(db as any, crawler.id)).available
		).toBe(true)

		// The standard mode is the F29 floor — available by definition.
		const [standard] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()
		expect(
			(await sessionGenreAvailable(db as any, standard.id)).available
		).toBe(true)
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
				db as any,
				sessionId,
				STANDARD_GENRE_ID,
				userId
			)
		).find((f) => f.function === "narrate")!

	it("offers the mode's contributed actions, and not respond", async () => {
		const all = await listSessionFunctions(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			userId
		)
		expect(all.map((f) => f.function)).toContain("narrate")
		// `respond` is intrinsic (§3), not a contribution — a session that could
		// not reply would not be a session, so it is never in this list.
		expect(all.map((f) => f.function)).not.toContain("respond")
	})

	it("starts a companion on, with the default answering", async () => {
		const n = await narrate()
		// core:spec/narrate contributing to core:input/user-message@1 — same
		// namespace, so a companion by the mechanical rule.
		expect(n.origin).toBe("companion")
		expect(n.enabled).toBe(true)
		expect(n.explicit).toBe(false)
		expect(n.source).toBe("default")
	})

	it("a session row overrides the default, and says it did", async () => {
		const r = await setSessionFunction(
			db as any,
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
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			userId
		)
		expect(live.map((f) => f.function)).not.toContain("narrate")
	})

	it("returning it to the default deletes the row rather than storing it", async () => {
		await setSessionFunction(
			db as any,
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
			db as any,
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
			db as any,
			sessionId,
			"core:input/other@1",
			"narrate",
			false,
			{ userId, isAdmin: true }
		)
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/not .*core:input\/other@1|is in/)
	})
})

/**
 * The preset layer, and the permission line that runs through it.
 *
 * A preset excluding an action is the interesting case: the action is still
 * contributed to the mode and still resolvable, so nothing stops it *except*
 * this layer — and a non-admin may not step over it.
 */
describe("a preset decides what a session includes", () => {
	let sessionId: number
	let userId: number
	let configId: number

	beforeAll(async () => {
		const [u] = await db
			.insert(schema.users)
			.values({ username: "preset-actor", isAdmin: false })
			.returning()
		userId = u.id
		const [c] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, genreId: STANDARD_GENRE_ID })
			.returning()
		sessionId = c.id

		// A mutable preset on the respond pipeline, selected at session scope —
		// the shipped one is immutable and refuses edits by design.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
		const [cfg] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "No narrator" })
			.returning()
		configId = cfg.id
		await db.insert(schema.pipelineConfigSelections).values({
			specId: spec.id,
			scopeKind: "session",
			scopeId: sessionId,
			configId
		})
	}, 30_000)

	it("excluding an action turns it off for sessions on that preset", async () => {
		const set = await setPresetActions(db as any, configId, {
			includedActions: []
		})
		expect(set.ok).toBe(true)

		const n = (
			await listSessionFunctions(
				db as any,
				sessionId,
				STANDARD_GENRE_ID,
				userId
			)
		).find((f) => f.function === "narrate")!
		expect(n.included).toBe(false)
		expect(n.enabled).toBe(false)
		expect(n.source).toBe("preset")
	})

	it("a non-admin may not switch on what the preset left out", async () => {
		const r = await setSessionFunction(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			"narrate",
			true,
			{ userId, isAdmin: false }
		)
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/administrator/i)
	})

	it("an admin may, and it lands on that session alone", async () => {
		const r = await setSessionFunction(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			"narrate",
			true,
			{ userId, isAdmin: true }
		)
		expect(r.ok).toBe(true)

		const n = (
			await listSessionFunctions(
				db as any,
				sessionId,
				STANDARD_GENRE_ID,
				userId
			)
		).find((f) => f.function === "narrate")!
		expect(n.enabled).toBe(true)
		expect(n.source).toBe("session")

		// The preset is unchanged — the exception is the session's, not the
		// preset's, which is the difference between the two admin paths.
		const [cfg] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
		expect(cfg.includedActions).toEqual([])
	})

	it("a non-admin may still switch an excluded action back off", async () => {
		// Only turning *on* is gated. Refusing someone the ability to give up
		// something they already have would be a rule with nobody to protect.
		const r = await setSessionFunction(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			"narrate",
			false,
			{ userId, isAdmin: false }
		)
		expect(r.ok).toBe(true)
	})

	it("refuses to include an action the pipeline's mode never offered", async () => {
		const r = await setPresetActions(db as any, configId, {
			includedActions: ["teleport"]
		})
		expect(r.ok).toBe(false)
		expect(r.error).toContain("teleport")
	})

	it("refuses to edit a preset Serene Pub ships", async () => {
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.isImmutable, true))
			.limit(1)
		const r = await setPresetActions(db as any, shipped.id, {
			includedActions: []
		})
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/Duplicate it/)
	})
})

/**
 * The preset a session runs on (19 §7, ruled 2026-08-24).
 *
 * A preset *is* a pipeline configuration somebody is allowed to see and use;
 * the two used to be separate ideas. The assertions worth reading are the two
 * about `enabled`: it is the administrator's answer to "what may people
 * choose", so it has to hold at the write and not only in the list — a switch
 * the picker respects and the handler ignores is advisory.
 */
describe("a session runs on a preset", () => {
	let sessionId: number
	let userId: number
	let specId: number
	let extraId: number

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

		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
		specId = spec.id
		const [extra] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Picker copy" })
			.returning()
		extraId = extra.id
	}, 30_000)

	it("offers the serving pipeline's presets, and says which is on", async () => {
		const r = await listSessionPresets(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			{
				userId,
				isAdmin: false
			}
		)
		expect(r.specSlug).toBe(RESPOND_SPEC_ID)
		expect(r.options.map((o) => o.configId)).toContain(extraId)
		// Nothing chosen yet, so the shipped default is what is in force —
		// "default preset pre-selected" without anybody having selected it.
		expect(r.selectedId).not.toBeNull()
	})

	it("choosing one writes a session-scope selection", async () => {
		const set = await chooseSessionPreset(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			extraId,
			{ userId, isAdmin: false }
		)
		expect(set.ok).toBe(true)

		const r = await listSessionPresets(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			{
				userId,
				isAdmin: false
			}
		)
		expect(r.selectedId).toBe(extraId)

		// The same row the pipeline panel writes — one mechanism, so a preset
		// chosen here and one chosen there cannot become two facts.
		const rows = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.scopeId, sessionId))
		expect(
			rows.some(
				(x: any) => x.scopeKind === "session" && x.configId === extraId
			)
		).toBe(true)
	})

	it("hides a disabled preset from a non-admin and shows it to an admin", async () => {
		await db
			.update(schema.pipelineConfigs)
			.set({ enabled: false })
			.where(eq(schema.pipelineConfigs.id, extraId))

		const asUser = await listSessionPresets(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			{ userId, isAdmin: false }
		)
		expect(asUser.options.map((o) => o.configId)).not.toContain(extraId)

		// An admin still sees it, marked. One they just switched off vanishing
		// entirely would read as deleted.
		const asAdmin = await listSessionPresets(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			{ userId, isAdmin: true }
		)
		const found = asAdmin.options.find((o) => o.configId === extraId)
		expect(found?.enabled).toBe(false)
	})

	it("refuses a disabled preset at the write, not only in the list", async () => {
		const denied = await chooseSessionPreset(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			extraId,
			{ userId, isAdmin: false }
		)
		expect(denied.ok).toBe(false)
		expect(denied.error).toMatch(/not available to choose/)

		const allowed = await chooseSessionPreset(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			extraId,
			{ userId, isAdmin: true }
		)
		expect(allowed.ok).toBe(true)
	})

	it("refuses a preset belonging to another pipeline", async () => {
		const [other] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
			.limit(1)
		const [foreign] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: other.id, name: "Wrong pipeline" })
			.returning()

		const r = await chooseSessionPreset(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			foreign.id,
			{ userId, isAdmin: true }
		)
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/different pipeline/)
	})

	it("changing preset changes which actions the session includes", async () => {
		// The join between the two features: a preset decides the included
		// set, so switching preset has to move the action list with it.
		await db
			.update(schema.pipelineConfigs)
			.set({ includedActions: [] })
			.where(eq(schema.pipelineConfigs.id, extraId))
		await chooseSessionPreset(
			db as any,
			sessionId,
			STANDARD_GENRE_ID,
			extraId,
			{
				userId,
				isAdmin: true
			}
		)

		const n = (
			await listSessionFunctions(
				db as any,
				sessionId,
				STANDARD_GENRE_ID,
				userId
			)
		).find((f) => f.function === "narrate")!
		expect(n.included).toBe(false)
		expect(n.source).toBe("preset")
	})
})

/**
 * Bucket membership is both ends of the pipeline (19 §0).
 *
 * ⚠ This exists because the `respond` bucket checked only the entry input.
 * `core:spec/graph-build` pins `core:input/user-message@1` — it reads a session
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
describe("the respond bucket is read *and* write", () => {
	it("resolves the standard mode to the reply pipeline", async () => {
		const slug = await resolveFunctionSpec(
			db as any,
			STANDARD_GENRE_ID,
			"respond"
		)
		expect(slug).toBe(RESPOND_SPEC_ID)
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
					n.kind === "input" && n.typeId === "core:input/user-message"
			),
			"the fixture no longer reproduces the case"
		).toBe(true)
		expect(
			mine.some(
				(n) =>
					n.kind === "consumer" &&
					n.typeId === "core:consumer/create-message"
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
		await db.insert(schema.pipelineFunctionBindings).values({
			scopeKind: "instance",
			scopeId: 0,
			genreId: STANDARD_GENRE_ID,
			functionKey: "respond",
			specId: graph.id
		})
		try {
			const slug = await resolveFunctionSpec(
				db as any,
				STANDARD_GENRE_ID,
				"respond"
			)
			expect(slug).toBe(RESPOND_SPEC_ID)
		} finally {
			await db
				.delete(schema.pipelineFunctionBindings)
				.where(eq(schema.pipelineFunctionBindings.specId, graph.id))
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
			db as any,
			c.id,
			STANDARD_GENRE_ID,
			u.id
		)
		expect(pipeline?.specSlug).toBe(RESPOND_SPEC_ID)
	})
})
