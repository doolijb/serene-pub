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
} from "$lib/server/pipelines/config/panel"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const SECRET = "test-instance-secret"

let db: TestDb
let userId: number
let otherUserId: number
let adminId: number
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
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

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id
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

		const before = await view({ sessionId })
		const ref = allOptions(before).find((o) => o.control === "prompts-ref")!
		expect(ref).toBeTruthy()
		// Unselected: nothing to carry, and nothing invented.
		expect(ref.prompt).toBeUndefined()

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			ref.id,
			prompt.id
		)
		const after = allOptions(await view({ sessionId })).find(
			(o) => o.id === ref.id
		)!
		expect(after.prompt).toBeTruthy()
		expect(after.prompt!.id).toBe(prompt.id)
		expect(after.prompt!.name).toBe("Rides along")
		expect(after.prompt!.fields).toEqual({ systemPrompt: "inline text" })
		expect(after.prompt!.readOnly).toBe(false)

		// Leave the option as found for the provenance tests below.
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			ref.id
		)
	})

	it("offers a non-admin prompts and nothing else", async () => {
		// Not disabled — absent. The 0.6 line: to a non-admin the pipeline is
		// how the application works; wording is the one thing that is theirs.
		const asUser = await view()
		expect(allOptions(asUser).length).toBeGreaterThan(0)
		for (const o of allOptions(asUser))
			expect(o.control).toBe("prompts-ref")
	})

	it("gives an admin live controls — global edits are config edits now", async () => {
		// "(admin only)" text on the admin's own screen was the defect: the
		// person who may change it saw a label saying they may not. Every
		// option is writable for an admin; since the layer simplification
		// (2026-08-24) a global edit lands in the selected configuration
		// itself, so there is no per-option landing scope to declare.
		const asAdmin = await view({ userId: adminId, isAdmin: true })
		const connections = allOptions(asAdmin).filter(
			(o) => o.control === "connection-ref"
		)
		expect(connections.length).toBeGreaterThan(0)
		for (const o of allOptions(asAdmin)) expect(o.writable).toBe(true)
	})

	it("refuses a non-admin write to anything but prompts, by sentence", async () => {
		// Hiding is not what protects an option — the ids are stable handles.
		// A minted id for a weight meets the same line the panel draws.
		const asAdmin = await view({ userId: adminId, isAdmin: true })
		const param = allOptions(asAdmin).find(
			(o) => o.control === "integer" || o.control === "number"
		)!
		expect(param).toBeTruthy()
		// From inside a session: the prompts line.
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer({ sessionId }),
				param.id,
				99
			)
		).rejects.toThrow(/stays with the administrator/)
		// Globally: a non-admin has no target at all — a global edit is a
		// config edit, and configs are the administrator's (ruled 2026-08-24).
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				param.id,
				99
			)
		).rejects.toThrow(/administrator edits a configuration/)
	})
})

