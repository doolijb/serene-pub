/**
 * Binding suggestions, end to end over a real database.
 *
 * ## What each half of this file is for
 *
 * The **derivation** half proves the thing the plan's §1 rule turns on: the
 * candidates are not stored, they are read back out of the annotation tables on
 * every scan, so an ignored name is re-derived every single time and is
 * suppressed by its *status* rather than by being forgotten. That distinction is
 * invisible to a test that only checks the list looks right once — it needs a
 * second scan after the decision, which is what "does not reappear" below is.
 *
 * The **guard** half mutation-tests the ownership checks. Every handler is
 * exercised twice: once by the owner, once by a second user holding the same
 * row's id. A suggestion carries a quoted line of the owner's transcript, so a
 * missing check here is a prose leak, not just an integrity one.
 *
 * ⚠ Nothing here mocks the extractor. The annotations are written by
 * `annotateLorebook` / `annotateSessionMessages` — the real lane's own functions
 * against the real `EXTRACTOR_VERSION` — because the whole claim under test is
 * *"the open tier is where candidates come from"*, and a hand-written annotation
 * row would let that claim be false while the test stayed green.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-binding-suggestions-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	// ⚠ The list handler enqueues on the real annotation lane (see the handler's
	// "a query promotes" note), so the lane's timer has to be stopped before the
	// data directory goes — the same teardown `annotations/queue.int.test.ts`
	// does, for the same reason.
	const { annotationLane } = await import("$lib/server/annotations/queue")
	annotationLane.stop()
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noEmit = () => {}

let seq = 0

/**
 * A book with one entry naming a place nothing in the world resolves to.
 *
 * "Emberfall" is capitalised, repeated, and titles no entry and names no
 * character — the exact shape the open tier is for. The gazetteer *does* know
 * "The Ashguard Riders" (it is the entry's own title), so that name resolves and
 * must not appear as a candidate; having both in one fixture is what makes the
 * tier filter load-bearing rather than incidental.
 */
async function makeBook(
	entries: Array<{ name: string; content: string }> = [
		{
			name: "The Ashguard Riders",
			content:
				"Oathbound riders of Emberfall. The Ashguard Riders keep the " +
				"Emberfall road, and Emberfall pays them in salt."
		}
	]
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `bsug-${seq++}`)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user!.id })
		.returning()
	const rows = entries.length
		? await db
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues(
						entries.map((e) => ({
							lorebookId: lorebook!.id,
							name: e.name,
							keys: "",
							content: e.content
						}))
					)
				)
				.returning()
		: []
	return { user: user!, lorebook: lorebook!, entries: rows }
}

/** Run the real annotation pass over the book's entries. */
async function annotate(lorebookId: number) {
	const { annotateLorebook } = await import("$lib/server/annotations")
	await annotateLorebook(db, lorebookId)
}

const list = async (userId: number, lorebookId: number) => {
	const { bindingSuggestionsListHandler } = await import(
		"./bindingSuggestions"
	)
	return bindingSuggestionsListHandler.handler(
		fakeSocket(userId),
		{ lorebookId },
		noEmit
	)
}

const pendingNames = (res: { suggestions: Array<any> }) =>
	res.suggestions.filter((s) => s.status === "pending").map((s) => s.name)

const allNames = (res: { suggestions: Array<any> }) =>
	res.suggestions.map((s) => s.name)

// ── Derivation ───────────────────────────────────────────────────────────────

