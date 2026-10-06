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
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { groupOptions, groupSteps } from "$lib/server/pipelines/config/panel/groups"

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
	await bootstrapPipelines(db)

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
		db,
		SECRET,
		CHAT_RESPOND_SPEC_ID,
		viewer(over)
	) as Promise<NamespaceView>

const allOptions = (v: NamespaceView): ConfigOption[] => groupOptions(v.groups)

describe("the namespace list", () => {
	it("lists what core published, from rows", async () => {
		const list = await listNamespaces(db)
		expect(list.map((n) => n.slug)).toContain(CHAT_RESPOND_SPEC_ID)
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
				.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		).map((k) => k.nodeKey)
		expect(keys.length).toBeGreaterThan(3)

		// `source` is a variable layout's authored template text. It is content
		// the user typed, not something this payload derived from the document —
		// and someone is entitled to write `{{#each}}` around a word that
		// happens to be a node key. Exempting it keeps the scan pointed at
		// *leaks*, which are fields core populates, rather than at what a person
		// chose to write in a box.
		//
		// `heading`, `purpose` and `valueLabel` are prose of the same class: a
		// settings group's heading and purpose, a step's heading, and the NAME of
		// the row a reference points at ("Build template context" is a
		// definition's name, not the `context` node).
		const PROSE = new Set([
			"label",
			"description",
			"name",
			"source",
			"heading",
			"purpose",
			"valueLabel"
		])
		// `taxonomy.mode` (23 §2) is a session-mode id — public vocabulary the
		// session picker already ships to every user (`sessions:genres`), not
		// this pipeline's wiring. The word-boundary scan flags it only because
		// the respond spec happens to name a node `input`, and "input" appears
		// inside every `core:inlet/…` id. Same exemption class as PROSE:
		// a value that is legitimately public, not a leak core derived.
		// `function` and `specSlug` are a trigger's PUBLIC routing identifiers —
		// the client fires a function by name and resolves it to a spec by slug,
		// so both are meant to travel. They trip the scan only because the word
		// boundary in a hyphenated name splits it: `generate-image` contains
		// `generate`, which the respond spec happens to use as a node key. Same
		// exemption class as `mode`: legitimately public, not derived from a node.
		const PUBLIC_IDS = new Set(["mode", "key", "specSlug"])
		// `prompt` is the prompts-ref option's designed payload field (the
		// selected prompt row riding along for inline editing) — a property
		// the panel always shipped in production, tripped here only because
		// the respond spec names a node `prompt`. Its subtree is authored
		// prose and row identity, so it walks as prose.
		const PAYLOAD_FIELDS = new Set(["prompt"])
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
					if (!PAYLOAD_FIELDS.has(k))
						for (const key of keys)
							if (new RegExp(`\\b${key}\\b`).test(k))
								offences.push(`${path}.${k} is named for a node`)
					// Prose is a subtree property: the prompt row's `fields` are authored text.
					walk(
						v,
						`${path}.${k}`,
						prose || PROSE.has(k) || PUBLIC_IDS.has(k) || PAYLOAD_FIELDS.has(k)
					)
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
					.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
			).map((k) => k.nodeKey.toLowerCase())
		)
		for (const o of allOptions(
			await view({ userId: adminId, isAdmin: true })
		))
			expect(keys.has(o.label.toLowerCase())).toBe(false)
	})

	it("names each option's step by an opaque handle, never an ordinal or a node key", async () => {
		const v = await view({ userId: adminId, isAdmin: true })
		const steps = groupSteps(v.groups)
		expect(steps.length).toBeGreaterThan(1)
		for (const s of steps) {
			expect(s.key).toMatch(/^[0-9a-f]{16}$/)
			expect(s.heading).not.toMatch(/\s\d+$/)
		}
		expect(allOptions(v).length).toBeGreaterThan(0)
	})

	it("fronts the prompt and folds the tuning parameters into Advanced", async () => {
		// Weights and budgets are present but set aside, so a group leads with
		// its prompt and references. Admin view — params are the
		// administrator's now.
		const v = await view({ userId: adminId, isAdmin: true })
		const advanced = v.groups.flatMap((g) => g.advanced.flatMap((s) => s.options))
		expect(advanced.length).toBeGreaterThan(0)
		for (const o of advanced)
			expect(o.control === "prompts-ref").toBe(false)
		const front = v.groups.flatMap((g) => g.front)
		expect(front.some((o) => o.control === "prompts-ref")).toBe(true)
	})

	it("carries the selected prompt row on a prompts-ref option", async () => {
		// The panel edits the prompt inline, so the row rides along — id,
		// name, fields, and whether it is a shipped (read-only) prompt.
		const before = await view({ sessionId })
		const ref = allOptions(before).find((o) => o.control === "prompts-ref")!
		expect(ref).toBeTruthy()

		// Into the option's OWN pool, read off the declaration. A row written
		// into any other pool is refused by `writeOption` now, which is the
		// point — but it would also make this test about the refusal rather
		// than about the ride-along.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decl = (
			await declarations(db, spec.activeVersionId!)
		).find(
			(d: any) =>
				d.control === "prompts-ref" &&
				optionId(SECRET, d.nodeKey, d.slot, d.path) === ref.id
		)!
		const [prompt] = await db
			.insert(schema.pipelinePrompts)
			.values({
				nodeDefinitionId: decl.nodeDefinitionId!,
				slot: decl.slot,
				name: "Rides along",
				fields: Object.fromEntries(
					(decl.promptFields ?? []).map((f: string) => [
						f,
						"inline text"
					])
				)
			})
			.returning()
		// The shipped default selects a catalog prompt (24 T6b: prompts seed
		// from @serene-pub/core-catalog with no legacy dependency), so the
		// row rides along from the start — shipped, hence read-only.
		expect(ref.prompt).toBeTruthy()
		expect(ref.prompt!.readOnly).toBe(true)

		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
		expect(after.prompt!.fields.systemPrompt).toBe("inline text")
		expect(after.prompt!.readOnly).toBe(false)

		// Leave the option as found for the provenance tests below.
		await clearOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ sessionId }),
			ref.id
		)
	})

	it("offers a non-admin prompts and nothing else — not even the model by name", async () => {
		// Not disabled — absent. The 0.6 line: to a non-admin the pipeline is
		// how the application works; wording is the one thing that is theirs.
		// A row is shown to a role that can normally edit it (owner ruling
		// 2026-09-30), and a non-admin never edits a connection anywhere.
		for (const over of [{}, { sessionId }]) {
			const asUser = await view(over)
			expect(allOptions(asUser).length).toBeGreaterThan(0)
			for (const o of allOptions(asUser))
				expect(o.control, JSON.stringify(over)).toBe("prompts-ref")
		}
	})

	it("draws a non-admin no group, on any pipeline, that holds only an administrator's rows", async () => {
		// "Only show cards if there's settings the user can edit": a group —
		// and so a session card, which is drawn when it has a group — is sent
		// only when it holds a row this role normally edits.
		for (const { slug } of await listNamespaces(db)) {
			const v = (await namespaceView(db, SECRET, slug, viewer({ sessionId }))) as
				| NamespaceView
				| null
			if (!v) continue
			for (const g of v.groups) {
				// In their own, unlocked session every row a non-admin is sent is
				// one they edit — a prompt (an envoy's texts are prompts too).
				const rows = groupOptions([g])
				const at = `${slug} / ${g.heading ?? g.key}`
				expect(rows.length, at).toBeGreaterThan(0)
				expect(
					rows.filter((o) => !o.writable).map((o) => [o.control, o.label]),
					at
				).toEqual([])
				expect(
					rows.filter((o) => o.control === "connection-ref" || o.control === "sampling-ref"),
					at
				).toEqual([])
			}
		}
	})

	it("gives a non-admin a prompt-bearing card in their own session, writable", async () => {
		const inSession = await view({ sessionId })
		expect(inSession.groups.length).toBeGreaterThan(0)
		const prompts = allOptions(inSession).filter((o) => o.control === "prompts-ref")
		expect(prompts.length).toBeGreaterThan(0)
		expect(prompts.every((o) => o.writable)).toBe(true)
	})

	it("still shows an administrator in a session the model, read-only — theirs to change in Pipelines", async () => {
		const asAdmin = await view({ userId: adminId, isAdmin: true, sessionId })
		const model = allOptions(asAdmin).find((o) => o.control === "connection-ref")
		expect(model).toBeTruthy()
		expect(model!.writable).toBe(false)
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
				viewer({ sessionId }),
				param.id,
				99
			)
		).rejects.toThrow(/stays with the administrator/)
		// Globally: a non-admin has no target at all — a global edit is a
		// config edit, and configs are the administrator's (ruled 2026-08-24).
		await expect(
			writeOption(
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
		// Since 24 T6b the shipped config carries a value for *every*
		// declaration (prompts included, now that they seed from the catalog
		// with no legacy dependency) — so the author layer is reached by
		// clearing a copy's value, not found lying around.
		const inSession = await view({ sessionId })
		// The session viewer is a non-admin, who is offered prompts and
		// nothing else — so the walk rides the prompts-ref option, as it
		// always did. Its base value now comes from the shipped config
		// (source "config"), and the author layer is exposed by clearing a
		// mutable copy below.
		const target = allOptions(inSession).find((o) => o.writable)!
		expect(target).toBeTruthy()
		expect(target.control).toBe("prompts-ref")

		// A mutable copy of the shipped default, selected for the instance —
		// the global edit below lands in *it*, because there is no other
		// global place left for an edit to go.
		const { duplicateConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, spec.id),
					eq(schema.pipelineConfigs.isImmutable, true)
				)
			)
		const copy = await duplicateConfig(db, shipped.id, "Walk copy")
		await selectConfig(db, spec.id, "pub", 0, copy.id, adminId)

		// Clearing deletes the copy's row, so the author default resolves —
		// the bottom of the chain, seen before the layers stack back up.
		await clearOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			target.id
		)
		let base = allOptions(
			await view({ userId: adminId, isAdmin: true })
		).find((o) => o.id === target.id)!
		expect(base.source).toBe("author")

		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			target.id,
			"the config says so"
		)
		let now = allOptions(
			await view({ userId: adminId, isAdmin: true })
		).find((o) => o.id === target.id)!
		expect(now.value).toBe("the config says so")
		expect(now.source).toBe("config")
		expect(now.overriddenHere).toBe(true)

		// Opened from inside the session, the same edit lands at session scope and wins.
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
		expect(now.source).toBe("config")

		// Leave the instance as found for the tests below.
		await clearOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ sessionId }),
			target.id
		)
		await selectConfig(db, spec.id, "pub", 0, null, adminId)
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const landing = await createConfig(db, spec.id, "Landing")
		await selectConfig(
			db,
			spec.id,
			"pub",
			0,
			landing.id,
			adminId
		)

		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			param.id,
			777
		)
		const after = allOptions(await asAdmin()).find(
			(o) => o.id === param.id
		)!
		expect(after.value).toBe(777)
		expect(after.source).toBe("config")
		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, landing.id))
		expect((rows as any[]).some((r) => r.value === 777)).toBe(true)

		// Reset deletes the configuration's value; the author default resolves.
		await clearOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			param.id
		)
		const back = allOptions(await asAdmin()).find((o) => o.id === param.id)!
		expect(back.value).not.toBe(777)
		expect(back.source).not.toBe("config")

		await selectConfig(db, spec.id, "pub", 0, null, adminId)
	})

	it("keeps one session's overrides out of another's view", async () => {
		const inSession = await view({ sessionId })
		const target = allOptions(inSession).find(
			(o) => o.writable && o.source !== "session"
		)!
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const [copy] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "My copy", isImmutable: false })
			.returning()

		await selectNamedConfig(
			db,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			copy.id,
			"pub"
		)
		const [row] = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.scopeKind, "pub"))
		expect(row.configId).toBe(copy.id)

		const v = await view()
		expect(v.selectedConfig).toEqual({
			id: copy.id,
			name: "My copy",
			source: "pub"
		})
		expect(v.configs.map((c) => c.id)).toContain(copy.id)
	})

	it("refuses a config belonging to another pipeline", async () => {
		// A selection that silently does nothing is the hardest configuration
		// bug to see — refused at the write, not resolved past at the read.
		const [foreign] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-narrate"))
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
				db,
				CHAT_RESPOND_SPEC_ID,
				viewer({ userId: adminId, isAdmin: true }),
				other.id,
				"pub"
			)
		).rejects.toThrow(/different pipeline/)
	})
})

