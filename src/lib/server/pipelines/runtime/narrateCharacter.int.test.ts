/**
 * The side character speaks in their own voice, and the lorebook answers to them.
 *
 * The ruling of 2026-09-07 asked for two things at once — "a first class
 * presence in the session, just like a primary character, only they aren't
 * inserted into the round-robin" — and the rotation half is pinned next door,
 * against the row the trigger writes (`sessions.sideCharacter.int.test.ts`).
 * This file is the other half: what actually reaches the model.
 *
 * Three claims, and each of them was false before the split:
 *
 *  1. the line the model continues from carries **their** name, not the joined
 *     cast list — seeding "Alice and Bram:" teaches a model to write joint
 *     dialogue as the cast, which is exactly what a shopkeeper answering a
 *     question must not do;
 *  2. `{{char}}` is them, and their card is in the prompt at full visibility —
 *     a model asked to speak as somebody needs to know who they are;
 *  3. **character lore bound to them is retrievable**, because the run's scope
 *     names them and `isCharacterLoreEntryVisible` admits an entry whose
 *     binding matches the speaker. Lore bound to a *different* character stays
 *     out, which is the same rule read from the other side.
 *
 * Asserted against the shipped document rather than an ad-hoc one, for
 * `narrateBudget.int.test.ts`'s reason: a test that compiled its own spec would
 * wire the speaker port while writing it, and the defect this replaces lived in
 * the document.
 *
 * ⚠ The run stops one node short of a rendered prompt — a bare `run()` has no
 * world, so `assemble` refuses without a story string rather than rendering
 * `[object Object]` at a model. Everything above it is on the receipt, which is
 * where the speaker's perspective is decided; `allPipelines.int.test.ts` owns
 * the rendered half.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { narrateCharacterSpec } from "$lib/server/pipelines/specs/narrate"
import * as schema from "$lib/server/db/schema"
import {
	worldLoreValues,
	characterLoreValues
} from "$lib/server/pipelines/testing/fixtures"

// No embedding model: the keyword mechanism runs, which is what every install
// has on first boot and the mechanism this fixture's lore is written for.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let sessionId: number
let userId: number
let vellId: number
let vellBindingId: number
let aliceId: number
let aliceBindingId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "narrate-character", isAdmin: false })
		.returning()
	userId = user.id

	const [alice] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	aliceId = alice.id

	// Never a cast member. Everything this file asserts about her is asserted
	// about somebody the session's rotation has never heard of.
	const [vell] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Captain Vell",
			description: "The harbour master, greying and unimpressed.",
			personality: "Terse. Keeps a ledger of everyone's debts."
		})
		.returning()
	vellId = vell.id

	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Bob",
			description: "A traveller."
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Harbour", userId })
		.returning()

	const [vellBinding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: vellId,
			binding: "{{char:vell}}",
			name: "Captain Vell"
		} as any)
		.returning()
	vellBindingId = vellBinding.id
	const [aliceBinding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: aliceId,
			binding: "{{char:alice}}",
			name: "Alice"
		} as any)
		.returning()
	aliceBindingId = aliceBinding.id

	await db.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "Riders who patrol the ash wastes."
			}
		]),
		// Vell's own — visible only while speaking as Vell.
		...characterLoreValues([
			{
				lorebookId: lorebook.id,
				lorebookBindingId: vellBindingId,
				name: "Vell's ledger",
				keys: "ashguard",
				content: "Vell keeps a private tally of the Ashguard's debts."
			}
		]),
		// Alice's own — must stay out of Vell's turn.
		...characterLoreValues([
			{
				lorebookId: lorebook.id,
				lorebookBindingId: aliceBindingId,
				name: "Alice's oath",
				keys: "ashguard",
				content: "Alice swore an oath to the Ashguard in secret."
			}
		])
	])

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: aliceId,
		isActive: true,
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId,
		role: "user",
		personaId: persona.id,
		content: "have you seen the ashguard?"
	} as any)
}, 60_000)

/** The shipped side-character document, stopped before it sends anything. */
const turnAs = async (speaker: {
	name: string
	characterId: number | null
	known: boolean
	character?: Record<string, unknown> | null
}) =>
	await run(narrateCharacterSpec(), {
		input: {
			text: "have you seen the ashguard?",
			sessionId,
			characterId: speaker.characterId,
			// The fact on its own port; the participant reference beside it
			// (R-18 (3)) — null for a free-form name, who is nobody's row.
			sideCharacter: speaker,
			speaker:
				speaker.characterId != null
					? `character:${speaker.characterId}`
					: null,
			sessionScope: {
				sessionId,
				currentCharacterId: speaker.characterId
			}
		},
		seed: "seed:narrate-character",
		bindings: coreBindings(),
		host: createHost(db, {
			sessionId,
			userId,
			currentCharacterId: speaker.characterId
		}),
		preview: true
	} as any)