describe("a name that resolves to nothing becomes a candidate", () => {
	it("appears, with the evidence needed to decide about it", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)

		const res = await list(user.id, lorebook.id)

		expect(pendingNames(res)).toContain("emberfall")
		const row = res.suggestions.find((s) => s.name === "emberfall")!

		// ⚠ The three things plan §4 asks the row to carry, each checked for a
		// real value rather than for presence: a suggestion whose count is 0 or
		// whose example is empty is one the user cannot evaluate in place, which
		// is the failure this surface exists to avoid.
		expect(row.occurrences).toBeGreaterThan(1)
		expect(row.sourceCount).toBe(1)
		expect(row.exampleContext).toContain("Emberfall")
		expect(row.exampleSourceKind).toBe("entry")
		expect(new Date(row.firstSeenAt).getTime()).toBeGreaterThan(0)
		expect(new Date(row.lastSeenAt).getTime()).toBeGreaterThan(0)
		expect(row.entityKey).toBe("open:emberfall")
		expect(row.stillPresent).toBe(true)
		expect(row.status).toBe("pending")
		expect(row.decidedAt).toBeNull()
	}, 60_000)

	it("does not offer a name the gazetteer already resolves", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)

		const res = await list(user.id, lorebook.id)

		// The entry's own title is in the vocabulary, so its mentions are
		// gazetteer-tier and carry `entry:<id>` — not `open:`. A suggestion here
		// would mean the tier filter had been loosened to keep the list full.
		expect(allNames(res)).not.toContain("the ashguard riders")
		expect(allNames(res)).not.toContain("ashguard")
		expect(
			res.suggestions.every((s) => s.entityKey.startsWith("open:"))
		).toBe(true)
	}, 60_000)

	it("counts a name across every source that says it", async () => {
		const { user, lorebook } = await makeBook([
			{
				name: "The Ashguard Riders",
				content: "Riders out of Emberfall."
			},
			{
				name: "The Salt Road",
				content: "It runs from Emberfall to the coast. Emberfall pays."
			}
		])
		await annotate(lorebook.id)

		const res = await list(user.id, lorebook.id)
		const row = res.suggestions.find((s) => s.name === "emberfall")!

		expect(row.sourceCount).toBe(2)
		expect(row.occurrences).toBe(3)
		// The example comes from the source that said it most — the second
		// entry — not from whichever row the query returned first.
		expect(row.exampleContext).toContain("Emberfall pays")
	}, 60_000)
})

describe("the recorded span only ever widens", () => {
	it("keeps the earlier first-seen when a later scan sees fewer sources", async () => {
		const { reconcileSuggestions, listSuggestions } = await import(
			"$lib/server/bindingSuggestions"
		)
		const { lorebook } = await makeBook([])
		const early = new Date("2026-01-01T00:00:00Z")
		const late = new Date("2026-06-01T00:00:00Z")

		const candidate = (firstSeenAt: Date, lastSeenAt: Date) => [
			{
				entityKey: "open:emberfall",
				surface: "Emberfall",
				occurrences: 1,
				sourceCount: 1,
				firstSeenAt,
				lastSeenAt,
				exampleContext: "…Emberfall…",
				exampleSourceKind: "entry" as const,
				exampleSourceId: 1
			}
		]

		await reconcileSuggestions(
			db,
			lorebook.id,
			candidate(early, late)
		)
		// A second scan that can only see the middle of the range — the lane has
		// not re-reached the oldest source, or its text moved.
		await reconcileSuggestions(
			db,
			lorebook.id,
			candidate(late, late)
		)

		const [row] = await listSuggestions(
			db,
			lorebook.id,
			new Set(["open:emberfall"])
		)
		/**
		 * ⚠ `least`/`greatest`, not the recomputed value outright. Annotation is
		 * a background lane, so a narrower answer is far likelier to mean *"not
		 * all of it has been read yet"* than *"the story changed"* — and plan §1
		 * rules that a silently-incomplete answer is worse than a stale one.
		 * Overwriting would make the first sighting march forward on its own.
		 */
		expect(new Date(row!.firstSeenAt).toISOString()).toBe(
			early.toISOString()
		)
		expect(new Date(row!.lastSeenAt).toISOString()).toBe(late.toISOString())
	}, 60_000)
})

// ── The decision, and the log ────────────────────────────────────────────────

describe("ignoring suppresses re-suggestion without hiding the decision", () => {
	async function ignoredBook() {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsIgnoreHandler } = await import(
			"./bindingSuggestions"
		)
		const after = await bindingSuggestionsIgnoreHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)
		return { user, lorebook, target, after }
	}

	it("takes it out of the pending list", async () => {
		const { after } = await ignoredBook()
		expect(pendingNames(after)).not.toContain("emberfall")
	}, 60_000)

	it("does not reappear on a re-scan", async () => {
		const { user, lorebook } = await ignoredBook()

		// ⚠ The load-bearing scan. The candidate is *re-derived* here — nothing
		// about ignoring it changed the entry text — so this is what proves the
		// suppression is the stored status and not a stale read.
		const rescan = await list(user.id, lorebook.id)

		expect(pendingNames(rescan)).not.toContain("emberfall")
		expect(
			rescan.suggestions.find((s) => s.name === "emberfall")!.stillPresent
		).toBe(true)
	}, 60_000)

	it("is still in the log, with when it was decided", async () => {
		const { user, lorebook } = await ignoredBook()
		const rescan = await list(user.id, lorebook.id)

		const row = rescan.suggestions.find((s) => s.name === "emberfall")!
		expect(row.status).toBe("ignored")
		expect(row.decidedAt).not.toBeNull()
		// The evidence keeps refreshing while it sits in the log — a dismissal
		// is not a freeze.
		expect(row.occurrences).toBeGreaterThan(1)
		expect(row.exampleContext).toContain("Emberfall")
	}, 60_000)

	it("un-ignore restores it to pending", async () => {
		const { user, lorebook, target } = await ignoredBook()
		const { bindingSuggestionsUnignoreHandler } = await import(
			"./bindingSuggestions"
		)

		const restored = await bindingSuggestionsUnignoreHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)

		expect(restored.restoredId).toBe(target.id)
		expect(pendingNames(restored)).toContain("emberfall")
		const row = restored.suggestions.find((s) => s.name === "emberfall")!
		expect(row.status).toBe("pending")
		expect(row.decidedAt).toBeNull()

		// And it survives the next derivation as pending.
		expect(pendingNames(await list(user.id, lorebook.id))).toContain(
			"emberfall"
		)
	}, 60_000)

	it("un-ignoring a row that is already pending is a no-op, not an error", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsUnignoreHandler } = await import(
			"./bindingSuggestions"
		)
		const res = await bindingSuggestionsUnignoreHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)
		expect(res.suggestions.find((s) => s.id === target.id)!.status).toBe(
			"pending"
		)
	}, 60_000)
})