/**
 * Admins define which configurations exist; everyone else chooses among them.
 *
 * R8, and the half of it that is easy to get wrong is the second clause. There
 * is no owner column here and there never was, so "removing user ownership" is
 * not a schema change — it is making the administrator's curation *binding*.
 * `enabled` is that curation, and until this it was advisory in the panel path:
 * every configuration was listed to everyone, and `selectNamedConfig` would
 * store a choice of a withdrawn one without comment. The picker filter is not
 * what protects it — a config id is a small integer arriving from the client —
 * so the refusal is asserted separately from the listing.
 */
describe("the curated set", () => {
	let specId: number
	let withdrawn: number
	let offered: number

	beforeAll(async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		specId = spec.id

		const [off] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Withdrawn", enabled: false })
			.returning()
		withdrawn = off.id
		const [on] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "On the menu", enabled: true })
			.returning()
		offered = on.id
	}, 60_000)

	it("does not list a withdrawn configuration to a non-admin", async () => {
		const v = await view()
		const ids = v.configs.map((c) => c.id)
		expect(ids).toContain(offered)
		expect(ids).not.toContain(withdrawn)
	})

	it("still lists it to an admin, marked, so switching one off is not deletion", async () => {
		// An admin who withdrew a configuration and then could not find it
		// would reasonably conclude they had deleted it.
		const v = await view({ isAdmin: true, userId: adminId })
		const row = v.configs.find((c) => c.id === withdrawn)
		expect(row).toBeTruthy()
		expect(row!.enabled).toBe(false)
	})

	it("refuses a non-admin who names a withdrawn configuration anyway", async () => {
		// The id did not have to come from the list. This is the check that
		// makes the switch a rule rather than a rendering decision.
		await expect(
			selectNamedConfig(
				db,
				CHAT_RESPOND_SPEC_ID,
				viewer({ sessionId }),
				withdrawn,
				"session"
			)
		).rejects.toThrow(OptionNotWritableError)

		const rows = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(
				and(
					eq(schema.pipelineConfigSelections.scopeKind, "session"),
					eq(schema.pipelineConfigSelections.scopeId, sessionId)
				)
			)
		// Refused means nothing was written, not "written and then reported".
		expect(rows.map((r) => r.configId)).not.toContain(withdrawn)
	})

	it("lets a non-admin choose an offered one for their own session", async () => {
		// The other half of the ruling, and the one a permission change is
		// most likely to break by accident: choosing is the verb people keep.
		await selectNamedConfig(
			db,
			CHAT_RESPOND_SPEC_ID,
			viewer({ sessionId }),
			offered,
			"session"
		)
		const v = await view({ sessionId })
		expect(v.selectedConfig).toEqual({
			id: offered,
			name: "On the menu",
			source: "session"
		})
	})

	it("lets an admin choose a withdrawn one, since it is their switch", async () => {
		await selectNamedConfig(
			db,
			CHAT_RESPOND_SPEC_ID,
			viewer({ userId: adminId, isAdmin: true }),
			withdrawn,
			"pub"
		)
		const [row] = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.scopeKind, "pub"))
		expect(row.configId).toBe(withdrawn)
	})

	it("refuses a session-scope choice made from outside a session", async () => {
		// It used to fall through to scope id 0 — a selection stored against a
		// session that does not exist, resolved by nobody, reported as saved.
		// A no-op that answers "done" is the failure the refusals here exist
		// to prevent.
		await expect(
			selectNamedConfig(
				db,
				CHAT_RESPOND_SPEC_ID,
				viewer(),
				offered,
				"session"
			)
		).rejects.toThrow(OptionNotWritableError)

		const rows = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(
				and(
					eq(schema.pipelineConfigSelections.scopeKind, "session"),
					eq(schema.pipelineConfigSelections.scopeId, 0)
				)
			)
		expect(rows).toHaveLength(0)
	})
})

