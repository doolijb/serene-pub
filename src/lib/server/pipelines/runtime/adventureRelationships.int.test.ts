/**
 * The cast's relationships in an Adventure turn (genre plan F6(a), 2026-09-29).
 *
 * The 09-10 ruling made the narrative graph a retrieval mechanism, and Chat has
 * run it since. Adventure never wired it, so a turn planned and narrated a
 * party whose members' ties the lorebook already held. This drives a whole turn
 * against real rows — the shipped document, the shipped preset and prompt rows
 * on a freshly booted install, the real executor and host — and reads what each
 * agent was actually shown.
 *
 * ## Three claims, each a prompt
 *
 *  1. **The planner and the narrator are told how the cast stand.** Nobody is
 *     speaking in an Adventure turn (the narrator's entry carries no character),
 *     so the graph is read **cast-wide** — every tie a cast member holds that
 *     is not their secret — rather than walked from a speaker who does not
 *     exist.
 *  2. **A secret stays the holder's.** The planner and the narrator are
 *     nobody's voice, and the earshot rule withholds a holder-only value from
 *     nobody's voice (review 2026-09-29: the planner's beats and the
 *     narrator's prose reach the player). So a secret tie reaches neither of
 *     them until the owner rules otherwise — fail closed. A voice is a cast
 *     member speaking, and no voice is handed the band at all — its pool is
 *     its own.
 *  3. **A place link is said once, by the place.** Relationships with an entry
 *     at an end reach a prompt through the room ("From here:"), so the
 *     mechanism's lore-link hop is off in Adventure's preset. The fixture would
 *     produce a hop with it on — asserted, so the absence is not vacuous.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ok, run } from "@serene-pub/sdk"
import {
	ADVENTURE_GENRE_ID,
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
	return { db, getCryptoSecretKey: () => "adventure-relationships-secret" }
})

let db: TestDb
let sessionId: number
let userId: number

/** A tie both of them know about. */
const KNOWN = "owes a life-debt to"
/** A tie only its holder knows. */
const SECRET = "means to sell out"
/** The place link's own wording, which only the hop could carry here. */
const DOOR = "the rusted iron door"
const LEADS = "leads north to"

const ROOM = "The Guardroom"
const BEYOND = "The Drowned Hall"

/** The mechanism's node in the Adventure document. */
const GRAPH = "gather.relationships.read"

const MESSAGE = "We slip out of the guardroom, and Wren keeps close to Marrow."

/**
 * The model, answering one document for every step — the same stub
 * `adventure.int.test.ts` explains: what is under test is what each step is
 * SHOWN, never what it says back.
 */
const ANSWER = JSON.stringify({
	beats: ["The torches gutter."],
	speakers: [{ name: "Wren", intent: "steady the party" }, { name: "Marrow" }],
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
			const at =
				typeof input?.params?.path === "string" ? input.params.path : ""
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
		path.join(os.tmpdir(), "serene-pub-vitest-adventure-relationships-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "delver", isAdmin: false })
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
			genreFields: {
				tone: "grounded",
				difficulty: "normal",
				trustNarrator: false
			}
		})
		.returning()
	sessionId = session.id

	const member = async (name: string) => {
		const [character] = await db
			.insert(schema.characters)
			.values({ userId, name, description: `${name} of the keep.` })
			.returning()
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: character.id } as any)
		const [node] = await db
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				name,
				binding: `{{char:${character.id}}}`,
				characterId: character.id
			})
			.returning()
		return node
	}
	const wren = await member("Wren")
	const marrow = await member("Marrow")

	const tie = async (
		fromNodeId: number,
		toNodeId: number,
		relationshipType: string,
		visibility: string
	) =>
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId,
			toNodeId,
			relationshipType,
			visibility: visibility as any,
			status: "active",
			description: ""
		} as any)
	await tie(wren.id, marrow.id, KNOWN, "acknowledged")
	await tie(marrow.id, wren.id, SECRET, "secret")

	// Two places and the door between them. Only the room has a key the
	// message fires, so the hall is reachable by the edge or not at all.
	let position = 0
	const place = async (title: string, keys: string[]) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++position,
					title,
					keys,
					content: `${title}. Stone, damp, and very quiet.`,
					enabled: true
				})
				.returning()
		)[0]
	const room = await place(ROOM, ["guardroom"])
	const hall = await place(BEYOND, ["drowned hall"])
	await db.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook.id,
		fromEntryId: room.id,
		toEntryId: hall.id,
		relationshipType: LEADS,
		reverseRelationshipType: "leads south to",
		title: DOOR,
		visibility: "acknowledged" as any,
		status: "active",
		description: ""
	} as any)

	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "user", content: MESSAGE } as any)
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: message.id, sessionId, role: "user" } as any)
}, 120_000)

