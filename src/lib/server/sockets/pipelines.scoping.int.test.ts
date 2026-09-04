/**
 * What the pipeline handlers refuse.
 *
 * The read model is tested against its own claims in
 * `pipelines/config.int.test.ts`. This file tests the layer above it, where the
 * inputs come from a browser: a `sessionId` is a small integer somebody can guess,
 * `scope: "instance"` is a word anyone can put in a payload, and the management
 * handlers are the ones allowed to talk about topology.
 *
 * Three properties, each of which is a hole if it is missing:
 *
 *  1. Passing someone else's session id does not make an edit land in their session.
 *  2. A non-admin cannot write at instance scope by asking to.
 *  3. Run receipts are scoped to their owner — a receipt records what a pipeline
 *     decided about somebody's conversation, not instance trivia.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { humanizeTypeId } from "$lib/server/pipelines/config/panel"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "socket-scoping-test-secret" }
})

let owner: { id: number }
let stranger: { id: number }
let admin: { id: number }
let ownersSessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-pipelines-scoping-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	owner = await createTestUser(testDb, "pipe-owner")
	stranger = await createTestUser(testDb, "pipe-stranger")
	admin = await createTestUser(testDb, "pipe-admin")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))

	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false })
		.returning()
	ownersSessionId = session.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

/** The captured emissions, so a handler's answer can be read back. */
function recordingEmit() {
	const seen: Array<[string, any]> = []
	const emit = (event: string, data: any) => seen.push([event, data])
	return {
		emit,
		seen,
		last: (e: string) => seen.filter(([k]) => k === e).at(-1)?.[1]
	}
}

/** A prompts option's handle, which is also what the prompt gates are keyed by. */
async function promptOptionId() {
	return await firstWritableOptionId(admin.id)
}

async function firstWritableOptionId(userId: number) {
	const { namespaceView } = await import("$lib/server/pipelines/config/panel")
	const view = await namespaceView(
		testDb as any,
		"socket-scoping-test-secret",
		RESPOND_SPEC_ID,
		{ userId, isAdmin: true }
	)
	// A prompts option, minted from an admin view — option ids are HMAC
	// handles independent of the viewer, and since the layer simplification
	// (2026-08-24) a non-admin's *global* view is read-only, so the non-admin
	// cases below exercise refusals against an id that certainly exists.
	const option = view!.steps
		.flatMap((s) => [...s.options, ...s.advanced])
		.find((o) => o.control === "prompts-ref")
	if (!option) throw new Error("the respond spec exposes no prompts option")
	return option.id
}

describe("a session id from the client is not a capability", () => {
	test("a stranger's edit with someone else's session id writes nowhere", async () => {
		const { pipelinesSetOption } = await import("./pipelines")
		const optionId = await firstWritableOptionId(stranger.id)
		const rec = recordingEmit()

		await pipelinesSetOption.handler(
			socketFor(stranger.id),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				value: "I should not reach that session",
				sessionId: ownersSessionId
			},
			rec.emit
		)

		// `viewerFor` drops a session the caller is no part of, and with the user
		// layer gone (2026-08-24) there is nowhere legitimate left for the
		// write to fall back to: a global edit is a config edit, and configs
		// are the administrator's. So the guessed id buys a refusal, not a row.
		const err = rec.last("pipelines:setOption:error")
		expect(err?.error).toMatch(/administrator/i)

		const sessionRows = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, ownersSessionId)
				)
			)
		expect(sessionRows).toHaveLength(0)

		const all = await testDb.select().from(schema.pipelineNodeOverrides)
		expect(
			(all as any[]).some(
				(o) => o.value === "I should not reach that session"
			)
		).toBe(false)
	})

	test("the owner's own edit does land at session scope", async () => {
		const { pipelinesSetOption } = await import("./pipelines")
		const optionId = await firstWritableOptionId(owner.id)

		await pipelinesSetOption.handler(
			socketFor(owner.id),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				value: "only in my session",
				sessionId: ownersSessionId
			},
			noopEmit
		)

		const rows = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, ownersSessionId)
				)
			)
		expect(rows).toHaveLength(1)
		expect(rows[0].value).toBe("only in my session")
	})
})