/**
 * Choosing is offered where it can succeed, and stated where it cannot.
 *
 * `canSelectConfig` exists because the client cannot work this out: it knows
 * neither the viewer's role nor the scope rule. Without it the Pipelines panel
 * rendered a live dropdown for a non-admin standing outside a session, whose
 * every use ended in "only an administrator chooses the configuration for
 * everyone on this pub" — a control that would have worked for somebody
 * else, which is worse than no control at all.
 */
describe("whether the selection is this viewer's to make", () => {
	it("is false for a non-admin outside a session", async () => {
		const v = await view()
		expect(v.canSelectConfig).toBe(false)
	})

	it("is true inside a session they own", async () => {
		const v = await view({ sessionId })
		expect(v.canSelectConfig).toBe(true)
	})

	it("is true for an admin anywhere", async () => {
		const v = await view({ userId: adminId, isAdmin: true })
		expect(v.canSelectConfig).toBe(true)
	})

	it("agrees with what the write path actually accepts", async () => {
		// The claim is not "the flag has a value" but "the flag and the
		// refusal are the same rule". Two independent copies of a permission
		// rule is how a screen ends up disagreeing with the server — the
		// configuration named here is one the panel itself just offered, so
		// nothing but the viewer's standing can be the reason it is refused.
		const v = await view()
		expect(v.canSelectConfig).toBe(false)
		expect(v.configs.length).toBeGreaterThan(0)
		await expect(
			selectNamedConfig(
				db,
				CHAT_RESPOND_SPEC_ID,
				viewer(),
				v.configs[0].id
			)
		).rejects.toThrow(OptionNotWritableError)
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
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			admin
		)) as NamespaceView
		// Any scalar option in the panel. This was the ranker's "Guaranteed
		// conversation", which is a per-source stack now — what these tests
		// need is a single number with an address, not that setting.
		return groupOptions(v.groups)
			.find((o) => o.label === "Limit")!
	}

	const useConfig = async (configId: number) => {
		const { selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		await selectConfig(db, specId, "pub" as any, 0, configId)
	}

	beforeAll(async () => {
		const { createConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		specId = spec.id
		alpha = (await createConfig(db, specId, "Alpha")).id
		beta = (await createConfig(db, specId, "Beta")).id
	})

	it("keeps each configuration's value with that configuration", async () => {
		await useConfig(alpha)
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			admin,
			(await budget()).id,
			1111,
			alpha
		)

		await useConfig(beta)
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
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
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
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
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-narrate"))
		const [foreign] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, narrate.id))
		await expect(
			writeOption(
				db,
				SECRET,
				CHAT_RESPOND_SPEC_ID,
				admin,
				(await budget()).id,
				7,
				foreign.id
			)
		).rejects.toThrow(/different pipeline/i)
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
/**
 * Each source carries its own intent (R-7 P5, 2026-09-16).
 *
 * The ranker used to declare `share`, `maxEntries` and `minEntries` as
 * five-band maps — one `share` control naming every source. Those live on the
 * sources now: each of the five retrieval nodes declares its own `share`,
 * ceiling and priority (the conversation its floor too), labelled with the
 * band it speaks for, and the ranker reads them off the candidates. So the
 * panel shows "Share — world lore" on the world-lore step and no "Context
 * split" anywhere.
 */
describe("each source carries its own intent", () => {
	const BANDS: Record<string, string> = {
		"gather.history.read": "conversation",
		"gather.worldLore.read": "world lore",
		"gather.characterLore.read": "character lore",
		"gather.historyEntries.read": "history",
		"gather.relationships.read": "relationships"
	}
	const declsOf = async () => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		return declarations(db, spec!.activeVersionId!)
	}
	const shareOptions = async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		return groupOptions(v.groups)
			.filter((o) => /^Share — /.test(o.label))
	}

	it("declares no context split on the ranker, and a share on every source, named for its band", async () => {
		const decls = await declsOf()
		expect(
			decls.filter((d) => d.nodeKey === "rank" && d.slot === "params").map((d) => d.path)
		).not.toEqual(expect.arrayContaining(["share", "maxEntries", "minEntries"]))
		expect(decls.find((d) => d.control === "share")).toBeUndefined()
		for (const [nodeKey, band] of Object.entries(BANDS)) {
			const share = decls.find(
				(d) => d.nodeKey === nodeKey && d.slot === "params" && d.path === "share"
			)
			expect(share, `${nodeKey} declares no share`).toBeTruthy()
			expect(share!.label).toBe(`Share — ${band}`)
			expect(share!.control).toBe("number")
			expect(share!.facet).toBe("weights")
		}
	})

	it("defaults to today's split, so nothing moves on upgrade", async () => {
		// `DEFAULT_GROUPS` in ranking/weights.ts: 0.5 to the conversation is
		// MESSAGE_FILL_FRACTION exactly, the three lore bands sum to the other
		// half, relationships ship at 0.
		const decls = await declsOf()
		const shareOf = (nodeKey: string) =>
			decls.find(
				(d) => d.nodeKey === nodeKey && d.slot === "params" && d.path === "share"
			)!.authorDefault
		expect(shareOf("gather.history.read")).toBe(0.5)
		expect(shareOf("gather.worldLore.read")).toBe(0.1667)
		expect(shareOf("gather.characterLore.read")).toBe(0.1667)
		expect(shareOf("gather.historyEntries.read")).toBe(0.1666)
		expect(shareOf("gather.relationships.read")).toBe(0)
		const capOf = (nodeKey: string) =>
			decls.find(
				(d) => d.nodeKey === nodeKey && d.slot === "params" && d.path === "maxEntries"
			)!.authorDefault
		expect(capOf("gather.history.read")).toBe(50)
		expect(capOf("gather.worldLore.read")).toBe(20)
		expect(capOf("gather.characterLore.read")).toBe(15)
		expect(capOf("gather.historyEntries.read")).toBe(10)
		// Uncapped by declaration: the query's own ceiling, absent, is the band's.
		expect(capOf("gather.relationships.read")).toBeUndefined()
		// The one floor (R6): the conversation's, nowhere else.
		expect(
			decls
				.filter((d) => d.slot === "params" && d.path === "minEntries")
				.map((d) => [d.nodeKey, d.authorDefault])
		).toEqual([["gather.history.read", 6]])
	})

	it("carries the real window once a sampling config is selected", async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const sampling = groupOptions(v.groups)
			.find((o) => o.control === "sampling-ref")
		expect(sampling, "no sampling slot to read a window from").toBeTruthy()

		// Absent until something is selected, and that is the honest state
		// rather than a placeholder: a share of an unknown window buys an
		// unknown number of tokens, and inventing one would be the same defect
		// as the `budget: 4096` this replaced.
		const before = await shareOptions()
		// The five bands' sources, and entity-search's recalled lines
		// (`recalledLinesShare`, 2026-09-27) — declared on the node, and
		// inert here as its `maxMessages` is: no shipped spec ranks them.
		expect(before.length).toBe(6)
		for (const o of before)
			expect(o.windowTokens, `${o.label} showed a window before one was selected`).toBeUndefined()

		// Both budgets are parameters since 0171 — a key present in `enabled` is
		// the switch being on, so the window is only real when both are listed.
		const [cfg] = await db
			.insert(schema.samplingConfigs)
			.values({
				name: "Window under test",
				values: { contextTokens: 8192, responseTokens: 512 },
				enabled: ["contextTokens", "responseTokens"]
			})
			.returning()
		await writeOption(
			db,
			SECRET,
			CHAT_RESPOND_SPEC_ID,
			{ userId: 1, isAdmin: true },
			sampling!.id,
			cfg.id
		)

		// The same arithmetic `core:task/context-budget@1` performs, because the
		// number on screen has to be the number the ranker divides:
		// (8192 - 512) * 0.95 — on every source's share, since each is a
		// share OF that window.
		for (const o of await shareOptions()) expect(o.windowTokens).toBe(7296)
	})

	it("keeps the signal matrix per band on the ranker — the cross-source half", async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const matrix = groupOptions(v.groups)
			.filter((o) => o.control === "per-member")
		expect(matrix.length).toBeGreaterThan(0)
		for (const row of matrix) {
			expect(row.members?.map((m) => m.key)).toEqual([
				"messages",
				"worldLore",
				"characterLore",
				"history",
				"relationships"
			])
			// …and no window: a weight is not a share of anything.
			expect(row.windowTokens).toBeUndefined()
		}
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
		for (const ns of await list(db)) {
			const v = (await namespaceView(db, SECRET, ns.slug, {
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
			for (const o of groupOptions(v.groups))
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
							`${ns.slug} › ${o.step.heading} › ${o.label} [${o.control}]`
						)
		}
		expect(empty).toEqual([])
	})
})