const nodeOf = (receipt: any, key: string) =>
	receipt.nodes.find((n: any) => n.nodeKey === key)

const vellSpeaker = () => ({
	name: "Captain Vell",
	characterId: vellId,
	known: true,
	character: {
		id: vellId,
		name: "Captain Vell",
		nickname: null,
		description: "The harbour master, greying and unimpressed.",
		personality: "Terse. Keeps a ledger of everyone's debts."
	}
})

describe("a side-character turn speaks as that character", () => {
	it("seeds the line the model continues from with their name", async () => {
		const receipt = await turnAs(vellSpeaker())
		const context = nodeOf(receipt, "context")
		expect(context, "the document has no context step").toBeTruthy()
		expect((context!.output as any).seedName).toBe("Captain Vell")

		// And it is the name on the trailing assistant line, which is the
		// thing the model actually continues from. `Alice` alone would be the
		// joined cast list — the narrator's answer, and the one a turn spoken
		// by a person must not give.
		const lines = nodeOf(receipt, "lines")
		const seed = (lines!.output as any).messages.at(-1)
		expect(seed.id).toBe(-2)
		expect(seed.name).toBe("Captain Vell")
	}, 30_000)

	it("renders them as {{char}} and puts their card in the prompt", async () => {
		const receipt = await turnAs(vellSpeaker())
		const ctx = (nodeOf(receipt, "context")!.output as any).templateContext
		expect(ctx.char).toBe("Captain Vell")

		// `characters` is already *rendered* by the variable layout at this
		// point — a string, not the array `resolveContextInput` built — so the
		// assertion is on the block the model reads rather than on an
		// intermediate nobody sends.
		const cards = String(ctx.characters ?? "")
		expect(
			cards,
			"the side character has no card, so the model is told to speak " +
				"as somebody it knows nothing about"
		).toContain("Captain Vell")
		expect(cards, "their card arrived without its detail").toContain(
			"harbour master"
		)
		// The cast is still there — a side character joins the scene, they do
		// not replace it.
		expect(cards).toContain("Alice")

		// ⚠ …but NOT the cast roster. `{{characterNames}}` is the list a
		// speaker is told not to write for, and the shipped side-character
		// prompt says exactly that; putting the speaker on it would make the
		// prompt forbid its own turn.
		expect(String(ctx.characterNames ?? "")).not.toContain("Captain Vell")
		expect(String(ctx.characterNames ?? "")).toContain("Alice")
	}, 30_000)

	it("retrieves the character lore bound to them, and nobody else's", async () => {
		const receipt = await turnAs(vellSpeaker())
		const names = ((nodeOf(receipt, "rank")!.output as any).candidates ?? [])
			.map((c: any) => c.payload?.name)

		expect(
			names,
			"lore bound to the speaking side character never reached the " +
				"ranker — the run's scope is not naming them"
		).toContain("Vell's ledger")
		// The same rule from the other side: character lore is private
		// self-knowledge, and a turn spoken as Vell may not read Alice's.
		expect(names).not.toContain("Alice's oath")
		// World lore is common to both narration pipelines.
		expect(names).toContain("The Ashguard")
	}, 30_000)

	it("a free-form name speaks under that name with no character behind it", async () => {
		const receipt = await turnAs({
			name: "The innkeeper",
			characterId: null,
			known: false,
			character: null
		})
		const out = nodeOf(receipt, "context")!.output as any
		expect(out.seedName).toBe("The innkeeper")
		expect(out.templateContext.char).toBe("The innkeeper")
		// No card, because there is none — and no cast member's card stood in
		// for one, which is the failure a `?? current` fallback would produce.
		expect(String(out.templateContext.characters ?? "")).toContain("Alice")
		expect(String(out.templateContext.characters ?? "")).not.toContain(
			"innkeeper"
		)

		// A name the lorebook has never heard of reaches nobody's private
		// lore. World lore still comes in, so the turn is not degraded.
		const names = ((nodeOf(receipt, "rank")!.output as any).candidates ?? [])
			.map((c: any) => c.payload?.name)
		expect(names).toContain("The Ashguard")
		expect(names).not.toContain("Alice's oath")
	}, 30_000)

	it("takes its name and card from the port, and its lore from the scope", async () => {
		/**
		 * The division of labour, with the two halves made to disagree.
		 *
		 * The **name and the card** are the port's: it is what the `speaker`
		 * in-port exists for, and a turn spoken by a free-form name has nowhere
		 * else to get them. This run gives the port a speaker and the scope
		 * nobody, which is the only arrangement in which that is load-bearing —
		 * on every shipped path `generateResponse` sets both from one fact.
		 *
		 * **Retrieval follows the scope, not the port**, and the second
		 * assertion is the one that says so. It is a property of the host read
		 * rather than of the context builder — a node cannot widen what the
		 * host was willing to hand it — which is exactly why it is pinned from
		 * out here: it is invisible from inside the binding, and the binding is
		 * where somebody would try to "fix" it.
		 */
		const receipt = await run(narrateCharacterSpec(), {
			input: {
				text: "have you seen the ashguard?",
				sessionId,
				characterId: null,
				sideCharacter: vellSpeaker(),
				speaker: null,
				sessionScope: { sessionId, currentCharacterId: null }
			},
			seed: "seed:narrate-character-port",
			bindings: coreBindings(),
			host: createHost(db, {
				sessionId,
				userId,
				currentCharacterId: null
			}),
			preview: true
		} as any)
		const out = nodeOf(receipt, "context")!.output as any
		expect(out.seedName).toBe("Captain Vell")
		expect(out.templateContext.char).toBe("Captain Vell")
		expect(String(out.templateContext.characters ?? "")).toContain(
			"Captain Vell"
		)

		// …and the retrieval stayed narrator-shaped, because the scope did.
		// Vell's private lore is out; the entry bound to nobody in particular
		// would have been in, which is what "the narrator is omniscient" means.
		const names = ((nodeOf(receipt, "rank")!.output as any).candidates ?? [])
			.map((c: any) => c.payload?.name)
		expect(
			names,
			"the prompt adopted the port's speaker and the lore did not — the " +
				"turn would sound like Vell over somebody else's knowledge"
		).not.toContain("Vell's ledger")
	}, 30_000)

	it("stops at the ranker, and that boundary is deliberate", async () => {
		// The same statement `narrateBudget.int.test.ts` makes about itself: a
		// bare run has no world, so `assemble` halts rather than rendering a
		// stringified empty object at a model. Asserted rather than left as a
		// comment, because a run that started halting *earlier* would make
		// every test above pass on an empty receipt.
		const receipt: any = await turnAs(vellSpeaker())
		expect(receipt.haltNodeKey).toBe("prompt")
		expect(nodeOf(receipt, "rank")).toBeTruthy()
	}, 30_000)
})
