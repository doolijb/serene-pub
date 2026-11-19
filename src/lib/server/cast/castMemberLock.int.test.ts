/**
 * 🚧 The cast member lock at the server's writers: while a member is locked no
 * run changes its details and words (row, cast versions), its art or its
 * durable sheet. A refused write is a note, a `refused` line or a skipped
 * landing, never a halt; a person's hand edit, a person's Accept and the
 * session layer are untouched. The lock is set by `lorebooks:updateBinding`
 * with the lock alone in the payload.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	defineRuleset,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { RUN_LOCK_SENTENCES } from "$lib/shared/lorebooks/runLocks"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string
const db = () => testDb as unknown as Db

const HP = "core:slot/hp@1"
const GENRE = "test:genre/cast-member-lock"
const RULESET = "test:ruleset/cast-lock-int@1"
const ROW_UPDATE = {
	key: "change",
	kind: "outlet",
	definitionId: "core:outlet/update-cast-member",
	definitionVersion: 1
} as any
const artDoor = (definitionId: string) =>
	({ key: "art", kind: "outlet", definitionId, definitionVersion: 1 }) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cast-member-lock-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	genreKeeping(GENRE, {
		name: { en: "Cast member lock" },
		family: "test",
		slots: [hp],
		events: {}
	})
	defineRuleset(RULESET, {
		name: { en: "Cast lock" },
		attributes: [
			{
				id: "plight",
				name: { en: "Plight" },
				kind: "label",
				of: ["active", "deceased", "missing"],
				carriedBy: ["cast"],
				readsOnto: "cast-state",
				prose: "Whether someone is still about."
			}
		],
		functions: [
			{
				ref: "test:function/cast-lock-vanish@1",
				module: {
					id: "test:function/cast-lock-vanish@1",
					name: { en: "Vanish" },
					meaning: { en: "Someone goes missing." },
					kind: "changing",
					invokable: { label: { en: "Vanish" } },
					prose: "People go missing.",
					phases: ["effects"],
					body: `export function invoke(ctx) { return { deltas: [{ attribute: "plight", op: "set", value: "missing", owner: ctx.aimedAt }] } }`
				}
			}
		]
	} as never)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

async function world(o: { ruleset?: string } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cm-lock-${suffix}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { loreWriteMode: "full" }
		})
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Mira ${suffix}`,
		description: "The card's description."
	})
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Mira ${suffix}`
	})
	// A second member the lock never touches, with no card: a background member.
	const { member: other } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:o${suffix}}}`,
		characterId: null,
		name: `Other ${suffix}`,
		description: "Someone else."
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: book!.id,
			...(o.ruleset ? { primaryRuleset: o.ruleset, rigour: "mechanics" } : {})
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: session!.id,
			characterId: card.id,
			castMemberId: member.id
		})
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			characterId: card.id,
			content: "…"
		})
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy!.id,
		sessionId: session!.id,
		characterId: card.id,
		role: "assistant"
	})
	const lock = (castMemberLock: boolean, id = member.id) =>
		testDb
			.update(schema.lorebookBindings)
			.set({ castMemberLock })
			.where(eq(schema.lorebookBindings.id, id))
	return {
		user,
		book: book!,
		card,
		member,
		other,
		session: session!,
		messageId: legacy!.id,
		suffix,
		lock,
		sentence: `Mira ${suffix}`
	}
}
type World = Awaited<ReturnType<typeof world>>

const said = (w: World) => RUN_LOCK_SENTENCES.castMember(`'${w.sentence}'`)

const versionsOf = async (memberId: number) =>
	await testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))

const rowOf = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, id))
	)[0]!

const hostOf = async (w: World, extra: Record<string, unknown> = {}) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const { noteTurnMessage } = await import(
		"$lib/server/pipelines/runtime/runTurnMessage"
	)
	const runId = `run-lock-${w.suffix}`
	noteTurnMessage(runId, w.messageId)
	return createHost(db(), {
		sessionId: w.session.id,
		userId: w.user.id,
		runId,
		...extra
	} as any)
}

const hpOf = async (w: World, owner: { kind: string; id: number }) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(db(), {
		sessionId: w.session.id,
		owner: owner as never,
		slotId: HP
	})
}

describe("update-cast-member@1 on a locked member", () => {
	test("nothing is written, the note names the member, nothing throws; unlocked it works", async () => {
		const w = await world()
		await w.lock(true)
		const before = await versionsOf(w.member.id)
		const host = await hostOf(w)
		const out: any = await host.commit!(
			{ member: w.member.id, changes: { description: "Rewritten." } },
			ROW_UPDATE
		)
		expect(out).toMatchObject({ written: false, castMemberId: w.member.id })
		expect(out.notes).toEqual([said(w)])
		expect(out.castVersionId).toBeUndefined()
		expect(await versionsOf(w.member.id)).toEqual(before)

		// The unlocked member beside it takes the same write in the same run.
		const free: any = await host.commit!(
			{ member: w.other.id, changes: { description: "Rewritten." } },
			ROW_UPDATE
		)
		expect(typeof free.castVersionId).toBe("number")

		await w.lock(false)
		const again: any = await host.commit!(
			{ member: w.member.id, changes: { description: "Rewritten." } },
			ROW_UPDATE
		)
		expect(typeof again.castVersionId).toBe("number")
		expect((await versionsOf(w.member.id)).length).toBeGreaterThan(
			before.length
		)
	})

	test("an author's write (no run) goes through the same funnel untouched", async () => {
		const w = await world()
		await w.lock(true)
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		await expect(
			testDb.transaction((tx) =>
				writeCastVersion(tx as unknown as Db, {
					member: w.member.id,
					changes: { description: "By hand." },
					writtenBy: "dc-cairns",
					session: { id: w.session.id, messageId: w.messageId }
				})
			)
		).resolves.toBeDefined()
	})
})

describe("set-state@1 on a locked member's durable sheet", () => {
	const node = async (runId: string) => {
		const { stateBindings } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		return stateBindings({ runId })["core:task/set-state@1"]!
	}
	const castMember = (w: World) => ({ kind: "cast_member", id: w.member.id })
	const seat = (w: World) => ({ kind: "session_cast", id: w.card.id })

	test("apply: a refused line with the sentence, the session-layer change in the same list lands", async () => {
		const w = await world()
		await w.lock(true)
		const setState = await node(`run-st-${w.suffix}`)
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: [
					{ owner: castMember(w), slotId: HP, value: 5 },
					{ owner: seat(w), slotId: HP, value: 7 }
				]
			},
			{} as any
		)
		expect(out.value.refused).toEqual([said(w)])
		expect(out.value.applied).toHaveLength(1)
		expect(await hpOf(w, seat(w))).toBe(7)
		expect(await hpOf(w, castMember(w))).toBe(20)

		await w.lock(false)
		const again: any = await setState(
			{
				scope: { sessionId: w.session.id },
				params: { mode: "apply" },
				changes: [{ owner: castMember(w), slotId: HP, value: 5 }]
			},
			{} as any
		)
		expect(again.value.refused ?? []).toEqual([])
		expect(await hpOf(w, castMember(w))).toBe(5)
	})

	test("propose: no proposal row is made", async () => {
		const w = await world()
		await w.lock(true)
		const setState = await node(`run-sp-${w.suffix}`)
		const out: any = await setState(
			{
				scope: { sessionId: w.session.id },
				changes: [{ owner: castMember(w), slotId: HP, value: 5 }]
			},
			{} as any
		)
		expect(out.value.refused).toEqual([said(w)])
		expect(out.value.proposed).toHaveLength(0)
		expect(
			await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.sessionId, w.session.id))
		).toHaveLength(0)
	})

	test("a person's hand edit lands; a person's Accept of a proposal made before the lock lands", async () => {
		const w = await world()
		const { setValue, proposeChange, decideProposal } = await import(
			"$lib/server/state/write"
		)
		const owner = castMember(w) as never
		const proposalId = await proposeChange(
			db(),
			{ sessionId: w.session.id, updatedBy: "run:early" },
			{ owner, slotId: HP, value: 9 } as never
		)
		await w.lock(true)
		const decided = await decideProposal(db(), proposalId, true, w.user.id)
		expect(decided.status).toBe("accepted")
		expect(await hpOf(w, castMember(w))).toBe(9)

		await setValue(
			db(),
			{ sessionId: w.session.id, updatedBy: "user", userId: w.user.id },
			{ owner, slotId: HP, value: 6 } as never
		)
		expect(await hpOf(w, castMember(w))).toBe(6)

		// The same run-made write today is refused.
		await expect(
			proposeChange(
				db(),
				{ sessionId: w.session.id, updatedBy: "run:late" },
				{ owner, slotId: HP, value: 3 } as never
			)
		).rejects.toThrow(said(w))
		await expect(
			setValue(
				db(),
				{ sessionId: w.session.id, updatedBy: "run:late" },
				{ owner, slotId: HP, value: 3 } as never
			)
		).rejects.toThrow(said(w))
	})
})

describe("a cast-state landing from the rules", () => {
	async function act(w: World, runId: string) {
		const { resolveRulesetTurn } = await import("$lib/server/rulesets/resolve")
		const key = (id: number) => `character:${id}`
		const res = await resolveRulesetTurn(
			db() as any,
			{
				owners: [`session:${w.session.id}`, key(w.card.id)],
				mode: "apply",
				actions: {
					function: "test:function/cast-lock-vanish@1",
					actor: key(w.card.id),
					aimedAt: key(w.card.id),
					answer: null
				}
			},
			{ runId, turnMessageId: w.messageId }
		)
		if ("halt" in res) throw new Error(res.halt)
		return res.ok
	}
	const stateOf = async (w: World) => {
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		return (
			await membersAsRead(db() as any, [w.member.id], {
				sessionId: w.session.id
			})
		).get(w.member.id)?.nodeState
	}

	test("direct: skipped with the words, nothing written; unlocked it lands", async () => {
		const w = await world({ ruleset: RULESET })
		await w.lock(true)
		const before = await versionsOf(w.member.id)
		const out = await act(w, `run-ties-a-${w.suffix}`)
		expect((out.facts.landings as any[])[0]).toMatchObject({
			kind: "attribute",
			attribute: "plight",
			skipped: `its cast member '${w.sentence}' is locked`
		})
		expect(await versionsOf(w.member.id)).toEqual(before)
		expect(await stateOf(w)).toBe("active")

		await w.lock(false)
		await act(w, `run-ties-b-${w.suffix}`)
		expect(await stateOf(w)).toBe("missing")
	})

	test("notes overlay: skipped too, no overlay entry made", async () => {
		const w = await world({ ruleset: RULESET })
		await testDb
			.update(schema.lorebooks)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.lorebooks.id, w.book.id))
		await w.lock(true)
		const out = await act(w, `run-ties-c-${w.suffix}`)
		const landing = (out.facts.landings as any[])[0]
		expect(landing.skipped).toBe(`its cast member '${w.sentence}' is locked`)
		expect(landing.overlaid).toBeUndefined()
		const { ruleFedOverlayOf } = await import("$lib/server/rulesets/ties")
		expect(await ruleFedOverlayOf(testDb as never, w.session.id)).toBeNull()

		// Unlocked, the same landing is the overlay's.
		await w.lock(false)
		const free = await act(w, `run-ties-d-${w.suffix}`)
		expect((free.facts.landings as any[])[0].overlaid).toBe(true)
	})
})

describe("art on a locked member", () => {
	test.each([
		[
			"core:outlet/offer-media",
			{ characterId: null, media: [] },
			{ offered: [] }
		],
		[
			"core:outlet/attach-sprite",
			{ characterId: null, media: [] },
			{ setId: null, attached: [], missing: [] }
		]
	])("%s: nothing is written, the note is returned", async (id, params, rest) => {
		const w = await world()
		await w.lock(true)
		const host = await hostOf(w, { cardActionCastMemberId: w.member.id })
		const out: any = await host.commit!(params as any, artDoor(id))
		expect(out).toEqual({
			written: false,
			characterId: null,
			castMemberId: w.member.id,
			...rest,
			notes: [said(w)]
		})
		expect(
			await testDb
				.select()
				.from(schema.castMemberFiles)
				.where(eq(schema.castMemberFiles.castMemberId, w.member.id))
		).toHaveLength(0)

		// Unlocked, the same door answers without the note.
		await w.lock(false)
		const free: any = await host.commit!(params as any, artDoor(id))
		expect(free.notes).toBeUndefined()
	})
})

describe("lorebooks:updateBinding with the lock alone", () => {
	const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
	const call = async (userId: number, lorebookBinding: Record<string, unknown>) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (await updateLorebookBindingHandler.handler(
			fakeSocket(userId),
			{ lorebookBinding } as any,
			() => {}
		)) as any
	}
	const redlines = async (memberId: number) =>
		(await testDb.select().from(schema.characterVersions).where(eq(schema.characterVersions.castMemberId, memberId))).length

	test("the owner locks and unlocks; no version, no redline", async () => {
		const w = await world()
		const versions = await redlines(w.member.id)
		const redlineRows = (await testDb.select().from(schema.loreRedlines)).length
		const locked = await call(w.user.id, { id: w.member.id, castMemberLock: true })
		expect(locked.lorebookBinding.castMemberLock).toBe(true)
		expect((await rowOf(w.member.id)).castMemberLock).toBe(true)
		const open = await call(w.user.id, { id: w.member.id, castMemberLock: false })
		expect(open.lorebookBinding.castMemberLock).toBe(false)
		expect((await rowOf(w.member.id)).castMemberLock).toBe(false)
		expect(await redlines(w.member.id)).toBe(versions)
		expect((await testDb.select().from(schema.loreRedlines)).length).toBe(redlineRows)
	})

	test("a stranger is refused", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `cm-lock-stranger-${w.suffix}`)
		await expect(
			call(stranger.id, { id: w.member.id, castMemberLock: true })
		).rejects.toThrow("Access denied.")
		expect((await rowOf(w.member.id)).castMemberLock).toBe(false)
	})

	test("a provided book's member is refused", async () => {
		const w = await world()
		const uuid = `00000000-0000-4000-8000-0000000c1${String(n).padStart(3, "0")}`
		await testDb
			.update(schema.lorebooks)
			.set({
				uuid,
				extraJson: {
					provided: { plugin: "core", slug: "core:lock", version: "1.0.0", sha256: "x", uuid, entries: {} }
				}
			} as any)
			.where(eq(schema.lorebooks.id, w.book.id))
		await expect(
			call(w.user.id, { id: w.member.id, castMemberLock: true })
		).rejects.toThrow("This lorebook comes with the pub: make your own copy to change it.")
		expect((await rowOf(w.member.id)).castMemberLock).toBe(false)
	})

	test("a full update with the lock in it does not change the lock", async () => {
		const w = await world()
		await call(w.user.id, {
			id: w.other.id,
			summary: "Quiet.",
			castMemberLock: true
		})
		expect((await rowOf(w.other.id)).castMemberLock).toBe(false)
		expect((await rowOf(w.other.id)).summary).toBe("Quiet.")
		await w.lock(true, w.other.id)
		await call(w.user.id, {
			id: w.other.id,
			summary: "Quieter.",
			castMemberLock: false
		})
		expect((await rowOf(w.other.id)).castMemberLock).toBe(true)
	})
})
