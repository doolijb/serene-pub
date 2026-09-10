/**
 * The completion-template handlers — the write boundary for rows that decide
 * the delimiters of every prompt this instance sends.
 *
 * Three things are being held here, and they are different in kind:
 *
 *  1. **Authorisation, per handler.** Not once at a layout. A socket event does
 *     not pass through `/admin/+layout.svelte`, so the gate that matters is the
 *     one inside each handler — and it is asserted for each of them by name
 *     rather than for a representative sample, because "we checked in the ones
 *     we remembered" is how the one that was forgotten gets shipped.
 *  2. **Immutability, refused server-side.** `db/defaults.ts` re-applies every
 *     seeded template's full contents on every boot. That is only safe while an
 *     immutable row cannot be edited at all — otherwise a user's edit is
 *     reverted at the next restart with nothing anywhere to catch it.
 *  3. **What a payload may say.** `renderMode`, the reserved role markers, an
 *     opening for at least one role, and a key that is unique and does not move.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	const dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-completion-template-int-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

const socketFor = (isAdmin: boolean) =>
	({
		user: { id: 1, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	}) as any
const noop = (() => {}) as any

/** A template payload that passes validation, for varying one field at a time. */
const draft = (over: Record<string, any> = {}) => ({
	key: `t-${Math.random().toString(36).slice(2, 10)}`,
	name: "A Template",
	renderMode: "flat",
	roles: Object.fromEntries(
		["system", "user", "assistant", "model", "tool", "function"].map((r) => [
			r,
			{ prefix: `<<${r}>>\n`, suffix: "\n" }
		])
	),
	fallbackRole: { prefix: "<<user>>\n", suffix: "\n" },
	stopStrings: ["<<end>>"],
	isSelectable: true,
	...over
})

async function handlers() {
	return await import("./completionTemplates")
}

/**
 * The message a refusal carries.
 *
 * Every handler emits on its own `:error` channel AND throws with the same
 * sentence, so the throw is the one this reads — and asserting a refusal
 * happened at all is half the point, which is why falling through is a failure
 * rather than an empty string.
 */
async function refusal(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn()
	} catch (e: any) {
		return String(e?.message ?? e)
	}
	throw new Error("expected the handler to refuse, and it did not")
}

describe("every handler checks admin, itself", () => {
	test("all seven refuse a non-admin", async () => {
		const h = await handlers()
		const cases: Array<[string, () => Promise<unknown>]> = [
			[
				"list",
				() =>
					h.completionTemplatesListHandler.handler(
						socketFor(false),
						{},
						noop
					)
			],
			[
				"get",
				() =>
					h.completionTemplatesGet.handler(
						socketFor(false),
						{ id: 1 },
						noop
					)
			],
			[
				"options",
				() =>
					h.completionTemplatesOptions.handler(
						socketFor(false),
						{},
						noop
					)
			],
			[
				"create",
				() =>
					h.completionTemplatesCreate.handler(
						socketFor(false),
						{ completionTemplate: draft() } as any,
						noop
					)
			],
			[
				"update",
				() =>
					h.completionTemplatesUpdate.handler(
						socketFor(false),
						{ completionTemplate: { id: 1, name: "x" } } as any,
						noop
					)
			],
			[
				"delete",
				() =>
					h.completionTemplatesDelete.handler(
						socketFor(false),
						{ id: 1 },
						noop
					)
			],
			[
				"clone",
				() =>
					h.completionTemplatesClone.handler(
						socketFor(false),
						{ id: 1 },
						noop
					)
			]
		]
		for (const [name, call] of cases) {
			await expect(call(), `${name} let a non-admin through`).rejects.toThrow(
				/Only admin users/
			)
		}
		// And nothing was written on the way to being refused.
		const rows = await testDb.select().from(schema.completionTemplates)
		expect(rows.every((r) => r.isImmutable)).toBe(true)
	}, 60_000)
})

