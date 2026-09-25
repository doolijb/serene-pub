/**
 * A per-node Sampling pick must reach the OUTGOING REQUEST, not only the budget.
 *
 * ⚠ It reached neither, and the two halves failed for different reasons — which
 * is why one fix would have been half a fix.
 *
 *  1. **The shape.** `resolveSlot` returns a REFERENCE for `connection`
 *     (`{ id, kind, metadata }`) and bare VALUES for `sampling`, id deliberately
 *     stripped, because the nodes that read a sampling slot need the numbers.
 *     `host.ts`'s `refId` reduces a slot to a row id; on sampling it found
 *     neither `ref` nor `id` and returned `null`, and
 *     `resolveCapabilityTarget` reads `null` as "this tier said nothing" — so
 *     the capability default won on every run.
 *  2. **The forwarding.** The summarize and graph step bindings never put
 *     `connection` or `sampling` on their `ctx.call` payload at all, and
 *     `dispatchStep` reads them off exactly that payload.
 *
 * The half that makes it urgent is that the VALUE readers were right the whole
 * time. `core:task/batch-messages@1` shares the drafting step's sampling slot by
 * reference (`slot.samplingOf`) precisely so the cut is clamped to the window
 * the batch is SENT against — so a pick moved the cut while the request went out
 * under the capability default. The transcript was sized for one window and
 * posted to another.
 *
 * ## Why no existing test caught it
 *
 * Every one of them sits on one side of the seam. `summarizeBatchBudget.int` sets
 * the window through the **capability default**, so both paths read the same
 * tier and it passes whether or not a pick is honoured. `dispatch.int` calls the
 * host with a hand-written `sampling: { id: 99 }` — a shape the executor has
 * never produced. The SDK's `samplingFallback.test.ts` asserts the values are
 * right **at the binding**, one layer short of where they were lost.
 *
 * So every pick here is a config **the capability default is not**, and every
 * assertion is on what the ADAPTER was handed.
 *
 * The pick is written straight into a duplicated, selected config at
 * `(nodeKey, 'sampling', '')` — the one address `config/slotAddress.int.test.ts`
 * proves the panel writes and the executor reads.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { connectionSlotValue } from "$lib/shared/connections/slotRef"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * Every text call the fakes saw, with the window, samplers and CONNECTION it
 * went out on.
 *
 * `connection` is the row `dispatch` resolved and constructed the adapter
 * against — the only place that answers "where did the bytes actually go",
 * which is the question the Connection slot exists to decide and the reason an
 * assertion on the resolver's arguments alone would be one step short.
 */
const textCalls: Array<{
	prompt: string
	tokenLimit: number
	sampling: any
	connection: any
}> = []
/** Every render request, as `buildImageRequest` produced it. */
const imageCalls: any[] = []

class FakeTextAdapter {
	private prompt: string
	private limit: number
	constructor(p: any) {
		this.prompt = p?.session?.sessionMessages?.[0]?.content ?? ""
		this.limit = p?.tokenLimit
		textCalls.push({
			prompt: this.prompt,
			tokenLimit: p?.tokenLimit,
			sampling: p?.sampling,
			connection: p?.connection
		})
	}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: {
				prompt: undefined,
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("<content>They went under the gate.</content>")
			}
		}
	}
}

const PNG_1x1 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