describe("resolution and provenance", () => {
	it("reports the layer a value won at, and follows the chain up", async () => {
		// The chain since the simplification (2026-08-24): the author's
		// default, the selected configuration, the session's override — walked
		// in a session view, where all three can be seen at once.
		const inSession = await view({ sessionId })
		const target = allOptions(inSession).find(
			(o) => o.writable && o.source === "author"
		)!
		expect(target).toBeTruthy()

		// A mutable copy of the shipped default, selected for the instance —
		// the global edit below lands in *it*, because there is no other
		// global place left for an edit to go.
		const { duplicateConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, spec.id),
					eq(schema.pipelineConfigs.isImmutable, true)
				)
			)
		const copy = await duplicateConfig(db as any, shipped.id, "Walk copy")
		await selectConfig(db as any, spec.id, "instance", 0, copy.id, adminId)

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			target.id,
			"the config says so"
		)
		let now = allOptions(
			await view({ userId: adminId, isAdmin: true })
		).find((o) => o.id === target.id)!
		expect(now.value).toBe("the config says so")
		expect(now.source).toBe("preset")
		expect(now.overriddenHere).toBe(true)

		// Opened from inside the session, the same edit lands at session scope and wins.
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			target.id,
			"only in this session"
		)
		let v = await view({ sessionId })
		now = allOptions(v).find((o) => o.id === target.id)!
		expect(now.value).toBe("only in this session")
		expect(now.source).toBe("session")

		// …and the configuration's value is untouched outside it.
		now = allOptions(await view({ userId: adminId, isAdmin: true })).find(
			(o) => o.id === target.id
		)!
		expect(now.value).toBe("the config says so")
		expect(now.source).toBe("preset")

		// Leave the instance as found for the tests below.
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			target.id
		)
		await selectConfig(db as any, spec.id, "instance", 0, null, adminId)
	})

	it("a global edit lands in the selected configuration — and a shipped one refuses", async () => {
		// The former instance override layer is gone (ruled 2026-08-24). A
		// global edit *is* an edit to the selected configuration: against the
		// shipped immutable default it refuses with the duplicate suggestion,
		// and against a mutable selection it becomes that configuration's own
		// value — reset deletes the value row, so the author default resolves
		// again.
		const asAdmin = () => view({ userId: adminId, isAdmin: true })
		const param = allOptions(await asAdmin()).find(
			(o) => o.control === "integer" && o.writable
		)!
		expect(param).toBeTruthy()

		// Nothing selected: the shipped default resolves, and refuses edits.
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer({ userId: adminId, isAdmin: true }),
				param.id,
				777
			)
		).rejects.toThrow(/Duplicate it and edit the copy/)

		const { createConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const landing = await createConfig(db as any, spec.id, "Landing")
		await selectConfig(
			db as any,
			spec.id,
			"instance",
			0,
			landing.id,
			adminId
		)

		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			param.id,
			777
		)
		const after = allOptions(await asAdmin()).find(
			(o) => o.id === param.id
		)!
		expect(after.value).toBe(777)
		expect(after.source).toBe("preset")
		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, landing.id))
		expect((rows as any[]).some((r) => r.value === 777)).toBe(true)

		// Reset deletes the configuration's value; the author default resolves.
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			param.id
		)
		const back = allOptions(await asAdmin()).find((o) => o.id === param.id)!
		expect(back.value).not.toBe(777)
		expect(back.source).not.toBe("preset")

		await selectConfig(db as any, spec.id, "instance", 0, null, adminId)
	})

	it("keeps one session's overrides out of another's view", async () => {
		const inSession = await view({ sessionId })
		const target = allOptions(inSession).find(
			(o) => o.writable && o.source !== "session"
		)!
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			target.id,
			"only here"
		)

		const [other] = await db
			.insert(schema.sessions)
			.values({ userId: otherUserId, isGroup: false })
			.returning()
		const theirs = allOptions(await view({ sessionId: other.id })).find(
			(o) => o.id === target.id
		)!
		expect(theirs.source).not.toBe("session")
		expect(theirs.value).not.toBe("only here")
	})

	it("resets by deleting, so a later config change still reaches the session", async () => {
		const target = allOptions(await view({ sessionId })).find(
			(o) => o.source === "session"
		)!

		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer({ sessionId }),
			target.id
		)

		const after = allOptions(await view({ sessionId })).find(
			(o) => o.id === target.id
		)!
		expect(after.source).not.toBe("session")
		expect(after.overriddenHere).toBe(false)

		// The row is gone rather than rewritten with the inherited value —
		// which is the whole difference: an admin moving the configuration's
		// value now reaches this session, and would not if reset had pinned a copy.
		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, sessionId)
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

	it("refuses a global edit to a non-admin — their levers are the session's", async () => {
		const target = allOptions(await view()).find(
			(o) => o.control === "prompts-ref"
		)!
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				viewer(),
				target.id,
				"x"
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

/**
 * An edit made in the builder belongs to the configuration it was made in.
 *
 * This is the seam that decides whether configurations are a real thing or a
 * dropdown. Every write used to land in `pipeline_node_overrides` at
 * **instance** scope, and instance outranks `preset` — where a configuration's
 * own values live — so a value changed while one configuration was selected
 * followed you to every other one. Duplicating a configuration to change a
 * single setting changed it everywhere instead, which is the exact accident
 * duplicating exists to prevent.
 *
 * The test switches between two configurations and reads the same option back.
 * Asserting only that the write landed somewhere would pass either way.
 */
describe("configurations hold their own values", () => {
	let specId: number
	let alpha: number
	let beta: number
	const admin = { userId: 1, isAdmin: true }

	/**
	 * A plain scalar option on the ranker, used here as *any* per-config value.
	 *
	 * This was "Budget" until the absolute token count was retired for the
	 * share model. Nothing in this block is about ranking — it is about a
	 * configuration keeping its own values — so the option only has to be a
	 * scalar somebody can set.
	 */
	const budget = async (): Promise<ConfigOption> => {
		const v = (await namespaceView(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin
		)) as NamespaceView
		// Any scalar option in the panel. This was the ranker's "Guaranteed
		// conversation", which is a per-source stack now — what these tests
		// need is a single number with an address, not that setting.
		return v.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.label === "Limit")!
	}

	const useConfig = async (configId: number) => {
		const { selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		await selectConfig(db as any, specId, "instance" as any, 0, configId)
	}

	beforeAll(async () => {
		const { createConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		specId = spec.id
		alpha = (await createConfig(db as any, specId, "Alpha")).id
		beta = (await createConfig(db as any, specId, "Beta")).id
	})

	it("keeps each configuration's value with that configuration", async () => {
		await useConfig(alpha)
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin,
			(await budget()).id,
			1111,
			alpha
		)

		await useConfig(beta)
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin,
			(await budget()).id,
			2222,
			beta
		)

		await useConfig(alpha)
		expect(
			(await budget()).value,
			"Beta's edit followed the switch back to Alpha"
		).toBe(1111)

		await useConfig(beta)
		expect((await budget()).value).toBe(2222)
	})

	it("resets only the configuration it was asked about", async () => {
		await useConfig(beta)
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin,
			(await budget()).id,
			beta
		)
		expect((await budget()).value).not.toBe(2222)

		await useConfig(alpha)
		expect(
			(await budget()).value,
			"clearing Beta took Alpha's value with it"
		).toBe(1111)
	})

	it("refuses to rewrite a configuration Serene Pub ships", async () => {
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, specId),
					eq(schema.pipelineConfigs.isImmutable, true)
				)
			)
		expect(shipped, "no immutable config to test against").toBeTruthy()
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				admin,
				(await budget()).id,
				4242,
				shipped.id
			)
		).rejects.toThrow(/ships|Duplicate/i)
	})

	it("refuses a configuration belonging to another pipeline", async () => {
		const [narrate] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		const [foreign] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, narrate.id))
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				admin,
				(await budget()).id,
				7,
				foreign.id
			)
		).rejects.toThrow(/different pipeline/i)
	})
})