describe("create", () => {
	test("strips id, isImmutable and seedKey from the payload", async () => {
		const h = await handlers()
		// Exactly what a "duplicate this row" client sends: the whole seeded
		// row, its seed identity included.
		const seeded = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "vicuna")
		})
		expect(seeded?.seedKey).toBe("completion-template-vicuna")

		const res: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{
				completionTemplate: {
					...seeded,
					key: "vicuna-ish",
					name: "Vicuna-ish"
				}
			} as any,
			noop
		)
		expect(res.completionTemplate.id).not.toBe(seeded!.id)
		expect(res.completionTemplate.seedKey).toBeNull()
		expect(res.completionTemplate.isImmutable).toBe(false)
		// The strip is what did it, not the column defaults: assert directly
		// that the allow-list drops all three rather than that the row happens
		// to come out right.
		const { sanitiseForTest } = await import("./completionTemplates")
		expect(
			sanitiseForTest({
				id: 99,
				isImmutable: true,
				seedKey: "completion-template-vicuna",
				name: "kept",
				notAColumn: 1
			})
		).toEqual({ name: "kept" })
		// The seeded row is untouched — nothing was overwritten by id.
		const after = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "vicuna")
		})
		expect(after?.name).toBe(seeded!.name)
	}, 60_000)

	test("refuses render_mode role_array outright", async () => {
		const h = await handlers()
		const message = await refusal(() =>
			h.completionTemplatesCreate.handler(
				socketFor(true),
				{ completionTemplate: draft({ renderMode: "role_array" }) } as any,
				noop
			)
		)
		expect(message).toMatch(/cannot be set here/i)
	}, 60_000)

	test("forces flat even if the payload smuggles a mode past the check", async () => {
		// The second lock: the column is written from a literal, never from the
		// spread, so a field the validator has not been taught about cannot
		// reach it.
		const h = await handlers()
		const res: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ renderMode: undefined }) } as any,
			noop
		)
		expect(res.completionTemplate.renderMode).toBe("flat")
	}, 60_000)

	test("refuses a template that opens with nothing for every role", async () => {
		const h = await handlers()
		const message = await refusal(() =>
			h.completionTemplatesCreate.handler(
				socketFor(true),
				{
					completionTemplate: draft({
						roles: Object.fromEntries(
							[
								"system",
								"user",
								"assistant",
								"model",
								"tool",
								"function"
							].map((r) => [r, { prefix: "", suffix: "\n" }])
						),
						fallbackRole: { prefix: "", suffix: "\n" }
					})
				} as any,
				noop
			)
		)
		expect(message).toMatch(/opens with nothing/i)
	}, 60_000)

	test("refuses a marker colliding with the reserved role vocabulary", async () => {
		const h = await handlers()
		const message = await refusal(() =>
			h.completionTemplatesCreate.handler(
				socketFor(true),
				{
					completionTemplate: draft({
						roles: {
							system: {
								prefix: "<@role:system>\n",
								suffix: "\n"
							}
						}
					})
				} as any,
				noop
			)
		)
		expect(message).toMatch(/reserved role marker/i)
	}, 60_000)

	test("refuses a duplicate key by name rather than by constraint", async () => {
		const h = await handlers()
		const message = await refusal(() =>
			h.completionTemplatesCreate.handler(
				socketFor(true),
				{ completionTemplate: draft({ key: "chatml" }) } as any,
				noop
			)
		)
		expect(message).toMatch(/already exists/i)
		expect(message).not.toMatch(/violates unique constraint/i)
	}, 60_000)

	test("refuses a key that is not a slug", async () => {
		const h = await handlers()
		for (const key of ["", "Has Spaces", "UPPER", "a".repeat(65)]) {
			const message = await refusal(() =>
				h.completionTemplatesCreate.handler(
					socketFor(true),
					{ completionTemplate: draft({ key }) } as any,
					noop
				)
			)
			expect(message, `key ${JSON.stringify(key)}`).toMatch(
				/key|blank/i
			)
		}
	}, 60_000)
})

