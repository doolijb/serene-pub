/**
 * The Adventure genre, as a declaration.
 *
 * What this file asserts is everything about the genre that is true before a
 * database exists: the genre validates and publishes, its five pipelines
 * compile, the preset binds what the genre requires, and the shipped prompts
 * and layout name the things the pipelines actually read. The turn itself —
 * two speakers, one keeper proposal set, `trustNarrator` — is
 * `runtime/adventure.int.test.ts`, where there are rows to run against.
 *
 * ⚠ The parity assertion lives here too, and it is the one worth reading
 * twice: **chat's respond spec must not move.** Adventure is built entirely
 * from nodes core already shipped plus new declarations beside them; the day
 * somebody "improves" a shared node to make an adventure prompt better, this is
 * what says so.
 */

import { describe, expect, it } from "vitest"
import { canonicalHash, i18nText, sessionEvents } from "@serene-pub/sdk"
import {
	ADVENTURE_ADVANCE_TIME_SPEC_ID,
	ADVENTURE_CREATE_SPEC_ID,
	ADVENTURE_GENRE_ID,
	ADVENTURE_LOOK_SPEC_ID,
	ADVENTURE_RESPOND_SPEC_ID,
	ADVENTURE_REST_SPEC_ID,
	ADVENTURE_SLOTS,
	corePresets,
	corePresetSeeds,
	CORE_PROMPTS,
	CORE_SPECS,
	CHAT_RESPOND_SPEC_ID,
	adventureGenre
} from "@serene-pub/core-catalog"

const built = (slug: string) => {
	const entry = CORE_SPECS.find((s) => s.slug === slug)
	expect(entry, `${slug} is not in CORE_SPECS`).toBeTruthy()
	return entry!.build()
}

describe("the Adventure genre declares itself", () => {
	it("validates, and brings the eight slots the design names", () => {
		expect(adventureGenre.id).toBe(ADVENTURE_GENRE_ID)
		expect(adventureGenre.shape?.lorebook).toBe("required")
		expect(adventureGenre.shape?.voice).toBe("narrator")
		// The planner decides who speaks: no Turn order control is offered.
		// Since R28 there is no shape key at all — the control is a turn-order
		// spec's `strategy` swaps, and adventure's spec declares none.
		expect("turnOrder" in (adventureGenre.shape ?? {})).toBe(false)
		expect((adventureGenre.slots ?? []).map((s) => s.id)).toEqual([
			"core:slot/hp@1",
			"core:slot/stamina@1",
			"core:slot/mood@1",
			"core:slot/trust@1",
			"core:slot/location@1",
			"core:slot/time-of-day@1",
			"core:slot/weather@1",
			// Phase 3b: possessions retired onto the inventory stat.
			"core:slot/inventory@1"
		])
	})

	it("declares the four session fields, with the safe default on the one that matters", () => {
		const fields = adventureGenre.shape?.fields ?? {}
		expect(Object.keys(fields).sort()).toEqual([
			"characterDetail",
			"difficulty",
			"tone",
			"trustNarrator"
		])
		// The one field with a safety meaning: off means the model asks.
		expect(fields.trustNarrator?.default).toBe(false)
		expect(fields.characterDetail?.default).toBe("full")
	})

	it("every slot carries a model-facing descriptor", () => {
		// `descriptor` is inside the content hash because the model reads it —
		// a slot without one reaches a prompt as a bare number.
		const silent = ADVENTURE_SLOTS.filter((s) => !s.descriptor?.trim())
		expect(silent.map((s) => s.id)).toEqual([])
	})

	it("publishes five pipelines, and every one of them compiles", () => {
		for (const slug of [
			ADVENTURE_CREATE_SPEC_ID,
			ADVENTURE_RESPOND_SPEC_ID,
			ADVENTURE_LOOK_SPEC_ID,
			ADVENTURE_REST_SPEC_ID,
			ADVENTURE_ADVANCE_TIME_SPEC_ID
		]) {
			const doc = built(slug)
			expect((doc.taxonomy as any)?.genre).toBe(ADVENTURE_GENRE_ID)
			expect(canonicalHash(doc)).toBeTruthy()
		}
	})

	it("the create pipeline carries the genre declaration on its row", () => {
		// The genre dashboard and the preset editor read "what is this session"
		// as a SELECT, so the declaration rides the version row.
		const doc = built(ADVENTURE_CREATE_SPEC_ID)
		expect((doc.genre as any)?.family).toBe("adventure")
		expect(Object.keys((doc.genre as any)?.events ?? {}).sort()).toContain(
			sessionEvents.messageRespond
		)
	})
})