/**
 * One control per shared slot — the "renders once" guards (U3; R-7 P2).
 *
 * A slot the document wired to another node's (`slot.params({ node })`,
 * `slot.samplingOf(…)`, a shared connection) belongs to the node it points
 * at, and `declarations()` offers it there and nowhere else. Two boxes for one
 * value is the three-System-boxes defect (13 §12 finding i): writing the second
 * would change nothing, because the executor resolves a shared slot against
 * the TARGET node's stored value. These used to live in the reprojection tests
 * that 0134 retired; re-homed here so the proof outlives the migrations.
 */
describe("a shared slot renders once, on its owner", () => {
	const declsOf = async (slug: string) => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
		return declarations(db, spec!.activeVersionId!)
	}

	const SCAN_KNOBS = [
		"admitThreshold",
		"guaranteedMessages",
		"lexicalScoring",
		"maxRecursionDepth",
		"scanDepth",
		"titleWeight",
		"trigramFolding"
	]
	/** Each lane's own (R-7 P5): unmarked on the declaration, rendered per lane. */
	const LANE_OWN = ["maxEntries", "priority", "share"]
	const LANES = [
		"gather.worldLore.read",
		"gather.characterLore.read",
		"gather.historyEntries.read"
	]

	it("shows the seven lore knobs once, on the world-lore lane, and the embed switch once, on the semantic embed", async () => {
		const decls = await declsOf(CHAT_RESPOND_SPEC_ID)
		const paramsOn = (nodeKey: string) =>
			decls.filter((d) => d.nodeKey === nodeKey && d.slot === "params")
		// The losers read the owner's slot through `ofNode` for the SHARED
		// fields: none of the seven scan knobs renders there. Their own three
		// do — see the next case.
		for (const loser of ["gather.characterLore.read", "gather.historyEntries.read"])
			expect(
				paramsOn(loser).map((d) => d.path).sort(),
				`${loser} offers a shared knob`
			).toEqual(LANE_OWN)
		// `enabled` is the embed pair's one field and it is shared, so the
		// loser embed node renders nothing at all.
		expect(paramsOn("names.arm.embed")).toEqual([])
		// The owners carry the controls — the seven knobs (and its own three),
		// and the switch.
		expect(paramsOn("gather.worldLore.read").map((d) => d.path).sort()).toEqual(
			[...SCAN_KNOBS, ...LANE_OWN].sort()
		)
		expect(paramsOn("semantic.arm.embed").map((d) => d.path)).toContain(
			"enabled"
		)
		// And across the whole document each of the seven appears on exactly
		// one lore lane — the proof "7 lore knobs once" names.
		for (const path of SCAN_KNOBS)
			expect(
				decls.filter(
					(d) =>
						d.slot === "params" &&
						d.path === path &&
						/^gather\.(worldLore|characterLore|historyEntries)\.read$/.test(
							d.nodeKey
						)
				).length,
				`${path} appears on more than one lore lane`
			).toBe(1)
	})

	it("shows share, ceiling and priority once PER LANE, each labelled with its band", async () => {
		// The other half of P2's line (R-7 P5): a field the declaration does
		// not mark `shared` is the lane's own, so every lane renders one and
		// the label says which lane it moves.
		const decls = await declsOf(CHAT_RESPOND_SPEC_ID)
		const bandOf: Record<string, string> = {
			"gather.worldLore.read": "world lore",
			"gather.characterLore.read": "character lore",
			"gather.historyEntries.read": "history"
		}
		for (const path of LANE_OWN) {
			const on = decls.filter(
				(d) => d.slot === "params" && d.path === path && LANES.includes(d.nodeKey)
			)
			expect(on.map((d) => d.nodeKey).sort(), `${path}`).toEqual([...LANES].sort())
			for (const d of on) expect(d.label).toMatch(new RegExp(`— ${bandOf[d.nodeKey]}$`))
		}
		// Own fields resolve at their own address: the panel's provenance for
		// a loser lane's share is the loser lane, not the owner.
		expect(
			decls.find(
				(d) => d.nodeKey === "gather.characterLore.read" && d.path === "share"
			)!.authorDefault
		).toBe(0.1667)
	})

	it("labels the owner's controls with the shared truth, not one lane's", async () => {
		// The owner governs three sources. A label reading "world lore" over a
		// control that moves character lore and history too was the U3
		// review's W4; the wording is the shared one on the declaration.
		const decls = await declsOf(CHAT_RESPOND_SPEC_ID)
		const scan = decls.find(
			(d) =>
				d.nodeKey === "gather.worldLore.read" &&
				d.slot === "params" &&
				d.path === "scanDepth"
		)!
		expect(scan.label).toBe("Messages scanned for lore triggers")
		expect(scan.description).toContain(
			"world lore, character lore and history"
		)
	})

	it("offers one connection option, on the step that sends", async () => {
		// A `connection` slot on Assemble would be a second connection picker
		// beside the reply step's. It is absent because it is SHARED — the
		// document wires `prompt`'s to `generate`'s — not because there is no
		// slot; the second assertion is what tells the two apart.
		const decls = await declsOf(CHAT_RESPOND_SPEC_ID)
		const conns = decls.filter((d) => d.control === "connection-ref")
		expect(conns.filter((d) => d.nodeKey === "generate").length).toBe(1)
		expect(conns.some((d) => d.nodeKey === "prompt")).toBe(false)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const [prompt] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(schema.pipelineNodes.specVersionId, spec!.activeVersionId!),
					eq(schema.pipelineNodes.nodeKey, "prompt")
				)
			)
		expect((prompt!.config as any).connection).toMatchObject({
			__ref: "slot",
			slot: "connection",
			ofNode: "generate"
		})
		expect((prompt!.resolvedRefs as any).connection).toBe("generate")
	})

	it("adds no second Sampling control on the step that only reads the window", async () => {
		// `contextBudget` reads `slot.samplingOf("generate")`: one control for
		// the pair, which is what makes the two windows unable to disagree.
		const decls = await declsOf(CHAT_RESPOND_SPEC_ID)
		expect(
			decls.filter(
				(d) => d.nodeKey === "contextBudget" && d.slot === "sampling"
			)
		).toEqual([])
		expect(
			decls.filter((d) => d.nodeKey === "generate" && d.slot === "sampling")
				.length
		).toBe(1)
	})
})

