/**
 * The narrator retrieves lore, and the number that decides whether it can.
 *
 * ⚠ This exists because it did not. `core:spec/chat-narrate` wired its `rank` node's
 * `candidates` in-port and never its `budget` one, and the reply pipeline had
 * already retired the typed `budget: 4096` fallback in its 1.6.0 — an absolute
 * count on a node cannot know which model it is about to be sent to. So
 * `rank-hybrid` read `input?.budget?.remaining ?? input?.availableTokens ?? 0`
 * and got the zero, `allocateBudgets` returned zeros for every band, and every
 * scored candidate came back `excluded_group_disabled` while every pinned one
 * came back `excluded_pinned_token_limit`. **The narrator's lore block was
 * empty on every turn.**
 *
 * Nothing failed, which is the shape of defect worth remembering here: an empty
 * lore block is exactly what a session with no matching lore looks like, the
 * template's `{{#if}}` skips it either way, and the receipt's own decisions all
 * carried a plausible reason. The spec's header says in so many words that
 * lorebook triggers are the thing this pipeline *deliberately keeps* — so the
 * one feature it claimed over graph context was the one it did not have.
 *
 * Asserted against the shipped document rather than an ad-hoc one, because the
 * defect was in the document. A test that compiled its own spec would have
 * wired the budget while writing it.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { run } from "@serene-pub/sdk"
import { narrateSpec } from "$lib/server/pipelines/specs/narrate"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

// No embedding model, so the keyword mechanism runs — which is the mechanism the shipped
// narrator document wires, and the one every install has on first boot.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

let db: TestDb
let sessionId: number
let userId: number

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "narrate-budget", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Narrator lore", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	// One entry, keyed on a word the last message says. Small enough that no
	// real budget could exclude it, so an exclusion can only be the zero.
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "An order of oathbound riders."
			}
		])
	)

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)
}, 60_000)

/** The shipped narrator document, stopped before it sends anything. */
const narratorRun = async () =>
	await run(narrateSpec(), {
		input: {
			text: "tell me about the ashguard",
			sessionId,
			// A narrator has no speaking character — that is the whole
			// difference between this pipeline and the reply one.
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:narrate-budget",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)

describe("the narrator pipeline retrieves the lore it says it keeps", () => {
	it("derives a context budget instead of ranking against zero", async () => {
		const receipt = await narratorRun()
		const budget = receipt.nodes.find(
			(n: any) => n.nodeKey === "contextBudget"
		)
		expect(
			budget,
			"the narrator pipeline has no context-budget step, so `rank` has " +
				"nothing to select against"
		).toBeTruthy()
		expect((budget!.output as any)?.available?.remaining).toBeGreaterThan(0)
	}, 30_000)

	it("selects a matching entry rather than excluding every one", async () => {
		const receipt = await narratorRun()
		const rank = receipt.nodes.find((n: any) => n.nodeKey === "rank")
		expect(rank, "the narrator pipeline has no ranking step").toBeTruthy()

		const candidates = (rank!.output as any)?.candidates ?? []
		const decisions = (rank!.output as any)?.decisions ?? []

		// The scan found it either way — the defect was never in retrieval.
		expect(
			decisions.length,
			"nothing reached the ranker, so this fixture is not testing the budget"
		).toBeGreaterThan(0)

		expect(
			candidates.map((c: any) => c.payload?.name),
			// The reason spelled out, because the failure mode is silent: with
			// no budget every decision reads `excluded_group_disabled`, which
			// is indistinguishable on a receipt from a source somebody
			// deliberately set to a zero share.
			"the narrator selected no lore — every candidate was excluded, " +
				`with reasons ${JSON.stringify(
					decisions.map((d: any) => d.reason)
				)}`
		).toContain("The Ashguard")
	}, 30_000)

	it("stops at the ranker, and that boundary is deliberate", async () => {
		/**
		 * What this file can and cannot see, stated rather than implied.
		 *
		 * A bare `run()` has no `world`, so no config layer resolves — and
		 * `assemble` refuses without a story string rather than rendering
		 * `[object Object]` at a model. So the receipt stops one node short of
		 * a rendered prompt, and the subject of this file is upstream of it:
		 * whether a candidate survives the budget. `allPipelines.int.test.ts`
		 * boots a real database and takes every shipped spec to its final
		 * Consumer, which is where the rendered half belongs.
		 *
		 * Asserted rather than left as a comment because a run that started
		 * halting *earlier* — at `rank`, say — would make the two tests above
		 * pass on an empty receipt.
		 */
		const receipt: any = await narratorRun()
		expect(receipt.outcome).toBe("halt")
		expect(receipt.haltNodeKey).toBe("prompt")
		expect(receipt.haltReason).toMatch(/no template/)
	}, 30_000)
})
