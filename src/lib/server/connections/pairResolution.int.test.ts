/**
 * What `resolveCapabilityTarget` hands an adapter after the split (0114): a ROW,
 * with the model merged into it.
 *
 * ## Why the merge is the thing under test
 *
 * The endpoint/model split could have been done by carrying a second object
 * beside the connection. It was not, and this file is why: seven adapters, five
 * dispatch paths, the capability guard, the template dereference, the wire-mode
 * resolver and the identity projection all read a CONNECTION ROW, and every one
 * of them would have become a place that can ask the wrong object. Asking the
 * wrong one is silent — you get the endpoint's answer, which is the answer that
 * used to be correct.
 *
 * So the contract is: after resolution, `connection.model` is the pair's
 * identifier, `connection.promptFormat` is the pair's template, `tokenCounter`
 * is the pair's tokenizer, and the capability column is the model's layer over
 * the endpoint's. Nothing downstream had to move, and that is only true if this
 * file passes.
 *
 * ## Real PGlite, unlike `capabilityTarget.test.ts` beside it
 *
 * That file pins the ORDER of the chain against a fake db, which is the right
 * shape for asserting a walk over a constant. This one is about a JOIN, a
 * foreign key, a partial unique index and a merge, and three of those four are
 * database behaviour.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 120_000)

/** A text endpoint that can chat, so nothing is refused for the wrong reason. */
async function endpoint(over: Partial<InsertConnection> = {}) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `endpoint ${Math.random()}`,
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost:11434",
			capabilities: { resolved: { "text->text": 1 } },
			...over
		} as InsertConnection)
		.returning()
	return row
}

async function model(
	connectionId: number,
	over: Partial<InsertConnectionModel> & { model: string }
) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId,
			name: over.model,
			...over
		} as InsertConnectionModel)
		.returning()
	return row
}

/** Resolve `text->text` with the instance default set to this pair. */
async function resolveWithDefault(
	connectionId: number | null,
	connectionModelId?: number | null
) {
	await setCapabilityDefault(db, TEXT_CAPABILITY, {
		connectionId,
		connectionModelId: connectionModelId ?? null
	})
	return await resolveCapabilityTarget(db, { capability: TEXT_CAPABILITY })
}

describe("a pair that names only the endpoint", () => {
	it("resolves to its DEFAULT model, not to the legacy mirror", async () => {
		// The mirror is deliberately WRONG here. On a healthy install the two
		// agree, and that is exactly what would make a resolver still reading
		// the column look correct forever — so this row pins the difference.
		const e = await endpoint({ model: "stale-mirror" })
		await model(e.id, { model: "real-default", isDefault: true })
		const res = await resolveWithDefault(e.id)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.model).toBe("real-default")
		expect(res.connection.connectionModelId).toBeTruthy()
	}, 60_000)

	it("merges to the endpoint itself when it has no models at all", async () => {
		// The pre-0114 row, exactly: an endpoint whose model column was never
		// filled in has no model rows, and the pair is then the endpoint alone.
		// Nothing that worked before the split stops working.
		const e = await endpoint({ model: null })
		const res = await resolveWithDefault(e.id)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.model).toBeNull()
		expect(res.connection.connectionModelId).toBeNull()
	}, 60_000)
})

