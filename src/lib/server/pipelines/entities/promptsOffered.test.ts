/**
 * Owner note 37 (2026-10-02) and D59 (2026-11-16): a model call offers the
 * prompts made for its own pipeline, plus its default.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db/schema", () => ({}))
vi.mock("$lib/server/pipelines/config/panel", () => ({ declarations: vi.fn() }))

import { promptDefaultsOf, promptsOffered } from "./prompts"

const SPEC = 7
const THIS = "a\u0000prompts\u0000"
const OTHER = "b\u0000prompts\u0000"
const OFF = 42

type P = { id: number; createdForSpecId: number | null; hidden?: boolean; ownerPluginId?: number | null }
const own = (id: number, hidden = false): P => ({ id, createdForSpecId: SPEC, hidden })
const foreign = (id: number, hidden = false): P => ({ id, createdForSpecId: 9, hidden })
const none = (id: number, hidden = false): P => ({ id, createdForSpecId: null, hidden })
const off = (id: number): P => ({ id, createdForSpecId: SPEC, ownerPluginId: OFF })

const offer = (
	pool: P[],
	o: { defaults?: Array<[string, number]>; inForce?: unknown; administrator?: boolean } = {}
) =>
	promptsOffered(pool, {
		specId: SPEC,
		address: THIS,
		defaults: new Map(o.defaults ?? []),
		inForce: o.inForce ?? null,
		administrator: o.administrator ?? true,
		pluginsOff: { owns: (id) => id === OFF }
	}).map((p) => p.id)

describe("promptsOffered", () => {
	test("own pipeline's prompts are kept", () => {
		expect(offer([own(1), own(2)])).toEqual([1, 2])
	})
	test("another pipeline's prompt is dropped", () => {
		expect(offer([own(1), foreign(2)])).toEqual([1])
	})
	test("a prompt with no pipeline is dropped for a non-administrator, kept for an administrator", () => {
		expect(offer([none(1), own(2)], { administrator: false })).toEqual([2])
		expect(offer([none(1), own(2)], { administrator: true })).toEqual([1, 2])
		expect(offer([none(1), none(2)], { defaults: [[OTHER, 2]], administrator: true })).toEqual([1, 2])
	})
	test("a prompt with no pipeline is kept for anyone when it is this call's default or in force", () => {
		expect(offer([none(1), none(2)], { defaults: [[THIS, 1]], administrator: false })).toEqual([1])
		expect(offer([none(1), none(2)], { inForce: 2, administrator: false })).toEqual([2])
	})
	test("a switched-off plugin's prompt is dropped for everyone, administrators included, kept in force", () => {
		expect(offer([off(1), own(2)], { administrator: false })).toEqual([2])
		expect(offer([off(1), own(2)], { administrator: true })).toEqual([2])
		expect(offer([off(1), own(2)], { inForce: 1, administrator: false })).toEqual([1, 2])
		expect(offer([off(1), own(2)], { inForce: 1, administrator: true })).toEqual([1, 2])
	})
	test("another call's default (own pipeline) is dropped", () => {
		expect(offer([own(1), own(2)], { defaults: [[OTHER, 2]] })).toEqual([1])
	})
	test("in force is kept though foreign, another's default or hidden", () => {
		const o = { defaults: [[OTHER, 3]] as Array<[string, number]>, administrator: false }
		expect(offer([foreign(1)], { ...o, inForce: 1 })).toEqual([1])
		expect(offer([own(3)], { ...o, inForce: 3 })).toEqual([3])
		expect(offer([own(4, true)], { ...o, inForce: 4 })).toEqual([4])
	})
	test("own default is kept though foreign or another's default", () => {
		expect(offer([foreign(1)], { defaults: [[THIS, 1]] })).toEqual([1])
		expect(offer([own(2)], { defaults: [[THIS, 2], [OTHER, 2]] })).toEqual([2])
	})
	test("hidden is dropped for a non-admin, kept for an admin", () => {
		expect(offer([own(1, true), own(2)], { administrator: false })).toEqual([2])
		expect(offer([own(1, true), own(2)], { administrator: true })).toEqual([1, 2])
	})
	test("a hidden own default not in force is dropped for a non-admin", () => {
		expect(offer([own(1, true)], { defaults: [[THIS, 1]], administrator: false })).toEqual([])
	})
	test("digit-string ids compare as numbers", () => {
		expect(offer([foreign(1), own(2), own(3)], { inForce: "1", defaults: [[OTHER, 2]] })).toEqual([1, 3])
		const d = promptDefaultsOf(
			[{ control: "prompts-ref", nodeKey: "a", slot: "prompts", path: "", authorDefault: null }],
			new Map([[THIS, "5"]])
		)
		expect(offer([foreign(5)], { defaults: [...d] })).toEqual([5])
	})
	test("pool order is preserved", () => {
		expect(offer([own(3), none(1), own(2)])).toEqual([3, 1, 2])
	})
})

describe("promptDefaultsOf", () => {
	test("only prompts-ref addresses count", () => {
		const d = promptDefaultsOf(
			[
				{ control: "prompts-ref", nodeKey: "a", slot: "prompts", path: "", authorDefault: null },
				{ control: "sampling-ref", nodeKey: "s", slot: "sampling", path: "", authorDefault: null }
			] as any,
			new Map<string, unknown>([
				[THIS, 4],
				["s\u0000sampling\u0000", 4]
			])
		)
		expect([...d]).toEqual([[THIS, 4]])
	})
	test("falls back to authorDefault when the map lacks the address", () => {
		const d = promptDefaultsOf(
			[{ control: "prompts-ref", nodeKey: "a", slot: "prompts", path: "", authorDefault: 8 }],
			new Map()
		)
		expect(d.get(THIS)).toBe(8)
	})
})
