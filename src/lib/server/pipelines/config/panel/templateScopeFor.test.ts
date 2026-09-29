/**
 * Typed templates P3: the panel's `context-template-ref` carries the
 * template's typed scope, computed with SDK `templateScopeAt` over the stored
 * document and the REGISTRY ROWS — slots, ports, `policy.bands` and
 * `policy.portSchemas` — never a loaded plugin (F6).
 *
 * The Twenty Questions speak path, as stored: the secret band, the briefing
 * band and the plugin's declared annex key are all in scope, and typed.
 */
import { afterAll, describe, it, expect } from "vitest"
import { assemble, buildTemplateContext } from "@serene-pub/contracts"
import {
	_withdrawAnnex,
	annexField,
	declareAnnex,
	type SpecDocument,
	type VarField
} from "@serene-pub/sdk"
import {
	templateScopeDetailFor,
	templateScopeFor
} from "$lib/server/pipelines/config/panel/declarations"

const TQ = "showcase.twenty-questions"
const CANDIDATES = "core:shape/context-candidates@1"
const TEMPLATE_CONTEXT = "core:shape/template-context@1"

const node = (key: string, definitionId: string, config = {}) => ({
	key,
	kind: "task",
	definitionId,
	definitionVersion: definitionId === "core:task/assemble" ? 2 : 1,
	config,
	position: 0
})

const doc = {
	input: { genre: `${TQ}:genre/game` },
	nodes: [
		node("context", "core:task/build-template-context"),
		node("lore", "core:query/lorebook-triggers"),
		node("secret", `${TQ}:task/pick-secret-entry`),
		node("tally", `${TQ}:task/tally-question`),
		node("pool", "core:task/concat-candidates"),
		node("rank", "core:task/rank-hybrid"),
		node("annexRead", "core:query/session-annex", { view: "template" }),
		node("speakPrompt", "core:task/assemble", {
			prompts: { __ref: "slot", slot: "prompts", ofNode: "context" }
		})
	],
	edges: [
		{ from: "lore", fromPort: "hits", to: "pool", toPort: "sources.0" },
		{ from: "secret", fromPort: "candidates", to: "pool", toPort: "sources.1" },
		{ from: "tally", fromPort: "candidates", to: "pool", toPort: "sources.2" },
		{ from: "pool", fromPort: "candidates", to: "rank", toPort: "candidates" },
		{ from: "rank", fromPort: "candidates", to: "speakPrompt", toPort: "candidates" },
		{
			from: "context",
			fromPort: "templateContext",
			to: "speakPrompt",
			toPort: "templateContext"
		},
		// P6: the template view of the annex on Assemble's `annex` port.
		{ from: "annexRead", fromPort: "main", to: "speakPrompt", toPort: "annex" }
	]
} as unknown as SpecDocument

/** Registry rows, as the table holds them. */
const rows = new Map<string, any>([
	[
		"core:task/build-template-context@1",
		{
			slots: buildTemplateContext.descriptor.slots,
			ports: { in: {}, out: { templateContext: TEMPLATE_CONTEXT } },
			policy: { portSchemas: buildTemplateContext.descriptor.portSchemas }
		}
	],
	[
		"core:query/lorebook-triggers@1",
		{
			ports: { in: { scope: "core:shape/session-scope@1" } },
			policy: {
				bands: {
					characterLore: "core:var/character-lore@1",
					history: "core:var/history@1",
					worldLore: "core:var/world-lore@1"
				}
			}
		}
	],
	[
		`${TQ}:task/pick-secret-entry@1`,
		{ ports: { in: {} }, policy: { bands: { secretEntry: `${TQ}:var/secret-entry@1` } } }
	],
	[
		`${TQ}:task/tally-question@1`,
		{ ports: { in: {} }, policy: { bands: { briefing: `${TQ}:var/briefing@1` } } }
	],
	["core:task/concat-candidates@1", { ports: { in: { sources: CANDIDATES } }, policy: {} }],
	["core:task/rank-hybrid@1", { ports: { in: { candidates: CANDIDATES } }, policy: {} }],
	[
		"core:task/assemble@2",
		{
			slots: assemble.descriptor.slots,
			ports: {
				in: {
					candidates: CANDIDATES,
					templateContext: TEMPLATE_CONTEXT,
					annex: "core:shape/json@1"
				}
			},
			policy: {}
		}
	]
])

declareAnnex(TQ, [
	annexField({
		key: "secret",
		shape: {
			type: "object",
			fields: {
				secretEntryId: { type: "integer", min: 0 },
				secretEntryName: { type: "string" },
				secretEntryText: { type: "string" }
			}
		},
		see: ["ai"]
	})
])
afterAll(() => _withdrawAnnex(TQ))

const at = (scope: Record<string, unknown>, root: string) => scope[root] as VarField

describe("templateScopeFor (typed templates P3)", () => {
	it("types the bands, the annex and the builder's keys, from rows", async () => {
		const scope = await templateScopeFor(async () => doc, "speakPrompt", "template", rows)
		expect(at(scope, "secretEntry")?.type).toBe("string")
		expect(at(scope, "briefing")?.type).toBe("string")
		const secret = at(scope, "annex")?.fields?.[TQ]?.fields?.secret
		expect(secret?.type).toBe("object")
		expect(secret?.fields?.secretEntryName?.type).toBe("string")
		// The builder's declared payload, and its prompts through the reference.
		expect(at(scope, "characters")?.type).toBe("string")
		expect(at(scope, "systemPrompt")?.type).toBe("string")
		// Assemble's own, as render() supplies them.
		expect(at(scope, "sessionMessages")?.of?.fields?.message?.type).toBe("string")
		expect(scope.blocks).toBeUndefined()
	})

	it("P6: no annex in scope where nothing feeds the annex port", async () => {
		const unwired = {
			...doc,
			edges: doc.edges.filter((e) => e.toPort !== "annex")
		} as unknown as SpecDocument
		const scope = await templateScopeFor(async () => unwired, "speakPrompt", "template", rows)
		expect(scope.annex).toBeUndefined()
		expect(at(scope, "secretEntry")?.type).toBe("string")
	})

	it("refuses a builder key that shadows a declared band, naming both", async () => {
		const rival = new Map(rows)
		rival.set("core:task/build-template-context@1", {
			...rows.get("core:task/build-template-context@1"),
			policy: {
				portSchemas: {
					out: {
						templateContext: {
							type: "object",
							fields: { briefing: { type: "string" } }
						}
					}
				}
			}
		})
		await expect(
			templateScopeFor(async () => doc, "speakPrompt", "template", rival)
		).rejects.toThrow(
			/'briefing'.*'tally' \(showcase\.twenty-questions:task\/tally-question@1\).*'context' \(core:task\/build-template-context@1\)/s
		)
	})

	it("P7: declarers are labels, never node keys", async () => {
		const detail = await templateScopeDetailFor(async () => doc, "speakPrompt", "template", rows)
		expect(Object.keys(detail.declarers).sort()).toEqual(Object.keys(detail.scope).sort())
		expect(detail.declarers.annex).toEqual({ label: "Annex declarations", group: "annex" })
		expect(detail.declarers.secretEntry?.group).toBe("band")
		expect(detail.declarers.characters?.group).toBe("builder")
		expect(detail.declarers.sessionMessages?.group).toBe("self")
		const keys = doc.nodes.map((n) => n.key)
		for (const d of Object.values(detail.declarers)) {
			expect(d.label).not.toMatch(/'|@\d|:/)
			for (const k of keys) expect(d.label).not.toMatch(new RegExp(`'${k}'`))
		}
	})
})
