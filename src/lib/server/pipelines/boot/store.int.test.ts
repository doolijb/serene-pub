/**
 * C1 against real rows: `import(export(rows))` is the identity and the hash is
 * stable.
 *
 * The SDK asserts this over in-memory documents already. This file asserts it
 * over the column mapping, which is where it actually breaks — a dropped
 * `clauseChain`, a preset value that comes back as a string, an edge whose port
 * survived but whose shape did not. None of those fail a unit test and all of
 * them make an exported pipeline behave differently on the far side.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import {
	spec,
	slot,
	canonicalHash,
	compile,
	sessionEvents,
	type SpecDocument
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

const sessionTurn = () =>
	compile(
		spec("core:spec/session-turn", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.task("prompt", ($) =>
				C.assemble.v2({ candidates: $.history.messages })
			)
			.oracle("generate", ($) =>
				C.generateText.v1({
					context: $.prompt.context,
					connection: slot.connection()
				})
			)
			.outlet("save", ($) =>
				C.createMessage.v1({ text: $.generate.text })
			)
			.preset("balanced", { label: "Balanced", default: true }, (p) =>
				p.params("history", { limit: 40 })
			)
			.build()
	)

/** Exercises the parts the simple chain does not: nesting, a bounded loop, a map. */
const agentic = () =>
	compile(
		spec("core:spec/agentic", { version: "0.2.0" })
			.inlet("input", C.userMessage.v1())
			.gather("gather", { mode: "parallel" }, (b) =>
				b
					.chain("semantic", (c) =>
						c
							.oracle("embed", ($) =>
								C.embedText.v1({
									text: $.input.text,
									connection: slot.connection()
								})
							)
							.query("vsearch", ($) =>
								C.vectorSearch.v1({
									vector: $.gather.semantic.embed.vector
								})
							)
					)
					.chain("keyword", (c) =>
						c.query("lore", ($) =>
							C.lorebookTriggers.v1({ text: $.input.text })
						)
					)
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("pipeline store", () => {
	it("round-trips a session turn without changing its hash (C1)", async () => {
		const doc = sessionTurn()
		const before = canonicalHash(doc)

		const saved = await saveDocument(db, doc, { publish: true })
		const back = await loadDocument(db, saved.specVersionId)

		expect(canonicalHash(back)).toBe(before)
		expect(back).toEqual(doc)
	})

	it("round-trips a node's expose mark and swaps, so a reader finds them off the registry (R28)", async () => {
		const { TURN_ORDER_BY_GENRE, CHAT_TURN_ORDER_SPEC_ID } = await import("@serene-pub/core-catalog")
		const doc = TURN_ORDER_BY_GENRE.find((t) => t.spec === CHAT_TURN_ORDER_SPEC_ID)!.build()
		const saved = await saveDocument(db, { ...doc, id: "test:spec/expose-round-trip" }, { publish: true })
		const back = await loadDocument(db, saved.specVersionId)
		const strategy = back.nodes.find((n) => n.key === "decide.rules.strategy")!
		expect(strategy.expose?.session).toBe(true)
		expect(strategy.expose?.swaps).toContain("core:task/turn-manual@1")
		expect(back.nodes.find((n) => n.key === "history")!.expose).toBeUndefined()
		// The lock over several events reads back too (it was written but
		// not read before M2).
		expect(back.input).toEqual(doc.input)
		expect(canonicalHash(back)).toBe(canonicalHash({ ...doc, id: "test:spec/expose-round-trip" }))
	})

	it("round-trips nested blocks, which is where the mapping actually breaks", async () => {
		const doc = agentic()
		const saved = await saveDocument(db, doc)
		const back = await loadDocument(db, saved.specVersionId)

		expect(canonicalHash(back)).toBe(canonicalHash(doc))
		// Named explicitly because losing either is silent: the block's members
		// still run, they just stop being attributable to their chain.
		expect(
			back.nodes.find((n) => n.key === "gather.semantic.embed")
				?.clauseChain
		).toBe("semantic")
		expect(back.clauses[0]?.chains).toEqual(["semantic", "keyword"])
	})

	it("stores presets as rows and returns them intact (F4)", async () => {
		const doc = sessionTurn()
		const saved = await saveDocument(db, doc)
		const back = await loadDocument(db, saved.specVersionId)

		expect(back.presets[0]?.slug).toBe("balanced")
		expect(back.presets[0]?.default).toBe(true)
		// The value came back a number, not "40". A preset that round-trips its
		// types loosely is a pipeline that behaves differently after an export.
		expect(back.presets[0]?.values[0]?.value).toEqual({ limit: 40 })
	})

	it("re-saving a semver replaces that version rather than duplicating it", async () => {
		const doc = sessionTurn()
		const first = await saveDocument(db, doc)
		const second = await saveDocument(db, doc)

		expect(second.specId).toBe(first.specId)
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.specId, first.specId))
		expect(versions.filter((v) => v.semver === "1.0.0")).toHaveLength(1)
	})

	it("the database refuses a sixth kind (F1)", async () => {
		const doc = sessionTurn()
		const saved = await saveDocument(db, doc)
		await expect(
			db.insert(schema.pipelineNodes).values({
				specVersionId: saved.specVersionId,
				nodeKey: "rogue",
				kind: "agent",
				definitionId: "demo:agent/rogue",
				definitionVersion: 1,
				config: {},
				position: 99
			})
		).rejects.toThrow()
	})

	it("the database refuses an unbounded repeat (F9)", async () => {
		const doc = sessionTurn()
		const saved = await saveDocument(db, doc)
		await expect(
			db.insert(schema.pipelineClauses).values({
				specVersionId: saved.specVersionId,
				clauseId: "forever",
				kind: "loop",
				max: null,
				position: 0
			})
		).rejects.toThrow()
	})

	it("an edge to a node the version does not contain is refused before it is written", async () => {
		const doc = sessionTurn()
		doc.edges.push({
			from: "generate",
			fromPort: "text",
			to: "nowhere",
			toPort: "text"
		})
		await expect(saveDocument(db, doc)).rejects.toThrow(
			/references a node this version does not contain/
		)
	})
})