describe("the turn is a multi-agent turn", () => {
	const doc = () => built(ADVENTURE_RESPOND_SPEC_ID)
	const keys = () => doc().nodes.map((n: any) => n.key)

	it("has a planner, a narrator, a voice per speaker and a state keeper", () => {
		const nodes = keys()
		expect(nodes).toContain("planWrite")
		expect(nodes).toContain("scene")
		expect(nodes).toContain("voices.item.say")
		expect(nodes).toContain("keeperWrite")
	})

	it("gives each agent its own context type, so each ships its own prompt", () => {
		// A prompt is pooled by (node type, slot) and resolved one row per pool
		// per spec: four agents on one context type would ship four agents one
		// set of instructions.
		const types = new Set(
			doc().nodes.map((n: any) => `${n.definitionId}@${n.definitionVersion}`)
		)
		expect(types).toContain("core:task/build-planner-context@1")
		expect(types).toContain("core:task/build-scene-context@1")
		expect(types).toContain("core:task/build-side-character-context@1")
		expect(types).toContain("core:task/build-keeper-context@1")
	})

	it("reads the session state once and hands it to every agent that needs it", () => {
		const d = doc()
		const stateReads = d.nodes.filter(
			(n: any) => n.definitionId === "core:query/session-state"
		)
		expect(stateReads).toHaveLength(1)
		const fed = d.edges
			.filter((e: any) => e.toPort === "state")
			.map((e: any) => e.to)
			.sort()
		// The voices too: a cast member with no place in front of them answered
		// from whatever the transcript suggested.
		expect(fed).toEqual([
			"keeperContext",
			"planContext",
			"sceneContext",
			"voices.item.context"
		])
	})

	it("hands the cast's relationships to the planner and the narrator, and to no voice (F6(a))", () => {
		// The 09-10 mechanism, read once in the gather, ranked with the lore,
		// and read back by the game master's two agents only. A voice is a cast
		// member speaking; another member's secret must never reach it.
		const d = doc()
		const graph = d.nodes.find(
			(n: any) => n.key === "gather.relationships.read"
		)
		expect(graph?.definitionId).toBe("core:query/relationship-search")
		expect(
			d.edges
				.filter((e: any) => e.toPort === "castRelationships")
				.map((e: any) => `${e.from}->${e.to}`)
				.sort()
		).toEqual(["rank->planContext", "rank->sceneContext"])
		expect(
			d.edges.filter(
				(e: any) =>
					e.from === "gather.relationships.read" &&
					String(e.to).startsWith("voices.")
			)
		).toEqual([])
		// On, with a share; the lore-link hop off — a place says its own ways
		// out, so a door is never said twice.
		const preset = d.presets.find((p: any) => p.default)
		const params = preset?.values.find(
			(v: any) => v.nodeKey === "gather.relationships.read"
		)?.value as { share?: number; loreLinks?: boolean } | undefined
		expect(params?.share).toBeGreaterThan(0)
		expect(params?.loreLinks).toBe(false)
	})

	it("the voices each-clause is bounded, and it runs over the planner's speakers", () => {
		const block = doc().clauses.find((b: any) => b.id === "voices")
		expect(block?.kind).toBe("each")
		// Mandatory (F9): the only thing between a planner that names the whole
		// tavern and a turn that costs twenty calls.
		expect(block?.max).toBeGreaterThan(0)
		// The planner's own `items`, not a separate reading step: the planner
		// asks for a SHAPE now, so the document it publishes is data already.
		expect((block?.over as any)?.node).toBe("planWrite")
		expect((block?.over as any)?.port).toBe("items")
	})

	it("the keeper runs after the write, so its changes anchor to the reply", () => {
		// A state change is anchored to the newest message, which is how a swipe
		// takes a turn's changes back with it. Ordered by an edge, not by hope.
		const d = doc()
		expect(
			d.edges.some(
				(e: any) => e.from === "save" && e.to === "keeperContext"
			)
		).toBe(true)
	})

	it("branches on trustNarrator at a junction, and only the trusted branch applies", () => {
		const d = doc()
		const route = d.clauses.find((b: any) => b.id === "commit")
		expect(route?.kind).toBe("junction")
		expect((route?.branches as any)?.trusted?.path).toBe("trustNarrator")
		expect((route?.branches as any)?.reviewed?.default).toBe(true)
		const preset = d.presets.find((p: any) => p.default)
		const applied = preset?.values.find(
			(v: any) => v.nodeKey === "commit.trusted.apply"
		)
		expect(applied?.value).toEqual({ mode: "apply" })
		// The other branch keeps the declared default, which is `propose`.
		expect(
			preset?.values.find(
				(v: any) => v.nodeKey === "commit.reviewed.propose"
			)
		).toBeUndefined()
	})

	it("asks both JSON steps for a shape rather than describing one", () => {
		// The defect this closes: asked as ordinary replies, the planner and the
		// keeper were roleplay continuations with a schema in their
		// instructions, so the model wrote the character's next paragraph and
		// appended the document under it.
		const d = doc()
		for (const key of ["planWrite", "keeperWrite"]) {
			const node = d.nodes.find((n: any) => n.key === key)
			expect(`${key}:${node?.definitionId}`).toBe(
				`${key}:core:oracle/generate-json`
			)
			expect((node?.config as any)?.schema?.type, key).toBe("object")
		}
		// And neither reads a transcript with a turn to continue in it.
		expect(d.nodes.find((n: any) => n.key === "lines")?.definitionId).toBe(
			"core:task/prose-transcript"
		)
	})

	it("ships the paths the two JSON steps select, as choices and not as literals", () => {
		const preset = doc().presets.find((p: any) => p.default)
		const at = (nodeKey: string) =>
			preset?.values.find((v: any) => v.nodeKey === nodeKey)?.value
		expect(at("planWrite")).toEqual({ path: "speakers" })
		// Two paths, joined in order: a schema can only be strict about a list
		// whose items are all one shape, and `resolve-state-changes` takes one
		// list.
		expect(at("keeperWrite")).toEqual({ path: "values,inventory" })
	})

	it("wires the planner's world hints into the resolver", () => {
		// `worldHints` was required by the plan's schema and read by nobody:
		// the first turn of a live session planned "the archive, night, storm"
		// and left Location unset with the world strip empty.
		const d = doc()
		expect(
			d.edges.some(
				(e: any) =>
					e.to === "keeperResolve" &&
					e.toPort === "plan" &&
					e.from === "planWrite"
			),
			"the resolver is not wired to the plan"
		).toBe(true)
	})

	it("gives the narrator the shipped story string, like every other step", () => {
		// The genre shipped an assembly template of its own whose every
		// variable was wrong: `{{{system}}}` and `{{{chatMessages}}}` do not
		// exist, so the narrator's prompt arrived with no instructions and no
		// transcript, and `{{{plan}}}` and `{{{state}}}` are structure, so both
		// blocks rendered `[object Object]`.
		const preset = doc().presets.find((p: any) => p.default)
		expect(
			preset?.values.find(
				(v: any) => v.nodeKey === "scenePrompt" && v.slot === "template"
			)
		).toBeUndefined()
	})
})

