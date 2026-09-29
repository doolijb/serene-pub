/**
 * The editor's completion list, as a pure function of scope + source + caret
 * (typed templates P7). What the owner asked for (Q8): a capable editor — the
 * typed roots after `{{`, the children after `.`, the element inside an each,
 * the helpers with a signature, and the same for Liquid.
 */
import { describe, expect, test } from "vitest"
import {
	completionsAt,
	describeAt,
	scopeTreeNodes,
	type ScopeDeclarer
} from "./templateAssist"
import { templateDiagnostics } from "./templateDiagnostics"
import type { TemplateScope } from "@serene-pub/sdk"

const HB = "core:template/handlebars@1"
const LIQUID = "core:template/liquid@1"

const SCOPE: TemplateScope = {
	characters: {
		type: "list",
		description: "Everyone in the scene.",
		of: {
			type: "object",
			fields: {
				name: { type: "string", description: "What they're called." },
				nickname: { type: "string", optional: true }
			}
		}
	},
	scenario: { type: "string", description: "The scene." },
	secretEntry: { type: "string", optional: true, description: "The secret." },
	annex: {
		type: "object",
		optional: true,
		fields: {
			core: {
				type: "object",
				fields: { mood: { type: "string" } }
			},
			"showcase.twenty-questions": {
				type: "object",
				optional: true,
				fields: {
					secret: {
						type: "object",
						fields: { secretEntryName: { type: "string" } }
					}
				}
			}
		}
	},
	state: {
		type: "object",
		optional: true,
		fields: {
			world: { type: "record" },
			cast: {
				type: "record",
				of: {
					type: "object",
					fields: {
						id: { type: "number" },
						name: { type: "string" },
						health: { type: "number" }
					}
				}
			}
		}
	}
}

const DECLARERS: Record<string, ScopeDeclarer> = {
	characters: { label: "Build template context", group: "builder" },
	scenario: { label: "Build template context", group: "builder" },
	secretEntry: { label: "Twenty Questions judge", group: "band" },
	annex: { label: "Annex declarations", group: "annex" },
	state: { label: "Build template context", group: "builder" }
}

const CURSOR = "‸"
function at(marked: string) {
	const offset = marked.indexOf(CURSOR)
	if (offset === -1) throw new Error("no cursor marker")
	return {
		source: marked.slice(0, offset) + marked.slice(offset + 1),
		offset
	}
}
const complete = (marked: string, engine = HB) => {
	const { source, offset } = at(marked)
	return completionsAt(source, offset, SCOPE, { engine, declarers: DECLARERS })
}
const labels = (marked: string, engine = HB) =>
	complete(marked, engine).map((c) => c.label)
/** Apply a completion the way the editor does, caret included. */
const apply = (marked: string, label: string, engine = HB) => {
	const { source } = at(marked)
	const c = complete(marked, engine).find((x) => x.label === label)
	if (!c) throw new Error(`no completion ${label}`)
	const out = source.slice(0, c.start) + c.insert + source.slice(c.end)
	const caret = c.start + (c.select ? c.select.end : c.insert.length)
	return out.slice(0, caret) + CURSOR + out.slice(caret)
}

describe("roots after {{", () => {
	test("the typed roots, with type, description and declarer", () => {
		const items = complete("{{‸").filter((c) => c.kind === "variable")
		expect(items.map((c) => c.label)).toEqual([
			"characters",
			"scenario",
			"secretEntry",
			"annex",
			"state"
		])
		const s = items.find((c) => c.label === "scenario")!
		expect(s.type).toBe("string")
		expect(s.description).toBe("The scene.")
		expect(s.declarer).toBe("Build template context")
	})

	test("the triple stash too", () => {
		expect(labels("{{{sec‸")).toEqual(["secretEntry"])
	})

	test("ranking: exact prefix, then fuzzy", () => {
		// `sc` prefixes scenario; `secretEntry` only matches as a subsequence
		// of `sE` — fuzzy comes after.
		expect(labels("{{se‸")[0]).toBe("secretEntry")
		expect(labels("{{scnr‸")).toEqual(["scenario", "secretEntry"])
		const ranked = labels("{{st‸")
		expect(ranked[0]).toBe("state")
	})

	test("grouped: context, then band, then annex, then state, then helpers", () => {
		const order = labels("{{‸")
		expect(order.indexOf("scenario")).toBeLessThan(order.indexOf("secretEntry"))
		expect(order.indexOf("secretEntry")).toBeLessThan(order.indexOf("annex"))
		expect(order.indexOf("annex")).toBeLessThan(order.indexOf("state"))
		expect(order.indexOf("state")).toBeLessThan(order.indexOf("json"))
	})
})