/**
 * An async block is configurable, and the control comes from the SDK.
 *
 * Whether chains run together is the author's default and the administrator's
 * decision — the same precedence `review` uses, and for the same reason: the
 * person who knows the provider is rate-limited is not the person who wrote the
 * spec. No core pipeline declares an async block yet, so without a synthetic
 * one this whole path would ship unexercised.
 */
describe("an async block offers its mode", () => {
	// Published here rather than leaning on another test having run: the
	// agentic fixture is saved inside one, and a suite whose setup is another
	// suite's side effect passes or fails on ordering.
	let versionId: number
	beforeAll(async () => {
		const saved = await saveDocument(db, agentic(), {
			publish: true
		})
		versionId = saved.specVersionId
	})

	it("declares one option per async block, addressed by the block's id", async () => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { CLAUSE_MODE_DECL } = await import("@serene-pub/sdk")

		const decls = await declarations(db, versionId)

		const mode = decls.find(
			(d) => d.nodeKey === "gather" && d.path === "mode"
		)
		expect(mode, "the async block declared no mode option").toBeTruthy()
		expect(mode!.control).toBe("enum")
		expect(mode!.of).toEqual(CLAUSE_MODE_DECL.of)
		// The author's declaration is the default the panel shows as inherited.
		expect(mode!.authorDefault).toBe("parallel")
		// Addressed by block id, which is what `resolveConfig` is handed — a
		// value written anywhere else never reaches the executor.
		expect(mode!.slot).toBe("settings")
	})

	it("offers nothing for a map block", async () => {
		// A map's mode is a property of what it iterates, not a choice about
		// concurrency — a control whose effect nobody could predict from its
		// label is worse than no control.
		//
		// Its own spec, because the agentic fixture declares only an async
		// block: iterating its blocks and skipping the async one left nothing
		// to assert, and the test passed while a mutation that offered a mode
		// on *every* block sailed through it.
		const mapped = compile(
			spec("core:spec/mapped", { version: "0.1.0" })
				.inlet("input", C.userMessage.v1())
				.query("history", ($) =>
					C.sessionHistory.v1({ scope: $.input.sessionScope })
				)
				.each(
					"each",
					{ over: ($: any) => $.history.messages, max: 4 },
					(m) =>
						m
							// A context the oracle's port accepts: the save
							// validates since the U5d review (W9), and text
							// wired into a context port is the mistake 01 §3
							// exists to catch.
							.task("prompt", ($: any) =>
								C.assemble.v2({ messages: $.history.messages })
							)
							.oracle("draft", ($: any) =>
								C.generateText.v1({
									context: $.each.item.prompt.context,
									connection: slot.connection()
								})
							)
				)
				.build()
		)
		const saved = await saveDocument(db, mapped, { publish: true })

		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decls = await declarations(db, saved.specVersionId)
		const blocks = (await db
			.select()
			.from(schema.pipelineClauses)
			.where(
				eq(schema.pipelineClauses.specVersionId, saved.specVersionId)
			)) as any[]

		const nonAsync = blocks.filter((b) => b.kind !== "gather")
		expect(
			nonAsync.length,
			"nothing to test against — the fixture declares no each clause"
		).toBeGreaterThan(0)
		for (const b of nonAsync)
			expect(
				decls.some((d) => d.nodeKey === b.clauseId && d.path === "mode"),
				`${b.kind} block '${b.clauseId}' offered a mode`
			).toBe(false)
	})
})

