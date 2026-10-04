/**
 * Adventure's places in a turn (plan A28, 2026-09-30) — the shipped document,
 * the shipped preset and prompt rows on a freshly booted install, the real
 * executor and host, with a stub model; what each agent is SHOWN.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ok, run } from "@serene-pub/sdk"
import {
	ADVENTURE_GENRE_ID,
	ADVENTURE_LOOK_SPEC_ID,
	ADVENTURE_RESPOND_SPEC_ID,
	CORE_SPECS
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import type { TestDb } from "$lib/server/utils/testDb"

// No embedding model: retrieval stays on the keyword path, which needs no
// network. Nothing here asserts on the semantic mechanism.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "adventure-places-secret" }
})

let db: TestDb
let sessionId: number
let userId: number

const ROOM = "The Guardroom"
const BEYOND = "The Drowned Hall"
/** The way between them, said from the room the scene is in. */
const LEADS = "leads north to"
/** What lies in the room the scene is in, and in the one beyond it. */
const HERE_ITEM = "a dropped torch"
const AHEAD_ITEM = "a sealed iron chest"

const MESSAGE = "We slip out of the guardroom, and Wren keeps close to Marrow."

/** The model, answering one document for every step (see `adventure.int.test.ts`). */
const ANSWER = JSON.stringify({
	beats: ["The torches gutter."],
	speakers: [{ name: "Wren", intent: "steady the party" }],
	worldHints: { location: ROOM, timeOfDay: "night", weather: "still" },
	needsLookup: false,
	values: [],
	inventory: []
})

const stubbed = () => {
	const parsed = JSON.parse(ANSWER) as Record<string, unknown>
	return {
		...coreBindings(),
		"core:oracle/generate-text@1": async () =>
			ok({ main: ANSWER, text: ANSWER, connection: { type: "stub" } }),
		"core:oracle/generate-json@1": async (input: any) => {
			const at = typeof input?.params?.path === "string" ? input.params.path : ""
			const items = at
				.split(",")
				.map((p: string) => p.trim())
				.filter(Boolean)
				.flatMap((p: string) => {
					const value = parsed[p]
					return Array.isArray(value) ? value : value == null ? [] : [value]
				})
			return ok({
				main: parsed,
				json: parsed,
				value: items,
				items,
				text: ANSWER,
				connection: { type: "stub" },
				structured: { mode: "schema", capability: "json_schema" }
			})
		}
	}
}

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-adventure-places-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "wanderer", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Under the keep" })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: "The keep",
			genreId: ADVENTURE_GENRE_ID,
			lorebookId: lorebook.id,
			genreFields: { tone: "grounded", difficulty: "normal", trustNarrator: false }
		})
		.returning()
	sessionId = session.id

	for (const name of ["Wren", "Marrow"]) {
		const [character] = await db
			.insert(schema.characters)
			.values({ userId, name, description: `${name} of the keep.` })
			.returning()
		await db.insert(schema.sessionCharacters).values({ sessionId, characterId: character.id } as any)
	}

	// Two places and the way between them. Neither has a key the message
	// fires, so a prompt that shows them was shown them by the listing.
	let position = 0
	const place = async (title: string) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++position,
					title,
					keys: [],
					content: `${title}: stone, damp, and very quiet.`,
					enabled: true
				})
				.returning()
		)[0]
	const room = await place(ROOM)
	const hall = await place(BEYOND)
	await db.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook.id,
		fromEntryId: room.id,
		toEntryId: hall.id,
		relationshipType: LEADS,
		reverseRelationshipType: "leads south to",
		visibility: "acknowledged" as any,
		status: "active",
		description: ""
	} as any)

	// The scene is in the guardroom; something lies in each place.
	await db.insert(schema.attributeValues).values([
		{
			ownerKind: "session",
			ownerId: sessionId,
			sessionId,
			slotId: "core:slot/location@1",
			value: { v: ROOM }
		},
		{
			ownerKind: "session_location",
			ownerId: room.id,
			sessionId,
			slotId: "core:slot/inventory@1",
			value: { v: [HERE_ITEM] }
		},
		{
			ownerKind: "session_location",
			ownerId: hall.id,
			sessionId,
			slotId: "core:slot/inventory@1",
			value: { v: [AHEAD_ITEM] }
		}
	] as any)

	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "user", content: MESSAGE } as any)
		.returning()
	await db.insert(schema.messages).values({ id: message.id, sessionId, role: "user" } as any)
}, 120_000)

let receipt: any
beforeAll(async () => {
	const entry = CORE_SPECS.find((s) => s.slug === ADVENTURE_RESPOND_SPEC_ID)!
	receipt = await run(entry.build(), {
		input: {
			text: MESSAGE,
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null },
			fields: { tone: "grounded", difficulty: "normal", trustNarrator: false }
		},
		seed: "seed:adventure-places",
		triggerSource: "event",
		compactHaltReceipts: false,
		bindings: stubbed(),
		world: await buildWorld(db, { sessionId, specId: ADVENTURE_RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId, userId })
	} as any)
}, 120_000)

const nodesOf = (key: string): any[] =>
	(receipt.nodes as any[]).filter((n) => n.nodeKey === key)

const outputOf = (key: string): any => {
	const [node] = nodesOf(key)
	expect(node, `${key} is not in the receipt`).toBeTruthy()
	return node.output
}

