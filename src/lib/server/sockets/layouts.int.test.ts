/**
 * The `layouts:*` handlers (session layout v2 §4.6): every verb's happy path,
 * and the refusals that keep one person's layouts out of another's reach.
 *
 * The permission MATRIX is unit-tested next to its predicates
 * (`db/layoutPermissions.test.ts`) and the row behaviour in
 * `db/layoutPresetsV2.int.test.ts`; what is proven here is that each handler
 * asks the right question, and that a refusal reaches the caller as its own
 * `<event>:error` with the sentence that names what was wrong.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { layoutPresetSeedKey } from "$lib/shared/sessionLayout/presets"
import { BUILT_IN_LAYOUT_DOC } from "$lib/shared/sessionLayout/document"
import type { TestDb } from "$lib/server/utils/testDb"
import type { LayoutDoc } from "@serene-pub/sdk"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

let n = 0
const freshGenre = () => `test:genre/sock-${n++}`

const handlers = () => import("./layouts")

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

/** An emitter that records what was sent, so a refusal can be read back. */
function recordingEmit() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		sent.push({ event, data })
	}
	return { emit, sent }
}

/** Run a handler expecting a refusal; return the sentence it emitted. */
async function refusalOf(
	run: (emit: (e: string, d: any) => void) => Promise<unknown>
): Promise<string> {
	const rec = recordingEmit()
	await expect(run(rec.emit)).rejects.toThrow()
	const err = rec.sent.find((s) => s.event.endsWith(":error"))
	expect(err).toBeTruthy()
	return err!.data.error as string
}

const docNaming = (key: string): LayoutDoc => ({
	version: 2,
	zones: {
		middle: {
			rows: ["grow"],
			cols: ["grow"],
			units: [
				{
					kind: "widget",
					key,
					widget: "messages",
					row: { start: 1, span: 1 },
					col: { start: 1, span: 1 }
				}
			]
		}
	}
})
const keyOf = (doc: LayoutDoc) => (doc.zones.middle.units[0] as any)?.key

