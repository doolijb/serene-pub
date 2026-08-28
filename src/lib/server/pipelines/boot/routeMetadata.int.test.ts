/**
 * Route blocks' renderable halves survive the column mapping (22 §3, 20 §10):
 * `on` (the routed port reference) and `routes` (each branch's declared
 * predicate) round-trip through save → rows → load, and the rows carry what
 * the graph projection reads. Loop `repeatWhile` rides the same assertion —
 * it was stored before but never proven end to end.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import {
	spec,
	canonicalHash,
	compile,
	pin,
	describeTaskType,
	S
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const decide = pin(
	describeTaskType({
		id: "demo:task/decide@1",
		timeoutMs: 500,
		ports: {
			in: { text: S.text },
			out: { main: S.json, call: S.json, more: S.json }
		}
	})
)
const act = pin(
	describeTaskType({
		id: "demo:task/act@1",
		timeoutMs: 500,
		ports: { in: { what: S.json }, out: { main: S.json } }
	})
)

const routedAndLooped = () =>
	compile(
		spec("demo:spec/routed-looped", {
			version: "1.0.0",
			// Rides along so the taxonomy column (23 §2) is proven through
			// the same save → rows → load identity as the route metadata.
			taxonomy: { zone: "session", role: "action", mode: "demo:input/x@1" }
		})
			.input("input", C.userMessage.v1())
			.task("decide", ($: any) => decide.v1({ text: $.input.text }))
			.route("fan", { on: ($: any) => $.decide.call }, (r) =>
				r
					.when("dice", { path: "tool", equals: "roll_dice" }, (c) =>
						c.task("go", () => act.v1({ what: "rolled" } as any))
					)
					.when("lore", { path: "writeLore", truthy: true }, (c) =>
						c.task("go", () => act.v1({ what: "wrote" } as any))
					)
					.otherwise("narrate", (c) =>
						c.task("go", () => act.v1({ what: "narrated" } as any))
					)
			)
			.loop(
				"again",
				{ repeatWhile: ($: any) => $.decide.more, max: 3 },
				(l) => l.task("step", () => act.v1({ what: "looped" } as any))
			)
			.build()
	)

describe("route/loop metadata through the store", () => {
	it("rows carry on_ref, routes and repeat_while; the document round-trips", async () => {
		const doc = routedAndLooped()
		const saved = await saveDocument(db as any, doc, { publish: true })

		const blocks = (await db
			.select()
			.from(schema.pipelineBlocks)
			.where(
				eq(schema.pipelineBlocks.specVersionId, saved.specVersionId)
			)) as any[]

		const route = blocks.find((b) => b.kind === "route")
		expect(route, "no route block row").toBeTruthy()
		// The projection reads `.port` — the renderable half of the reference.
		expect(route.onRef?.port).toBe("call")
		expect(Object.keys(route.routes ?? {}).sort()).toEqual([
			"dice",
			"lore",
			"narrate"
		])
		expect(route.routes.dice).toMatchObject({
			path: "tool",
			equals: "roll_dice"
		})
		expect(route.routes.lore).toMatchObject({
			path: "writeLore",
			truthy: true
		})
		expect(route.routes.narrate).toMatchObject({ default: true })

		const loop = blocks.find((b) => b.kind === "loop")
		expect(loop, "no loop block row").toBeTruthy()
		expect(loop.repeatWhile?.port).toBe("more")
		expect(loop.max).toBe(3)

		// The catalogue claims land on the version row (23 §4)…
		const [versionRow] = (await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(
				eq(schema.pipelineSpecVersions.id, saved.specVersionId)
			)) as any[]
		// The deprecated `mode` spelling normalizes to `genre` (24 §2).
		expect(versionRow.taxonomy).toEqual({
			zone: "session",
			role: "action",
			genre: "demo:input/x@1"
		})

		// C1 over the new columns: import(export(rows)) is the identity.
		const back = await loadDocument(db as any, saved.specVersionId)
		expect(canonicalHash(back)).toBe(canonicalHash(doc))
		const backRoute = back.blocks.find((b: any) => b.kind === "route") as any
		expect(backRoute?.routes?.narrate?.default).toBe(true)
		const backLoop = back.blocks.find((b: any) => b.kind === "loop") as any
		expect(backLoop?.repeatWhile?.port).toBe("more")
	})
})
