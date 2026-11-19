/**
 * Who reads a pipeline's prompts and settings (owner ruling D58, 2026-11-16):
 * "The session's owner picks and may read the wording; a guest sees nothing;
 * outside a session only an administrator."
 *
 * Driven through the socket handlers, the way the client does. G6 (owner,
 * 2026-11-16) is ruled and pinned: "In another person's session an
 * administrator is a guest." Outside a session an administrator reads and
 * writes at configuration scope as before.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { groupOptions } from "$lib/server/pipelines/config/panel/groups"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "prompt-readers-test-secret"
	}
})

const ADMIN_SENTENCE = "Access denied. Only admin users can manage pipelines."
const SESSION_SENTENCE = "Only the session's owner sees its settings."

let testDb: TestDb
let dataDir: string
let owner: { id: number }
let guest: { id: number }
let admin: { id: number }
let member: { id: number }
let sessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-prompt-readers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	owner = await createTestUser(testDb, "readers-owner")
	guest = await createTestUser(testDb, "readers-guest")
	admin = await createTestUser(testDb, "readers-admin")
	member = await createTestUser(testDb, "readers-member")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId: "core:genre/story"
		} as any)
		.returning()
	sessionId = session!.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guest.id } as any)
	// A second guest session of the administrator's: admin is a guest of `sessionId` too.
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: admin.id } as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const asOwner = () => socketFor(owner.id)
const asGuest = () => socketFor(guest.id)
const asAdmin = () => socketFor(admin.id, true)
const asMember = () => socketFor(member.id)

const get = async (socket: any, sessionIdArg?: number) => {
	const { pipelinesGet } = await import("./pipelines")
	return (await pipelinesGet.handler(
		socket,
		{ slug: STORY_RESPOND_SPEC_ID, sessionId: sessionIdArg },
		() => {}
	)) as any
}

const wording = async (socket: any, params: Record<string, unknown>) => {
	const { pipelinesPromptWording } = await import("./pipelines")
	return (await pipelinesPromptWording.handler(
		socket,
		{ slug: STORY_RESPOND_SPEC_ID, sessionId, ...params } as any,
		() => {}
	)) as any
}

const promptOption = async () => {
	const res = await get(asOwner(), sessionId)
	const option = groupOptions(res.pipeline.groups).find(
		(o: any) => o.control === "prompts-ref"
	) as any
	if (!option) throw new Error("the owner's view has no prompt row")
	return option
}

/** The owner's settings-form field for the reply's prompt row. */
const promptField = async () => {
	const { settingsForm } = await import("$lib/server/sessions/settingsForm")
	const form = await settingsForm(testDb as any, sessionId, {
		userId: owner.id,
		isAdmin: false
	})
	const field = form.groups
		.find(
			(g: any) =>
				g.kind === "registration" &&
				g.pipeline === STORY_RESPOND_SPEC_ID
		)
		?.fields.find(
			(x: any) =>
				(x.address as any).slot === "prompts" && (x.address as any).nodeKey === "context"
		)
	if (!field) throw new Error("the owner's form has no reply prompt row")
	return field as any
}

/** Every prompt of the pool, so "nothing leaked" can look for each. */
const poolLeaks = async (reply: unknown) => {
	const text = JSON.stringify(reply)
	const rows = await testDb.select().from(schema.pipelinePrompts)
	const hits: string[] = []
	for (const r of rows) {
		if (r.name && text.includes(r.name)) hits.push(r.name)
		for (const v of Object.values(
			(r.fields ?? {}) as Record<string, string>
		))
			if (
				v &&
				v.length > 12 &&
				text.includes(JSON.stringify(v).slice(1, 40))
			)
				hits.push(`${r.name}: wording`)
	}
	return hits
}