describe("the two keeper actions", () => {
	const action = (slug: string) => built(slug)

	it("ask for the keeper's shape rather than parsing prose", () => {
		// Both were `generate-text` + `parse-json` with a prefill. Their spec
		// hashes move with this, which is recorded in `boot/specHashes.test.ts`
		// — both slugs are new in this release.
		for (const slug of [
			ADVENTURE_REST_SPEC_ID,
			ADVENTURE_ADVANCE_TIME_SPEC_ID
		]) {
			const d: any = action(slug)
			const write = d.nodes.find((n: any) => n.key === "write")
			expect(`${slug}:${write?.definitionId}`).toBe(
				`${slug}:core:oracle/generate-json`
			)
			expect((write?.config as any)?.schema?.type, slug).toBe("object")
			// No prose to salvage, and no parse step left to salvage it with.
			expect(
				d.nodes.some((n: any) => n.definitionId === "core:task/parse-json"),
				slug
			).toBe(false)
			expect(
				d.nodes.find((n: any) => n.key === "lines")?.definitionId,
				slug
			).toBe("core:task/prose-transcript")
			const preset = d.presets.find((p: any) => p.default)
			expect(
				preset?.values.find((v: any) => v.nodeKey === "write")?.value,
				slug
			).toEqual({ path: "values,inventory" })
		}
	})
})