describe("instance scope is the administrator's", () => {
	test("a non-admin asking for it is refused, in a sentence", async () => {
		const { pipelinesSetOption } = await import("./pipelines")
		const optionId = await firstWritableOptionId(stranger.id)
		const rec = recordingEmit()

		await pipelinesSetOption.handler(
			socketFor(stranger.id),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				value: "for everyone"
			},
			rec.emit
		)

		const err = rec.last("pipelines:setOption:error")
		expect(err?.error).toMatch(/administrator/i)

		const rows = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeKind, "instance"))
		expect(rows).toHaveLength(0)
	})

	test("an admin's global edit lands in the selected configuration", async () => {
		const { pipelinesSetOption } = await import("./pipelines")
		const optionId = await firstWritableOptionId(admin.id)

		// Against the shipped immutable default the write refuses with the
		// duplicate suggestion — the layers as simplified 2026-08-24: there
		// is no instance override row to fall back to writing.
		const rec = recordingEmit()
		await pipelinesSetOption.handler(
			socketFor(admin.id, true),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				value: "for everyone"
			},
			rec.emit
		)
		expect(rec.last("pipelines:setOption:error")?.error).toMatch(
			/Duplicate it and edit the copy/
		)

		// With a mutable configuration selected, the same write becomes that
		// configuration's own value.
		const { resolveSelectedConfig, duplicateConfig, selectConfig } =
			await import("$lib/server/pipelines/config/named")
		const [spec] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const shipped = await resolveSelectedConfig(
			testDb as any,
			spec.id,
			RESPOND_SPEC_ID,
			{}
		)
		const copy = await duplicateConfig(
			testDb as any,
			shipped!.configId,
			"Everyone's"
		)
		await selectConfig(testDb as any, spec.id, "instance", 0, copy.id)

		await pipelinesSetOption.handler(
			socketFor(admin.id, true),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				value: "for everyone"
			},
			noopEmit
		)

		const values = await testDb
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, copy.id))
		expect((values as any[]).some((v) => v.value === "for everyone")).toBe(
			true
		)
		// And no override row anywhere — the layer is gone.
		const overrides = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeKind, "instance"))
		expect(overrides).toHaveLength(0)
	})
})

describe("the management view is admin-only", () => {
	test("a non-admin is refused before any topology is read", async () => {
		const { pipelinesDetail } = await import("./pipelines")
		const rec = recordingEmit()
		const res: any = await pipelinesDetail.handler(
			socketFor(stranger.id),
			{ slug: RESPOND_SPEC_ID },
			rec.emit
		)
		expect(res.error).toMatch(/admin/i)
		expect(res.spec).toBeUndefined()
		// Node counts are topology. The refusal must not carry one anyway.
		expect(JSON.stringify(res)).not.toMatch(/nodeCount/)
	})

	test("an admin sees the versions and their hashes", async () => {
		const { pipelinesDetail } = await import("./pipelines")
		const res: any = await pipelinesDetail.handler(
			socketFor(admin.id, true),
			{ slug: RESPOND_SPEC_ID },
			noopEmit
		)
		expect(res.spec?.versions?.length).toBeGreaterThan(0)
		expect(res.spec.versions[0].canonicalHash).toBeTruthy()
		expect(res.spec.versions[0].nodeCount).toBeGreaterThan(0)
	})
})

describe("run receipts belong to the person whose session they describe", () => {
	test("a stranger asking about someone else's session gets nothing", async () => {
		await testDb.insert(schema.pipelineRuns).values({
			runId: "run-scoping-1",
			specSlug: RESPOND_SPEC_ID,
			specVersion: "1.0.0",
			sessionId: ownersSessionId,
			userId: owner.id,
			outcome: "ok",
			triggerSource: "event",
			seed: "s",
			startedAt: new Date(),
			endedAt: new Date(),
			elapsedMs: 1,
			receipt: {}
		})

		const { pipelinesRuns } = await import("./pipelines")
		const mine: any = await pipelinesRuns.handler(
			socketFor(owner.id),
			{ sessionId: ownersSessionId },
			noopEmit
		)
		expect(mine.runs).toHaveLength(1)

		const theirs: any = await pipelinesRuns.handler(
			socketFor(stranger.id),
			{ sessionId: ownersSessionId },
			noopEmit
		)
		expect(theirs.runs).toHaveLength(0)
	})
})