class FakeImageAdapter {
	constructor(public connection: any) {}
	async generateImage(req: any) {
		imageCalls.push(req)
		return {
			media: [{ kind: "image", mime: "image/png", base64: PNG_1x1 }],
			isAborted: false,
			applied: ["steps"],
			ignored: []
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeTextAdapter })
}))
vi.mock("$lib/server/utils/getImageAdapter", () => ({
	getImageAdapter: async () => ({ Adapter: FakeImageAdapter })
}))
vi.mock("$lib/server/media", () => ({
	createMedia: async (_db: any, input: any) => ({
		file: {
			id: 1,
			uuid: "uuid-1",
			rev: 0,
			userId: input.userId,
			sessionId: input.sessionId ?? null,
			kind: "image",
			displayMime: "image/png",
			displayBytes: 68,
			width: 1,
			height: 1,
			filename: input.filename,
			meta: input.meta
		},
		original: { id: 2, fileId: 1, variant: "original", mime: "image/png" }
	}),
	mediaUrl: (uuid: string, rev: number) => `/media/${uuid}?r=${rev}`
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

/**
 * What `dispatch` handed the resolver — the run's own resolution (R-8).
 *
 * Since the one road, dispatch consumes the executor's resolved connection
 * and sampling and re-walks no tier of its own: `resolveCapabilityTarget` is
 * handed the run's ids as `pipelineConfig` and only loads the pair, checks the
 * model and attaches the template. The spy records what arrived and delegates
 * to the real resolver against THIS database — `capabilityDefault` reads the
 * global `db` otherwise, which in an int test is the app's own.
 *
 * ⚠ The session tier is not modelled, and does not need to be: it is in the
 * WORLD now (`sessions.sampling_config_id` at session scope), and no test in
 * this file sets it.
 */
let resolveArgs: any = null
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real: any = await importOriginal()
	return {
		...real,
		resolveCapabilityTarget: async (_db: any, req: any) => {
			// Capture only the step's own dispatch. Since the turn-order
			// spec was bound to `message-completed` (PLAN-turn-order §4.5),
			// the finishing write of this very run dispatches the turn-order
			// spec as a child, and its run asks `capabilityDefault` through
			// `connectionStopsFor` for the INSTANCE default — a capability
			// lookup that carries no `pipelineConfig` and must not overwrite
			// what this file is spying on.
			if (req.pipelineConfig !== undefined) {
				resolveArgs = {
					pipelineConnectionId: req.pipelineConfig?.connectionId ?? null,
					pipelineConnectionModelId:
						req.pipelineConfig?.connectionModelId ?? null,
					pipelineSamplingId: req.pipelineConfig?.samplingConfigId ?? null
				}
			}
			return await real.resolveCapabilityTarget(db, req)
		}
	}
})
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." }
	})
}))

/**
 * The two windows, chosen far enough apart that a batch cut against one cannot
 * be mistaken for a cut against the other.
 *
 * ⚠ The default is deliberately NOT the pick. A fixture that points the
 * capability default at the same row it picks passes whether or not any of this
 * works — the exact trap `slotAddress.int.test.ts` describes.
 */
const DEFAULT_WINDOW = 32768
const PICKED_WINDOW = 3000
const DEFAULT_TEMP = 0.1
const PICKED_TEMP = 0.9
const DEFAULT_STEPS = 12
const PICKED_STEPS = 41

/**
 * Two text servers, on the same terms as the two sampling configs above: the
 * capability default is deliberately NOT the pick, so a request that ignores the
 * pick lands somewhere a test can see rather than on the same row by luck.
 */
const DEFAULT_BASE_URL = "http://text"
const PICKED_BASE_URL = "http://second-text"

let db: TestDb
let userId: number
let textSessionId: number
let summarySessionId: number
let imageSessionId: number
let defaultSamplingId: number
let pickedSamplingId: number
let defaultImageSamplingId: number
let pickedImageSamplingId: number
let defaultConnectionId: number
let pickedConnectionId: number
/**
 * The MODEL half of each pair (0128). A connection has no default model, so
 * every registration and every slot value below names both halves; an endpoint
 * on its own resolves as unconfigured.
 */
let defaultModelId: number
let pickedModelId: number

/** Spec slugs, hoisted so the pick helper and the runs cannot disagree. */
let RESPOND: string
let SUMMARIZE: string
const IMAGE = "core:spec/generate-image"

/**
 * The mutable config every pick is written into, per spec.
 *
 * The shipped config is immutable by design ("duplicate it and edit the copy"),
 * so a run that resolved against it would be resolving against something no user
 * can change — which is not the situation this file is about.
 */
const configs = new Map<string, number>()

async function mutableConfigFor(slug: string): Promise<number> {
	const known = configs.get(slug)
	if (known != null) return known
	const { duplicateConfig, selectConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	const [shipped] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			and(
				eq(schema.pipelineConfigs.specId, spec.id),
				eq(schema.pipelineConfigs.isImmutable, true)
			)
		)
	const copy = await duplicateConfig(db, shipped.id, `${slug} (test)`)
	await selectConfig(db, spec.id, "instance", 0, copy.id, userId)
	configs.set(slug, copy.id)
	return copy.id
}

