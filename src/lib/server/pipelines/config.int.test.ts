/**
 * The configuration layer, as the pipeline view sees it.
 *
 * Three claims are worth pinning rather than asserting, because each is a rule
 * that is easy to keep by accident today and easy to break by accident later:
 *
 *  1. **The payload carries no topology** (05 §0a). Structural editing is behind
 *     a system setting; a default-view payload that shipped node keys would make
 *     that setting cosmetic. A future field that leaks one should fail here.
 *  2. **A value knows which layer it came from**, so *"I changed this and nothing
 *     happened"* has an answer.
 *  3. **Reset is a delete, not a write of the inherited value** — the difference
 *     only shows up on the day an admin changes the instance value and expects it
 *     to reach everyone who has not opted out.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	clearOption,
	listNamespaces,
	namespaceView,
	optionId,
	selectNamedConfig,
	writeOption,
	OptionNotFoundError,
	OptionNotWritableError,
	type ConfigOption,
	type NamespaceView
} from "./config"
import { RESPOND_SPEC_ID } from "./bootstrap"

const SECRET = "test-instance-secret"

let db: TestDb
let userId: number
let otherUserId: number
let adminId: number
let chatId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "config-test", isAdmin: false })
		.returning()
	userId = user.id
	const [other] = await db
		.insert(schema.users)
		.values({ username: "config-other", isAdmin: false })
		.returning()
	otherUserId = other.id
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "config-admin", isAdmin: true })
		.returning()
	adminId = admin.id

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	chatId = chat.id
}, 60_000)

const viewer = (over: any = {}) => ({
	userId,
	isAdmin: false,
	...over
})

const view = (over: any = {}): Promise<NamespaceView> =>
	namespaceView(
		db as any,
		SECRET,
		RESPOND_SPEC_ID,
		viewer(over)
	) as Promise<NamespaceView>

const allOptions = (v: NamespaceView): ConfigOption[] =>
	v.steps.flatMap((s) => [...s.options, ...s.advanced])

describe("the namespace list", () => {
	it("lists what core published, from rows", async () => {
		const list = await listNamespaces(db as any)
		expect(list.map((n) => n.slug)).toContain(RESPOND_SPEC_ID)
	})
})

describe("the option payload", () => {
	it("carries no node key in anything but human prose", async () => {
		// The rule 05 §0a states, checked against the serialized payload rather
		// than against the fields I remembered to look at.
		//
		// Human-readable text is exempt, and that exemption is narrow on purpose:
		// core's node keys are ordinary English words — `history`, `context`,
		// `prompt` — so "Post History Instructions" trips a naive scan while
		// leaking nothing. Every *other* string, and every property name, is
		// checked, because those are the places a leak would actually be usable:
		// an id that turned out to be an encoding, a facet keyed by node, a
		// `nodeKey` field somebody adds to make a future screen easier.
		// Scoped to *this* pipeline's nodes.
		//
		// It read every node key on the instance, which was the same thing while
		// core shipped one pipeline and stops being so at seven: a payload for
		// the reply pipeline cannot leak the summarize pipeline's topology, since
		// it never sees it — but it does contain the word `source`, which is a
		// node key over there. Widening the scan past the pipeline under view
		// turns ordinary English into a failure and teaches the reader to
		// weaken it.
		const keys = (
			await db
				.select({ nodeKey: schema.pipelineNodes.nodeKey })
				.from(schema.pipelineNodes)
				.innerJoin(
					schema.pipelineSpecVersions,
					eq(
						schema.pipelineNodes.specVersionId,
						schema.pipelineSpecVersions.id
					)
				)
				.innerJoin(
					schema.pipelineSpecs,
					eq(
						schema.pipelineSpecVersions.specId,
						schema.pipelineSpecs.id
					)
				)
				.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		).map((k) => k.nodeKey)
		expect(keys.length).toBeGreaterThan(3)

		// `source` is a variable layout's authored template text. It is content
		// the user typed, not something this payload derived from the document —
		// and someone is entitled to write `{{#each}}` around a word that
		// happens to be a node key. Exempting it keeps the scan pointed at
		// *leaks*, which are fields core populates, rather than at what a person
		// chose to write in a box.
		const PROSE = new Set(["label", "description", "name", "source"])
		const offences: string[] = []
		const walk = (value: unknown, path: string, prose: boolean) => {
			if (typeof value === "string") {
				if (prose) return
				for (const key of keys)
					if (new RegExp(`\\b${key}\\b`).test(value))
						offences.push(`${path} = ${JSON.stringify(value)}`)
				return
			}
			if (Array.isArray(value))
				return value.forEach((v, i) => walk(v, `${path}[${i}]`, prose))
			if (value && typeof value === "object")
				for (const [k, v] of Object.entries(value)) {
					for (const key of keys)
						if (new RegExp(`\\b${key}\\b`).test(k))
							offences.push(`${path}.${k} is named for a node`)
					walk(v, `${path}.${k}`, PROSE.has(k))
				}
		}
		walk(await view(), "view", false)
		expect(offences).toEqual([])
	})

	it("never uses a node key as a label either", async () => {
		// The narrow escape hatch above, kept honest: prose is exempt from the
		// substring scan, so a label that *is* a node key would slip through.
		const keys = new Set(
			(
				await db
					.select({ nodeKey: schema.pipelineNodes.nodeKey })
					.from(schema.pipelineNodes)
					.innerJoin(
						schema.pipelineSpecVersions,
						eq(
							schema.pipelineNodes.specVersionId,
							schema.pipelineSpecVersions.id
						)
					)
					.innerJoin(
						schema.pipelineSpecs,
						eq(
							schema.pipelineSpecVersions.specId,
							schema.pipelineSpecs.id
						)
					)
					.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			).map((k) => k.nodeKey.toLowerCase())
		)
		for (const o of allOptions(
			await view({ userId: adminId, isAdmin: true })
		))
			expect(keys.has(o.label.toLowerCase())).toBe(false)
	})

	it("groups options by step, in run order, with opaque keys", async () => {
		const v = await view({ userId: adminId, isAdmin: true })
		expect(v.steps.length).toBeGreaterThan(0)
		// The key is an ordinal, never a node key — grouping by step reveals
		// count and order (the ratified 0.6 trade, DECOMPOSITION §26), not
		// addresses.
		expect(v.steps.map((s) => s.key)).toEqual(
			v.steps.map((_, i) => `s${i}`)
		)
		expect(allOptions(v).length).toBeGreaterThan(0)
	})

	it("splits tuning parameters into the step's advanced group", async () => {
		// Weights and budgets are present but set aside, so a step leads with
		// its prompt and references. Number-controlled params land in
		// `advanced`; the prompts-ref never does. Admin view — params are the
		// administrator's now.
		const v = await view({ userId: adminId, isAdmin: true })
		const advanced = v.steps.flatMap((s) => s.advanced)
		expect(advanced.length).toBeGreaterThan(0)
		for (const o of advanced)
			expect(o.control === "prompts-ref").toBe(false)
		const primary = v.steps.flatMap((s) => s.options)
		expect(primary.some((o) => o.control === "prompts-ref")).toBe(true)
	})

	it("carries the selected prompt row on a prompts-ref option", async () => {
		// The panel edits the prompt inline, so the row rides along — id,
		// name, fields, and whether it is a shipped (read-only) prompt.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const [prompt] = await db
			.insert(schema.pipelinePrompts)
			.values({
				specId: spec.id,
				name: "Rides along",
				fields: { systemPrompt: "inline text" }
			})
			.returning()

		const before = await view()
		const ref = allOptions(before).find((o) => o.control === "prompts-ref")!
		expect(ref).toBeTruthy()
		// Unselected: nothing to carry, and nothing invented.
		expect(ref.prompt).toBeUndefined()

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			ref.id,
			prompt.id
		)
		const after = allOptions(await view()).find((o) => o.id === ref.id)!
		expect(after.prompt).toBeTruthy()
		expect(after.prompt!.id).toBe(prompt.id)
		expect(after.prompt!.name).toBe("Rides along")
		expect(after.prompt!.fields).toEqual({ systemPrompt: "inline text" })
		expect(after.prompt!.readOnly).toBe(false)

		// Leave the option as found for the provenance tests below.
		await clearOption(db as any, SECRET, RESPOND_SPEC_ID, viewer(), ref.id)
	})

	it("offers a non-admin prompts and nothing else", async () => {
		// Not disabled — absent. The 0.6 line: to a non-admin the pipeline is
		// how the application works; wording is the one thing that is theirs.
		const asUser = await view()
		expect(allOptions(asUser).length).toBeGreaterThan(0)
		for (const o of allOptions(asUser))
			expect(o.control).toBe("prompts-ref")
	})

	it("gives an admin live controls that land at instance scope", async () => {
		// "(admin only)" text on the admin's own screen was the defect: the
		// person who may change it saw a label saying they may not. Every
		// non-prompt option is writable for an admin and declares that its
		// edits land at instance scope; prompts stay personal.
		const asAdmin = await view({ userId: adminId, isAdmin: true })
		const connections = allOptions(asAdmin).filter(
			(o) => o.control === "connection-ref"
		)
		expect(connections.length).toBeGreaterThan(0)
		for (const o of allOptions(asAdmin)) {
			expect(o.writable).toBe(true)
			if (o.control === "prompts-ref") expect(o.writeAt).toBeUndefined()
			else expect(o.writeAt).toBe("instance")
		}
	})

	it("refuses a non-admin write to anything but prompts, by sentence", async () => {
		// Hiding is not what protects an option — the ids are stable handles.
		// A minted id for a weight meets the same line the panel draws.
		const asAdmin = await view({ userId: adminId, isAdmin: true })
		const param = allOptions(asAdmin).find(
			(o) => o.control === "integer" || o.control === "number"
		)!
		expect(param).toBeTruthy()
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				param.id,
				99
			)
		).rejects.toThrow(/stays with the administrator/)
	})
})

describe("resolution and provenance", () => {
	it("reports the layer a value won at, and follows the chain up", async () => {
		const before = await view()
		// An option nothing has touched: the shipped default config covers
		// most addresses at `preset`, which outranks `instance` — so the walk
		// below needs a setting whose chain is empty to start from.
		const target = allOptions(before).find(
			(o) => o.writable && o.source === "author"
		)!
		expect(target).toBeTruthy()

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			target.id,
			"instance says so",
			"instance"
		)
		let v = await view()
		let now = allOptions(v).find((o) => o.id === target.id)!
		expect(now.value).toBe("instance says so")
		expect(now.source).toBe("instance")

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			target.id,
			"the user says so"
		)
		v = await view()
		now = allOptions(v).find((o) => o.id === target.id)!
		expect(now.value).toBe("the user says so")
		expect(now.source).toBe("user")
		expect(now.overriddenHere).toBe(true)

		// Opened from inside the chat, the same edit lands at chat scope and wins.
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ chatId }),
			target.id,
			"only in this chat"
		)
		v = await view({ chatId })
		now = allOptions(v).find((o) => o.id === target.id)!
		expect(now.value).toBe("only in this chat")
		expect(now.source).toBe("chat")

		// …and the user's own value is untouched outside it.
		v = await view()
		now = allOptions(v).find((o) => o.id === target.id)!
		expect(now.value).toBe("the user says so")
	})

	it("an admin's instance override beats the selected config", async () => {
		// The 0.6 revision of the chain (SDK SCOPE_ORDER): an override is a
		// decision made on top of the selected config, so it wins — the
		// original order made an admin's live edit the one write that could
		// store cleanly and do nothing, shadowed forever by the shipped
		// default's value for the same path.
		const asAdmin = () => view({ userId: adminId, isAdmin: true })
		const fromConfig = allOptions(await asAdmin()).find(
			(o) => o.source === "preset" && o.control === "integer"
		)!
		expect(fromConfig).toBeTruthy()

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			fromConfig.id,
			777,
			"instance"
		)
		const after = allOptions(await asAdmin()).find(
			(o) => o.id === fromConfig.id
		)!
		expect(after.value).toBe(777)
		expect(after.source).toBe("instance")
		expect(after.overriddenHere).toBe(true)

		// Reset deletes the row; the config's value is what resolves again.
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			fromConfig.id,
			"instance"
		)
		const back = allOptions(await asAdmin()).find(
			(o) => o.id === fromConfig.id
		)!
		expect(back.value).toBe(fromConfig.value)
		expect(back.source).toBe("preset")
	})

	it("keeps one user's overrides out of another's view", async () => {
		const v = await view({ userId: otherUserId })
		const mine = await view()
		const target = allOptions(mine).find((o) => o.source === "user")!
		const theirs = allOptions(v).find((o) => o.id === target.id)!
		expect(theirs.source).not.toBe("user")
		expect(theirs.value).not.toBe(target.value)
	})

	it("resets by deleting, so a later admin change still reaches the user", async () => {
		const target = allOptions(await view()).find(
			(o) => o.source === "user"
		)!

		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			target.id
		)

		const after = allOptions(await view()).find((o) => o.id === target.id)!
		expect(after.source).toBe("instance")
		expect(after.overriddenHere).toBe(false)

		// The row is gone rather than rewritten with the inherited value — which is
		// the whole difference: an admin moving the instance value now reaches this
		// user, and would not if reset had pinned a copy.
		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "user"),
					eq(schema.pipelineNodeOverrides.scopeId, userId)
				)
			)
		expect(rows).toHaveLength(0)
	})
})

describe("what a write refuses", () => {
	it("refuses a slot the write matrix does not allow at this scope", async () => {
		const asAdmin = await view({ userId: adminId, isAdmin: true })
		const connection = allOptions(asAdmin).find(
			(o) => o.control === "connection-ref"
		)!
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				connection.id,
				"7"
			)
		).rejects.toThrow(OptionNotWritableError)
	})

	it("refuses instance scope to a non-admin", async () => {
		const target = allOptions(await view()).find((o) => o.writable)!
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				target.id,
				"x",
				"instance"
			)
		).rejects.toThrow(OptionNotWritableError)
	})

	it("refuses a handle minted against a different instance", async () => {
		// The handle is keyed on the instance secret, so one lifted from another
		// install names nothing here — and says so rather than writing a row that
		// matches no option.
		const forged = optionId(
			"someone-elses-secret",
			"prompt",
			"prompts",
			"system"
		)
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				forged,
				"x"
			)
		).rejects.toThrow(OptionNotFoundError)
	})
})

describe("named configs", () => {
	it("selects the config the runtime resolves, not a parallel mechanism", async () => {
		// The panel and world.ts must read the same table, or every screen
		// agrees with the user while the run uses something else. The shipped
		// immutable default is always offered; selecting a copy stores its id
		// in the same selections row the runtime walks.
		const v0 = await view()
		expect(v0.configs.length).toBeGreaterThan(0)
		// Nothing selected yet still resolves — to the shipped default.
		expect(v0.selectedConfig).toBeTruthy()
		expect(v0.selectedConfig!.source).toBe("shipped")

		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const [copy] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "My copy", isImmutable: false })
			.returning()

		await selectNamedConfig(
			db as any,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			copy.id,
			"instance"
		)
		const [row] = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.scopeKind, "instance"))
		expect(row.configId).toBe(copy.id)

		const v = await view()
		expect(v.selectedConfig).toEqual({
			id: copy.id,
			name: "My copy",
			source: "instance"
		})
		expect(v.configs.map((c) => c.id)).toContain(copy.id)
	})

	it("refuses a config belonging to another pipeline", async () => {
		// A selection that silently does nothing is the hardest configuration
		// bug to see — refused at the write, not resolved past at the read.
		const [foreign] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		const [other] = await db
			.insert(schema.pipelineConfigs)
			.values({
				specId: foreign.id,
				name: "Wrong namespace",
				isImmutable: false
			})
			.returning()

		await expect(
			selectNamedConfig(
				db as any,
				RESPOND_SPEC_ID,
				viewer({ userId: adminId, isAdmin: true }),
				other.id,
				"instance"
			)
		).rejects.toThrow(/different pipeline/)
	})
})
