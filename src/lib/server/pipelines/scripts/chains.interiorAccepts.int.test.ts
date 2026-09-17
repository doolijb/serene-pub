import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	compile,
	describeOracleDefinition,
	ok,
	pin,
	run,
	S,
	spec
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { makeScriptApplier } from "./chains"

/**
 * An interior script point declares what it accepts (R-11, 2026-09-16; 18 §4e)
 * — through the real applier, from the executor.
 *
 * Until this change the broker offered every point as a text-transform hook
 * whatever the definition said, so a `candidates/filter` point could not
 * exist. Now the executor hands the applier the point's own `accepts` and the
 * applier does what it has always done with a link of the wrong kind: records
 * it `skip` with "a kind this hook does not accept" and leaves the value
 * alone. Pinned here rather than only in the SDK because the refusal is the
 * host's — the SDK's test proves the list arrives; this proves the list is
 * acted on.
 */

let db: TestDb

const TEXT = "core:script:text/transform"
const FILTER = "core:script:candidates/filter"

const drafter = pin(
	describeOracleDefinition({
		id: "test:oracle/point-accepts@1",
		shape: S.textGen,
		ports: { in: { text: S.text }, out: { main: S.text } },
		scriptPoints: [
			{
				key: "candidates",
				accepts: [`${FILTER}@1`],
				label: { en: "Candidates" }
			},
			{
				key: "draft",
				accepts: [`${TEXT}@1`],
				label: { en: "Draft" }
			}
		]
	})
)

const doc = compile(
	spec("test:spec/point-accepts", { version: "1.0.0" })
		.inlet("input", C.userMessage.v1())
		.oracle("draft", ($: any) => drafter.v1({ text: $.input.text }))
		.build()
)

let shoutId: number

async function runThrough(point: string) {
	return (await run(doc, {
		world: {
			overrides: [
				{
					nodeKey: "draft",
					slot: "scripts",
					path: point,
					value: [shoutId],
					scopeKind: "session"
				}
			],
			samplingConfigs: [],
			connections: [],
			activeConnection: {}
		} as any,
		input: { text: "quiet" },
		seed: "point-accepts",
		triggerSource: "ui",
		applyScripts: makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 }),
		bindings: {
			"core:inlet/user-message@1": async (i: any) => ok(i),
			[drafter.id]: async (i: any, ctx: any) =>
				ok({ main: await ctx.scripts.applyText(point, i.text) })
		}
	})) as any
}

beforeAll(async () => {
	db = await createTestDb()
	// Registry rows inserted directly: this test targets the applier and the
	// broker, not the projection (`registrySync.int.test.ts` owns that half).
	await db.insert(schema.pipelineDefinitionRegistry).values([
		{
			definitionId: TEXT,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { text: {} }, out: { text: {} } },
			semantics: "transform"
		},
		{
			definitionId: FILTER,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { candidates: {} }, out: { candidates: {} } },
			semantics: "transform"
		}
	])
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: `${TEXT}@1`,
			name: "shout",
			enabled: true,
			source: `return text.toUpperCase()`,
			varsIn: ["text"],
			varsOut: ["text"]
		})
		.returning()
	shoutId = row.id
}, 60_000)

describe("a point's own accepts is what the applier enforces", () => {
	it("a point declaring candidates/filter refuses a text transform, and the text is untouched", async () => {
		const receipt = await runThrough("candidates")
		expect(receipt.outcome).toBe("ok")
		const node = receipt.nodes.find((n: any) => n.nodeKey === "draft")
		expect(node.scripts).toMatchObject([
			{
				scriptId: shoutId,
				scriptKind: `${TEXT}@1`,
				appliedBy: "binding",
				result: "skip",
				reason: "a kind this hook does not accept"
			}
		])
		expect(receipt.nodes.find((n: any) => n.nodeKey === "draft").result).toBe("ok")
	})

	it("the same link on a point declaring text/transform runs", async () => {
		const receipt = await runThrough("draft")
		const node = receipt.nodes.find((n: any) => n.nodeKey === "draft")
		expect(node.scripts).toMatchObject([
			{ scriptId: shoutId, appliedBy: "binding", result: "ok", changed: true }
		])
	})
})