/** Point one node's slot at one row — or clear it, which is the other guard. */
async function setSlot(
	slug: string,
	nodeKey: string,
	slot: string,
	value: unknown | null,
	path = ""
) {
	const configId = await mutableConfigFor(slug)
	const where = and(
		eq(schema.pipelineConfigValues.configId, configId),
		eq(schema.pipelineConfigValues.nodeKey, nodeKey),
		eq(schema.pipelineConfigValues.slot, slot),
		eq(schema.pipelineConfigValues.path, path)
	)
	await db.delete(schema.pipelineConfigValues).where(where)
	if (value === null) return
	// Committed as the panel commits it: a number for a sampling or context id,
	// and whatever `connectionSlotValue` builds for a connection — the
	// string/number divide is the second, independent break on this path
	// (`sameId`).
	await db.insert(schema.pipelineConfigValues).values({
		configId,
		nodeKey,
		slot,
		path,
		value: value as any
	})
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines, RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	RESPOND = RESPOND_SPEC_ID
	SUMMARIZE = (await import("$lib/server/pipelines/specs/summarize"))
		.SUMMARIZE_WORLD_SPEC_ID

	const [user] = await db
		.insert(schema.users)
		.values({ username: "sampling-slot", isAdmin: true })
		.returning()
	userId = user.id
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Slots", userId })
		.returning()

	const session = async () =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, lorebookId: lorebook.id })
				.returning()
		)[0].id
	textSessionId = await session()
	summarySessionId = await session()
	imageSessionId = await session()

	await db.insert(schema.sessionMessages).values({
		sessionId: textSessionId,
		role: "user",
		content: "tell me about the gate"
	} as any)
	// Enough chat that the narrow window has to cut it into more batches than
	// the wide one — which is what makes the budget half observable.
	await db.insert(schema.sessionMessages).values(
		Array.from({ length: 60 }, (_, i) => ({
			sessionId: summarySessionId,
			role: "user" as const,
			content: `${i}: ${"the gate was sealed with old iron. ".repeat(12)}`
		}))
	)

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: DEFAULT_BASE_URL })
		.returning()
	defaultConnectionId = textConn.id
	// The second server, for the Connection slot. Same type as the default —
	// what is under test is which ROW the pick resolves to, and two rows of
	// different types would let the capability filter decide it instead.
	const [secondTextConn] = await db
		.insert(schema.connections)
		.values({
			name: "Second text",
			type: "koboldcpp",
			baseUrl: PICKED_BASE_URL
		})
		.returning()
	pickedConnectionId = secondTextConn.id
	const [imageConn] = await db
		.insert(schema.connections)
		.values({
			name: "Image",
			type: "a1111",
			baseUrl: "http://image",
			// Stated outright rather than inferred from the type: the guard reads
			// an explicit override above everything else, so the fixture cannot
			// be broken by a change to how a type's modality is judged.
			capabilities: { overrides: { "text->image": "good" } }
		} as any)
		.returning()

	// The model half of each endpoint. The checkpoint is a property of the
	// model row, and the merge is what puts it back on `connection.model` for
	// the adapter.
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	defaultModelId = (await ensureConnectionModel(
		db,
		textConn.id,
		"default-7b"
	))!.id
	pickedModelId = (await ensureConnectionModel(
		db,
		secondTextConn.id,
		"picked-7b"
	))!.id
	const imageModelId = (await ensureConnectionModel(
		db,
		imageConn.id,
		"juggernaut.safetensors"
	))!.id

	const sampling = async (name: string, values: any, enabled: string[]) =>
		(
			await db
				.insert(schema.samplingConfigs)
				.values({ name, isImmutable: false, values, enabled } as any)
				.returning()
		)[0].id
	const imageSampling = async (name: string, steps: number) =>
		(
			await db
				.insert(schema.samplingConfigs)
				.values({
					name,
					isImmutable: false,
					shape: "core:shape/image-gen@1",
					values: { steps, cfg: 6, width: 512, height: 512 },
					enabled: ["steps", "cfg", "width", "height"]
				} as any)
				.returning()
		)[0].id

	const TEXT_KEYS = ["contextTokens", "responseTokens", "temperature"]
	defaultSamplingId = await sampling(
		"The capability default",
		{
			contextTokens: DEFAULT_WINDOW,
			responseTokens: 200,
			temperature: DEFAULT_TEMP
		},
		TEXT_KEYS
	)
	pickedSamplingId = await sampling(
		"The one that was picked",
		{
			contextTokens: PICKED_WINDOW,
			responseTokens: 200,
			temperature: PICKED_TEMP
		},
		TEXT_KEYS
	)
	defaultImageSamplingId = await imageSampling("Image default", DEFAULT_STEPS)
	pickedImageSamplingId = await imageSampling("Image picked", PICKED_STEPS)

	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: defaultModelId,
		samplingConfigId: defaultSamplingId
	})
	await setCapabilityDefault(db, "text->image", {
		connectionId: imageConn.id,
		connectionModelId: imageModelId,
		samplingConfigId: defaultImageSamplingId
	})

	// The image spec ships review ON — "Ask for the prompt" — so the run parks
	// before the render and there is no request to assert about. Turning it off
	// is the ordinary configuration a person makes to render immediately.
	// Per FIELD, which is how a settings slot is declared and stored
	// (`render|settings|review`); a whole-slot write at `''` is a different
	// address and would leave the shipped `on` standing.
	await setSlot(IMAGE, "render", "settings", "off", "review")
})