/**
 * Every setting lands somewhere.
 *
 * The panel once matched options into a fixed list of kinds, so an option of a
 * kind it had not heard of — a plugin's — rendered nowhere. The groups are
 * shaped from every option drawn, so each one lands in exactly one group.
 */
describe("every option drawn has a group", () => {
	it("places each option once, whatever its kind", async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const decls = await declarations(db, spec!.activeVersionId!)
		const ids = groupOptions(v.groups).map((o) => o.id)
		expect(new Set(ids).size).toBe(ids.length)
		expect(new Set(ids)).toEqual(
			new Set(decls.map((d) => optionId(SECRET, d.nodeKey, d.slot, d.path)))
		)
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
/**
 * The substrate's settings render from the row, like any slot (R-9, R-11 —
 * 2026-09-16).
 *
 * `settings.enabled`, `settings.review` and a gather clause's `settings.mode`
 * were three controls `declarations.ts` synthesised by hand — wording,
 * defaults and facets written in the panel, declared by nothing. They are a
 * `settings` slot now: projected onto the registry row for every optional or
 * gated definition, declared by the SDK for a gather clause, and walked by the
 * same branch that renders a `params` field. What is pinned is that the panel
 * has no special knowledge left: every settings option corresponds to a
 * declaration it read, the defaults are the declaration's (an author's
 * `reviewDefault` reaches the panel, which the hand-written control got
 * wrong), the facets and `quick` are what they were, the addresses are
 * unchanged, and an interior script point's option lists what the point
 * accepts rather than what the panel assumed.
 */
describe("the substrate's settings render from the row, like any slot", () => {
	const declsOf = async (slug: string) => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
		return {
			versionId: spec!.activeVersionId!,
			decls: await declarations(db, spec!.activeVersionId!)
		}
	}

	it("offers `enabled` on every optional node and nowhere else, as the row declares it", async () => {
		const { versionId, decls } = await declsOf(CHAT_RESPOND_SPEC_ID)
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, versionId))
		const registry = await db.select().from(schema.pipelineDefinitionRegistry)
		const rowOf = (n: any) =>
			registry.find(
				(r) => r.definitionId === n.definitionId && r.version === n.definitionVersion
			)!
		const optional = (nodes as any[]).filter((n) => rowOf(n).optional)
		expect(optional.length, "no optional node in the reply spec").toBeGreaterThan(0)
		const enabled = decls.filter((d) => d.slot === "settings" && d.path === "enabled")
		expect(enabled.map((d) => d.nodeKey).sort()).toEqual(
			optional.map((n) => n.nodeKey).sort()
		)
		for (const d of enabled) {
			// Read from the row (F6): the slot is on it, and the option is it.
			const row = rowOf((nodes as any[]).find((n) => n.nodeKey === d.nodeKey))
			expect((row.slots as any).settings?.schema?.enabled?.type).toBe("boolean")
			expect(d).toMatchObject({
				matrixSlot: "settings",
				facet: "settings",
				quick: true,
				control: "boolean",
				authorDefault: true,
				// A source reads as one; a model call (the embed steps) as a step.
				label: row.kind === "query" ? "Use this source" : "Run this step"
			})
		}
	})

	it("offers `review` on every gated node, at the declaration's own default", async () => {
		const { versionId, decls } = await declsOf(CHAT_RESPOND_SPEC_ID)
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, versionId))
		const registry = await db.select().from(schema.pipelineDefinitionRegistry)
		const gated = (nodes as any[]).filter((n) => {
			const r = registry.find(
				(r) => r.definitionId === n.definitionId && r.version === n.definitionVersion
			)!
			return r.effects === "write" || r.effects === "external"
		})
		expect(gated.length).toBeGreaterThan(0)
		const review = decls.filter((d) => d.slot === "settings" && d.path === "review")
		expect(review.map((d) => d.nodeKey).sort()).toEqual(gated.map((n) => n.nodeKey).sort())
		for (const d of review)
			expect(d).toMatchObject({
				matrixSlot: "settings",
				// Its own heading, beside the switch's — the field's facet.
				facet: "review",
				control: "enum",
				of: ["off", "on"],
				label: "Review"
			})
		// The reply's two message writes default off (R-21 (3)); the
		// hand-written control said `off` for every node, which was wrong for
		// any author defaulting review on — pinned on the SDK side against
		// `attach-image`, and here that the panel reads the default at all.
		expect(review.find((d) => d.nodeKey === "save")?.authorDefault).toBe("off")
		expect(review.find((d) => d.nodeKey === "placeholder")?.authorDefault).toBe("off")
	})

	it("offers `mode` on every gather clause, declared by the SDK from the clause's own row", async () => {
		const { versionId, decls } = await declsOf(CHAT_RESPOND_SPEC_ID)
		const clauses = await db
			.select()
			.from(schema.pipelineClauses)
			.where(eq(schema.pipelineClauses.specVersionId, versionId))
		const gathers = (clauses as any[]).filter((c) => c.kind === "gather")
		expect(gathers.length).toBeGreaterThan(0)
		const modes = decls.filter((d) => d.slot === "settings" && d.path === "mode")
		expect(modes.map((d) => d.nodeKey).sort()).toEqual(
			gathers.map((c) => c.clauseId).sort()
		)
		for (const d of modes) {
			const clause = gathers.find((c) => c.clauseId === d.nodeKey)!
			expect(d).toMatchObject({
				matrixSlot: "settings",
				facet: "settings",
				nodeKind: "clause",
				control: "enum",
				of: ["parallel", "sequential"],
				authorDefault: clause.mode ?? "parallel",
				label: "Run"
			})
		}
		// The other three constructs carry none.
		const others = (clauses as any[]).filter((c) => c.kind !== "gather")
		for (const c of others)
			expect(decls.some((d) => d.nodeKey === c.clauseId)).toBe(false)
	})

	it("has no settings option the declarations did not produce", async () => {
		// The rule the three special cases broke: a settings option exists
		// because a row or the SDK declared it, never because the panel knew
		// about a node. Every `settings` decl is one of the three declared
		// paths, and each path's set was matched exactly above.
		const { decls } = await declsOf(CHAT_RESPOND_SPEC_ID)
		const paths = new Set(
			decls.filter((d) => d.slot === "settings").map((d) => d.path)
		)
		expect([...paths].sort()).toEqual(["enabled", "mode", "review"])
	})

	it("keeps the addresses a stored value was written at", async () => {
		// A pre-existing `settings.review = on` row is exactly as valid after
		// the slot became a declaration as before: the address is declared,
		// so the reconciler keeps it, and it is a deviation from the author's
		// `off`, so the sweep keeps it too. `reviewGate.int.test.ts` proves
		// the same row still parks a run.
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/summarize"
		)
		const { reconcileConfigs } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, SUMMARIZE_WORLD_SPEC_ID))
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec!.id, name: "gated summaries" })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: config!.id,
			nodeKey: "save",
			slot: "settings",
			path: "review",
			value: "on"
		})
		const reports = await reconcileConfigs(
			db,
			spec!.id,
			spec!.activeVersionId!,
			SUMMARIZE_WORLD_SPEC_ID
		)
		const mine = reports.find((r) => r.configId === config!.id)!
		expect(mine.culled).toEqual([])
		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config!.id))
		expect(
			rows.filter((r) => r.nodeKey === "save" && r.slot === "settings" && r.path === "review")
		).toHaveLength(1)
		expect(rows.find((r) => r.slot === "settings")?.value).toBe("on")
		// And the panel resolves it at the address it was written at.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decls = await declarations(db, spec!.activeVersionId!)
		expect(
			decls.find((d) => d.nodeKey === "save" && d.slot === "settings" && d.path === "review")
		).toMatchObject({ facet: "review", authorDefault: "off" })
	})

	it("lists what an interior script point accepts, from the point", async () => {
		// R-11: `summarize-batch`'s `each-draft` says text/transform itself;
		// the option carries the point's list, not a kind the panel assumed.
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/summarize"
		)
		const { decls } = await declsOf(SUMMARIZE_WORLD_SPEC_ID)
		const point = decls.find(
			(d) => d.slot === "scripts" && d.path === "each-draft"
		)
		expect(point, "the drafting step's interior point").toBeTruthy()
		expect(point).toMatchObject({
			nodeKey: "drafting.item.draft",
			control: "scripts-chain",
			facet: "scripts",
			label: "Each draft",
			accepts: ["core:script:text/transform@1"]
		})
		// The registry row is where it came from, in the full shape.
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				eq(schema.pipelineDefinitionRegistry.definitionId, "core:oracle/summarize-batch")
			)
		expect((row!.scriptPoints as any[])[0]).toMatchObject({
			key: "each-draft",
			accepts: ["core:script:text/transform@1"]
		})
	})
})