/**
 * `0115` keeps a gate that somebody turned on.
 *
 * `sync` and `async` are retired spellings. Reading them as `off` on upgrade is
 * the one outcome of this change that could let an unreviewed write land on an
 * install that had deliberately gated it — so both become `on`, and this is the
 * test that says so against rows written before the change rather than against
 * a fresh database, where the values cannot occur at all.
 */
describe("0115 retires the third review position", () => {
	const migration = async () =>
		(await import("node:fs")).readFileSync(
			"drizzle/0115_review_on_off.sql",
			"utf8"
		)

	it("turns both retired spellings into 'on', in both tables", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		const [cfg] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "Review legacy" })
			.returning()

		// Session-scope rows: the only override scope 0140 leaves, and the 0115
		// rewrite never keyed on scope — retired spellings are retired
		// wherever they sit.
		await db.insert(schema.pipelineNodeOverrides).values([
			{
				specId: spec.id,
				scopeKind: "session",
				scopeId: 4241,
				nodeKey: "save",
				slot: "settings",
				path: "review",
				value: "sync" as any
			},
			{
				specId: spec.id,
				scopeKind: "session",
				scopeId: 4242,
				nodeKey: "generate",
				slot: "settings",
				path: "review",
				value: "async" as any
			},
			// A gate deliberately left off stays off.
			{
				specId: spec.id,
				scopeKind: "session",
				scopeId: 4243,
				nodeKey: "generate",
				slot: "settings",
				path: "review",
				value: "off" as any
			}
		])
		await db.insert(schema.pipelineConfigValues).values({
			configId: cfg.id,
			nodeKey: "save",
			slot: "settings",
			path: "review",
			value: "async" as any
		})

		for (const stmt of (await migration()).split(
			"--> statement-breakpoint"
		))
			await db.execute(stmt)

		const overrides = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.path, "review"))
		const values = overrides.map((o: any) => o.value).sort()
		expect(values).toEqual(["off", "on", "on"])

		const [inConfig] = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, cfg.id))
		expect(
			inConfig.value,
			"a configuration's own review value was left behind"
		).toBe("on")
	})
})