async function scenario(genreId: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `sock-owner-${n++}`)
	const guest = await createTestUser(testDb, `sock-guest-${n++}`)
	const outsider = await createTestUser(testDb, `sock-out-${n++}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([
		{ genreId, preset: { layout: docNaming("genre") } }
	])
	const [seeded] = await testDb
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			eq(schema.sessionLayoutPresets.seedKey, layoutPresetSeedKey(genreId))
		)
	return { owner, guest, outsider, session, seeded, genreId }
}

describe("layouts:list", () => {
	test(
		"answers for the session's genre, and for a bare genre id",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsList } = await handlers()
			const bySession = await layoutsList.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(bySession.genreId).toBe(s.genreId)
			expect(bySession.presets.map((p) => p.id)).toContain(s.seeded.id)
			expect(bySession.presets[0].origin).toBe("core")
			expect(keyOf(bySession.presets[0].document!)).toBe("genre")

			const byGenre = await layoutsList.handler(
				fakeSocket(s.owner.id),
				{ genreId: s.genreId },
				noopEmit
			)
			expect(byGenre.presets.map((p) => p.id)).toEqual(
				bySession.presets.map((p) => p.id)
			)
		},
		60_000
	)

	test(
		"refuses a session the caller is not in, and a call with no scope",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsList } = await handlers()
			expect(
				await refusalOf((emit) =>
					layoutsList.handler(
						fakeSocket(s.outsider.id),
						{ sessionId: s.session.id },
						emit
					)
				)
			).toBe("No access to this session")
			expect(
				await refusalOf((emit) =>
					layoutsList.handler(fakeSocket(s.owner.id), {}, emit)
				)
			).toContain("no session type")
		},
		60_000
	)

	test(
		"a guest of the session sees the same list",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsList } = await handlers()
			const res = await layoutsList.handler(
				fakeSocket(s.guest.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(res.presets.map((p) => p.id)).toContain(s.seeded.id)
		},
		60_000
	)
})

describe("layouts:save", () => {
	test(
		"saves a private row of the caller's and re-lists",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave } = await handlers()
			const res = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Mine",
					description: "one column",
					preset: { layout: docNaming("mine") }
				},
				noopEmit
			)
			expect(res.preset.origin).toBe("user")
			expect(res.preset.visibility).toBe("private")
			expect(res.preset.authorUserId).toBe(s.owner.id)
			expect(res.presets.map((p) => p.id)).toContain(res.preset.id)
		},
		60_000
	)

	test(
		"refuses a nameless save and a document that does not validate",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave } = await handlers()
			expect(
				await refusalOf((emit) =>
					layoutsSave.handler(
						fakeSocket(s.owner.id),
						{
							sessionId: s.session.id,
							name: "   ",
							preset: { layout: docNaming("x") }
						},
						emit
					)
				)
			).toBe("A preset needs a name")

			const sentence = await refusalOf((emit) =>
				layoutsSave.handler(
					fakeSocket(s.owner.id),
					{
						sessionId: s.session.id,
						name: "Broken",
						preset: { layout: { version: 1 } as any }
					},
					emit
				)
			)
			expect(sentence).toContain("can't be stored")
		},
		60_000
	)

	test(
		"a guest may save one of their own",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave } = await handlers()
			const res = await layoutsSave.handler(
				fakeSocket(s.guest.id),
				{
					sessionId: s.session.id,
					name: "Guest's",
					preset: { layout: docNaming("guest") }
				},
				noopEmit
			)
			expect(res.preset.authorUserId).toBe(s.guest.id)
			expect(res.preset.visibility).toBe("private")
		},
		60_000
	)
})

describe("layouts:update, share, clone, delete, usage", () => {
	test(
		"the author renames and re-captures; a stranger is told nothing",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave, layoutsUpdate } = await handlers()
			const saved = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Before",
					preset: { layout: docNaming("before") }
				},
				noopEmit
			)
			const res = await layoutsUpdate.handler(
				fakeSocket(s.owner.id),
				{
					presetId: saved.preset.id,
					name: "After",
					preset: { layout: docNaming("after") }
				},
				noopEmit
			)
			expect(res.preset.name).toBe("After")
			expect(keyOf(res.preset.document!)).toBe("after")

			expect(
				await refusalOf((emit) =>
					layoutsUpdate.handler(
						fakeSocket(s.outsider.id),
						{ presetId: saved.preset.id, name: "Taken" },
						emit
					)
				)
			).toBe("Unknown layout preset")
		},
		60_000
	)

	test(
		"sharing is the author's; a guest asking through the session is refused",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave, layoutsShare } = await handlers()
			const mine = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Published",
					preset: { layout: docNaming("published") }
				},
				noopEmit
			)
			const shared = await layoutsShare.handler(
				fakeSocket(s.owner.id),
				{ presetId: mine.preset.id, visibility: "shared" },
				noopEmit
			)
			expect(shared.preset.visibility).toBe("shared")

			const guests = await layoutsSave.handler(
				fakeSocket(s.guest.id),
				{
					sessionId: s.session.id,
					name: "Guest's",
					preset: { layout: docNaming("guest") }
				},
				noopEmit
			)
			expect(
				await refusalOf((emit) =>
					layoutsShare.handler(
						fakeSocket(s.guest.id),
						{
							sessionId: s.session.id,
							presetId: guests.preset.id,
							visibility: "shared"
						},
						emit
					)
				)
			).toContain("not share one with the instance")
		},
		60_000
	)

	test(
		"anybody may clone what they can see; the copy is theirs and private",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsClone } = await handlers()
			const res = await layoutsClone.handler(
				fakeSocket(s.guest.id),
				{ presetId: s.seeded.id },
				noopEmit
			)
			expect(res.preset.origin).toBe("user")
			expect(res.preset.visibility).toBe("private")
			expect(res.preset.authorUserId).toBe(s.guest.id)
			expect(keyOf(res.preset.document!)).toBe("genre")
		},
		60_000
	)

	test(
		"delete reports the sessions that were on it; a built-in is refused",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave, layoutsDelete, layoutsUsage } =
				await handlers()
			const saved = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Doomed",
					preset: { layout: docNaming("doomed") }
				},
				noopEmit
			)
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				layoutPresetId: saved.preset.id
			})

			const usage = await layoutsUsage.handler(
				fakeSocket(s.owner.id),
				{ presetId: saved.preset.id },
				noopEmit
			)
			expect(usage.sessions).toBe(1)

			const res = await layoutsDelete.handler(
				fakeSocket(s.owner.id),
				{ presetId: saved.preset.id },
				noopEmit
			)
			expect(res.affectedSessions).toBe(1)
			expect(res.presets.map((p) => p.id)).not.toContain(saved.preset.id)

			expect(
				await refusalOf((emit) =>
					layoutsDelete.handler(
						fakeSocket(s.owner.id, true),
						{ presetId: s.seeded.id },
						emit
					)
				)
			).toBe("Built-in layouts can't be deleted.")
		},
		60_000
	)
})

describe("layouts:setDefault", () => {
	test(
		"sets it, and falls through when the preset it named is deleted",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave, layoutsSetDefault, layoutsDelete, layoutsResolve } =
				await handlers()
			const saved = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Preferred",
					preset: { layout: docNaming("preferred") }
				},
				noopEmit
			)
			const set = await layoutsSetDefault.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id, presetId: saved.preset.id },
				noopEmit
			)
			expect(set.presetId).toBe(saved.preset.id)
			expect(
				(
					await layoutsResolve.handler(
						fakeSocket(s.owner.id),
						{ sessionId: s.session.id },
						noopEmit
					)
				).tier
			).toBe("user-default")

			await layoutsDelete.handler(
				fakeSocket(s.owner.id),
				{ presetId: saved.preset.id },
				noopEmit
			)
			const after = await layoutsResolve.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(after.tier).toBe("genre")
		},
		60_000
	)

	test(
		"refuses a preset the caller cannot see",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsSave, layoutsSetDefault } = await handlers()
			const theirs = await layoutsSave.handler(
				fakeSocket(s.owner.id),
				{
					sessionId: s.session.id,
					name: "Owner's own",
					preset: { layout: docNaming("owners") }
				},
				noopEmit
			)
			expect(
				await refusalOf((emit) =>
					layoutsSetDefault.handler(
						fakeSocket(s.outsider.id),
						{ genreId: s.genreId, presetId: theirs.preset.id },
						emit
					)
				)
			).toBe("Unknown layout preset")
		},
		60_000
	)
})

describe("layouts:export and layouts:import", () => {
	test(
		"round-trips through the wire as a new private row",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsExport, layoutsImport } = await handlers()
			const exported = await layoutsExport.handler(
				fakeSocket(s.guest.id),
				{ presetId: s.seeded.id },
				noopEmit
			)
			expect(keyOf(exported.preset.layout)).toBe("genre")

			const imported = await layoutsImport.handler(
				fakeSocket(s.guest.id),
				{
					sessionId: s.session.id,
					name: "From a file",
					preset: JSON.parse(JSON.stringify(exported.preset))
				},
				noopEmit
			)
			expect(imported.preset.origin).toBe("user")
			expect(imported.preset.authorUserId).toBe(s.guest.id)
			expect(keyOf(imported.preset.document!)).toBe("genre")
		},
		60_000
	)

	test(
		"an import carrying no document is refused with a sentence",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsImport } = await handlers()
			expect(
				await refusalOf((emit) =>
					layoutsImport.handler(
						fakeSocket(s.owner.id),
						{
							sessionId: s.session.id,
							name: "Empty",
							preset: {} as any
						},
						emit
					)
				)
			).toContain("no layout document")
		},
		60_000
	)
})

describe("layouts:resolve", () => {
	test(
		"walks the chain for the caller, and refuses a session they are not in",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsResolve } = await handlers()
			const res = await layoutsResolve.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(res.tier).toBe("genre")
			expect(res.origin).toBe("core")
			expect(keyOf(res.document)).toBe("genre")

			expect(
				await refusalOf((emit) =>
					layoutsResolve.handler(
						fakeSocket(s.outsider.id),
						{ sessionId: s.session.id },
						emit
					)
				)
			).toBe("No access to this session")
		},
		60_000
	)

	test(
		"a guest resolves their own document, not the owner's",
		async () => {
			const s = await scenario(freshGenre())
			const { layoutsResolve } = await handlers()
			await testDb.insert(schema.sessionPanelLayouts).values({
				sessionId: s.session.id,
				userId: s.owner.id,
				document: docNaming("owners")
			})
			const mine = await layoutsResolve.handler(
				fakeSocket(s.guest.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(mine.tier).toBe("genre")
			const theirs = await layoutsResolve.handler(
				fakeSocket(s.owner.id),
				{ sessionId: s.session.id },
				noopEmit
			)
			expect(theirs.tier).toBe("session")
			expect(keyOf(theirs.document)).toBe("owners")
		},
		60_000
	)

	test(
		"a session whose genre has no row at all lands on the built-in floor",
		async () => {
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const owner = await createTestUser(testDb, `sock-floor-${n++}`)
			const [session] = await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					isGroup: true,
					genreId: freshGenre()
				})
				.returning()
			const { layoutsResolve } = await handlers()
			const res = await layoutsResolve.handler(
				fakeSocket(owner.id),
				{ sessionId: session.id },
				noopEmit
			)
			expect(res.tier).toBe("built-in")
			expect(res.document).toEqual(BUILT_IN_LAYOUT_DOC)
		},
		60_000
	)
})
