/**
 * Every marked recipe in the SDK guides is run as written.
 *
 * `ts` and `playground` fences are covered by the SDK's
 * `sdk-tests/guideSnippets.test.ts` and `sdk-tests/guides.test.ts`; marked
 * ` ```js recipe <id> ` fences are covered here, each through the real script
 * applier. This test finds the fences, and an explicit map holds one runner per
 * id. It fails on a marked id the map does not know, on a known id no guide
 * carries, on an id that appears twice, and on a fence whose info string says
 * `recipe` without reading exactly `js recipe <id>`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { makeScriptApplier } from "./chains"
import { score } from "../ranking/select"
import { withDefaults } from "../ranking/weights"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const RESCORE = "core:script:candidates/rescore"
const FLOOR = 0.2

let db: TestDb
let registered = 0

const guidesDir = new URL(
	"../../../../../../serene-pub-sdk/guides/",
	import.meta.url
).pathname

type Fence = { id: string; file: string; source: string }

/**
 * Finds the marked recipes in one guide. Any line that opens a fence (after
 * leading whitespace, three or more backticks or tildes) whose info string has
 * the word `recipe` is a marker, and it must read exactly ` ```js recipe <id> `
 * or the scan throws: a malformed marker is never skipped. The body of a fence
 * that is not a recipe is never scanned for markers.
 */