/**
 * The reply step, on the real respond document — nothing added.
 *
 * ⚠ **It used to need a line.** No shipped `generate-text` node wired these
 * slots: `respond`, `narrate` and `narrate-character` all called
 * `C.generateText.v1({ context, prompts })` and named neither `connection` nor
 * `sampling`, so the executor never resolved them for that node, the binding
 * forwarded `null`, and the panel's pickers on the reply step were inert for a
 * THIRD reason, in the spec document itself. This function patched the loaded
 * copy in memory to make the other two halves observable, and the guard below
 * pinned the hole so the patch could not outlive it.
 *
 * `drizzle/0111_reply_slots_and_relationship_cap.sql` closed it — all three
 * documents wire `connection: slot.connection()` and `sampling: slot.sampling()`
 * on their `generate` node now — so the patch is gone and the guard is inverted.
 * Everything here is the real one: the document, the config store, the world,
 * the binding, the host and `dispatch`.
 */
const runRespond = async () => {
	const { loadPublished } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const { coreBindings } = await import(
		"$lib/server/pipelines/runtime/bindings"
	)
	const { run } = await import("@serene-pub/sdk")

	const doc: any = await loadPublished(db, RESPOND)
	const generate = doc.nodes.find((n: any) => n.key === "generate")
	expect(generate, "the reply pipeline has no `generate` node").toBeTruthy()

	return (await run(doc, {
		world: await buildWorld(db, { specId: RESPOND }),
		input: {
			text: "tell me about the gate",
			sessionId: textSessionId,
			characterId: null,
			sessionScope: {
				sessionId: textSessionId,
				currentCharacterId: null
			}
		},
		seed: "seed:sampling-slot",
		bindings: coreBindings(),
		host: createHost(db, {
			sessionId: textSessionId,
			userId
		})
	} as any)) as any
}

const runSummarize = async () => {
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	return (await runSpec({
		db: db,
		sessionId: summarySessionId,
		userId,
		specId: SUMMARIZE,
		input: { scope: { sessionId: summarySessionId }, request: {} },
		// Stops at the write: what is under test is every call made on the way,
		// not the entry that gets saved.
		preview: { atNode: "save" },
		skipReceipt: true
	})) as any
}

const runImage = async () => {
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	return (await runSpec({
		db: db,
		sessionId: imageSessionId,
		userId,
		specId: IMAGE,
		input: {
			text: "a sealed iron gate",
			sessionId: imageSessionId,
			characterId: null,
			sessionScope: {
				sessionId: imageSessionId,
				currentCharacterId: null
			}
		},
		skipReceipt: true
	})) as any
}

/** Only the drafting calls — synthesis and naming send other prompts. */
const drafts = () => textCalls.filter((c) => c.prompt.includes("old iron"))