describe("pipelines:get — who reads the view", () => {
	test("an administrator outside a session reads every row", async () => {
		const res = await get(asAdmin())
		expect(res.error).toBeUndefined()
		const controls = groupOptions(res.pipeline.groups).map(
			(o: any) => o.control
		)
		expect(controls).toContain("prompts-ref")
		expect(controls).toContain("connection-ref")
	})

	test("a non-admin outside a session is refused with the admin sentence, nothing leaked", async () => {
		const res = await get(asMember())
		expect(res).toEqual({ error: ADMIN_SENTENCE })
		expect(await poolLeaks(res)).toEqual([])
	})

	test("the owner in their own session reads prompt rows and no model plumbing", async () => {
		const res = await get(asOwner(), sessionId)
		expect(res.error).toBeUndefined()
		const controls = groupOptions(res.pipeline.groups).map(
			(o: any) => o.control
		)
		expect(controls.length).toBeGreaterThan(0)
		for (const c of controls) expect(c).toBe("prompts-ref")
	})

	test("a guest is refused with the session sentence, nothing leaked", async () => {
		const res = await get(asGuest(), sessionId)
		expect(res).toEqual({ error: SESSION_SENTENCE })
		expect(await poolLeaks(res)).toEqual([])
	})

	test("an administrator in someone else's session is a guest — G6: refused like one, nothing leaked", async () => {
		const res = await get(asAdmin(), sessionId)
		expect(res).toEqual({ error: SESSION_SENTENCE })
		expect(await poolLeaks(res)).toEqual([])
	})
})

describe("pipelines:promptWording by optionId", () => {
	test("the owner reads", async () => {
		const option = await promptOption()
		const choice = option.choices[0]
		const res = await wording(asOwner(), {
			optionId: option.id,
			promptId: choice.id
		})
		expect(res.error).toBeUndefined()
		expect(res.name).toBe(choice.label)
		expect(Object.keys(res.fields)).toEqual(option.promptFields)
	})

	test("a guest with an option id minted from the owner's view is refused, nothing leaked", async () => {
		const option = await promptOption()
		const res = await wording(asGuest(), {
			optionId: option.id,
			promptId: option.choices[0].id
		})
		expect(res.error).toBe(SESSION_SENTENCE)
		expect(res.fields).toBeUndefined()
		expect(res.name).toBeUndefined()
	})

	test("a non-admin outside a session is refused", async () => {
		const option = await promptOption()
		const res = await wording(asMember(), {
			sessionId: undefined,
			optionId: option.id,
			promptId: option.choices[0].id
		})
		expect(res.error).toBe(ADMIN_SENTENCE)
		expect(res.fields).toBeUndefined()
		expect(res.name).toBeUndefined()
	})

	test("a forged prompt id is refused", async () => {
		const option = await promptOption()
		const res = await wording(asOwner(), {
			optionId: option.id,
			promptId: 987654321
		})
		expect(res.error).toMatch(/not one this step offers/)
		expect(res.fields).toBeUndefined()
	})
})

