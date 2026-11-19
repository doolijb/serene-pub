/**
 * 🚧 The three recipes of the SDK guide, *Noting that a character came to know an
 * entry* (`guides/genres-presets-and-routines.md`), run as written through the
 * app's real runtime (`runSpec`, a published spec, the real bindings and host,
 * the script applier with the guide's script bodies as stored scripts), and each
 * shown to do its job: with an entry marked not common knowledge, Mira's
 * `knownToSpeaker` read leaves it out before the recipe and returns it after.
 * Only the model is faked (recipe 3's judge).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { compile, spec, slot, ITEM, coreEvents, defineAttributeSheet } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { insertCastMember } from "$lib/server/characters/versions"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { loadEntryKnowledge, setEntryCommonKnowledge } from "$lib/server/lorebooks/entryKnowledge"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "note-entry-knowledge-recipes" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** What the judge answers; a test sets it to the ids it wants "revealed". */
const judge = vi.hoisted(() => ({ answer: "{}", asked: 0 }))
class FakeAdapter {
	injected: unknown
	constructor(_p: unknown) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: unknown) {
		this.injected = p
		return this
	}
	async generateText() {
		judge.asked++
		return {
			compiledPrompt: this.injected ?? { prompt: undefined, messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(judge.answer)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db

const LOCATION_SLOT = "core:slot/location@1"
/** A genre that keeps the location on the world and on each cast member (recipe 2 reads the world's). */
const WALKERS = "test:genre/note-entry-knowledge-walkers"
genreKeeping(WALKERS, {
	name: { en: "Walkers" },
	family: "test",
	sheets: [
		defineAttributeSheet("test:sheet/note-entry-knowledge-walkers@1", {
			label: { en: "Walkers" },
			slots: [{ id: LOCATION_SLOT, appliesTo: ["world", "cast"] }]
		})
	],
	events: {}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-note-entry-knowledge-recipes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(asDb())
	// The judge's connection: the instance default for text, with a fake adapter behind it.
	const [conn] = await db.insert(schema.connections).values({ name: "Fake", type: "openai", baseUrl: "http://x/v1" }).returning()
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Recipes sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as never)
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const model = await ensureConnectionModel(asDb(), conn!.id, "fake-7b")
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(asDb(), "text->text", {
		connectionId: conn!.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

/** The guide's script bodies, stored as the app stores a **Transform data** script. */
async function storeScript(name: string, source: string): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: "core:script:data/transform@1",
			name: `${name} ${++n}`,
			enabled: true,
			source,
			varsIn: ["value"],
			varsOut: ["value"]
		})
		.returning()
	return row!.id
}

// --- guide: genres-presets-and-routines.md, "Noting that a character came to know an entry" -------------

/** `members` takes: (guide, recipe 1 and 3) */
const MEMBERS_SCRIPT = `return (value.sessionCharacters ?? []).filter((s) => s.enabled && !s.removedAt && s.ref).map((s) => s.ref)`

/** `place` takes: (guide, recipe 2) */
const PLACE_SCRIPT = `return value?.world?.location ?? null`

/** `brief` takes: (guide, recipe 3) */
const BRIEF_SCRIPT = `const list = (value ?? []).map((e) => \`\${e.entryId}: \${e.name}\`).join('\\n')
return { brief: \`Which of these entries did the last lines reveal to the people there? Answer { "revealed": [ids] }: only what was said or shown.\\n\${list}\` }`

// Recipe 1, "Told in the scene" (the ts fence, verbatim).
const toldInTheScene = spec('my:spec/told-in-the-scene', { version: '1.0.0' })
	.inlet('input', C.routine.v1())
	.query('history', ($) =>
		C.sessionHistory.v1({ scope: $.input.sessionScope, params: slot.params() }),
	)
	.query('named', ($) =>
		C.entriesNamed.v1({
			scope: $.input.sessionScope,
			messages: $.history.messages,
			params: slot.params(),
		}),
	)
	.query('cast', ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))
	// a script step turns the cast into a list of member references
	.task('members', ($) => C.runScript.v1({ input: $.cast.main as any }))
	.each('who', { over: ($) => $.members.main, max: 12 }, (m) =>
		m
			.task('member', ($) =>
				C.joinText.v1({ items: [$[ITEM]] as any, params: slot.params() }),
			)
			.each('what', { over: ($) => $.named.ids, max: 8 }, (e) =>
				e.outlet('note', ($) =>
					C.noteEntryKnowledge.v1({
						member: $.who.item.member.text,
						entry: $[ITEM],
						params: slot.params(),
					}),
				),
			),
	)
	.defaults((d) =>
		d
			.params('who.item.member', { path: '', separator: '' })
			.params('who.item.what.item.note', { knowledgeKind: 'was_told' }),
	)

// Recipe 2, "Has been there" (the ts fence, verbatim).
const hasBeenThere = spec('my:spec/has-been-there', { version: '1.0.0' })
	.inlet('input', C.routine.v1(), { suits: [coreEvents.sceneClosed] })
	.query('state', ($) => C.sessionState.v1({ scope: $.input.sessionScope }))
	.query('cast', ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))
	// two script steps: the place's value off the state, and the cast as a list of member references
	.task('place', ($) => C.runScript.v1({ input: $.state.state as any }))
	.task('members', ($) => C.runScript.v1({ input: $.cast.main as any }))
	.each('who', { over: ($) => $.members.main, max: 12 }, (m) =>
		m.outlet('note', ($) =>
			C.noteEntryKnowledge.v1({
				member: $[ITEM],
				entry: $.place.main,
				params: slot.params(),
			}),
		),
	)
	.defaults((d) => d.params('who.item.note', { knowledgeKind: 'has_been_there' }))

// Recipe 3, "A model decides" (the ts fence, verbatim).
const toldWhatWasRevealed = spec('my:spec/told-what-was-revealed', { version: '1.0.0' })
	.inlet('input', C.routine.v1())
	.query('history', ($) =>
		C.sessionHistory.v1({ scope: $.input.sessionScope, params: slot.params() }),
	)
	.query('named', ($) =>
		C.entriesNamed.v1({
			scope: $.input.sessionScope,
			messages: $.history.messages,
			params: slot.params(),
		}),
	)
	.query('cast', ($) => C.sessionCast.v1({ scope: $.input.sessionScope }))
	// a script step writes the question as text: the named entries, "which did the reply reveal?"
	.task('brief', ($) => C.runScript.v1({ input: $.named.main as any }))
	.task('briefText', ($) =>
		C.joinText.v1({ items: [$.brief.main] as any, params: slot.params() }),
	)
	.task('context', ($) =>
		C.buildTemplateContext.v1({
			cast: $.cast.cast,
			turnDirection: $.briefText.text,
			prompts: slot.prompts(),
			variables: slot.variables(),
		}),
	)
	.task('prompt', ($) =>
		C.assemble.v2({
			messages: $.history.messages,
			templateContext: $.context.templateContext,
			template: slot.template(),
			connection: slot.connectionOf('judge'),
		}),
	)
	// the one model call: { revealed: [entry ids] }
	.oracle('judge', ($) =>
		C.generateJson.v1({
			context: $.prompt.context,
			schema: {
				type: 'object',
				properties: { revealed: { type: 'array', items: { type: 'integer' } } },
				required: ['revealed'],
			} as any,
			connection: slot.connection(),
			sampling: slot.sampling(),
			params: slot.params(),
		}),
	)
	.task('members', ($) => C.runScript.v1({ input: $.cast.main as any }))
	.each('who', { over: ($) => $.members.main, max: 12 }, (m) =>
		m
			.task('member', ($) =>
				C.joinText.v1({ items: [$[ITEM]] as any, params: slot.params() }),
			)
			.each('what', { over: ($) => $.judge.items, max: 8 }, (e) =>
				e.outlet('note', ($) =>
					C.noteEntryKnowledge.v1({
						member: $.who.item.member.text,
						entry: $[ITEM],
						params: slot.params(),
					}),
				),
			),
	)
	.defaults((d) =>
		d
			.params('briefText', { path: 'brief', separator: '' })
			.params('judge', { path: 'revealed' })
			.params('who.item.member', { path: '', separator: '' })
			.params('who.item.what.item.note', { knowledgeKind: 'was_told' }),
	)

// ---------------------------------------------------------------------------------------------------------

type Kind = "full" | "review"

/** A lorebook with Mira seated, two entries marked not common knowledge, and a session reading it. */
async function world(kind: Kind, genreId?: string) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `nekr-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: owner.id, loreWriteMode: kind })
	const [book] = await db.insert(schema.lorebooks).values({ userId: owner.id, name: `World ${suffix}` }).returning()
	// Under Full the session's first write forks its own line (a play tie is ended only on it).
	const [fork] =
		kind === "full"
			? await db.insert(schema.lorebookBranches).values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 }).returning()
			: []
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Mira", description: "…" } as never)
		.returning()
	const mira = (
		await insertCastMember(asDb(), {
			lorebookId: book!.id,
			binding: `{{char:Mira${suffix}}}`,
			characterId: card!.id,
			name: "Mira"
		})
	).member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			...(fork ? { lorebookBranchId: fork.id, lineOnFirstWrite: true } : {}),
			...(genreId ? { genreId } : {})
		} as never)
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: mira,
		position: 0,
		seatedByUserId: owner.id,
		isActive: true
	} as never)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(asDb(), session!.id)
	/** An entry marked not common knowledge: lore by default (what `entries-named@1` reads), or a place. */
	const entry = async (name: string, typeId: string = WORLD_LORE_TYPE_ID) => {
		const [row] = await db
			.insert(schema.lorebookEntries)
			.values(entryInsert({ typeId, lorebookId: book!.id, name, content: `About ${name}.`, position: ++n } as never))
			.returning()
		await setEntryCommonKnowledge(asDb(), { userId: owner.id, entryId: row!.id, notCommonKnowledge: true })
		return row!.id
	}
	const say = async (content: string) => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content })
			.returning()
		await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const ties = (lorebookId: number) =>
		db
			.select()
			.from(schema.narrativeRelationships)
			.where(and(eq(schema.narrativeRelationships.lorebookId, lorebookId), eq(schema.narrativeRelationships.fromNodeId, mira)))
			.orderBy(schema.narrativeRelationships.id)
	/** Where the recipe's ties land: the lorebook under Full, the session's notes under Review changes. */
	const home = () => ties(kind === "full" ? book!.id : own.id)
	/** Mira's `knownToSpeaker` lore read (the entries-named query through the real bindings and host). */
	const loreRead = async (read: "named" | "places" = "named"): Promise<number[]> => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(asDb(), { sessionId: session!.id, userId: owner.id })
		const messages = (
			await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, session!.id))
		).map((m) => ({ id: m.id, content: m.content }))
		const node = read === "named" ? "core:query/entries-named@1" : "core:query/lorebook-entries@1"
		const bind: any = coreBindings()[node]
		const r = (await (typeof bind === "function" ? bind : bind.run)(
			{
				scope: { sessionId: session!.id, currentCharacterId: card!.id },
				messages,
				params: read === "named" ? {} : { entryTypes: [LOCATION_TYPE_ID] }
			} as never,
			{
				log: () => {},
				status: () => {},
				countTokens: (t: string) => Math.ceil(t.length / 4),
				read: async (name: string, q: unknown) =>
					host.read!(name as never, q as never, {
						key: "n",
						definitionId: "core:query/entries-named",
						definitionVersion: 1,
						kind: "query"
					} as never)
			} as never
		)) as { kind: string; value: { ids?: number[]; main: { id?: number }[] } }
		expect(r.kind).toBe("ok")
		return read === "named" ? r.value.ids! : r.value.main.map((x) => x.id).filter((id): id is number => typeof id === "number")
	}
	const leftOut = async () => {
		const r = await loadEntryKnowledge(asDb(), { sessionId: session!.id, speaker: `character:${card!.id}` })
		return r.kind === "judged" ? r.leftOut.map((l) => l.entryId).sort() : []
	}
	return { owner, book: book!, own, mira, session: session!, entry, say, home, ties, loreRead, leftOut }
}
type World = Awaited<ReturnType<typeof world>>

/** Publish the recipe's spec and run it as a routine would: input of the routine inlet, scripts on the named steps. */
async function runRecipe(w: World, builder: { build(): unknown }, scripts: Record<string, string>) {
	const doc = compile(builder.build() as never)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(asDb(), doc, { publish: true })
	const overrides = []
	for (const [nodeKey, source] of Object.entries(scripts))
		overrides.push({ nodeKey, slot: "scripts", path: "", value: [await storeScript(nodeKey, source)] })
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	return (await runSpec({
		db: asDb(),
		sessionId: w.session.id,
		userId: w.owner.id,
		specId: (doc as { id: string }).id,
		input: {
			sessionId: w.session.id,
			sessionScope: { sessionId: w.session.id, userId: w.owner.id },
			cause: {}
		},
		overrides,
		skipReceipt: true
	} as never)) as any
}

/** Every outlet note in a receipt: written, or why not. */
const noted = (receipt: any) => (receipt.nodes as any[]).filter((x) => String(x.nodeKey).endsWith("note"))

describe("note-entry-knowledge · the guide's recipes", () => {
	it("1 · told in the scene (Full): the entry the lines name is noted, and Mira's read returns it", async () => {
		const w = await world("full")
		const tag = `T${w.session.id}`
		const vault = await w.entry(`Vault${tag}`)
		const cellar = await w.entry(`Cellar${tag}`)
		// Only the vault is named in the lines.
		await w.say(`Vault${tag} was where the ledger lay.`)
		expect(await w.leftOut()).toEqual([vault, cellar].sort())
		expect(await w.loreRead()).toEqual([])

		const receipt = await runRecipe(w, toldInTheScene, { members: MEMBERS_SCRIPT })
		expect(receipt.outcome, JSON.stringify(receipt.nodes?.map((x: any) => [x.nodeKey, x.result, x.error ?? x.haltReason]))).toBe("ok")
		expect(noted(receipt).length).toBeGreaterThan(0)

		const ties = await w.ties(w.book.id)
		expect(ties.map((t) => [t.toEntryId, t.knowledgeKind, t.status])).toEqual([[vault, "was_told", "active"]])
		expect(await w.home()).toHaveLength(1)
		expect(await w.ties(w.own.id)).toHaveLength(0)
		// knownToSpeaker now lets the named entry through for Mira; the unnamed one stays out.
		expect(await w.leftOut()).toEqual([cellar])
		expect(await w.loreRead()).toEqual([vault])
	})

	it("2 · has been there (Review changes): the place's entry is noted in the session's notes", async () => {
		const w = await world("review", WALKERS)
		const tag = `T${w.session.id}`
		const vault = await w.entry(`Vault${tag}`, LOCATION_TYPE_ID)
		const cellar = await w.entry(`Cellar${tag}`, LOCATION_TYPE_ID)
		const { applyChange } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		// The scene closed at the Vault (the world's place); Mira stands in the Cellar, so the Vault is still out for her.
		await applyChange(asDb(), ctx, { owner: { kind: "session", id: w.session.id }, slotId: LOCATION_SLOT, value: `Vault${tag}` } as never)
		await applyChange(asDb(), ctx, { owner: { kind: "seated_member", id: w.mira }, slotId: LOCATION_SLOT, value: `Cellar${tag}` } as never)
		expect(await w.leftOut()).toEqual([vault])
		expect(await w.loreRead("places")).toEqual([cellar])

		const receipt = await runRecipe(w, hasBeenThere, { place: PLACE_SCRIPT, members: MEMBERS_SCRIPT })
		expect(receipt.outcome, JSON.stringify(receipt.nodes?.map((x: any) => [x.nodeKey, x.result, x.error ?? x.haltReason]))).toBe("ok")

		expect((await w.ties(w.own.id)).map((t) => [t.toEntryId, t.knowledgeKind, t.status])).toEqual([[vault, "has_been_there", "active"]])
		expect(await w.ties(w.book.id)).toHaveLength(0)
		expect(await w.leftOut()).toEqual([])
		expect((await w.loreRead("places")).sort()).toEqual([vault, cellar].sort())
	})

	it("3 · a model decides (Full): only the entry the judge picked is noted", async () => {
		const w = await world("full")
		const tag = `T${w.session.id}`
		const vault = await w.entry(`Vault${tag}`)
		const cellar = await w.entry(`Cellar${tag}`)
		await w.say(`They spoke of Vault${tag} and of Cellar${tag}.`)
		judge.answer = JSON.stringify({ revealed: [vault] })
		judge.asked = 0
		expect(await w.leftOut()).toEqual([vault, cellar].sort())
		expect(await w.loreRead()).toEqual([])

		const receipt = await runRecipe(w, toldWhatWasRevealed, { brief: BRIEF_SCRIPT, members: MEMBERS_SCRIPT })
		expect(receipt.outcome, JSON.stringify(receipt.nodes?.map((x: any) => [x.nodeKey, x.result, x.error ?? x.haltReason]))).toBe("ok")
		expect(judge.asked).toBe(1)

		const ties = await w.ties(w.book.id)
		expect(ties.map((t) => [t.toEntryId, t.knowledgeKind, t.status])).toEqual([[vault, "was_told", "active"]])
		// The cellar was named but not picked: no tie, still out for Mira.
		expect(ties.some((t) => t.toEntryId === cellar)).toBe(false)
		expect(await w.leftOut()).toEqual([cellar])
		expect(await w.loreRead()).toEqual([vault])
	})
})