/**
 * The bar renders from the declaration, not from a list in the client.
 *
 * The 1:1 rule applied to a control that would otherwise need five hardcoded
 * names, five labels and five colours. A plugin adding a sixth retrieval source
 * has to get a labelled band without anyone editing the panel — which is only
 * true while the bands travel with the option.
 */
describe("a share option carries its own bands", () => {
	const shareOption = async () => {
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		return v.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.control === "share")
	}

	it("names every source, in order, with a label and a colour", async () => {
		const o = await shareOption()
		expect(o, "the ranker declares no share option").toBeTruthy()
		expect(o!.members?.map((m) => m.key)).toEqual([
			"messages",
			"worldLore",
			"characterLore",
			"history",
			"relationships"
		])
		// Display text resolved server-side: the client renders strings, it
		// does not pick them.
		expect(o!.members?.map((m) => m.label)).toEqual([
			"Conversation",
			"World lore",
			"Character lore",
			"History entries",
			"Relationships"
		])
		expect(o!.members?.every((m) => typeof m.tone === "number")).toBe(true)
	})

	it("defaults to today's split, so nothing moves on upgrade", async () => {
		// `DEFAULT_GROUPS` in ranking/weights.ts: 0.5 to messages reproduces
		// MESSAGE_FILL_FRACTION exactly.
		const o = await shareOption()
		expect((o!.authorDefault as Record<string, number>).messages).toBe(0.5)
	})

	it("carries the real window once a sampling config is selected", async () => {
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const sampling = v.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.control === "sampling-ref")
		expect(sampling, "no sampling slot to read a window from").toBeTruthy()

		// Absent until something is selected, and that is the honest state
		// rather than a placeholder: a percentage of an unknown window buys an
		// unknown number of tokens, and inventing one would be the same defect
		// as the `budget: 4096` this replaced.
		expect(
			(await shareOption())!.windowTokens,
			"a window appeared before one was selected"
		).toBeUndefined()

		const [cfg] = await db
			.insert(schema.samplingConfigs)
			.values({
				name: "Window under test",
				userId: 1,
				contextTokens: 8192,
				responseTokens: 512
			} as any)
			.returning()
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			{ userId: 1, isAdmin: true },
			sampling!.id,
			cfg.id
		)

		// The same arithmetic `core:task/context-budget@1` performs, because the
		// number on screen has to be the number the ranker divides:
		// (8192 - 512) * 0.95.
		expect((await shareOption())!.windowTokens).toBe(7296)
	})

	it("gives the per-member ceiling the same bands", async () => {
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const ceiling = v.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.control === "per-member")
		expect(ceiling?.members?.map((m) => m.key)).toEqual([
			"messages",
			"worldLore",
			"characterLore",
			"history",
			"relationships"
		])
		// …and no window: a ceiling counts entries, not tokens.
		expect(ceiling?.windowTokens).toBeUndefined()
	})
})