describe("dispatch — the reply step's own Sampling", () => {
	it("sends the picked config's samplers, not the capability default's", async () => {
		// The `generate` node's slot, through the panel's address, resolved by
		// the executor and consumed by dispatch (R-8). Before the executor
		// carried the reference this arrived as `null`, which reads as "the
		// pipeline chose nothing" — and the default temperature went out
		// instead.
		await setSlot(RESPOND, "generate", "sampling", pickedSamplingId)
		textCalls.length = 0
		resolveArgs = null
		await runRespond()

		// The id, where it was `null` — and the samplers that actually went out.
		expect(resolveArgs?.pipelineSamplingId).toBe(pickedSamplingId)
		expect(textCalls.length).toBeGreaterThan(0)
		expect(textCalls[0]!.sampling?.temperature).toBe(PICKED_TEMP)
		expect(textCalls[0]!.sampling?.temperature).not.toBe(DEFAULT_TEMP)
	})

	it("resolves the capability default's own row when nothing is picked", async () => {
		// The other half of the guard, and the shape of it is worth stating:
		// what the executor forwards is whatever the CONFIG STORE resolved at
		// this address, and `world.ts` projects the capability default there
		// itself, at `defaults` scope, for the spec's provider node. So the id
		// arriving here is the default's own — the same row, reached by the same
		// store, and exactly what the `connection` slot beside it has always
		// done. What must never happen is the PICKED row surviving a clear.
		//
		// The executor's `activeSampling` fallback is deliberately NOT forwarded:
		// that one is not the config store, and sending it would be the executor
		// inventing a tier it does not own. Every node but this one therefore
		// says nothing at all here — see the image case below.
		await setSlot(RESPOND, "generate", "sampling", null)
		textCalls.length = 0
		resolveArgs = null
		await runRespond()

		expect(resolveArgs?.pipelineSamplingId).toBe(defaultSamplingId)
		expect(resolveArgs?.pipelineSamplingId).not.toBe(pickedSamplingId)
		expect(textCalls.length).toBeGreaterThan(0)
		expect(textCalls[0]!.sampling?.temperature).toBe(DEFAULT_TEMP)
	})

	it("the shipped documents wire both slots on the sending node", async () => {
		// ⚠ Inverted, and it used to read "do not wire them — the picker is
		// still inert". That was the third hole and the reason the run above
		// had to patch a line in: every shipped `generate-text` node called
		// `C.generateText.v1({ context, prompts })` and named neither slot, so
		// nothing the panel stored for it was ever resolved.
		// `drizzle/0111_reply_slots_and_relationship_cap.sql` closed it —
		// editing published documents under frozen versions, which is why it
		// needed a re-projection migration and moved three spec hashes.
		//
		// Read off the PUBLISHED rows, not the compiled catalog: the rows are
		// what `loadPublished` hands the executor, so a document corrected in
		// the SDK and never republished would still run without the slots. That
		// is precisely the state the migration exists to prevent, and asserting
		// on `respondSpec()` here would be blind to it.
		const { loadPublished } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		// All three, where it used to be two: `narrate-character` carries the
		// same `generate` node and was missing the same two lines.
		const { NARRATE_SPEC_ID, NARRATE_CHARACTER_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/narrate"
		)
		for (const slug of [
			RESPOND,
			NARRATE_SPEC_ID,
			NARRATE_CHARACTER_SPEC_ID
		]) {
			const doc: any = await loadPublished(db, slug)
			const generate = doc.nodes.find((n: any) => n.key === "generate")
			expect(generate, `${slug} has no generate node`).toBeTruthy()
			expect(
				generate.config.sampling,
				`${slug}'s generate node stopped naming its sampling slot — the ` +
					`pick is stored, resolved by nobody, and the request goes to ` +
					`the instance default again`
			).toEqual({ __ref: "slot", slot: "sampling" })
			expect(
				generate.config.connection,
				`${slug}'s generate node stopped naming its connection slot`
			).toEqual({ __ref: "slot", slot: "connection" })

			// ⚠ And this is why it mattered, stated mechanically: the BUDGET node
			// reads the very slot the sending node did not declare. A Sampling
			// pick on the reply step moved `contextBudget`'s window — the prompt
			// was sized for it — while the request went out on the capability
			// default. One window sized it, another received it. Kept here
			// because the two must stay pointed at the same node: a `samplingOf`
			// naming some other key would put them back in disagreement without
			// either assertion above noticing.
			const budget = doc.nodes.find((n: any) => n.key === "contextBudget")
			expect(budget, `${slug} has no contextBudget node`).toBeTruthy()
			expect(budget.config.sampling).toEqual({
				__ref: "slot",
				slot: "sampling",
				ofNode: "generate"
			})
			// The same, for the render side: `prompt` picks the wire format off
			// the connection this step sends to.
			const prompt = doc.nodes.find((n: any) => n.key === "prompt")
			expect(prompt, `${slug} has no prompt node`).toBeTruthy()
			expect(prompt.config.connection).toEqual({
				__ref: "slot",
				slot: "connection",
				ofNode: "generate"
			})
		}
	})
})