describe("the preset and the prompts", () => {
	const preset = () =>
		corePresets().find((p) => p.slug === "adventure-default")!

	it("binds both required events and the form answer, and includes the five actions", () => {
		const p = preset()
		expect(p.genre).toBe(ADVENTURE_GENRE_ID)
		expect(p.bindings[sessionEvents.sessionCreated]?.spec).toBe(
			ADVENTURE_CREATE_SPEC_ID
		)
		expect(p.bindings[sessionEvents.messageRespond]?.spec).toBe(
			ADVENTURE_RESPOND_SPEC_ID
		)
		// The optional form event (R-15 *Forms*; U5d), bound so a question put
		// to an AI-portrayed cast member is answered out of the box.
		expect(p.bindings[sessionEvents.formAddressed]?.spec).toBe(
			"core:spec/adventure-answer-form"
		)
		// By identity (W-A): the declaration, not the spec. Ask and Answer are
		// the worked form (U5d).
		expect(p.actions?.include).toEqual([
			`${ADVENTURE_LOOK_SPEC_ID}#look`,
			`${ADVENTURE_REST_SPEC_ID}#rest`,
			`${ADVENTURE_ADVANCE_TIME_SPEC_ID}#advance-time`,
			"core:spec/adventure-ask#ask",
			"core:spec/adventure-answer#answer"
		])
	})

	it("ships enabled, and is offered rather than assumed", () => {
		expect(preset().enabled).toBe(true)
		const seed = corePresetSeeds().find(
			(s) => s.seedKey === "core-adventure-default"
		)
		expect(seed?.enabled).toBe(true)
		// "Default" means the one preset a session with no preset falls back
		// to, and there is exactly one of those on an instance.
		expect(seed?.isDefault).toBe(false)
		expect(
			corePresetSeeds().find((s) => s.seedKey === "core-chat-default")
				?.isDefault
		).toBe(true)
	})

	it("carries the field pre-fill into the seeded row, and curates nothing", () => {
		const seed = corePresetSeeds().find(
			(s) => s.seedKey === "core-adventure-default"
		)
		expect((seed?.defaults as any)?.genreFields?.trustNarrator).toBe(false)
		// ⚠ No `includedActions`, though the declaration names three. NULL is
		// the companion rule — every action contributed for this genre comes
		// along, enabled by default because they are in the genre owner's own
		// namespace — and an array would freeze the list at the three that
		// exist today. Chat's row says the same thing for the same reason.
		expect((seed as any)?.includedActions).toBeUndefined()
	})

	it("ships one prompt per agent pool, each defaulted to the spec that reads it", () => {
		const forSpec = (nodeType: string, slug: string) =>
			CORE_PROMPTS.filter(
				(p) =>
					p.nodeType === nodeType && p.defaultForSpecs.includes(slug)
			)
		expect(
			forSpec(
				"core:task/build-planner-context",
				ADVENTURE_RESPOND_SPEC_ID
			)
		).toHaveLength(1)
		expect(
			forSpec("core:task/build-scene-context", ADVENTURE_RESPOND_SPEC_ID)
		).toHaveLength(1)
		expect(
			forSpec(
				"core:task/build-side-character-context",
				ADVENTURE_RESPOND_SPEC_ID
			)
		).toHaveLength(1)
		// Three specs share the keeper's pool and each starts on its own row:
		// the turn's keeper, Rest, and the clock.
		for (const slug of [
			ADVENTURE_RESPOND_SPEC_ID,
			ADVENTURE_REST_SPEC_ID,
			ADVENTURE_ADVANCE_TIME_SPEC_ID
		])
			expect(
				forSpec("core:task/build-keeper-context", slug),
				`the keeper pool has no default for ${slug}`
			).toHaveLength(1)
	})

	it("the planner and the keeper prompts name the keys their pipeline selects", () => {
		// The prose and the schema on the wire say the same thing, and both are
		// contract: `path` selects `speakers` on one and `values,inventory` on
		// the other, so a model that reads only the words still answers with the
		// names the pipeline reads back.
		const planner = CORE_PROMPTS.find(
			(p) => p.nodeType === "core:task/build-planner-context"
		)!
		expect(planner.fields.systemPrompt).toContain("speakers")
		const keeper = CORE_PROMPTS.find((p) =>
			p.seedKey.endsWith("adventure-keeper")
		)!
		expect(keeper.fields.systemPrompt).toContain("values")
		// The item arm is `inventory` since 2026-09-27 (was `possessions`).
		expect(keeper.fields.systemPrompt).toContain("- inventory:")
		expect(keeper.fields.systemPrompt).not.toContain("possessions")
	})

	it("the narrator prompt interpolates the tone field the genre declares", () => {
		const narrator = CORE_PROMPTS.find(
			(p) => p.nodeType === "core:task/build-scene-context"
		)!
		expect(narrator.fields.systemPrompt).toContain("{{tone}}")
	})
})