describe("children after .", () => {
	test("an object's fields", () => {
		expect(labels("{{annex.‸")).toEqual(["core", "showcase.twenty-questions"])
	})

	test("a dotted owner inserts the segment-literal brackets", () => {
		expect(apply("{{annex.show‸", "showcase.twenty-questions")).toBe(
			"{{annex.[showcase.twenty-questions]‸"
		)
	})

	test("walks through a bracketed owner", () => {
		expect(labels("{{annex.[showcase.twenty-questions].‸")).toEqual(["secret"])
		expect(
			labels("{{annex.[showcase.twenty-questions].secret.‸")
		).toEqual(["secretEntryName"])
	})

	test("a half-typed bracket still completes", () => {
		expect(labels("{{annex.[showcase.tw‸")).toEqual([
			"showcase.twenty-questions"
		])
	})

	test("a record offers a key placeholder, then the value's fields", () => {
		const c = complete("{{state.cast.‸")
		expect(c.map((x) => x.label)).toEqual(["‹member›"])
		expect(c[0]!.kind).toBe("placeholder")
		expect(labels("{{state.cast.wren.‸")).toEqual(["id", "name", "health"])
	})
})

describe("inside an each", () => {
	test("the element's fields, this and the loop data", () => {
		const l = labels("{{#each characters}}{{‸")
		expect(l).toEqual(
			expect.arrayContaining(["name", "nickname", "this", "@index", "@first", "@last"])
		)
		expect(l.indexOf("name")).toBeLessThan(l.indexOf("@index"))
	})

	test("`@` narrows to the loop data", () => {
		expect(labels("{{#each characters}}{{@i‸")).toEqual(["@index"])
	})

	test("outside an each there is no loop data", () => {
		expect(labels("{{@‸")).toEqual([])
	})
})

describe("helpers", () => {
	test("inline helpers carry a short signature", () => {
		const j = complete("{{{js‸").find((c) => c.label === "json")!
		expect(j.kind).toBe("helper")
		expect(j.detail).toMatch(/json value/)
		const p = complete("{{pa‸").find((c) => c.label === "pad")!
		expect(p.detail).toMatch(/pad n width/)
	})

	test("a block snippet closes the block, caret on the argument", () => {
		expect(apply("{{#ea‸", "each")).toBe("{{#each ‸}}\n\n{{/each}}")
	})

	test("a block snippet reuses braces already typed", () => {
		expect(apply("{{#i‸}}", "if")).toBe("{{#if ‸}}\n\n{{/if}}")
	})

	test("a role block puts the caret in the body", () => {
		expect(apply("{{#sys‸", "systemBlock")).toBe(
			"{{#systemBlock}}\n‸\n{{/systemBlock}}"
		)
	})
})

describe("Liquid", () => {
	test("{{ offers the roots", () => {
		expect(labels("{{ scena‸", LIQUID)).toEqual(["scenario"])
	})

	test("{% offers tags, with a closing snippet", () => {
		expect(labels("{% ‸", LIQUID)).toEqual(
			expect.arrayContaining(["if", "for", "assign", "systemBlock"])
		)
		expect(labels("{% ‸", LIQUID)).not.toContain("include")
		expect(apply("{% i‸", "if", LIQUID)).toBe("{% if ‸ %}\n\n{% endif %}")
	})

	test("filters after |", () => {
		const f = complete("{{ scenario | ‸", LIQUID)
		expect(f.map((x) => x.label)).toEqual(
			expect.arrayContaining(["json", "jsonValue", "pad", "upcase", "default"])
		)
		expect(f.every((x) => x.kind === "filter")).toBe(true)
		expect(labels("{{ scenario | jso‸", LIQUID)).toEqual(["json", "jsonValue"])
	})

	test("object paths walk like Handlebars", () => {
		expect(labels("{{ annex.‸", LIQUID)).toEqual([
			"core",
			"showcase.twenty-questions"
		])
		expect(labels("{{ characters.‸", LIQUID)).toEqual(
			expect.arrayContaining(["size", "first", "last"])
		)
	})

	test("a dotted owner inserts the bracket-string syntax", () => {
		expect(apply("{{ annex.sh‸", "showcase.twenty-questions", LIQUID)).toBe(
			'{{ annex["showcase.twenty-questions"]‸'
		)
		expect(
			labels('{{ annex["showcase.twenty-questions"].‸', LIQUID)
		).toEqual(["secret"])
	})

	test("a for loop's item has the element's fields", () => {
		expect(labels("{% for c in characters %}{{ c.‸", LIQUID)).toEqual([
			"name",
			"nickname"
		])
		expect(labels("{% for c in characters %}{{ ‸", LIQUID)).toEqual(
			expect.arrayContaining(["c", "forloop"])
		)
	})

	test("an open block offers its end tag first", () => {
		expect(labels("{% if scenario %}x{% ‸", LIQUID)[0]).toBe("endif")
	})
})