describe("dispatch — the reply step's own Connection", () => {
	/**
	 * The other slot on the same node, and the one with teeth: a Sampling pick
	 * that misses changes the samplers, a Connection pick that misses sends the
	 * request to a different **server**.
	 *
	 * ⚠ The assertion is on the CONNECTION the adapter was constructed against,
	 * not on the id handed to the resolver. `refId(p.connection)` reducing a
	 * resolved slot to an id and `resolveCapabilityTarget` walking the tiers are
	 * two separate steps, and only the second one decides where the bytes go —
	 * an id arriving at `pipelineConfig` is a proposal until the walk has read
	 * the whole chain. It happens to be the TOP tier since 0130, which is a fact
	 * about today's chain and not a reason to assert one step earlier.
	 */
	it("sends to the picked connection, not the capability default's", async () => {
		/**
		 * ⚠ RED against a live defect in the SDK executor, not against this
		 * fixture. `connectionSlotValue` writes the pair a picker commits —
		 * `{ ref, modelId }` — and `executor.ts`'s connection branch compares
		 * the whole stored value with `sameId(c.id, chosenId)`, which
		 * stringifies the object to `[object Object]` and matches no
		 * connection. The slot then falls through to `activeConnection[kind]`
		 * and the pick is silently replaced by the instance default: the exact
		 * disguise `slotAddress.test.ts` was written about.
		 *
		 * The fix is in that branch — read the two halves with
		 * `slotConnectionId` / `slotModelId` and carry `modelId` on the
		 * descriptor it returns, so `host.ts`'s `slotModelId(p.connection)`
		 * has something to read. Writing a bare connection id here instead
		 * would make this green while leaving the defect in place.
		 */
		await setSlot(
			RESPOND,
			"generate",
			"connection",
			connectionSlotValue(pickedConnectionId, pickedModelId)
		)
		textCalls.length = 0
		resolveArgs = null
		await runRespond()

		// The id, where it was `null` — the panel's pick reaching tier 2 at all.
		expect(resolveArgs?.pipelineConnectionId).toBe(pickedConnectionId)
		expect(textCalls.length).toBeGreaterThan(0)
		// And where the request actually went.
		expect(textCalls[0]!.connection?.id).toBe(pickedConnectionId)
		expect(textCalls[0]!.connection?.baseUrl).toBe(PICKED_BASE_URL)
		expect(textCalls[0]!.connection?.id).not.toBe(defaultConnectionId)
		// And the MODEL half of the same pick, all the way to the adapter. The
		// endpoint alone was never the whole assertion: a pair that loses its
		// model still reaches the right server and still answers, out of
		// whatever model that server happens to load — which is the half of this
		// defect that produces no wrong URL to notice.
		expect(textCalls[0]!.connection?.model).toBe("picked-7b")
	})

	it("resolves the capability default when nothing is picked", async () => {
		// The other half of the guard: the picked row must not survive a clear.
		// Unlike `sampling`, `resolveSlot`'s connection branch falls back to
		// `world.activeConnection[kind]` and returns a row either way — and
		// `world.ts` projects that key from the same `connection_defaults` row
		// the `capabilityDefault` tier reads, so the id arriving at tier 2 with
		// nothing picked is the default's own. Same value, one tier up, which is
		// why wiring this slot changes nothing for an install that never touched
		// the picker.
		await setSlot(RESPOND, "generate", "connection", null)
		textCalls.length = 0
		resolveArgs = null
		await runRespond()

		expect(resolveArgs?.pipelineConnectionId).toBe(defaultConnectionId)
		expect(resolveArgs?.pipelineConnectionId).not.toBe(pickedConnectionId)
		expect(textCalls.length).toBeGreaterThan(0)
		expect(textCalls[0]!.connection?.id).toBe(defaultConnectionId)
		expect(textCalls[0]!.connection?.baseUrl).toBe(DEFAULT_BASE_URL)
	})
})