/**
 * The envoys a document declares, checked where it lands as rows (U5g
 * review, W4 and S5). The SDK checks a genre at `genre()` and a reference at
 * `compile()`, against its own registry; a plugin's genre never passes
 * through either, so the host re-runs the same findings at `saveDocument`
 * and refuses a second spec of one namespace claiming an action envoy's key
 * at the pointer move. ⏳ Only the core catalog reaches `saveDocument`
 * today; these documents are built by hand, as a plugin's would arrive.
 */
describe("envoys are checked where a document lands (U5g review, W4, S5)", () => {
	const GENRE = "acme:genre/lodge"
	let n = 0
	/** A compiled chain re-addressed as a plugin's spec, with the fields set by hand. */
	const docOf = (
		id: string,
		patch: Partial<SpecDocument> & Record<string, unknown>
	): SpecDocument => {
		const doc = sessionTurn()
		return { ...doc, id, version: `1.0.${n++}`, ...patch } as SpecDocument
	}
	const createDoc = (envoys: unknown[] | undefined, id = "acme:spec/create-lodge") =>
		docOf(id, {
			genre: {
				name: { en: "Lodge" },
				family: "chat",
				shape: { characters: { min: 0, max: 0 } },
				...(envoys ? { envoys } : {})
			},
			input: { genre: GENRE, event: sessionEvents.sessionCreated }
		})
	const respondDoc = (envoyKey: string, id = "acme:spec/lodge-respond") => {
		const doc = docOf(id, {
			input: { genre: GENRE, event: sessionEvents.messageRespond }
		})
		const prompt = doc.nodes.find((x) => x.key === "prompt")!
		prompt.resolvedRefs = { ...(prompt.resolvedRefs ?? {}), prompts: `envoy:${envoyKey}` }
		return doc
	}
	const actionDoc = (id: string, actions: unknown[]) =>
		docOf(id, { contributes: { actions } })
	const action = (key: string, envoyKey: string, extra: Record<string, unknown> = {}) => ({
		key,
		function: key,
		genre: GENRE,
		venue: { kind: "composer" },
		label: { en: key },
		description: { en: "A test action." },
		envoy: { key: envoyKey, name: { en: envoyKey }, ...extra }
	})

	it("a genre's envoys are refused with the SDK's sentences: two defaults, a bad image, a dotted key", async () => {
		await expect(
			saveDocument(db, createDoc([
				{ key: "keeper", name: { en: "Keeper" }, default: true },
				{ key: "porter", name: { en: "Porter" }, default: true }
			]))
		).rejects.toThrow(/2 envoys are 'default: true'/)
		await expect(
			saveDocument(db, createDoc([
				{ key: "keeper", name: { en: "Keeper" }, image: "javascript:alert(1)" }
			]))
		).rejects.toThrow(/'image' is an http\(s\):\/\/ URL or a data:image/)
		await expect(
			saveDocument(db, createDoc([{ key: "has.dot", name: { en: "Dotted" } }]))
		).rejects.toThrow(/lowercase kebab/)
		// Nothing landed: no row for the slug.
		expect(
			(
				await db
					.select()
					.from(schema.pipelineSpecs)
					.where(eq(schema.pipelineSpecs.slug, "acme:spec/create-lodge"))
			).length
		).toBe(0)
	})

	it("an action's envoy is on-action only, and its declaration is checked like a genre's", async () => {
		await expect(
			saveDocument(db, actionDoc("acme:spec/dice", [action("roll", "master", { speaks: "in-turn" })]))
		).rejects.toThrow(/speaks 'on-action' only/)
		// A bare string is `en` (R-20, ruled 2026-09-17); a map without one is refused.
		await expect(
			saveDocument(db, actionDoc("acme:spec/dice", [action("roll", "master", { name: { fr: "Maître" } })]))
		).rejects.toThrow(/required 'en'/)
		expect(
			(await saveDocument(db, actionDoc("acme:spec/dice-bare", [action("roll", "bare", { name: "Master" })])))
				.written
		).toBe(true)
	})

	it("a blank envoy name or genre name is refused under R-20 with the sentence, in the genre and on an action (U5i)", async () => {
		await expect(
			saveDocument(db, createDoc([{ key: "keeper", name: "   " }]))
		).rejects.toThrow(/\[R-20\].*genre\.envoys\[keeper\]\.name is empty/)
		await expect(
			saveDocument(db, docOf("acme:spec/create-blank", {
				genre: { name: { fr: "Loge" }, family: "chat" },
				input: { genre: GENRE, event: sessionEvents.sessionCreated }
			}))
		).rejects.toThrow(/\[R-20\].*genre\.name: a locale map with a required 'en'/)
	})

	it("a reference to an envoy the published genre does not declare is refused; a declared one, or an unknown genre, or a batch-mate's, is not", async () => {
		// Before the genre is published nothing can be judged: saved.
		const early = await saveDocument(db, respondDoc("keeper", "acme:spec/lodge-early"), {
			publish: true
		})
		expect(early.written).toBe(true)
		// The genre, declaring one envoy.
		await saveDocument(db, createDoc([{ key: "keeper", name: { en: "Keeper" }, default: true }]), {
			publish: true
		})
		await expect(saveDocument(db, respondDoc("nobody"))).rejects.toThrow(
			/reads the prompts of envoy 'nobody', which 'acme:genre\/lodge' does not declare — it declares 'keeper'/
		)
		const ok = await saveDocument(db, respondDoc("keeper"), { publish: true })
		expect(ok.written).toBe(true)
		// A batch republishing the create spec: its published declaration is
		// the old one, so the reference is not judged against it.
		const batched = await saveDocument(db, respondDoc("porter", "acme:spec/lodge-batched"), {
			batch: new Set(["acme:spec/create-lodge"])
		})
		expect(batched.written).toBe(true)
		// The create spec itself may reference its own declaration.
		const own = createDoc([{ key: "keeper", name: { en: "Keeper" }, default: true }], "acme:spec/create-lodge-self")
		own.nodes.find((x) => x.key === "prompt")!.resolvedRefs = { prompts: "envoy:keeper" }
		expect((await saveDocument(db, own)).written).toBe(true)
		const ownBad = createDoc([{ key: "keeper", name: { en: "Keeper" } }], "acme:spec/create-lodge-self-bad")
		ownBad.nodes.find((x) => x.key === "prompt")!.resolvedRefs = { prompts: "envoy:porter" }
		await expect(saveDocument(db, ownBad)).rejects.toThrow(/envoy 'porter'/)
	})

	it("two specs of one namespace claiming one action-envoy key are refused at publish; one spec's two actions, or another namespace, are not", async () => {
		const dice = await saveDocument(
			db,
			actionDoc("acme:spec/dice", [action("roll", "master"), action("reroll", "master")]),
			{ publish: true }
		)
		expect(dice.written).toBe(true)
		await expect(
			saveDocument(db, actionDoc("acme:spec/cards", [action("draw", "master")]), {
				publish: true
			})
		).rejects.toThrow(
			/the action envoy 'acme.master' is declared by both 'acme:spec\/dice' and 'acme:spec\/cards'/
		)
		// A draft is not a claim: saved, not published.
		expect(
			(await saveDocument(db, actionDoc("acme:spec/cards", [action("draw", "master")]))).written
		).toBe(true)
		// Another namespace's `master` is `beta.master` — no collision.
		expect(
			(
				await saveDocument(db, actionDoc("beta:spec/cards", [action("draw", "master")]), {
					publish: true
				})
			).written
		).toBe(true)
		// The install-wide check after a batch sees the same rule.
		const { assertInstallSlashNamesFree } = await import(
			"$lib/server/pipelines/boot/store"
		)
		await expect(assertInstallSlashNamesFree(db)).resolves.toBeUndefined()
	})

	it("a node key with a colon is refused with the builder's sentence, even in a raw document (raw documents bypass the builder)", async () => {
		const doc = createDoc(
			[{ key: "keeper", name: { en: "Keeper" }, default: true }],
			"acme:spec/bad-node-key"
		)
		doc.nodes.find((n) => n.key === "prompt")!.key = "envoy:prompt"
		await expect(saveDocument(db, doc)).rejects.toThrow(
			/node key 'envoy:prompt' contains ':' — a colon marks a synthetic config address/
		)
	})

	it("a create spec that reads an envoy without declaring any is refused immediately, not skipped as unpublished", async () => {
		const doc = createDoc(undefined, "acme:spec/create-lodge-none")
		doc.nodes.find((x) => x.key === "prompt")!.resolvedRefs = { prompts: "envoy:keeper" }
		await expect(saveDocument(db, doc)).rejects.toThrow(
			/reads the prompts of envoy 'keeper', which 'acme:genre\/lodge' does not declare — it declares no envoys/
		)
	})
})