describe("prompt CRUD is gated on the option, not on ownership", () => {
	let specId: number
	let promptId: number
	let optionId: string
	let pool: { nodeTypeId: string; slot: string }

	beforeAll(async () => {
		const [spec] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		specId = spec.id

		// The pool comes off the declaration, and so does the handle every
		// mutation is addressed by: a prompt is pooled by the node that
		// consumes it, so "which pipeline owns this row" has no answer and the
		// option handle is what proves the caller is operating a control this
		// pipeline offers them.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decl = (
			await declarations(testDb as any, spec.activeVersionId!)
		).find((d: any) => d.control === "prompts-ref")!
		pool = { nodeTypeId: decl.nodeTypeId!, slot: decl.slot }
		optionId = await promptOptionId()

		const [p] = await testDb
			.insert(schema.pipelinePrompts)
			.values({
				...pool,
				name: "Socket original",
				fields: Object.fromEntries(
					(decl.promptFields ?? []).map((f: string) => [
						f,
						"original words"
					])
				)
			})
			.returning()
		promptId = p.id
	})

	/** The owner edits from inside their own session, which is where a
	 * non-admin's prompt edits land (the write matrix's `prompts` line). */
	const asOwner = <T extends object>(extra: T) => ({
		slug: RESPOND_SPEC_ID,
		optionId,
		sessionId: ownersSessionId,
		...extra
	})

	test("clone answers with the copy's id and a fresh view", async () => {
		const { pipelinesClonePrompt } = await import("./pipelines")
		const rec = recordingEmit()
		const res: any = await pipelinesClonePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId }),
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.promptId).toBeTruthy()
		expect(res.promptId).not.toBe(promptId)
		// The copy's name is derived and unique; the view already offers it.
		const view = rec.last("pipelines:get")?.pipeline
		const labels = view.steps
			.flatMap((s: any) => [...s.options, ...s.advanced])
			.filter((o: any) => o.control === "prompts-ref")
			.flatMap((o: any) => o.choices ?? [])
			.map((c: any) => c.label)
		expect(labels).toContain("Socket original (copy)")
	})

	test("a copy lands in the option's own pool, or the picker would not offer it", async () => {
		const { pipelinesClonePrompt } = await import("./pipelines")
		const cloned: any = await pipelinesClonePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId, name: "Pool check" }),
			noopEmit
		)
		const [row] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, cloned.promptId))
		expect(row.nodeTypeId).toBe(pool.nodeTypeId)
		expect(row.slot).toBe(pool.slot)
	})

	test("create writes a prompt into an option's pool from nothing", async () => {
		// A pool can be legitimately empty — core ships prose for its own nodes
		// and none for a plugin's — so a picker with no rows needs a way to be
		// given one.
		const { pipelinesCreatePrompt } = await import("./pipelines")
		const res: any = await pipelinesCreatePrompt.handler(
			socketFor(owner.id),
			asOwner({ name: "From nothing", fields: { systemPrompt: "x" } }),
			noopEmit
		)
		expect(res.error).toBeUndefined()
		const [row] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, res.promptId))
		expect(row.nodeTypeId).toBe(pool.nodeTypeId)
		expect(row.slot).toBe(pool.slot)
		expect(row.createdForSpecId).toBe(specId)
	})

	test("update rewords the copy; the original is untouched", async () => {
		const { pipelinesClonePrompt, pipelinesUpdatePrompt } = await import(
			"./pipelines"
		)
		const cloned: any = await pipelinesClonePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId, name: "Reworded" }),
			noopEmit
		)
		const res: any = await pipelinesUpdatePrompt.handler(
			socketFor(owner.id),
			asOwner({
				promptId: cloned.promptId,
				fields: {
					systemPrompt: "new words",
					postHistoryInstructions: "new words"
				}
			}),
			noopEmit
		)
		expect(res.error).toBeUndefined()

		const { resolvePromptFields } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		expect(
			(await resolvePromptFields(testDb as any, cloned.promptId))
				.systemPrompt
		).toBe("new words")
		expect(
			(await resolvePromptFields(testDb as any, promptId)).systemPrompt
		).toBe("original words")
	})

	test("a prompt from another pool is refused, and blames the step", async () => {
		// The refusal that replaces "does not belong to this pipeline". That
		// sentence is no longer true of anything — a prompt travels with its
		// node — and telling somebody it was would send them looking for a
		// setting that does not exist.
		const { NARRATE_SPEC_ID } = await import("$lib/server/pipelines/specs")
		const [narrate] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const nDecl = (
			await declarations(testDb as any, narrate.activeVersionId!)
		).find((d: any) => d.control === "prompts-ref")!
		const [foreign] = await testDb
			.insert(schema.pipelinePrompts)
			.values({
				nodeTypeId: nDecl.nodeTypeId!,
				slot: nDecl.slot,
				name: "From another kind of step",
				fields: Object.fromEntries(
					(nDecl.promptFields ?? []).map((f: string) => [f, "x"])
				)
			})
			.returning()

		const { pipelinesUpdatePrompt, pipelinesDeletePrompt } = await import(
			"./pipelines"
		)
		const rec = recordingEmit()
		const res: any = await pipelinesUpdatePrompt.handler(
			socketFor(owner.id),
			asOwner({
				promptId: foreign.id,
				fields: { systemPrompt: "hijacked" }
			}),
			rec.emit
		)
		expect(res.error).toMatch(/different kind of step/)
		expect(rec.last("pipelines:updatePrompt:error")).toBeTruthy()

		const del: any = await pipelinesDeletePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId: foreign.id }),
			noopEmit
		)
		expect(del.error).toMatch(/different kind of step/)
	})

	test("a non-admin outside every session is told where to edit instead", async () => {
		// Tighter than `promptInSpec` was, deliberately. That gate checked
		// ownership and never asked whether the caller could write at all, so
		// any signed-in person could reword a row from outside every session —
		// which, pooled, reaches every pipeline reusing the node.
		const { pipelinesUpdatePrompt } = await import("./pipelines")
		const res: any = await pipelinesUpdatePrompt.handler(
			socketFor(owner.id),
			{
				slug: RESPOND_SPEC_ID,
				optionId,
				promptId,
				fields: { systemPrompt: "from nowhere" }
			},
			noopEmit
		)
		expect(res.error).toMatch(/administrator/)
	})

	test("an option handle for a different kind of setting is refused", async () => {
		// The handle is the capability here, so it has to be checked for what
		// it addresses and not merely for being well formed.
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const view = await namespaceView(
			testDb as any,
			"socket-scoping-test-secret",
			RESPOND_SPEC_ID,
			{ userId: admin.id, isAdmin: true }
		)
		const other = view!.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.control === "context-template-ref")!
		const { pipelinesUpdatePrompt } = await import("./pipelines")
		const res: any = await pipelinesUpdatePrompt.handler(
			socketFor(owner.id),
			{
				slug: RESPOND_SPEC_ID,
				optionId: other.id,
				promptId,
				sessionId: ownersSessionId,
				fields: { systemPrompt: "through the wrong door" }
			},
			noopEmit
		)
		expect(res.error).toMatch(/does not choose a prompt/)
	})

	test("delete removes an unreferenced copy", async () => {
		const { pipelinesClonePrompt, pipelinesDeletePrompt } = await import(
			"./pipelines"
		)
		const cloned: any = await pipelinesClonePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId, name: "Disposable copy" }),
			noopEmit
		)
		const res: any = await pipelinesDeletePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId: cloned.promptId }),
			noopEmit
		)
		expect(res.error).toBeUndefined()
	})

	test("your own selection does not hold a prompt alive — anyone else's does", async () => {
		// Delete sits next to the *selected* prompt in the panel, and selecting
		// is itself a reference — without this rule the button is unreachable.
		// Deleting what you selected resets your selection to what it inherits.
		const { pipelinesClonePrompt, pipelinesDeletePrompt } = await import(
			"./pipelines"
		)
		const cloned: any = await pipelinesClonePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId, name: "Selected copy" }),
			noopEmit
		)
		// Selections are session overrides now (the layers as simplified
		// 2026-08-24) — the owner's in their session, somebody else's in theirs.
		const [strangersSession] = await testDb
			.insert(schema.sessions)
			.values({ userId: stranger.id, isGroup: false })
			.returning()
		const select = async (sessionId: number, byUserId: number) => {
			await testDb
				.delete(schema.pipelineNodeOverrides)
				.where(
					and(
						eq(schema.pipelineNodeOverrides.specId, specId),
						eq(schema.pipelineNodeOverrides.scopeKind, "session"),
						eq(schema.pipelineNodeOverrides.scopeId, sessionId),
						eq(schema.pipelineNodeOverrides.slot, pool.slot)
					)
				)
			await testDb.insert(schema.pipelineNodeOverrides).values({
				specId,
				scopeKind: "session",
				scopeId: sessionId,
				nodeKey: "context",
				slot: pool.slot,
				path: "",
				value: cloned.promptId,
				updatedBy: byUserId
			})
		}

		// Someone else's session selected it too: refuse, and leave both rows.
		await select(ownersSessionId, owner.id)
		await select(strangersSession.id, stranger.id)
		const refused: any = await pipelinesDeletePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId: cloned.promptId }),
			noopEmit
		)
		expect(refused.error).toMatch(/still selected/)

		// Only the owner's own selection remains: delete goes through and the
		// selection row goes with it.
		await testDb
			.delete(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(
						schema.pipelineNodeOverrides.scopeId,
						strangersSession.id
					),
					eq(schema.pipelineNodeOverrides.scopeKind, "session")
				)
			)
		const res: any = await pipelinesDeletePrompt.handler(
			socketFor(owner.id),
			asOwner({ promptId: cloned.promptId }),
			noopEmit
		)
		expect(res.error).toBeUndefined()
		const leftover = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, ownersSessionId))
		expect(
			(leftover as any[]).filter((r) => r.value === cloned.promptId)
		).toHaveLength(0)
	})
})