describe("pipelines:promptWording by fieldId", () => {
	test("the owner reads a pool prompt of the Story reply's prompt row", async () => {
		const field = await promptField()
		const key = field.members[0].key
		const res = await wording(asOwner(), {
			fieldId: field.id,
			promptId: Number(key)
		})
		expect(res.error).toBeUndefined()
		expect(res.fieldId).toBe(field.id)
		expect(res.optionId).toBeUndefined()
		expect(res.declared.length).toBeGreaterThan(0)
		expect(Object.keys(res.fields)).toEqual(res.declared)
	})

	test("a prompt outside the row's pool is refused", async () => {
		const field = await promptField()
		const [narrator] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(
				and(
					eq(
						schema.pipelinePrompts.nodeDefinitionId,
						"core:task/build-narrator-context"
					),
					eq(schema.pipelinePrompts.name, "Narrator")
				)
			)
		expect(narrator).toBeDefined()
		const res = await wording(asOwner(), {
			fieldId: field.id,
			promptId: narrator!.id
		})
		expect(res.error).toMatch(/not one this step offers/)
		expect(res.fields).toBeUndefined()
	})

	test("a prompt hidden from owners and not in force is refused", async () => {
		const { setPromptHidden } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const field = await promptField()
		const other = field.members.find((m: any) => m.key !== field.value)!
		await setPromptHidden(testDb as any, Number(other.key), true)
		try {
			const res = await wording(asOwner(), {
				fieldId: field.id,
				promptId: Number(other.key)
			})
			expect(res.error).toMatch(/not one this step offers/)
			expect(res.fields).toBeUndefined()
		} finally {
			await setPromptHidden(testDb as any, Number(other.key), false)
		}
	})

	test("a guest with the owner's field id is refused, nothing leaked", async () => {
		const field = await promptField()
		const res = await wording(asGuest(), {
			fieldId: field.id,
			promptId: Number(field.members[0].key)
		})
		expect(res.error).toBe(SESSION_SENTENCE)
		expect(res.fields).toBeUndefined()
		expect(res.name).toBeUndefined()
	})

	test("neither address, or both, is refused", async () => {
		const field = await promptField()
		const option = await promptOption()
		const promptId = Number(field.members[0].key)
		const neither = await wording(asOwner(), { promptId })
		expect(neither.error).toBe("That setting does not choose a prompt.")
		const both = await wording(asOwner(), {
			promptId,
			fieldId: field.id,
			optionId: option.id
		})
		expect(both.error).toBe("That setting does not choose a prompt.")
	})

	test("a field id that is not a prompt row is refused", async () => {
		const res = await wording(asOwner(), {
			fieldId: JSON.stringify(["genre", "rigour"]),
			promptId: 1
		})
		expect(res.error).toBe("That setting does not choose a prompt.")
	})
})

/** The reply prompt row as the owner reads it in the session and an administrator at configuration scope. */
const storedValues = async () => {
	const pick = (res: any) => {
		const o = groupOptions(res.pipeline.groups).find(
			(x: any) => x.control === "prompts-ref"
		) as any
		return { value: o.value, source: o.source }
	}
	return {
		session: pick(await get(asOwner(), sessionId)),
		configuration: pick(await get(asAdmin()))
	}
}