describe("hover", () => {
	test("type, description and declarer", () => {
		const { source, offset } = at("{{{secr‸etEntry}}}")
		expect(
			describeAt(source, offset, SCOPE, { declarers: DECLARERS })
		).toMatchObject({
			path: "secretEntry",
			type: "string",
			description: "The secret.",
			declarer: "Twenty Questions judge"
		})
	})

	test("a Liquid path", () => {
		const { source, offset } = at('{{ annex["showcase.twenty-questions"].sec‸ret }}')
		expect(
			describeAt(source, offset, SCOPE, { engine: LIQUID, declarers: DECLARERS })
		).toMatchObject({ type: "object", declarer: "Annex declarations" })
	})
})

describe("diagnostics", () => {
	test("an unknown root carries a did-you-mean fix", () => {
		const src = "{{{secretEntri}}}"
		const { diagnostics } = templateDiagnostics(HB, src, SCOPE)
		expect(diagnostics).toHaveLength(1)
		const d = diagnostics[0]!
		expect(d.severity).toBe("error")
		expect(d.fix).toBeTruthy()
		const fixed = src.slice(0, d.fix!.start) + d.fix!.text + src.slice(d.fix!.end)
		expect(fixed).toBe("{{{secretEntry}}}")
	})

	test("an unknown field fixes the segment, not the root", () => {
		const src = "{{#each characters}}{{nme}}{{/each}}{{annex.core.mod}}"
		const { diagnostics } = templateDiagnostics(HB, src, SCOPE)
		const fixed = diagnostics.reduceRight(
			(s, d) => (d.fix ? s.slice(0, d.fix.start) + d.fix.text + s.slice(d.fix.end) : s),
			src
		)
		expect(fixed).toBe("{{#each characters}}{{name}}{{/each}}{{annex.core.mood}}")
	})

	test("lenient turns name findings into warnings", () => {
		const { diagnostics } = templateDiagnostics(HB, "{{nope}}", SCOPE, {
			lenient: true
		})
		expect(diagnostics[0]!.severity).toBe("warning")
	})
})

describe("the variables tree", () => {
	test("paths per engine, with declarers", () => {
		const hb = scopeTreeNodes(SCOPE, { declarers: DECLARERS })
		const annex = hb.find((n) => n.label === "annex")!
		const tq = annex.children!.find((n) => n.label === "showcase.twenty-questions")!
		expect(tq.path).toBe("annex.[showcase.twenty-questions]")
		expect(tq.children![0]!.children![0]!.path).toBe(
			"annex.[showcase.twenty-questions].secret.secretEntryName"
		)
		expect(annex.declarer).toBe("Annex declarations")
		const lq = scopeTreeNodes(SCOPE, { engine: LIQUID })
		expect(
			lq.find((n) => n.label === "annex")!.children!.find((n) => n.label.startsWith("showcase"))!.path
		).toBe('annex["showcase.twenty-questions"]')
		const cast = hb
			.find((n) => n.label === "state")!
			.children!.find((n) => n.label === "cast")!
		expect(cast.children![0]!.path).toBe("state.cast.member")
	})
})

describe("the helper list stays whole", () => {
	test("every helper core registers has a signature", async () => {
		const { CONTEXT_HANDLEBARS_HELPERS } = await import("./templateCheckOptions")
		const { HANDLEBARS_HELPER_DOCS, LIQUID_FILTER_DOCS } = await import("./templateAssist")
		const { CONTEXT_LIQUID_FILTERS } = await import("./templateCheckOptions")
		for (const h of CONTEXT_HANDLEBARS_HELPERS) expect(HANDLEBARS_HELPER_DOCS[h], h).toBeTruthy()
		for (const f of CONTEXT_LIQUID_FILTERS) expect(LIQUID_FILTER_DOCS[f], f).toBeTruthy()
	})
})