/**
 * Named-config CRUD, and the two ways it could quietly do harm.
 *
 * A configuration is the thing someone keeps — the pipeline underneath it is
 * just the backbone. So these verbs are the ones that lose work if they are
 * wrong: a duplicate that starts empty silently hands back the *defaults*
 * rather than what you were looking at, and an id check that trusts the client
 * lets a guessable integer rename or delete another pipeline's configuration
 * through this one's screen.
 */
describe("named-config CRUD", () => {
	const call = async (name: string, params: any, user = admin) => {
		const mod: any = await import("./pipelines")
		const rec = recordingEmit()
		const res = await mod[name].handler(
			socketFor(user.id, user === admin),
			params,
			rec.emit
		)
		return { res, rec }
	}

	const configsIn = async () => {
		const [spec] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		return await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, spec.id))
	}

	test("creates one, and it shows up in the view", async () => {
		const { res } = await call("pipelinesCreateConfig", {
			slug: RESPOND_SPEC_ID,
			name: "Nighttime"
		})
		expect(res.error).toBeUndefined()
		expect(res.configId).toBeTruthy()
		expect((await configsIn()).map((c: any) => c.name)).toContain(
			"Nighttime"
		)
	})

	test("refuses a name the pipeline already uses", async () => {
		const { res } = await call("pipelinesCreateConfig", {
			slug: RESPOND_SPEC_ID,
			name: "Nighttime"
		})
		expect(res.error).toMatch(/already has a configuration/i)
	})

	test("a duplicate carries the values, not just the name", async () => {
		// The whole workflow is "copy the one I like, change one thing". A copy
		// that started empty would resolve the pipeline defaults instead, which
		// looks identical until the one thing you changed is not the only
		// difference.
		const source = (await configsIn()).find(
			(c: any) => c.name === "Nighttime"
		)!
		await testDb.insert(schema.pipelineConfigValues).values({
			configId: source.id,
			nodeKey: "prompt",
			slot: "params",
			path: "budget",
			value: 1234 as any
		})

		const { res } = await call("pipelinesCreateConfig", {
			slug: RESPOND_SPEC_ID,
			name: "Nighttime (copy)",
			fromConfigId: source.id
		})
		expect(res.error).toBeUndefined()

		const copied = await testDb
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, res.configId))
		expect(copied).toHaveLength(1)
		expect(copied[0].value).toBe(1234)
		// And the source still has its own row — a move would pass a
		// "the copy has it" assertion just as well.
		const stillThere = await testDb
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, source.id))
		expect(stillThere).toHaveLength(1)
	})

	test("renames, then deletes", async () => {
		const target = (await configsIn()).find(
			(c: any) => c.name === "Nighttime (copy)"
		)!
		const renamed = await call("pipelinesRenameConfig", {
			slug: RESPOND_SPEC_ID,
			configId: target.id,
			name: "Daytime"
		})
		expect(renamed.res.error).toBeUndefined()
		expect((await configsIn()).map((c: any) => c.name)).toContain("Daytime")

		const deleted = await call("pipelinesDeleteConfig", {
			slug: RESPOND_SPEC_ID,
			configId: target.id
		})
		expect(deleted.res.error).toBeUndefined()
		expect((await configsIn()).map((c: any) => c.name)).not.toContain(
			"Daytime"
		)
	})

	test("will not delete the shipped configuration", async () => {
		const shipped = (await configsIn()).find((c: any) => c.isImmutable)
		expect(shipped, "no immutable config to test against").toBeTruthy()
		const { res } = await call("pipelinesDeleteConfig", {
			slug: RESPOND_SPEC_ID,
			configId: shipped!.id
		})
		expect(res.error).toMatch(/ships|default/i)
		expect((await configsIn()).some((c: any) => c.id === shipped!.id)).toBe(
			true
		)
	})

	test("will not touch another pipeline's configuration", async () => {
		// The id is a small integer the client supplies. Without the spec check
		// this renames the narrator's configuration through the reply
		// pipeline's screen.
		const [narrate] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		const [foreign] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, narrate.id))
		expect(foreign, "narrate has no config to borrow").toBeTruthy()

		const { res } = await call("pipelinesRenameConfig", {
			slug: RESPOND_SPEC_ID,
			configId: foreign.id,
			name: "Hijacked"
		})
		expect(res.error).toMatch(/different pipeline/i)

		const [after] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, foreign.id))
		expect(after.name).toBe(foreign.name)
	})

	test("a non-admin cannot create one", async () => {
		const { res } = await call(
			"pipelinesCreateConfig",
			{ slug: RESPOND_SPEC_ID, name: "Sneaky" },
			owner
		)
		expect(res.error).toMatch(/admin/i)
		expect((await configsIn()).map((c: any) => c.name)).not.toContain(
			"Sneaky"
		)
	})
})