// ── Accepting ────────────────────────────────────────────────────────────────

describe("adding creates the binding and records that it did", () => {
	it("mints a background binding and marks the suggestion added", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		const res = await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)

		const bindings = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		const minted = bindings.find((b) => b.name === "Emberfall")
		expect(minted).toBeTruthy()
		// Background: no character, no persona. The open tier says a name was
		// used, not that a character sheet exists behind it.
		expect(minted!.characterId).toBeNull()
		expect(minted!.personaId).toBeNull()
		// The token is server-derived, never the empty string the client sent.
		expect(minted!.binding).toBeTruthy()

		const row = res.suggestions.find((s) => s.id === target.id)!
		expect(row.status).toBe("added")
		expect(row.resolvedBindingId).toBe(minted!.id)
		expect(row.decidedAt).not.toBeNull()
		expect(res.addedId).toBe(target.id)
	}, 60_000)

	it("stays added on the next scan, though the name is still unresolved", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)

		/**
		 * ⚠ The reason `added` has to be its own suppressor.
		 *
		 * `loadVocabulary` skips a binding with no character and no persona —
		 * there is no row for it to resolve *to* — so re-annotating leaves
		 * "emberfall" in the open tier for ever. If the status were cosmetic,
		 * the user would be asked to add what they just added, on every scan.
		 */
		await annotate(lorebook.id)
		const rescan = await list(user.id, lorebook.id)

		expect(pendingNames(rescan)).not.toContain("emberfall")
		expect(
			rescan.suggestions.find((s) => s.name === "emberfall")!.status
		).toBe("added")
	}, 60_000)

	it("refuses a name the book already has a binding for", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)

		// A second suggestion for the same name, added again, would make two
		// rows for one identity — the duplicate the Bindings tab has a review
		// surface for. Straight through the guard, so a fresh pending row:
		await db
			.update(schema.bindingSuggestions)
			.set({ status: "pending", resolvedBindingId: null })
			.where(eq(schema.bindingSuggestions.id, target.id))

		await expect(
			bindingSuggestionsAddHandler.handler(
				fakeSocket(user.id),
				{ id: target.id, name: "Emberfall" },
				noEmit
			)
		).rejects.toThrow(/already has a binding/i)
	}, 60_000)

	it("falls back to the suggestion's own surface when no name is given", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)

		const bindings = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		// The surface form the passage used, not the lowercased key.
		expect(bindings.map((b) => b.name)).toContain(target.surface)
		expect(target.surface).toBe("Emberfall")
	}, 60_000)

	it("refuses to add one twice", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)
		await expect(
			bindingSuggestionsAddHandler.handler(
				fakeSocket(user.id),
				{ id: target.id, name: "Emberfall Two" },
				noEmit
			)
		).rejects.toThrow(/already been added/i)
	}, 60_000)

	it("refuses to un-ignore something that was added", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const {
			bindingSuggestionsAddHandler,
			bindingSuggestionsUnignoreHandler
		} = await import("./bindingSuggestions")
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)
		await expect(
			bindingSuggestionsUnignoreHandler.handler(
				fakeSocket(user.id),
				{ id: target.id },
				noEmit
			)
		).rejects.toThrow(/delete the binding/i)
	}, 60_000)
})

// ── Not-yet-annotated is not the same as empty ───────────────────────────────