/**
 * **Look is shown the places** (owner ruling 2026-10-03): its context step is
 * the scene builder, fed the same `rooms` listing and room rule as the turn,
 * and its prompt row lives in the scene builder's pool. On
 * `build-template-context` it computed no place, so Look described somewhere
 * it had never been shown.
 */
describe("Look reads the places on the scene builder", () => {
	const doc = () => built(ADVENTURE_LOOK_SPEC_ID)
	const node = (key: string) =>
		doc().nodes.find((n: any) => n.key === key) as any

	it("builds its context with the scene builder, from the places listing", () => {
		expect(node("context")?.definitionId).toBe("core:task/build-scene-context")
		expect(node("gather.rooms.read")?.definitionId).toBe(
			"core:query/lorebook-entries"
		)
		const into = (port: string) =>
			doc()
				.edges.filter((e: any) => e.toPort === port)
				.map((e: any) => `${e.from}->${e.to}`)
				.sort()
		expect(into("locationEntries")).toEqual([
			"gather.rooms.read->context",
			"gather.rooms.read->place"
		])
		// The room rule: the room `{{locationEntry}}` shows spends no lore budget.
		expect(into("shownElsewhere")).toEqual(["place->rank"])
		expect(doc().nodes.some((n: any) => n.key === "plan")).toBe(false)
	})

	it("ships the listing's and the room rule's values on its default preset", () => {
		const preset = (doc() as any).presets?.find((p: any) => p.default)
		expect(JSON.stringify(preset)).toContain("core:entry/location")
		expect(JSON.stringify(preset)).toContain("world.location")
	})

	it("starts on a prompt row in the scene pool that writes the place", () => {
		const rows = CORE_PROMPTS.filter((p) =>
			p.defaultForSpecs.includes(ADVENTURE_LOOK_SPEC_ID)
		)
		expect(rows).toHaveLength(1)
		expect(rows[0].nodeType).toBe("core:task/build-scene-context")
		expect(rows[0].seedKey).toBe(
			"pipeline-prompt:core:task/build-scene-context:prompts:adventure-look"
		)
		expect(rows[0].fields.systemPrompt).toContain("{{location}}")
		expect(rows[0].fields.systemPrompt).toContain("{{locationEntry}}")
		expect(rows[0].fields.systemPrompt).toContain("{{knownLocations}}")
		expect(rows[0].fields.narratorName).toBe("Narrator")
	})
})

describe("the Adventure layout", () => {
	const layout = () => adventureGenre.layouts![0]!

	it("is shipped for the genre, as its default, under its own name", () => {
		expect(adventureGenre.id).toBe(ADVENTURE_GENRE_ID)
		expect(layout().slug).toBe("default")
		expect(i18nText(layout().name)).toBe("Adventure")
	})

	it("docks the party down the right and puts the world above the messages", () => {
		const l = layout().preset as any
		expect(l.zoneLayout.zones.right.pinned).toBe(true)
		// No Inventory: R79 removed that widget for now.
		expect(l.zoneLayout.zones.right.widgets).toEqual([
			"scene-portraits",
			"stats"
		])
		// Unpinned: an icon strip that pops over the conversation, which is what
		// "collapsed to the rail" means.
		expect(l.zoneLayout.zones.left.pinned).toBe(false)
		// The middle zone is world-state over the one conversation widget:
		// the composer is a setting of `messages`, not a widget of its own.
		const middle = l.widgetGrid.widgets.map((w: any) => w.id)
		expect(middle).toEqual(["world-state", "messages"])
		expect(l.widgetSettings["scene-portraits"].bars).toBe(true)
	})
})