describe("options arrive in the order they were declared", () => {
	it("follows the parameter schema's own order within a slot", async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView

		// By node id, not the step's rendered label: `gather.relationships.read`
		// (a query, not this task) renders as "Relationships: ranked" and a
		// label regex matched it first. `declarations()` names the rank-hybrid
		// node's own key ("rank"), and `optionId` is the same address-to-id
		// mapping `read.ts` used to mint every option's id, so the ids computed
		// here from that nodeKey are exactly the ones on its step's options.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const rankOptionIds = new Set(
			(await declarations(db, spec.activeVersionId!))
				.filter((d: any) => d.nodeKey === "rank")
				.map((d: any) => optionId(SECRET, d.nodeKey, d.slot, d.path))
		)
		expect(
			rankOptionIds.size,
			"no declarations on the rank node"
		).toBeGreaterThan(0)
		const rank = groupSteps(v.groups).find((s) =>
			s.options.some((o) => rankOptionIds.has(o.id))
		)
		expect(rank, "no ranking step").toBeTruthy()
		expect(rank!.options.map((o) => o.label)).toEqual([
			// ⚠ "Context split", "Most entries per source" and "Always keep at
			// least" led this list until 2026-09-16 and are gone from the
			// ranker (R-7 P5): each source declares its own share, ceiling and
			// floor now — "Share — world lore" on the world-lore lane, and so
			// on — and the ranker keeps only what is cross-source. See "each
			// source carries its own intent" above.
			// The three grouped mechanism strengths (migration 0201), declared
			// **ahead** of the nine and rendering there — the altitude a reader
			// starts at, with the individual signals under them for anyone who
			// wants that far in. Its own control type, not a share: raising one
			// takes nothing from the others.
			"How entries are found",
			// The signal-weight matrix (migration 0146), in the transposed
			// declaration's own order — per-source rows, advanced only. Ten
			// since 0199 added `signalProximity`, which is declared between
			// density and priority and therefore renders there; eleven since
			// 0201 added `signalSemantic`, declared beside the entity signal it
			// sits with in the "how entries are found" grouping; twelve since
			// 0202 added `signalEntityVector`, declared after it and in the
			// same grouping.
			"Keyword match",
			"Name mentioned",
			"Shared entities",
			"Similar meaning",
			"Called by a description",
			"Distinctive words",
			"Recently referenced",
			// ⚠ `Recency` and `Same scene` were declared between these two and
			// are gone (migration 0099): nothing produced either signal, so
			// both were controls a reader could move at any value without
			// changing a prompt. `Information density` survives under a
			// truthful label — the number is length against the pool mean, not
			// how much an entry says per token — because the scan produces it
			// now, as it already produced `proximity`.
			"Length against the pool",
			"Keywords close together",
			"Author priority",
			// How the sources' shares divide the window (R-7 P5) — the one
			// thing about shares that is the ranker's — then the allocation
			// switch (`scoreLedAllocation`, from the pre-squash migration 0196 —
			// archived, superseded by the 0094 baseline), declared last and
			// rendered last.
			"How shares divide the window",
			"Let the best entries lead",
			// The hook's chain, which `declarations()` appends after the
			// node's own slots.
			"Scripts"
		])
	})

	it("follows the descriptor's slot order within a node", async () => {
		// Assemble declares `template`, then `variables`, then `params` — and
		// alphabetically that is params, template, variables, which would put
		// "Post History Depth" first and the context template third. So this is
		// the assertion that notices a tidy-minded `.sort()` in the slot walk.
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		const asm = groupSteps(v.groups).find((s) => /assemble/i.test(s.heading))
		expect(asm, "no assembly step").toBeTruthy()
		const labels = asm!.options.map((o) => o.label)
		expect(labels[0], "the template slot is declared first").toBe(
			"Template"
		)
		// Then the layouts, then the tuning numbers — slot by slot, in order.
		expect(labels.indexOf("World lore")).toBeLessThan(
			labels.indexOf("Post History Depth")
		)
	})

	it("follows node position across steps", async () => {
		const v = (await namespaceView(db, SECRET, CHAT_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView
		// The order the machine runs in: each Advanced lists its steps so.
		const labels = v.groups.flatMap((g) => g.advanced.map((s) => s.heading))
		expect(labels.indexOf("Context budget")).toBeLessThan(
			labels.indexOf("Rank hybrid")
		)
		expect(labels.indexOf("Rank hybrid")).toBeLessThan(
			labels.indexOf("Assemble")
		)
	})
})