describe("a book nobody has scanned says so", () => {
	it("reports `scanned: false` with sources outstanding", async () => {
		const { user, lorebook } = await makeBook()
		// Deliberately NOT annotated.

		const res = await list(user.id, lorebook.id)

		expect(res.suggestions).toEqual([])
		// ⚠ The distinction plan §1 caveat 2 demands. Without it this response
		// is byte-identical to "we looked and there is nothing to add", which is
		// a confident answer to a question nobody asked yet.
		expect(res.scanned).toBe(false)
		expect(res.outstanding).toBe(1)
		expect(res.coverage.entries).toEqual({ annotated: 0, total: 1 })
	}, 60_000)

	it("reports `scanned: true` when the pass ran and genuinely found nothing", async () => {
		const { user, lorebook } = await makeBook([
			{ name: "the salt road", content: "it runs to the coast." }
		])
		await annotate(lorebook.id)

		const res = await list(user.id, lorebook.id)

		expect(res.suggestions).toEqual([])
		expect(res.scanned).toBe(true)
		expect(res.outstanding).toBe(0)
		// The empty-extraction sentinel is what makes this reachable: a passage
		// that named nothing is still a row, so it counts as examined.
		expect(res.coverage.entries).toEqual({ annotated: 1, total: 1 })
	}, 60_000)

	it("an empty book is scanned and empty, not unscanned", async () => {
		const { user, lorebook } = await makeBook([])

		const res = await list(user.id, lorebook.id)

		expect(res.suggestions).toEqual([])
		expect(res.outstanding).toBe(0)
		// Nothing to annotate, so nothing is owed — but `scanned` is still false
		// because no source of either kind carries an annotation. The UI reads
		// `outstanding` to tell these apart, which is why both are on the wire.
		expect(res.scanned).toBe(false)
		expect(res.coverage).toEqual({
			entries: { annotated: 0, total: 0 },
			messages: { annotated: 0, total: 0 }
		})
	}, 60_000)

	it("opening the panel promotes the book, so the state can be left", async () => {
		const { user, lorebook } = await makeBook()
		const { annotationLane } = await import("$lib/server/annotations/queue")

		const onLane = () =>
			[
				...annotationLane.snapshotGroups(),
				...annotationLane.snapshotHistory()
			].some((g) => g.lorebookIds.includes(lorebook.id))
		expect(onLane()).toBe(false)

		const first = await list(user.id, lorebook.id)
		expect(first.scanned).toBe(false)
		expect(first.outstanding).toBe(1)

		/**
		 * ⚠ Nothing here ran an annotation pass. The only call was `list`, and
		 * this is what proves the handler put the book on the lane — without it,
		 * "not scanned yet" is a state a user cannot leave for up to the sweep
		 * interval, with no action on the panel that would change the answer.
		 *
		 * Asserted on the lane's own queue rather than by waiting for the book
		 * to come out annotated: `settleAnnotationQueue()` means *no run is in
		 * flight*, not *this book is done*, and the lane is fair across every
		 * group anything has queued. Convergence is the lane's tested behaviour
		 * (`annotations/queue.int.test.ts`); putting the work on it is this
		 * handler's, and that is what is checked here.
		 */
		expect(onLane()).toBe(true)
	}, 60_000)

	it("does not wake the lane for a book it has already covered", async () => {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const { annotationLane } = await import("$lib/server/annotations/queue")
		await list(user.id, lorebook.id)

		// Nothing is outstanding, so opening the panel is a pure read. Without
		// the condition, every open of the Bindings tab would enqueue a group
		// with no work in it.
		expect(
			annotationLane
				.snapshotGroups()
				.some((g) => g.lorebookIds.includes(lorebook.id))
		).toBe(false)
	}, 60_000)

	it("counts the transcript half too", async () => {
		const { user, lorebook } = await makeBook([])
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				lorebookId: lorebook.id
			})
			.returning()
		const [sm] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: session!.id,
				role: "user",
				content: "We rode for Emberfall at dawn. Emberfall was burning."
			})
			.returning()
		// The store writes the legacy row and mirrors it under the same id; the
		// annotation's foreign key points at `messages`, so both must exist.
		await db.insert(schema.messages).values({
			id: sm!.id,
			sessionId: session!.id,
			role: "user"
		})

		const before = await list(user.id, lorebook.id)
		expect(before.scanned).toBe(false)
		expect(before.coverage.messages).toEqual({ annotated: 0, total: 1 })

		const { annotateSessionMessages, loadVocabulary } = await import(
			"$lib/server/annotations"
		)
		await annotateSessionMessages(
			db,
			session!.id,
			await loadVocabulary(db, lorebook.id)
		)

		const after = await list(user.id, lorebook.id)
		expect(after.scanned).toBe(true)
		expect(after.coverage.messages).toEqual({ annotated: 1, total: 1 })
		const row = after.suggestions.find((s) => s.name === "emberfall")!
		expect(row).toBeTruthy()
		expect(row.exampleSourceKind).toBe("message")
		expect(row.exampleContext).toContain("Emberfall")
	}, 60_000)
})

