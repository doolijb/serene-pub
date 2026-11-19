/**
 * `readStoredValue`, the one "would the run use this value?" rule, and
 * `addsOnlyAt`, the check before a one-address write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { valuesWith } from "$lib/server/sessions/settingsForm"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { addsOnlyAt, readStoredValue, settingLocksOf, type ReferenceSlots } from "./values"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const SEP = "\u0000"
const kinds: ReferenceSlots = {
	promptSlots: new Set([`n${SEP}prompt`]),
	templateSlots: new Set([`n${SEP}template`]),
	layoutSlots: new Set([`n${SEP}layout`, `n${SEP}free`]),
	layoutVariables: new Map([[`n${SEP}layout${SEP}k`, "core:var/a@1"]])
}
const at = (slot: string, path = "") => ({ nodeKey: "n", slot, path })

let db: TestDb
let dataDir: string
let promptId: number
let emptyPromptId: number
let templateId: number
let layoutId: number
let otherLayoutId: number
const MISSING = 987654

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-stored-value-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const promptRow = { nodeDefinitionId: "test:task/x", slot: "prompt", name: "p" }
	;[{ id: promptId }] = await db
		.insert(schema.pipelinePrompts)
		.values({ ...promptRow, fields: { a: "A", b: "B" } })
		.returning()
	;[{ id: emptyPromptId }] = await db
		.insert(schema.pipelinePrompts)
		.values({ ...promptRow, name: "empty", fields: {} })
		.returning()
	;[{ id: templateId }] = await db
		.insert(schema.pipelineContextTemplates)
		.values({ nodeDefinitionId: "test:task/x", name: "t", source: "S", engine: "e:one" })
		.returning()
	;[{ id: layoutId }] = await db
		.insert(schema.pipelineVariableTemplates)
		.values({ variableId: "core:var/a@1", name: "l", source: "L" })
		.returning()
	;[{ id: otherLayoutId }] = await db
		.insert(schema.pipelineVariableTemplates)
		.values({ variableId: "core:var/b@1", name: "l2", source: "L2" })
		.returning()
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("readStoredValue", () => {
	const rows = (): { name: string; at: ReturnType<typeof at>; value: unknown; expected: unknown }[] => [
		{ name: "null", at: at("plain"), value: null, expected: undefined },
		{ name: "undefined", at: at("plain"), value: undefined, expected: undefined },
		{ name: "prompt id", at: at("prompt"), value: promptId, expected: { kind: "prompt", fields: { a: "A", b: "B" } } },
		{ name: "prompt digit string", at: at("prompt"), value: String(promptId), expected: { kind: "prompt", fields: { a: "A", b: "B" } } },
		{ name: "prompt non-digit string", at: at("prompt"), value: "abc", expected: undefined },
		{ name: "prompt boolean", at: at("prompt"), value: true, expected: undefined },
		{ name: "prompt id naming no row", at: at("prompt"), value: MISSING, expected: undefined },
		{ name: "prompt with no fields", at: at("prompt"), value: emptyPromptId, expected: undefined },
		{ name: "template row", at: at("template"), value: templateId, expected: { kind: "template", template: { source: "S", engine: "e:one" } } },
		{ name: "template id naming no row", at: at("template"), value: MISSING, expected: undefined },
		{ name: "inline template source only", at: at("template"), value: { source: "x" }, expected: { kind: "template", template: { source: "x", engine: CORE_TEMPLATE_ENGINE } } },
		{ name: "inline template engine only", at: at("template"), value: { engine: "j" }, expected: undefined },
		{ name: "template string", at: at("template"), value: "text", expected: undefined },
		{ name: "layout of the key's variable", at: at("layout", "k"), value: layoutId, expected: { kind: "layout", layout: { variableId: "core:var/a@1", source: "L", name: "l" } } },
		{ name: "layout of another variable", at: at("layout", "k"), value: otherLayoutId, expected: undefined },
		{ name: "layout naming no row", at: at("layout", "k"), value: MISSING, expected: undefined },
		{ name: "layout non-number", at: at("layout", "k"), value: "7", expected: undefined },
		{ name: "layout key with no variable recorded", at: at("free", "z"), value: otherLayoutId, expected: { kind: "layout", layout: { variableId: "core:var/b@1", source: "L2", name: "l2" } } },
		{ name: "plain zero", at: at("plain"), value: 0, expected: { kind: "value", value: 0 } },
		{ name: "plain false", at: at("plain"), value: false, expected: { kind: "value", value: false } },
		{ name: "plain empty string", at: at("plain"), value: "", expected: { kind: "value", value: "" } },
		{ name: "plain object", at: at("plain"), value: { a: 1 }, expected: { kind: "value", value: { a: 1 } } }
	]
	it.each(Array.from({ length: rows().length }, (_, i) => i))("row %i", async (i) => {
		const row = rows()[i]!
		const read = await readStoredValue(db, kinds, row.at, row.value)
		if (row.expected === undefined) expect(read, row.name).toBeUndefined()
		else expect(read, row.name).toMatchObject(row.expected as object)
	})
})

describe("addsOnlyAt", () => {
	const decl = (path: string) => ({ nodeKey: "n", slot: "s", path }) as never
	const two = [decl("a"), decl("b")]
	const one = [decl("")]
	const where = (path: string) => ({ nodeKey: "n", slot: "s", path })
	const cases: {
		name: string
		before: any
		after: any
		decls: any
		at: { nodeKey: string; slot: string; path: string }
		value: unknown
		expected: boolean
	}[] = [
		{ name: "one address added on an empty layer", before: null, after: valuesWith(null, where(""), 1), decls: one, at: where(""), value: 1, expected: true },
		{ name: "one address changed beside another kept", before: { n: { s: { a: 1, b: 2 } } }, after: valuesWith({ n: { s: { a: 1, b: 2 } } }, where("b"), 3), decls: two, at: where("b"), value: 3, expected: true },
		{ name: "a whole-slot write over values held by path", before: { n: { s: { a: 1, b: 2 } } }, after: valuesWith({ n: { s: { a: 1, b: 2 } } }, where(""), 5), decls: two, at: where(""), value: 5, expected: false },
		{ name: "a write that also drops another address", before: { n: { s: { a: 1, b: 2 } } }, after: { n: { s: { a: 9 } } }, decls: two, at: where("a"), value: 9, expected: false }
	]
	it.each(cases)("$name", (c) => {
		expect(addsOnlyAt(c.before, c.after, c.decls, c.at, c.value)).toBe(c.expected)
	})
})

describe("settingLocksOf", () => {
	// A `-ref` slot takes a decision object whole at its own address.
	const decls = [
		{ nodeKey: "node", slot: "pick", path: "", control: "prompts-ref" },
		{ nodeKey: "node", slot: "params", path: "margin" }
	]
	const key = `node${SEP}pick${SEP}`
	const lock = (value: unknown) => ({ node: { pick: { value, lock: true } } })
	const plain = (value: unknown) => ({ node: { pick: value } })
	const locks = (layers: { instance?: any; genre?: any; preset?: any }) =>
		settingLocksOf({ instance: null, genre: null, preset: null, ...layers }, decls as never)
	const cases: { name: string; layers: { instance?: any; genre?: any; preset?: any }; expected: [string, unknown, string][] }[] = [
		{ name: "a genre lock", layers: { genre: lock(1) }, expected: [[key, 1, "genre"]] },
		{ name: "a preset lock", layers: { preset: lock(2) }, expected: [[key, 2, "preset"]] },
		{
			name: "a null preset lock holds the genre's value",
			layers: { genre: plain(5), preset: lock(null) },
			expected: [[key, 5, "preset"]]
		},
		{ name: "a null genre lock with nothing below holds undefined", layers: { genre: lock(null) }, expected: [[key, undefined, "genre"]] },
		{ name: "a genre lock beats a preset lock", layers: { genre: lock(1), preset: lock(2) }, expected: [[key, 1, "genre"]] },
		{ name: "an instance lock where the genre states nothing", layers: { instance: lock(3) }, expected: [[key, 3, "genre"]] },
		{ name: "an instance lock under a plain genre value", layers: { instance: lock(3), genre: plain(1) }, expected: [] },
		{ name: "a decision without a lock", layers: { genre: plain({ value: 1, askAtStart: true }) }, expected: [] },
		{
			name: "a lock inside a params slot keyed by path",
			layers: { genre: { node: { params: { margin: { value: 0.2, lock: true } } } } },
			expected: [[`node${SEP}params${SEP}margin`, 0.2, "genre"]]
		}
	]
	it.each(cases)("$name", (c) => {
		const got = [...locks(c.layers)].map(([k, l]) => [k, l.value, l.layer])
		expect(got).toEqual(c.expected)
	})
})