/**
 * A clause's settings sit at the spine position of its first member, and an
 * envoy's instructions are the prompt of the call that reads them — never a
 * detached step of their own (owner rulings 2026-09-30).
 *
 * `guide-respond` is the one shipped spec with both in one document: a
 * `gather` clause (`history`/`cast`/`docs`, run in parallel) and a reference
 * to the guide genre's one envoy, `mascot`, on `context`'s `prompts` slot.
 */
describe("a clause's step sits at its spine position; an envoy's prompt is a front row", () => {
	it("guide-respond: the gather clause precedes its first member; the envoy's texts are on the front", async () => {
		const { GUIDE_RESPOND_SPEC_ID } = await import(
			"@serene-pub/core-catalog"
		)
		const v = (await namespaceView(db, SECRET, GUIDE_RESPOND_SPEC_ID, {
			userId: 1,
			isAdmin: true
		})) as NamespaceView

		const labels = v.groups.flatMap((g) => g.advanced.map((s) => s.heading))
		const gatherAt = labels.findIndex((l) => /gather/i.test(l))
		const historyAt = labels.findIndex((l) => /session history/i.test(l))
		expect(gatherAt, labels.join(", ")).toBeGreaterThanOrEqual(0)
		expect(historyAt, labels.join(", ")).toBeGreaterThanOrEqual(0)
		// At its spine position — right before the block it governs — not
		// appended after every node in the document (`save` included).
		expect(gatherAt).toBeLessThan(historyAt)
		expect(gatherAt).toBeLessThan(labels.length - 1)

		// The envoy is no step and no group of its own…
		const headings = [
			...v.groups.map((g) => g.heading ?? ""),
			...labels
		]
		expect(headings.some((h) => /envoy/i.test(h))).toBe(false)
		// …its texts are the prompt on a group's front.
		expect(
			v.groups.some((g) => g.front.some((o) => o.control === "text"))
		).toBe(true)
	})
})