describe("update", () => {
	test("refuses a built-in", async () => {
		const h = await handlers()
		const builtin = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "chatml")
		})
		const message = await refusal(() =>
			h.completionTemplatesUpdate.handler(
				socketFor(true),
				{
					completionTemplate: { id: builtin!.id, name: "Mine now" }
				} as any,
				noop
			)
		)
		expect(message).toMatch(/built-in/i)
		const after = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.id, builtin!.id)
		})
		expect(after!.name).toBe(builtin!.name)
	}, 60_000)

	test("refuses a key change — connections are pointing at it", async () => {
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "stable-key" }) } as any,
			noop
		)
		const message = await refusal(() =>
			h.completionTemplatesUpdate.handler(
				socketFor(true),
				{
					completionTemplate: {
						id: created.completionTemplate.id,
						key: "moved-key"
					}
				} as any,
				noop
			)
		)
		expect(message).toMatch(/key cannot change/i)
	}, 60_000)

	test("validates the row as it WILL be, not as the patch reads", async () => {
		// A patch carrying only `roles` has no name and no key in it. Checking
		// the patch alone would let a template that opens with nothing through,
		// because the rule would never see the fields it needs.
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "partial-patch" }) } as any,
			noop
		)
		const message = await refusal(() =>
			h.completionTemplatesUpdate.handler(
				socketFor(true),
				{
					completionTemplate: {
						id: created.completionTemplate.id,
						roles: Object.fromEntries(
							[
								"system",
								"user",
								"assistant",
								"model",
								"tool",
								"function"
							].map((r) => [r, { prefix: "", suffix: "" }])
						),
						fallbackRole: { prefix: "", suffix: "" }
					}
				} as any,
				noop
			)
		)
		expect(message).toMatch(/opens with nothing/i)
	}, 60_000)

	test("a rename alone saves — a partial patch is not judged as a whole row", async () => {
		/**
		 * ⚠ The case that distinguishes validating the PATCH from validating the
		 * row the patch produces.
		 *
		 * A rename carries no `roles` and no `fallbackRole`. Run the rules over
		 * that object and every role opens with nothing, so "give at least one
		 * role an opening" fires — on a save that changed a name. The handler
		 * merges over the stored row first, so the rules see the row as it will
		 * be.
		 */
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "rename-me", name: "Before" }) } as any,
			noop
		)
		const res: any = await h.completionTemplatesUpdate.handler(
			socketFor(true),
			{
				completionTemplate: {
					id: created.completionTemplate.id,
					name: "After"
				}
			} as any,
			noop
		)
		expect(res.completionTemplate.name).toBe("After")
		// The framing it did not mention is untouched.
		expect(res.completionTemplate.roles).toEqual(
			created.completionTemplate.roles
		)
	}, 60_000)

	test("a field outside the allow-list cannot reach the row", async () => {
		// A deny-list would have to grow with the table; this asserts the
		// allow-list posture directly, with a column the client must never write
		// and a key that is not a column at all.
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "allowlisted" }) } as any,
			noop
		)
		const res: any = await h.completionTemplatesUpdate.handler(
			socketFor(true),
			{
				completionTemplate: {
					id: created.completionTemplate.id,
					name: "Allow-listed",
					isImmutable: true,
					seedKey: "completion-template-chatml",
					notAColumnAtAll: "boom"
				}
			} as any,
			noop
		)
		expect(res.completionTemplate.renderMode).toBe("flat")
		expect(res.completionTemplate.name).toBe("Allow-listed")
		expect(res.completionTemplate.isImmutable).toBe(false)
		expect(res.completionTemplate.seedKey).toBeNull()
	}, 60_000)

	test("refuses role_array rather than silently coercing it to flat", async () => {
		// ⚠ `renderMode` is outside the allow-list, so it is never WRITTEN from a
		// payload — but a client that asked for a role-array template is told no
		// rather than quietly given a flat one. The two are different answers and
		// only one of them is honest.
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "no-role-array" }) } as any,
			noop
		)
		const message = await refusal(() =>
			h.completionTemplatesUpdate.handler(
				socketFor(true),
				{
					completionTemplate: {
						id: created.completionTemplate.id,
						renderMode: "role_array"
					}
				} as any,
				noop
			)
		)
		expect(message).toMatch(/cannot be set here/i)
	}, 60_000)

	test("saves a real edit and cannot be made immutable by the payload", async () => {
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "editable" }) } as any,
			noop
		)
		const res: any = await h.completionTemplatesUpdate.handler(
			socketFor(true),
			{
				completionTemplate: {
					id: created.completionTemplate.id,
					name: "Edited",
					isImmutable: true,
					seedKey: "completion-template-vicuna",
					roles: {
						system: { prefix: "[[SYS]]\n", suffix: "\n" }
					}
				}
			} as any,
			noop
		)
		expect(res.completionTemplate.name).toBe("Edited")
		expect(res.completionTemplate.isImmutable).toBe(false)
		expect(res.completionTemplate.seedKey).toBeNull()
		expect((res.completionTemplate.roles as any).system.prefix).toBe(
			"[[SYS]]\n"
		)
	}, 60_000)
})