function scanRecipes(file: string, text: string): Fence[] {
	const out: Fence[] = []
	const lines = text.split("\n")
	for (let i = 0; i < lines.length; i++) {
		const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i])
		if (!open) continue
		const [, fence, info] = open
		const close = (line: string) => {
			const t = line.trim()
			return t.length >= fence.length && t === fence[0].repeat(t.length)
		}
		let j = i + 1
		const body: string[] = []
		while (j < lines.length && !close(lines[j])) body.push(lines[j++])
		if (!/\brecipe\b/.test(info)) {
			i = j
			continue
		}
		const m = /^```js recipe (\S+)\s*$/.exec(lines[i])
		if (!m)
			throw new Error(
				`${file}:${i + 1}: a recipe marker must read exactly "\`\`\`js recipe <id>": ${lines[i]}`
			)
		if (j >= lines.length) throw new Error(`${file}: recipe "${m[1]}" is not closed`)
		out.push({ id: m[1], file, source: body.join("\n") })
		i = j
	}
	return out
}

function markedFences(): Fence[] {
	return readdirSync(guidesDir)
		.filter((f) => f.endsWith(".md"))
		.flatMap((file) => scanRecipes(file, readFileSync(guidesDir + file, "utf8")))
}

const site = {
	nodeKey: "rank",
	definitionId: "core:task/rank-lore@1",
	at: "in:candidates",
	slot: "scripts",
	phase: "before",
	port: "candidates",
	accepts: [`${RESCORE}@1`],
	extras: []
} as any

const candidate = (id: string, decayRate: number, lastRefRecency?: number) => ({
	id,
	source: "worldLore",
	tokens: 10,
	signals: {
		keyword: 0.5,
		...(lastRefRecency === undefined ? {} : { lastRefRecency })
	},
	priority: 1,
	position: 0,
	pinned: false,
	payload: { id, decayRate }
})

const weights = withDefaults().signals.worldLore
const scoreOf = (c: any) => score(c.signals, weights)

async function register(
	source: string,
	type: { typeId: string; vars: string } = { typeId: `${RESCORE}@1`, vars: "candidates" }
): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: type.typeId,
			name: `recipe ${++registered}`,
			enabled: true,
			source,
			varsIn: [type.vars],
			varsOut: [type.vars]
		})
		.returning()
	return row.id
}

async function rescore(source: string, list: any[]): Promise<any[]> {
	const scriptId = await register(source)
	const applier = makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 })
	const out = await applier(site, [scriptId], list)
	expect(out.applications.map((a: any) => a.result)).toEqual(["ok"])
	return out.value as any[]
}

const TRANSFORM = "core:script:data/transform"

const transformSite = {
	nodeKey: "heard",
	definitionId: "core:task/run-script@1",
	at: "in:main",
	slot: "scripts",
	phase: "after",
	port: "main",
	accepts: [`${TRANSFORM}@1`],
	extras: []
} as any

async function transform(source: string, value: unknown): Promise<unknown> {
	const scriptId = await register(source, { typeId: `${TRANSFORM}@1`, vars: "value" })
	const applier = makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 })
	const out = await applier(transformSite, [scriptId], value)
	expect(out.applications.map((a: any) => a.result)).toEqual(["ok"])
	return out.value
}

const runners: Record<string, (source: string) => Promise<void>> = {
	"living-recall": async (source) => {
		const before = [
			candidate("living", 0.5, 0.8),
			candidate("fact", 0, 0.8),
			candidate("gone", 1, 0.8),
			candidate("nosignal", 0.5)
		]
		const after = await rescore(source, before)
		const by = (id: string) => after.find((c) => c.id === id)

		expect(scoreOf(by("living"))).toBeLessThan(scoreOf(before[0]))
		expect(by("fact")).toEqual(before[1])
		expect(scoreOf(by("fact"))).toBe(scoreOf(before[1]))
		expect(by("gone").signals.lastRefRecency).toBeCloseTo(0.8 * FLOOR, 12)
		expect(by("nosignal")).toEqual(before[3])

		const rates = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
		const ranked = await rescore(
			source,
			rates.map((r) => candidate(`r${r}`, r, 0.8))
		)
		const fact = scoreOf(candidate("fact", 0, 0.8))
		for (const c of ranked) expect(scoreOf(c)).toBeLessThanOrEqual(fact)
	},

	"spoke-or-named": async (source) => {
		const cast = {
			sessionCharacters: [
				{ character: { id: 7, name: "Mira" }, castMemberId: 70 },
				{ character: { id: 8, name: "Bram" }, castMemberId: 80 }
			]
		}
		const row = (id: number, content: string, extra: Record<string, unknown> = {}) => ({
			id,
			role: "assistant",
			content,
			characterId: null,
			castMemberId: null,
			...extra
		})
		const rows = [
			row(1, "I speak.", { characterId: 7 }),
			row(2, "Said by a card-less seat.", { castMemberId: 70 }),
			row(3, "Where is mira?"),
			row(4, "Miranda left"),
			row(5, "Nothing to do with her.", { characterId: 8, castMemberId: 80 }),
			row(6, "A person speaks.", { role: "user" })
		]
		const kept = async (scope: unknown, input = rows) =>
			((await transform(source, { rows: input, cast, scope })) as { id: number }[]).map((r) => r.id)

		// A card's turn: its own line, a card-less-stamped one, a naming in any case, the person's line.
		expect(await kept({ currentCharacterId: 7 })).toEqual([1, 2, 3, 6])
		// A card-less seat's turn is read from the member id (the seat is the same one).
		expect(await kept({ currentCastMemberId: 70 })).toEqual([1, 2, 3, 6])
		expect(await kept({ currentCastMemberId: 80 })).toEqual([5, 6])
		// Not one character's turn: the rows come back unchanged.
		expect(await kept({})).toEqual([1, 2, 3, 4, 5, 6])
		expect(await kept(null)).toEqual([1, 2, 3, 4, 5, 6])
		// The person's lines are judged by the same rule when the switch is off.
		const off = source.replace("const KEEP_PERSON_LINES = true", "const KEEP_PERSON_LINES = false")
		expect(off).not.toBe(source)
		const judged = (await transform(off, { rows, cast, scope: { currentCharacterId: 7 } })) as {
			id: number
		}[]
		expect(judged.map((r) => r.id)).toEqual([1, 2, 3])
	}
}

beforeAll(async () => {
	db = await createTestDb()
	await db.insert(schema.pipelineDefinitionRegistry).values([
		{
			definitionId: RESCORE,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { candidates: {} }, out: { candidates: {} } },
			semantics: "transform"
		},
		{
			definitionId: TRANSFORM,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { value: {} }, out: { value: {} } },
			semantics: "transform"
		}
	])
}, 60_000)

describe("the recipe scanner", () => {
	const scan = (text: string) => scanRecipes("x.md", text)
	for (const marker of [
		"```ts recipe x",
		"   ```js recipe x",
		"~~~js recipe x",
		"```js recipe",
		"```js recipe a b"
	])
		it(`throws on a malformed marker: ${JSON.stringify(marker)}`, () => {
			expect(() => scan(`text\n\n${marker}\nbody\n${marker.trim().slice(0, 3)}\n`)).toThrow(/x\.md:3/)
		})

	it("parses a well-formed marker and ignores other fences, even ones that hold a marker", () => {
		const text = [
			"```ts",
			"const a = 1",
			"```",
			"````markdown",
			"```js recipe inside",
			"x",
			"```",
			"````",
			"```js recipe ok",
			"return 1",
			"```"
		].join("\n")
		expect(scan(text)).toEqual([{ id: "ok", file: "x.md", source: "return 1" }])
	})

	it("throws on a recipe that is not closed", () => {
		expect(() => scan("```js recipe open\nbody")).toThrow(/not closed/)
	})
})

describe("the guides' marked recipes", () => {
	const fences = markedFences()

	it("every marked id has a runner, every runner a fence, no id twice", () => {
		const ids = fences.map((f) => f.id)
		const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
		expect(
			ids.filter((id) => !(id in runners)),
			"marked ids the map does not know"
		).toEqual([])
		expect(
			Object.keys(runners).filter((id) => !ids.includes(id)),
			"known ids no guide carries"
		).toEqual([])
		expect(twice, "ids that appear twice").toEqual([])
	})

	for (const fence of fences)
		it(`runs "${fence.id}" (${fence.file}) as written`, async () => {
			const run = runners[fence.id]
			if (!run) throw new Error(`no runner for "${fence.id}"`)
			await run(fence.source)
		})
})