// ── Guards ───────────────────────────────────────────────────────────────────

describe("every handler refuses another user's rows", () => {
	async function twoUsers() {
		const { user, lorebook } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(db, `bsug-stranger-${seq++}`)
		return { user, stranger: stranger!, lorebook, target }
	}

	it("list refuses a lorebook the caller does not own", async () => {
		const { stranger, lorebook } = await twoUsers()
		await expect(list(stranger.id, lorebook.id)).rejects.toThrow(
			/lorebook not found/i
		)
	}, 60_000)

	it("ignore refuses a suggestion the caller does not own", async () => {
		const { stranger, target } = await twoUsers()
		const { bindingSuggestionsIgnoreHandler } = await import(
			"./bindingSuggestions"
		)
		await expect(
			bindingSuggestionsIgnoreHandler.handler(
				fakeSocket(stranger.id),
				{ id: target.id },
				noEmit
			)
		).rejects.toThrow(/suggestion not found/i)

		// ⚠ And it did not write. A guard that refuses after the update is a
		// guard that does not exist.
		const [row] = await db
			.select()
			.from(schema.bindingSuggestions)
			.where(eq(schema.bindingSuggestions.id, target.id))
		expect(row!.status).toBe("pending")
	}, 60_000)

	it("unignore refuses a suggestion the caller does not own", async () => {
		const { user, stranger, target } = await twoUsers()
		const {
			bindingSuggestionsIgnoreHandler,
			bindingSuggestionsUnignoreHandler
		} = await import("./bindingSuggestions")
		await bindingSuggestionsIgnoreHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)

		await expect(
			bindingSuggestionsUnignoreHandler.handler(
				fakeSocket(stranger.id),
				{ id: target.id },
				noEmit
			)
		).rejects.toThrow(/suggestion not found/i)

		const [row] = await db
			.select()
			.from(schema.bindingSuggestions)
			.where(eq(schema.bindingSuggestions.id, target.id))
		expect(row!.status).toBe("ignored")
	}, 60_000)

	it("add refuses a suggestion the caller does not own, and mints nothing", async () => {
		const { stranger, lorebook, target } = await twoUsers()
		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await expect(
			bindingSuggestionsAddHandler.handler(
				fakeSocket(stranger.id),
				{ id: target.id, name: "Emberfall" },
				noEmit
			)
		).rejects.toThrow(/suggestion not found/i)

		const bindings = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(bindings.map((b) => b.name)).not.toContain("Emberfall")
	}, 60_000)

	it("a suggestion id from another book cannot be steered into this one", async () => {
		// The handlers take a row id and read the lorebook off the row, so
		// there is no lorebookId parameter to forge — this pins that shape.
		const a = await makeBook()
		await annotate(a.lorebook.id)
		const first = await list(a.user.id, a.lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const b = await makeBook()
		const { bindingSuggestionsAddHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsAddHandler.handler(
			fakeSocket(a.user.id),
			{ id: target.id, name: "Emberfall" },
			noEmit
		)

		const inB = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, b.lorebook.id))
		expect(inB).toEqual([])
	}, 60_000)
})

// ── The decision outlives its evidence ───────────────────────────────────────

describe("a decision survives the candidate disappearing", () => {
	it("keeps the row and says the story no longer names it", async () => {
		const { user, lorebook, entries } = await makeBook()
		await annotate(lorebook.id)
		const first = await list(user.id, lorebook.id)
		const target = first.suggestions.find((s) => s.name === "emberfall")!

		const { bindingSuggestionsIgnoreHandler } = await import(
			"./bindingSuggestions"
		)
		await bindingSuggestionsIgnoreHandler.handler(
			fakeSocket(user.id),
			{ id: target.id },
			noEmit
		)

		// The passage is rewritten without the name, and re-annotated.
		await db
			.update(schema.lorebookEntries)
			.set({ content: "Oathbound riders who keep the salt road." })
			.where(eq(schema.lorebookEntries.id, entries[0]!.id))
		await annotate(lorebook.id)

		const rescan = await list(user.id, lorebook.id)
		const row = rescan.suggestions.find((s) => s.name === "emberfall")!

		// The log keeps the decision — that is what a log is for…
		expect(row.status).toBe("ignored")
		// …but it must not claim the story still says it.
		expect(row.stillPresent).toBe(false)
	}, 60_000)
})