describe("delete", () => {
	test("refuses a built-in", async () => {
		const h = await handlers()
		const builtin = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "instruct")
		})
		const message = await refusal(() =>
			h.completionTemplatesDelete.handler(
				socketFor(true),
				{ id: builtin!.id },
				noop
			)
		)
		expect(message).toMatch(/built-in/i)
		expect(
			await testDb.query.completionTemplates.findFirst({
				where: (t, { eq }) => eq(t.id, builtin!.id)
			})
		).toBeTruthy()
	}, 60_000)

	test("nulls the connections that referenced it, and says how many", async () => {
		const h = await handlers()
		const created: any = await h.completionTemplatesCreate.handler(
			socketFor(true),
			{ completionTemplate: draft({ key: "doomed" }) } as any,
			noop
		)
		const [connection] = await testDb
			.insert(schema.connections)
			.values({
				name: "Points at doomed",
				type: "koboldcpp",
				promptFormat: "doomed"
			})
			.returning()

		const res: any = await h.completionTemplatesDelete.handler(
			socketFor(true),
			{ id: created.completionTemplate.id },
			noop
		)
		expect(res.success).toMatch(/1 connection\b/)

		// `ON DELETE SET NULL`: the connection survives with no format, which is
		// a different sentence from "you never picked one" only because the
		// message above says so.
		const after = await testDb.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, connection.id)
		})
		expect(after).toBeTruthy()
		expect(after!.promptFormat).toBeNull()
	}, 60_000)
})

describe("clone", () => {
	test("a built-in becomes an editable row under a free key", async () => {
		const h = await handlers()
		const builtin = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "chatml")
		})
		const res: any = await h.completionTemplatesClone.handler(
			socketFor(true),
			{ id: builtin!.id },
			noop
		)
		const clone = res.completionTemplate
		expect(clone.key).toBe("chatml-copy")
		expect(clone.isImmutable).toBe(false)
		expect(clone.seedKey).toBeNull()
		// The delimiters come across — that is the whole point of cloning.
		expect(clone.roles).toEqual(builtin!.roles)

		// A second clone does not collide.
		const again: any = await h.completionTemplatesClone.handler(
			socketFor(true),
			{ id: builtin!.id },
			noop
		)
		expect(again.completionTemplate.key).toBe("chatml-copy-2")
	}, 60_000)

	test("cloning split_session produces a FLAT template", async () => {
		/**
		 * ⚠ The one row whose mode is `role_array`, and the one thing a clone
		 * must not carry across. That template's markers are emitted by
		 * hand-written code and its framing is deliberately empty; a role-array
		 * clone would be a mutable row an admin could point a connection at,
		 * switching the whole pipeline to role-array output through a mode
		 * nothing here can render.
		 */
		const h = await handlers()
		const split = await testDb.query.completionTemplates.findFirst({
			where: (t, { eq }) => eq(t.key, "split_session")
		})
		expect(split!.renderMode).toBe("role_array")
		const res: any = await h.completionTemplatesClone.handler(
			socketFor(true),
			{ id: split!.id },
			noop
		)
		expect(res.completionTemplate.renderMode).toBe("flat")
	}, 60_000)
})

describe("options", () => {
	test("offers selectable rows including admin-authored ones, and not split", async () => {
		const h = await handlers()
		await h.completionTemplatesCreate.handler(
			socketFor(true),
			{
				completionTemplate: draft({
					key: "offered-one",
					name: "Offered One"
				})
			} as any,
			noop
		)
		await h.completionTemplatesCreate.handler(
			socketFor(true),
			{
				completionTemplate: draft({
					key: "hidden-one",
					name: "Hidden One",
					isSelectable: false
				})
			} as any,
			noop
		)

		const res: any = await h.completionTemplatesOptions.handler(
			socketFor(true),
			{},
			noop
		)
		const values = res.options.map((o: any) => o.value)
		// The defect this replaces: `PromptFormats.options` is a hand-written
		// array of the eight built-ins, so an authored template could never
		// appear in the control that selects it.
		expect(values).toContain("offered-one")
		expect(values).toContain("vicuna")
		expect(values).not.toContain("split_session")
		expect(values).not.toContain("hidden-one")
	}, 60_000)
})

describe("the list", () => {
	test("puts built-ins first, then names, and carries the framing", async () => {
		const h = await handlers()
		const res: any = await h.completionTemplatesListHandler.handler(
			socketFor(true),
			{},
			noop
		)
		const rows = res.completionTemplatesList
		const firstCustom = rows.findIndex((r: any) => !r.isImmutable)
		expect(firstCustom).toBeGreaterThan(0)
		expect(
			rows.slice(0, firstCustom).every((r: any) => r.isImmutable)
		).toBe(true)
		expect(rows.slice(firstCustom).some((r: any) => r.isImmutable)).toBe(
			false
		)
		// The changelist shows what a system block opens with, so the row has to
		// carry it — a `columns:` projection that dropped `roles` would render
		// an empty column and nobody would know why.
		expect(rows[0].roles).toBeTruthy()
	}, 60_000)
})