describe("writes stay refused for a guest", () => {
	test("setOption, setOptions and clearOption", async () => {
		const ownerOption = await promptOption()
		const adminView = await get(asAdmin())
		const adminOption = groupOptions(adminView.pipeline.groups).find(
			(o: any) => o.control === "prompts-ref"
		) as any
		const {
			pipelinesSetOption,
			pipelinesSetOptions,
			pipelinesClearOption
		} = await import("./pipelines")
		const OWNER_ONLY_SENTENCE =
			"Only an administrator edits a configuration, because everyone resolving it gets the change. Nothing was saved — open the session you want to change and edit there, or ask an administrator."
		const before = await storedValues()
		for (const optionId of [ownerOption.id, adminOption.id]) {
			const set: any = await pipelinesSetOption.handler(
				asGuest(),
				{
					slug: STORY_RESPOND_SPEC_ID,
					sessionId,
					optionId,
					value: ownerOption.choices[0].id
				} as any,
				() => {}
			)
			expect(set.error, "setOption").toBe(OWNER_ONLY_SENTENCE)
			const many: any = await pipelinesSetOptions.handler(
				asGuest(),
				{
					slug: STORY_RESPOND_SPEC_ID,
					sessionId,
					set: [{ optionId, value: ownerOption.choices[0].id }],
					clear: []
				} as any,
				() => {}
			)
			expect(many.error, "setOptions set").toBe(OWNER_ONLY_SENTENCE)
			const cleared: any = await pipelinesClearOption.handler(
				asGuest(),
				{ slug: STORY_RESPOND_SPEC_ID, sessionId, optionId } as any,
				() => {}
			)
			expect(cleared.error, "clearOption").toBe(OWNER_ONLY_SENTENCE)
		}
		expect(await storedValues(), "nothing stored at either scope").toEqual(
			before
		)
	})

	test("an administrator in someone else's session is refused exactly as a guest — G6", async () => {
		const ownerOption = await promptOption()
		const adminView = await get(asAdmin())
		const adminOption = groupOptions(adminView.pipeline.groups).find(
			(o: any) => o.control === "prompts-ref"
		) as any
		const { pipelinesSetOption, pipelinesSetOptions, pipelinesClearOption } =
			await import("./pipelines")
		const OWNER_ONLY_SENTENCE =
			"Only an administrator edits a configuration, because everyone resolving it gets the change. Nothing was saved — open the session you want to change and edit there, or ask an administrator."
		const before = await storedValues()
		for (const optionId of [ownerOption.id, adminOption.id]) {
			const set: any = await pipelinesSetOption.handler(
				asAdmin(),
				{
					slug: STORY_RESPOND_SPEC_ID,
					sessionId,
					optionId,
					value: ownerOption.choices[0].id
				} as any,
				() => {}
			)
			expect(set.error, "setOption").toBe(OWNER_ONLY_SENTENCE)
			const many: any = await pipelinesSetOptions.handler(
				asAdmin(),
				{
					slug: STORY_RESPOND_SPEC_ID,
					sessionId,
					set: [{ optionId, value: ownerOption.choices[0].id }],
					clear: []
				} as any,
				() => {}
			)
			expect(many.error, "setOptions set").toBe(OWNER_ONLY_SENTENCE)
			const cleared: any = await pipelinesClearOption.handler(
				asAdmin(),
				{ slug: STORY_RESPOND_SPEC_ID, sessionId, optionId } as any,
				() => {}
			)
			expect(cleared.error, "clearOption").toBe(OWNER_ONLY_SENTENCE)
		}
		expect(await storedValues(), "nothing stored at either scope").toEqual(
			before
		)
	})

	test("an administrator outside a session still writes at configuration scope", async () => {
		const adminView = await get(asAdmin())
		const option = groupOptions(adminView.pipeline.groups).find(
			(o: any) => o.control === "prompts-ref"
		) as any
		const { pipelinesSetOption, pipelinesClearOption } = await import(
			"./pipelines"
		)
		const before = await storedValues()
		const chosen = option.choices.find(
			(c: any) => c.id !== before.configuration.value
		)
		const set: any = await pipelinesSetOption.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID, optionId: option.id, value: chosen.id } as any,
			() => {}
		)
		expect(set.error).toBeUndefined()
		const after = await storedValues()
		expect(after.session.source).not.toBe("session")
		expect(after.configuration.value).toBe(chosen.id)
		expect(after.configuration.source).toBe("config")
		const cleared: any = await pipelinesClearOption.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID, optionId: option.id } as any,
			() => {}
		)
		expect(cleared.error).toBeUndefined()
	})
})

describe("what is not gated", () => {
	test("pipelines:list still answers a non-admin outside a session", async () => {
		const { pipelinesList } = await import("./pipelines")
		const res: any = await pipelinesList.handler(
			asMember(),
			{} as any,
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(res.pipelinesList.length).toBeGreaterThan(0)
	})
})

describe("sessions:pipelines", () => {
	const list = async (socket: any) => {
		const { sessionsPipelinesHandler } = await import("./sessions")
		return (await sessionsPipelinesHandler.handler(
			socket,
			{ sessionId },
			() => {}
		)) as any
	}

	test("the owner gets the list", async () => {
		expect((await list(asOwner())).pipelines.length).toBeGreaterThan(0)
	})

	test("a guest gets none", async () => {
		const res = await list(asGuest())
		expect(res.pipelines).toEqual([])
		expect(res.presetFallbacks).toBeUndefined()
	})

	test("an administrator who is a guest gets none — G6", async () => {
		const res = await list(asAdmin())
		expect(res.pipelines).toEqual([])
		expect(res.presetFallbacks).toBeUndefined()
	})
})