describe("dispatchStep — a summarize step's own Sampling", () => {
	it("sends every draft against the window the pick names", async () => {
		// The step bindings forwarded neither slot, so this was `null` twice
		// over: `refId(undefined)` at the host, and no reference to read even if
		// they had. Every draft went out on the capability default's window.
		await setSlot(
			SUMMARIZE,
			"drafting.item.draft",
			"sampling",
			pickedSamplingId
		)
		textCalls.length = 0
		expect((await runSummarize()).haltNodeKey).toBe("save")

		const picked = drafts()
		expect(picked.length).toBeGreaterThan(0)
		for (const call of picked) expect(call.tokenLimit).toBe(PICKED_WINDOW)
	})

	it("agrees with the budget: the cut and the request use one window", async () => {
		// The sharpest symptom, asserted directly. `core:task/batch-messages@1`
		// takes the drafting step's sampling BY REFERENCE (`slot.samplingOf`)
		// so the cut is clamped to the window the batch is sent against — and
		// that reader was correct all along. With the request on the default,
		// a transcript cut for 3000 tokens was posted to a 32768-token call:
		// the two numbers were free to be anything.
		//
		// Both directions, because either alone is satisfiable by a fix that
		// simply stops honouring the pick anywhere.
		await setSlot(
			SUMMARIZE,
			"drafting.item.draft",
			"sampling",
			pickedSamplingId
		)
		textCalls.length = 0
		expect((await runSummarize()).haltNodeKey).toBe("save")
		const narrow = drafts()

		await setSlot(SUMMARIZE, "drafting.item.draft", "sampling", null)
		textCalls.length = 0
		expect((await runSummarize()).haltNodeKey).toBe("save")
		const wide = drafts()

		// The budget moved: the narrow window cut the same transcript into more
		// batches than the wide one.
		expect(narrow.length).toBeGreaterThan(wide.length)
		// And the request moved WITH it, which is the half that was missing.
		for (const call of narrow) expect(call.tokenLimit).toBe(PICKED_WINDOW)
		for (const call of wide) expect(call.tokenLimit).toBe(DEFAULT_WINDOW)
		// Every prompt fits the window it was actually sent against, allowance
		// included — which is only a real check once the two are the same window.
		for (const call of narrow)
			expect(Math.ceil(call.prompt.length / 4) + 200).toBeLessThanOrEqual(
				PICKED_WINDOW
			)
	})
})

describe("dispatchImage — the render step's own Sampling", () => {
	it("renders on the picked config's parameters", async () => {
		// The third `refId` call site. `generate-image` forwarded its slots all
		// along, which is what made the gap look like a difference in kind
		// rather than one shared shape defect — the forwarding was fine and the
		// reduction to a row id was what returned null.
		await setSlot(IMAGE, "render", "sampling", pickedImageSamplingId)
		imageCalls.length = 0
		await runImage()

		expect(imageCalls.length).toBe(1)
		expect(imageCalls[0].steps).toBe(PICKED_STEPS)
		expect(imageCalls[0].steps).not.toBe(DEFAULT_STEPS)
	})

	it("falls through to the image capability default when nothing is picked", async () => {
		// `render` is not the node `world.ts` projects the legacy defaults onto
		// (that is `generate`), so nothing resolves at this address at all and
		// the reference really is absent — which is what keeps "the pipeline
		// chose nothing here" sayable, and lets `resolveCapabilityTarget` answer
		// from the tier that did choose.
		await setSlot(IMAGE, "render", "sampling", null)
		imageCalls.length = 0
		await runImage()

		expect(imageCalls.length).toBe(1)
		expect(imageCalls[0].steps).toBe(DEFAULT_STEPS)
	})
})