let receipt: any
beforeAll(async () => {
	const entry = CORE_SPECS.find((s) => s.slug === ADVENTURE_RESPOND_SPEC_ID)!
	receipt = await run(entry.build(), {
		input: {
			text: MESSAGE,
			sessionId,
			// The narrator's entry: nobody is speaking.
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null },
			fields: { tone: "grounded", difficulty: "normal", trustNarrator: false }
		},
		seed: "seed:adventure-relationships",
		triggerSource: "event",
		compactHaltReceipts: false,
		bindings: stubbed(),
		world: await buildWorld(db, {
			sessionId,
			specId: ADVENTURE_RESPOND_SPEC_ID
		}),
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

/**
 * Everything an assemble node could have sent: the flat prompt when it
 * rendered one, the message list when the wire splits it.
 */
const promptText = (output: any): string => {
	const main = output?.main ?? output
	if (typeof main?.rendered === "string") return main.rendered
	return JSON.stringify(main?.messages ?? output?.context ?? output)
}

const occurrences = (text: string, needle: string): number =>
	text.split(needle).length - 1

describe("an Adventure turn and the cast's relationships", () => {
	it("runs to the end", () => {
		expect(
			`${receipt.outcome} ${receipt.haltReason ?? ""} ${receipt.haltNodeKey ?? ""}`.trim()
		).toBe("ok")
	})

	it("reads the graph cast-wide: nobody is speaking", () => {
		const ties = (outputOf(GRAPH)?.main ?? []).filter(
			(c: any) => c?.source === "relationships" && c?.payload
		)
		// The acknowledged tie, and not Marrow's secret: withheld at the read.
		expect(ties.map((c: any) => c.payload.lane)).toEqual([
			"castRelationships"
		])
		expect(ties[0].payload.name).toBe("Wren")
		// Both ends are in the cast, so the tie is present.
		for (const c of ties) expect(c.payload.rank?.present).toBe(true)
	})

	it("gives the band a share, so the ties compete for the window and win room", () => {
		const decisions: any[] = outputOf("rank")?.decisions ?? []
		const ties = decisions.filter(
			(d) => d?.candidate?.source === "relationships"
		)
		expect(ties.length, "no relationship reached the ranker").toBe(1)
		// Included, where Chat's shipped share of 0 excludes every one of them
		// as `excluded_group_disabled` — the preset's share reached the run.
		for (const d of ties) expect(d.included, d.reason).toBe(true)
	})

	it("tells the narrator how the cast stand with each other", () => {
		const scene = promptText(outputOf("scenePrompt"))
		expect(scene).toContain(KNOWN)
		expect(scene).toContain("Wren")
		expect(scene).toContain("Marrow")
	})

	it("tells the planner the same", () => {
		expect(promptText(outputOf("planPrompt"))).toContain(KNOWN)
	})

	it("withholds a member's secret from the game master's agents too", () => {
		for (const key of ["planPrompt", "scenePrompt"]) {
			const text = promptText(outputOf(key))
			expect(text, key).not.toContain(SECRET)
			expect(text, key).not.toContain("Only Marrow knows")
		}
	})

	it("never hands a voice the band — not the secret, not the known tie", () => {
		const voices = nodesOf("voices.item.prompt")
		expect(voices, "the plan named two speakers").toHaveLength(2)
		for (const voice of voices) {
			const text = promptText(voice.output)
			expect(text).not.toContain(SECRET)
			expect(text).not.toContain(KNOWN)
		}
		// Nor does the keeper, which reads the same rank and renders no tie.
		const keeper = promptText(outputOf("keeperPrompt"))
		expect(keeper).not.toContain(SECRET)
	})

	it("leaves the place link to the place: no hop, and never said twice", () => {
		const hops = (outputOf(GRAPH)?.main ?? []).filter(
			(c: any) => c?.payload?.via === "link"
		)
		expect(hops).toEqual([])
		expect(outputOf(GRAPH)?.diagnostics?.linked ?? 0).toBe(0)
		for (const key of ["planPrompt", "scenePrompt"]) {
			const text = promptText(outputOf(key))
			expect(occurrences(text, LEADS), key).toBeLessThanOrEqual(1)
			expect(occurrences(text, DOOR), key).toBeLessThanOrEqual(1)
		}
	})

	it("would have hopped with lore links on — the fixture is not vacuous", async () => {
		const bindings = coreBindings() as any
		const host = createHost(db, { sessionId, userId })
		const read = (table: string, q: unknown) =>
			host.read!(table, q, {
				key: GRAPH,
				definitionId: "core:query/relationship-search",
				definitionVersion: 1,
				kind: "query"
			})
		const ctx = {
			signal: new AbortController().signal,
			progress: () => {},
			log: () => {},
			read,
			countTokens: (text: string) => Math.ceil(text.length / 4)
		}
		const withHop = await bindings["core:query/relationship-search@1"](
			{
				scope: { sessionId, currentCharacterId: null },
				// Adventure's own share with the links switched on: the hop
				// runs only for a band that can spend (plan A2).
				params: { loreLinks: true, share: 0.1 }
			},
			ctx
		)
		expect(withHop.kind).toBe("ok")
		const hops = (withHop.value.main as any[]).filter(
			(c) => c?.payload?.via === "link"
		)
		expect(hops.map((c) => c.payload.name)).toEqual([BEYOND])
	})
})