/**
 * The structural payload the builder's map draws from.
 *
 * Everything here is topology — node keys, wiring, blocks — and it rides on
 * `pipelines:detail` rather than `pipelines:get` on purpose: the panel view is
 * what the sidebar reads, and 05 §0a forbids it knowing any of this. The first
 * assertion is that boundary; the rest are the three things the map cannot draw
 * if they are wrong.
 */
describe("the builder's structural payload", () => {
	const detailFor = async (slug: string) => {
		const { pipelinesDetail } = await import("./pipelines")
		const rec = recordingEmit()
		await pipelinesDetail.handler(
			socketFor(admin.id, true),
			{ slug },
			rec.emit
		)
		return rec.last("pipelines:detail")?.spec
	}

	test("a non-admin gets no graph, because they get no detail at all", async () => {
		const { pipelinesDetail } = await import("./pipelines")
		const rec = recordingEmit()
		const res: any = await pipelinesDetail.handler(
			socketFor(owner.id),
			{ slug: RESPOND_SPEC_ID },
			rec.emit
		)
		expect(res.error).toMatch(/admin/i)
		expect(rec.last("pipelines:detail")).toBeUndefined()
	})

	test("every node appears, including the ones that configure nothing", async () => {
		// The page used to render `steps`, which exist only for configurable
		// nodes — so a twelve-node pipeline drew as eight and the reader had no
		// way to know four were missing.
		const spec = await detailFor(RESPOND_SPEC_ID)
		const keys = spec.graph.nodes.map((n: any) => n.key)
		expect(keys).toContain("input")
		expect(keys).toContain("gather.cast.read")
		expect(keys).toContain("lines")
		const unconfigurable = spec.graph.nodes.filter(
			(n: any) => n.stepKey === null
		)
		expect(unconfigurable.length).toBeGreaterThan(0)
	})

	test("a configurable node names the step that configures it", async () => {
		// The map is keyed by node and the inspector by step; if this pairing
		// is wrong, clicking a card opens somebody else's settings.
		const spec = await detailFor(RESPOND_SPEC_ID)
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const view: any = await namespaceView(
			testDb as any,
			"socket-scoping-test-secret",
			RESPOND_SPEC_ID,
			{ userId: admin.id, isAdmin: true }
		)
		const generate = spec.graph.nodes.find((n: any) => n.key === "generate")
		const step = view.steps.find((s: any) => s.key === generate.stepKey)
		expect(step, "generate's stepKey matches no step").toBeTruthy()
		expect(step.label).toBe(generate.label)
	})

	test("the reads arrive as one block, one chain each", async () => {
		// The map draws a frame with columns from exactly this: same blockId,
		// different blockChain. Were they to arrive with no block, or all on
		// one chain, the page would draw four sequential cards for something
		// that runs at once — which is the drawing being wrong about the run.
		const spec = await detailFor(RESPOND_SPEC_ID)
		const reads = spec.graph.nodes.filter(
			(n: any) => n.blockId === "gather"
		)
		// Five since 1.8.0: world and character lore split into their own
		// lanes. Asserted as "one chain each" rather than a fixed count, so
		// adding a source is a one-line change here instead of a puzzle.
		expect(reads.length).toBeGreaterThanOrEqual(4)
		expect(reads.every((n: any) => n.blockKind === "async")).toBe(true)
		expect(new Set(reads.map((n: any) => n.blockChain)).size).toBe(
			reads.length
		)
		expect(reads.map((n: any) => n.blockChain).sort()).toEqual([
			"cast",
			"characterLore",
			"history",
			"historyEntries",
			"relationshipsKnown",
			"relationshipsPerspectives",
			"worldLore"
		])

		const block = spec.graph.blocks.find((b: any) => b.id === "gather")
		expect(block?.kind).toBe("async")
		expect(block?.mode).toBe("parallel")
	})

	test("a node is labelled with the name its type declares", async () => {
		// ⚠ The label was `humanizeTypeId(typeId)`, which turns
		// `core:query/relationships-perspectives@1` into "Relationships
		// perspectives" — a reasonable fallback being used as the answer. The
		// registry row carries `i18n`, written from the declaration precisely
		// so a name can be a name, and the builder invented one beside it: the
		// graph query rendered as "Graph context" while its declaration said
		// "Graph relationships", and nothing showed the second.
		//
		// Asserted on a type whose declared name is *not* what humanizing its
		// id produces, or the test passes either way.
		const spec = await detailFor(RESPOND_SPEC_ID)
		const node = spec.graph.nodes.find((n: any) =>
			String(n.typeId).startsWith("core:query/relationships-perspectives")
		)
		expect(node, "the node is in the graph").toBeTruthy()
		expect(node!.label).toBe("Relationships: their perspective")
		expect(node!.label).not.toBe(humanizeTypeId(node!.typeId))
	})

	test("a map block arrives with what it iterates over", async () => {
		// `over` is a data reference the edge table never carried, so deriving
		// it from edges comes back empty every time — it has to be read from
		// `pipeline_blocks`.
		const spec = await detailFor("core:spec/summarize-scene")
		const block = spec.graph.blocks.find((b: any) => b.kind === "map")
		expect(block, "summarize-scene declares a map block").toBeTruthy()
		expect(block.over).toBe("batches")
		expect(block.max).toBeGreaterThan(0)
		const inBlock = spec.graph.nodes.filter(
			(n: any) => n.blockId === block.id
		)
		expect(inBlock.length).toBeGreaterThan(0)
		expect(inBlock[0].blockKind).toBe("map")
	})

	test("an edge out of a block keeps the block it came from", async () => {
		// A map's output feeds the next node with no `fromNodeId` at all.
		// Reading only nodes drops it, and the frame loses its exit.
		const spec = await detailFor("core:spec/summarize-scene")
		const fromBlock = spec.graph.edges.filter((e: any) => e.fromBlock)
		expect(
			fromBlock.length,
			"every edge resolved to a node — the block edges were dropped"
		).toBeGreaterThan(0)
		expect(fromBlock.every((e: any) => e.from === null)).toBe(true)
	})
})