describe("parity", () => {
	it("chat's respond spec is byte-identical — adventure edited no shipped node", () => {
		// Recorded in `boot/specHashes.test.ts` as well; here so the failure
		// names the lane that would have caused it. The hash moved on
		// 2026-09-15 for the reply's own reason (09-B B4: the placeholder
		// outlet and the update that fills it), and again on 2026-09-16 (R-12:
		// the generating step wires no `prompts` share — the slot is culled
		// from `generate-text@1`), and once more on 2026-09-16 with the
		// one-shot rename (plans/30 §U3 — every shipped document moved once),
		// each recorded there in the same change — and once more on
		// 2026-09-16 (R-7 P5, U3b: the lore pool concatenates the
		// conversation's `band` port), and once more on 2026-09-16 (U5a,
		// R-18 (3): the turn strategy takes the inlet's `speaker` reference
		// beside the bare id), and once more on 2026-09-17 (U5d review W9:
		// `session-history@1` declares the rows it publishes, `messages@1`,
		// and an edge's compiled shape is part of the document — every spec
		// reading history moved) — none by this genre.
		// (was "18917086c3f34", then "3f0e84937c657", then "19cac7b1208d4e",
		//  then "1ace29594a6283", then "1c503cc437da52", then "1c2931c6f16055" —
	// the last move being A6's, where the `speaker` node left for
	// `core:spec/<genre>-turn-order` and `placeholder` returned to directly after
	// the inlet (PLAN-turn-order §4.4). Still nothing adventure edited.
	// Then "2c62eb10ed01b", before the sprite tail (DESIGN-sprites §5,
	// 2026-09-24) appended `sprites` and its junction after `save` — also not
	// adventure's.
		// Moved 2026-09-27 (lair pass B3/B18): the streaming stage and the stage
		// statuses are declared on `expose` (`stream`, `status`). Proven: with those
		// two keys stripped, the document hashes back to the old pin. (was '1970a642240009')
		// Moved 2026-09-29 (genre uplift F1): `semantic.arm.queries` wires
		// `connection: slot.connectionOf('semantic.arm.embed')` — not adventure's.
		// Proven in `boot/specHashes.test.ts` (F1's edits reverted hash back to
		// the old pin), which recorded it; this copy was missed. (was "ab24c4c296be8")
		// Moved 2026-09-30 (config grouping, catalog lane): the two embed steps
		// carry an `expose.label` — not adventure's. Proven in
		// `boot/specHashes.test.ts`, which records it. (was "e1d9077ca6b80")
		// Moved 2026-10-01 (post-history trigger): the default preset is `default` /
		// "Default" — not adventure's. Proven in `boot/specHashes.test.ts`, which
		// records it. (was "58982f85e91a9")
		// Moved 2026-10-02 (author's note AN1; lorebooks wave 8 presences +
		// eligible; attachments phase 4 history-attachments + place-attachments)
		// — none adventure's. Proven in `boot/specHashes.test.ts`, which records
		// each move. (was "29d6c133bf60f")
		// Moved 2026-10-03 (owner note 39: `save` wires `reasoning`) — not
		// adventure's; `boot/specHashes.test.ts` recorded it, this copy was
		// missed. (was "df7c86394a82")
		// Moved 2026-10-03 (history window: `session-history` reads by `budget`)
		// — not adventure's; `boot/specHashes.test.ts` records it. (was "75db48c05464b")
		// Moved 2026-10-05 (sprites in-pipeline: the written-out sprite step
		// replaces the tail; D-c: the embed steps lose their connection slot and
		// `semantic.arm.queries` wires its own) — not adventure's;
		// `boot/specHashes.test.ts` records it. (was "6b320446a5eb1")
		// Moved 2026-10-05 (rename: the id `core:spec/respond` is now
		// `core:spec/chat-respond`) — not adventure's. (was "520aa324cf15f")
		expect(canonicalHash(built(CHAT_RESPOND_SPEC_ID))).toBe("1f99b0cdffb35d")
	})
})