/**
 * The Fixed Ledger's static laws run at the publish (U5d review, W9).
 *
 * `validate()` had run for an author — the builder, the conformance suite —
 * and never for the document an instance stores: thirteen shipped specs
 * carried a 01 §3 finding for a release because `session-history@1` declared
 * candidates and published rows, and no door said so. Now every save asks,
 * an `error` refuses, and the catalog itself is clean.
 */
describe("saveDocument runs validate() (U5d review, W9)", () => {
	it("every shipped spec validates with zero errors, and the seed publishes them all", async () => {
		const { validate } = await import("@serene-pub/sdk")
		const { CORE_SPECS } = await import("$lib/server/pipelines/specs")
		const errors: string[] = []
		for (const s of CORE_SPECS) {
			const doc = s.build()
			for (const f of validate(doc).filter((x) => x.severity === "error"))
				errors.push(`${doc.id} · [${f.law}] ${f.nodeKey ?? ""}: ${f.message}`)
		}
		expect(errors).toEqual([])
		// A world-in-widget forgery is what the line refuses; a shape
		// forgery is what the laws refuse — both at the same door.
		const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
		await expect(bootstrapPipelines(db as any)).resolves.toBeDefined()
	}, 120_000)

	// A widget venue since 2026-09-28: a message's own ⋮ is the owner's side of
	// the line (lair re-plan R11, File as a room).
	it("a forged document — a world action in a widget venue — is refused at saveDocument by validate()", async () => {
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const doc = compile(
			spec("core:spec/test-forged-world", {
				version: "1.0.0",
				taxonomy: { role: "action"},
				contributes: {
					actions: [
						{
							key: "grant",
							venue: { kind: "composer" },
							label: { en: "Grant" },
							description: { en: "A test action." }
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: sessionEvents.sessionAction
				})
				.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
				.build()
		)
		// Patched after the builder saw it — an import, a hand-written JSON.
		const [action] = (doc.contributes as any).actions
		const forged: SpecDocument = {
			...doc,
			contributes: {
				actions: [{ ...action, effects: "world", venue: [{ kind: "widget" }] }]
			}
		}
		// Labelled with the line's own law, F41 (U7 review, W3) — the sentence
		// still cites R-15, where the line is ruled.
		await expect(saveDocument(db, forged, { publish: true })).rejects.toThrow(
			/does not validate — \[F41\].*'world' action may not appear in the 'widget' venue/
		)
	})

	it("a document whose preset label is blank is refused at saveDocument under R-20, with the fix (U5i)", async () => {
		const doc = sessionTurn()
		const forged: SpecDocument = {
			...doc,
			id: "core:spec/test-blank-preset-label",
			presets: [{ ...doc.presets[0]!, label: "" }]
		}
		await expect(saveDocument(db, forged, { publish: true })).rejects.toThrow(
			/does not validate — \[R-20\] presets\[balanced\]\.label is empty — give it text a person reads, 'Title' or \{ en: 'Title' \} \(R-20\) \(write display text/
		)
	})

	it("a shape forgery — text wired into a port that takes an assembled context — is refused at saveDocument; a warning is not", async () => {
		const doc = compile(
			spec("core:spec/test-forged-shape", { version: "1.0.0" })
				.inlet("input", C.userMessage.v1())
				.oracle("generate", ($: any) =>
					C.generateText.v1({ context: $.input.text, connection: slot.connection() })
				)
				.outlet("save", ($) => C.createMessage.v1({ text: $.generate.text }))
				.build()
		)
		await expect(saveDocument(db, doc)).rejects.toThrow(
			/does not validate — \[01 §3\] generate: 'input\.text' produces core:shape\/text@1; 'generate\.context' needs core:shape\/assembled-context@1/
		)
		// The same document with the mistake fixed saves — and `sessionTurn`
		// above, whose transcript feeds a candidates port, still does: a
		// transcript may be offered as candidates (messages@1 → candidates).
		expect((await saveDocument(db, sessionTurn())).specVersionId).toBeGreaterThan(0)
	})
})