/** Everything an assemble node could have sent. */
const promptText = (output: any): string => {
	const main = output?.main ?? output
	if (typeof main?.rendered === "string") return main.rendered
	return JSON.stringify(main?.messages ?? output?.context ?? output)
}

/**
 * **Adventure's places** (plan A28, 2026-09-30). The genre requires a
 * lorebook and never listed its places: the planner decided where the scene
 * went, and every agent was told where it is, without either being shown the
 * places the world holds or the ways between them. The places plan left
 * Adventure the rooms chain "later, with no new node"; it is wired now — the
 * listing the Lair reads, with its links — so `{{knownLocations}}` and
 * `{{locationEntry}}` (the place's body and its ways on, "From here:") reach
 * the planner, the narrator and each voice.
 */
describe("an Adventure turn and the world's places", () => {
	it("runs to the end", () => {
		expect(`${receipt.outcome} ${receipt.haltReason ?? ""} ${receipt.haltNodeKey ?? ""}`.trim()).toBe("ok")
	})

	it("shows the planner every place the world holds, and the one the scene is in with its ways on", () => {
		const planner = promptText(outputOf("planPrompt"))
		expect(planner).toContain(`The places this world holds: ${ROOM}, ${BEYOND}.`)
		expect(planner).toContain(`${ROOM}: stone, damp, and very quiet.`)
		expect(planner).toContain("From here:")
		expect(planner).toContain(`- Leads north to ${BEYOND}.`)
		expect(planner).not.toContain("{{")
	})

	it("shows the narrator the place the scene is in", () => {
		const scene = promptText(outputOf("scenePrompt"))
		expect(scene).toContain("The place, as the lorebook describes it:")
		expect(scene).toContain(`${ROOM}: stone, damp, and very quiet.`)
		expect(scene).not.toContain("{{")
	})

	it("shows each voice the place it stands in", () => {
		const voices = nodesOf("voices.item.prompt")
		expect(voices, "the plan named one speaker").toHaveLength(1)
		const text = promptText(voices[0].output)
		expect(text).toContain("The place you are standing in:")
		expect(text).toContain(`${ROOM}: stone, damp, and very quiet.`)
	})
})

/**
 * **A voice sees the stats of the place it stands in** (plan A28): what lies
 * in a place the scene is not in is the game master's knowledge, not a cast
 * member's. The narrator is nobody's voice and reads every place the session
 * sees. Adventure's shipped voice row writes no `{{stateSummary}}`, so this
 * reads the variable a voice's template is handed — what an edited row that
 * writes it would show.
 */
describe("a voice's view of the places' stats", () => {
	const summaryOf = (key: string): string =>
		String(nodesOf(key)[0]?.output?.templateContext?.stateSummary ?? "")

	it("the voice is handed what lies here and not what lies beyond", () => {
		const summary = summaryOf("voices.item.context")
		expect(summary).toContain(`${ROOM}: inventory ${HERE_ITEM}.`)
		expect(summary).not.toContain(AHEAD_ITEM)
	})

	it("the narrator is told both", () => {
		const scene = promptText(outputOf("scenePrompt"))
		expect(scene).toContain(`${ROOM}: inventory ${HERE_ITEM}.`)
		expect(scene).toContain(`${BEYOND}: inventory ${AHEAD_ITEM}.`)
	})
})

/**
 * **Look is shown the places** (owner ruling 2026-10-03). Look built its
 * prompt on `build-template-context`, which computes no place, so the
 * narrator described somewhere it had never been shown. On the scene builder,
 * fed the same listing as the turn, it is told where the scene is, the place
 * with its ways on, and every place the world holds.
 */
describe("Look and the world's places", () => {
	let look: any
	beforeAll(async () => {
		const entry = CORE_SPECS.find((s) => s.slug === ADVENTURE_LOOK_SPEC_ID)!
		look = await run(entry.build(), {
			input: {
				text: "",
				sessionId,
				characterId: null,
				sessionScope: { sessionId, currentCharacterId: null },
				fields: { tone: "grounded", difficulty: "normal", trustNarrator: false }
			},
			seed: "seed:adventure-places-look",
			triggerSource: "event",
			compactHaltReceipts: false,
			bindings: stubbed(),
			world: await buildWorld(db, { sessionId, specId: ADVENTURE_LOOK_SPEC_ID }),
			host: createHost(db, { sessionId, userId })
		} as any)
	}, 120_000)

	const lookOutput = (key: string): any => {
		const node = (look.nodes as any[]).find((n) => n.nodeKey === key)
		expect(node, `${key} is not in Look's receipt`).toBeTruthy()
		return node.output
	}

	it("runs to the end", () => {
		expect(`${look.outcome} ${look.haltReason ?? ""} ${look.haltNodeKey ?? ""}`.trim()).toBe("ok")
	})

	it("tells the narrator where the scene is, the place with its ways on, and every place", () => {
		const text = promptText(lookOutput("prompt"))
		expect(text).toContain(`This scene is at ${ROOM}.`)
		expect(text).toContain("The place, as the lorebook describes it:")
		expect(text).toContain(`${ROOM}: stone, damp, and very quiet.`)
		expect(text).toContain("From here:")
		expect(text).toContain(`- Leads north to ${BEYOND}.`)
		expect(text).toContain(`The places this world holds: ${ROOM}, ${BEYOND}.`)
		expect(text).not.toContain("{{")
	})

	it("resolves the room by the room rule, for the ranker to leave to the place", () => {
		expect(lookOutput("place")?.entryId).toBeTruthy()
	})
})