/**
 * No setting on screen that cannot be set.
 *
 * Three node types declared a `template` slot nothing read and nothing seeded a
 * row for, so the panel rendered a picker with an empty dropdown on every
 * pipeline using them — `session-history`, `lorebook-triggers` and `generate-text`.
 * The slots are gone; this is what stops one coming back unnoticed, because the
 * declaration compiles perfectly well without anything to select and the defect
 * is only visible on the screen.
 *
 * Deliberately a rule about *every* reference control, not a list of the three:
 * a prompts slot or a variable layout with nothing to point at is the same
 * defect wearing a different label.
 */
describe("every reference control has something to reference", () => {
	it("offers at least one choice, on every step of every shipped pipeline", async () => {
		const { listNamespaces: list } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const empty: string[] = []
		for (const ns of await list(db as any)) {
			const v = (await namespaceView(db as any, SECRET, ns.slug, {
				userId: 1,
				isAdmin: true
			})) as NamespaceView
			// Three exclusions, each for a different reason:
			//
			// · `connection-ref` / `sampling-ref` — the instance's rows
			//   to create. An install with none is a fresh install, not
			//   a broken declaration.
			// · `prompts-ref` — core's prompts are migrated *from* the
			//   legacy config rows, which `defaults.sync()` writes at
			//   boot, and this fixture cannot call it (it re-enters the
			//   mocked db module). Asserting on them here would report
			//   empty pickers the fixture caused, and a guard that cries
			//   wolf is a guard someone switches off.
			//
			// What is left is what core seeds through `bootstrapPipelines`
			// alone — the context templates and variable layouts — which
			// is exactly the class the dead `template` slots were in.
			for (const step of v.steps)
				for (const o of [...step.options, ...step.advanced])
					if (
						/-ref$/.test(o.control) &&
						![
							"connection-ref",
							"sampling-ref",
							"prompts-ref"
						].includes(o.control) &&
						!(o.choices ?? []).length
					)
						empty.push(
							`${ns.slug} › ${step.label} › ${o.label} [${o.control}]`
						)
		}
		expect(empty).toEqual([])
	})
})

/**
 * A facet the client has never heard of still gets a heading.
 *
 * The panel used to hold the facet list itself, and match options *into* it. So
 * an option whose facet was not in that list matched no group and rendered
 * nowhere: a plugin's settings could exist in the database, be writable through
 * the socket, and be invisible on the only screen that configures them. Nothing
 * failed — which is the whole problem with a filter posing as a fallback.
 */