describe("the per-model overrides", () => {
	it("substitute the model's template, tokenizer and context window", async () => {
		const e = await endpoint({
			model: "endpoint-mirror",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		const m = await model(e.id, {
			model: "the-model",
			isDefault: true,
			promptFormat: "chatml",
			tokenCounter: "openai",
			contextWindow: 32768
		})
		const res = await resolveWithDefault(e.id, m.id)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.model).toBe("the-model")
		expect(res.connection.promptFormat).toBe("chatml")
		expect(res.connection.tokenCounter).toBe("openai")
		expect(res.connection.contextWindow).toBe(32768)
		// And the template was dereferenced against the MODEL's key, not the
		// endpoint's — the failure `withCompletionTemplate`'s header describes,
		// arriving by a new route. A prompt rendered in one format and stopped
		// on another's markers does not error; it runs on.
		expect(res.connection.completionTemplate?.key).toBe("chatml")
	}, 60_000)

	it("falls through to the endpoint for everything it does not state", async () => {
		// The whole safety argument for the 0114 backfill: a model row with no
		// overrides resolves byte-identically to the endpoint it hangs off.
		const e = await endpoint({
			promptFormat: "chatml",
			tokenCounter: "openai"
		})
		const m = await model(e.id, { model: "bare", isDefault: true })
		const res = await resolveWithDefault(e.id, m.id)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.promptFormat).toBe("chatml")
		expect(res.connection.tokenCounter).toBe("openai")
		expect(res.connection.contextWindow).toBeNull()
	}, 60_000)

	it("layers the model's capability switches over the endpoint's", async () => {
		// The defect the per-model column exists to close: before the split,
		// probing a vision model taught the ENDPOINT vision, and every text
		// model behind the same host inherited the claim. Here the endpoint says
		// vision is on and this particular checkpoint says it is not.
		const e = await endpoint({
			capabilities: {
				resolved: { "text->text": 1 },
				overrides: { "text+image->text": 1 }
			}
		})
		const m = await model(e.id, {
			model: "text-only",
			isDefault: true,
			capabilities: { overrides: { "text+image->text": false } }
		})
		const res = await resolveWithDefault(e.id, m.id)
		expect(res.ok).toBe(true)
		if (!res.ok) return
		const merged = res.connection.capabilities as any
		expect(merged.overrides["text+image->text"]).toBe(false)
		expect(merged.resolved["text+image->text"]).toBeFalsy()
		// The endpoint's own row is untouched — a resolution is a read.
		const [stored] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, e.id))
		expect((stored.capabilities as any).overrides).toEqual({
			"text+image->text": 1
		})
	}, 60_000)
})

describe("a pair whose halves disagree", () => {
	it("refuses a model that belongs to a different endpoint", async () => {
		const a = await endpoint()
		const b = await endpoint()
		await model(a.id, { model: "a-default", isDefault: true })
		const mB = await model(b.id, { model: "b-model", isDefault: true })
		const res = await resolveWithDefault(a.id, mB.id)
		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.message).toMatch(/different connection/i)
	}, 60_000)

	it("refuses a model that has been switched off", async () => {
		// Not a fallback to the default. Silently substituting a different MODEL
		// is a run that succeeds against something nobody picked, which is the
		// defect class this whole resolver exists to close.
		const e = await endpoint()
		await model(e.id, { model: "on", isDefault: true })
		const off = await model(e.id, { model: "off", enabled: false })
		const res = await resolveWithDefault(e.id, off.id)
		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.kind).toBe("model")
		expect(res.problem.message).toMatch(/switched off/i)
	}, 60_000)

	it("names neither the connection nor the model in the sentence", async () => {
		// The message travels through `Error.message` and `Receipt.haltReason`
		// where nothing can redact it; the identity rides as a FIELD, which the
		// projection removes for everyone who is not an administrator.
		const e = await endpoint({ name: "Secret Box" })
		const other = await endpoint()
		const mOther = await model(other.id, { model: "gpt-secret" })
		const res = await resolveWithDefault(e.id, mOther.id)
		expect(res.ok).toBe(false)
		if (res.ok) return
		expect(res.problem.message).not.toContain("Secret Box")
		expect(res.problem.message).not.toContain("gpt-secret")
		expect(res.problem.connection?.name).toBe("Secret Box")
	}, 60_000)
})

describe("the model comes from whichever tier won the connection", () => {
	it("drops the default's model when a higher tier names another endpoint", async () => {
		// ⚠ The half of the walk that is not independent. A `connection_models`
		// row belongs to one endpoint, so carrying the default tier's model past
		// the pipeline tier's endpoint change would build a pair whose two
		// halves name different connections — turning an ordinary "this pipeline
		// overrides the default connection" into a hard refusal about a model
		// nobody selected.
		const registered = await endpoint()
		const rModel = await model(registered.id, {
			model: "registered-model",
			isDefault: true
		})
		const override = await endpoint()
		await model(override.id, {
			model: "override-default",
			isDefault: true
		})
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: registered.id,
			connectionModelId: rModel.id
		})
		const res = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			pipelineConfig: { connectionId: override.id }
		})
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.id).toBe(override.id)
		expect(res.connection.model).toBe("override-default")
	}, 60_000)

	it("honours a model named by the tier that also named the endpoint", async () => {
		const registered = await endpoint()
		await model(registered.id, { model: "reg", isDefault: true })
		const override = await endpoint()
		await model(override.id, { model: "its-default", isDefault: true })
		const chosen = await model(override.id, { model: "chosen" })
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: registered.id
		})
		const res = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			pipelineConfig: {
				connectionId: override.id,
				connectionModelId: chosen.id
			}
		})
		expect(res.ok).toBe(true)
		if (!res.ok) return
		expect(res.connection.model).toBe("chosen")
	}, 60_000)
})