describe("the facet vocabulary travels with the view", () => {
	const view = async () =>
		(await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView

	it("names every facet the pipeline actually uses, and no others", async () => {
		const v = await view()
		const used = new Set(
			v.steps
				.flatMap((s) => [...s.options, ...s.advanced])
				.map((o) => o.facet)
		)
		expect(new Set(v.facets.map((f) => f.id))).toEqual(used)
	})

	it("resolves each heading, in order, from the declaration", async () => {
		const v = await view()
		const byId = new Map(v.facets.map((f) => [f.id, f]))
		expect(byId.get("prompts")?.label).toBe("Prompt")
		// One heading, two facets — the panel no longer pairs them itself.
		expect(byId.get("connection")?.label).toBe("Model")
		expect(byId.get("sampling")?.label).toBe("Model")
		expect(byId.get("weights")?.label).toBe("Tuning")
		const orders = v.facets.map((f) => f.order)
		expect([...orders].sort((a, b) => a - b)).toEqual(orders)
	})

	it("says which lead the panel rather than the client deciding", async () => {
		const v = await view()
		const simple = v.facets
			.filter((f) => f.simple)
			.map((f) => f.id)
			.sort()
		expect(simple).toEqual(["connection", "prompts", "review", "sampling"])
	})

	it("gives an undeclared facet a humanised heading rather than dropping it", async () => {
		// The branch that matters, and the one that used to lose settings. It
		// cannot be reached through `namespaceView` without a plugin installed,
		// so the resolution is tested where it lives.
		const { resolveFacet } = await import(
			"$lib/server/pipelines/config/panel/read"
		)
		const { getFacet } = await import("@serene-pub/sdk")
		expect(
			getFacet("retrieval_tuning"),
			"picked a name core declares"
		).toBeUndefined()

		expect(resolveFacet("retrieval_tuning")).toEqual({
			id: "retrieval_tuning",
			label: "Retrieval tuning",
			// After everything core declares, so a plugin cannot push its own
			// settings above the prompt.
			order: 900,
			// And behind the tuning door: leading the panel is a claim only a
			// declaration gets to make.
			simple: false
		})
		expect(resolveFacet("someOtherThing").label).toBe("Some Other Thing")
	})

	it("keeps a facet nothing declares, rather than filtering it out", async () => {
		// The property a shipped pipeline cannot exercise, because core
		// declares all of its own facets — so a filter here would stay
		// invisible until somebody installed a plugin, which is exactly how the
		// client-side version of this bug survived.
		const { facetsFor } = await import(
			"$lib/server/pipelines/config/panel/read"
		)
		const out = facetsFor(["weights", "retrieval_tuning", "prompts"])
		expect(out.map((f) => f.id)).toEqual([
			"prompts",
			"weights",
			// Last, because nothing declared an order for it.
			"retrieval_tuning"
		])
		expect(out.at(-1)!.label).toBe("Retrieval tuning")
	})

	it("resolves a declared facet the same way", async () => {
		const { resolveFacet } = await import(
			"$lib/server/pipelines/config/panel/read"
		)
		expect(resolveFacet("prompts")).toEqual({
			id: "prompts",
			label: "Prompt",
			order: 0,
			simple: true
		})
	})
})

/**
 * Declared order is the order.
 *
 * `declarations()` walks nodes by stored position and each node's slots by the
 * order the descriptor wrote them, so what a reader sees follows what an author
 * declared. Worth pinning rather than assuming: the slots reach the panel as
 * JSON on a registry row, and "object key order survives a round trip" is true
 * but not something to leave to memory — and a `Object.keys(...).sort()` added
 * for tidiness anywhere in that path would silently reorder every settings
 * screen.
 *
 * The client regroups by facet on top of this, deliberately. Within a facet,
 * this is what decides what comes first.
 */
describe("options arrive in the order they were declared", () => {
	it("follows the parameter schema's own order within a slot", async () => {
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const rank = v.steps.find((s) => /rank/i.test(s.label))
		expect(rank, "no ranking step").toBeTruthy()
		expect(
			[...rank!.options, ...rank!.advanced].map((o) => o.label)
		).toEqual([
			// The chain first: `scripts` is a headline option, not a tuning
			// parameter, so it lands in `options` while the shares sit in
			// `advanced` — declaration order within each group still holds.
			"Scripts",
			"Context split",
			"Most entries per source",
			"Always keep at least"
		])
	})

	it("follows the descriptor's slot order within a node", async () => {
		// Assemble declares `template`, then `variables`, then `params` — and
		// alphabetically that is params, template, variables, which would put
		// "Post History Depth" first and the context template third. So this is
		// the assertion that notices a tidy-minded `.sort()` in the slot walk.
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const asm = v.steps.find((s) => /assemble/i.test(s.label))
		expect(asm, "no assembly step").toBeTruthy()
		const labels = asm!.advanced.map((o) => o.label)
		expect(labels[0], "the template slot is declared first").toBe(
			"Template"
		)
		// Then the layouts, then the tuning numbers — slot by slot, in order.
		expect(labels.indexOf("World lore")).toBeLessThan(
			labels.indexOf("Post History Depth")
		)
	})

	it("follows node position across steps", async () => {
		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		// The order the machine runs in, which is what the step rail numbers.
		const labels = v.steps.map((s) => s.label)
		expect(labels.indexOf("Context budget")).toBeLessThan(
			labels.indexOf("Rank hybrid")
		)
		expect(labels.indexOf("Rank hybrid")).toBeLessThan(
			labels.indexOf("Assemble")
		)
	})
})
