/**
 * The compiled-template cache in `renderers.ts` (review row C4).
 *
 * The cache holds a compiled TEMPLATE, never a result, and its key carries the
 * format's content, so every test here is a way of asking "can a render depend
 * on what ran before it?" — the answer has to be no.
 */

import { describe, expect, it } from "vitest"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE,
	_templateCacheSize,
	renderTemplate
} from "$lib/server/pipelines/prompt/renderers"
import { builtinCompletionTemplate } from "$lib/shared/constants/completionTemplates"

const HB = CORE_TEMPLATE_ENGINE
const LQ = CORE_LIQUID_ENGINE

const HB_BLOCK = "{{#systemBlock}}x{{/systemBlock}}"
const LQ_BLOCK = "{% systemBlock %}x{% endsystemBlock %}"

function render(
	engine: string,
	template: string,
	extra: {
		promptFormat?: string
		completionTemplate?: any
		variables?: Record<string, unknown>
	} = {}
) {
	return renderTemplate(engine, {
		template,
		variables: extra.variables ?? {},
		promptFormat: extra.promptFormat,
		completionTemplate: extra.completionTemplate
	})
}

describe.each([
	["handlebars", HB, HB_BLOCK],
	["liquid", LQ, LQ_BLOCK]
])("%s: format is part of the key", (_n, engine, tpl) => {
	it("same source, two formats, interleaved A B A", async () => {
		const a1 = await render(engine, tpl, { promptFormat: "chatml" })
		const b = await render(engine, tpl, { promptFormat: "vicuna" })
		const a2 = await render(engine, tpl, { promptFormat: "chatml" })
		expect(a1).not.toBe(b)
		expect(a2).toBe(a1)
		expect(a1).toContain("<|im_start|>")
	})

	it("a different variable set gives a different result", async () => {
		const t =
			engine === HB
				? "{{name}} / {{#each xs}}{{this}},{{/each}}"
				: "{{ name }} / {% for x in xs %}{{ x }},{% endfor %}"
		const one = await render(engine, t, {
			variables: { name: "a", xs: [1, 2] }
		})
		const two = await render(engine, t, {
			variables: { name: "b", xs: [3] }
		})
		expect(one).toBe("a / 1,2,")
		expect(two).toBe("b / 3,")
	})
})

describe.each([
	["handlebars", HB, HB_BLOCK],
	["liquid", LQ, LQ_BLOCK]
])("%s: an edited CompletionTemplate row always shows", (_n, engine, tpl) => {
	const base = () => {
		const row = structuredClone(builtinCompletionTemplate("chatml")) as any
		row.key = `edit-${engine}`
		return row
	}

	it("a new object with edited roles renders the new framing", async () => {
		const row = base()
		const before = await render(engine, tpl, { completionTemplate: row })
		const edited = structuredClone(row)
		edited.roles.system.prefix = "[[SYS]]"
		const after = await render(engine, tpl, { completionTemplate: edited })
		expect(after).toContain("[[SYS]]")
		expect(after).not.toBe(before)
		// and the original content still renders the original framing
		expect(await render(engine, tpl, { completionTemplate: row })).toBe(
			before
		)
	})

	it("the same object mutated in place cannot corrupt a render of the original content", async () => {
		const row = base()
		const original = structuredClone(row)
		const before = await render(engine, tpl, { completionTemplate: row })
		row.roles.system.prefix = "[[MUT]]"
		const mutated = await render(engine, tpl, { completionTemplate: row })
		expect(mutated).toContain("[[MUT]]")
		const again = await render(engine, tpl, {
			completionTemplate: original
		})
		expect(again).toBe(before)
	})
})

describe("a template that fails to parse stores nothing", () => {
	it("throws every time", async () => {
		await expect(render(LQ, "{% systemBlock %}x")).rejects.toThrow()
		await expect(render(LQ, "{% systemBlock %}x")).rejects.toThrow()
		await expect(render(HB, "{{#systemBlock}}x")).rejects.toThrow()
		await expect(render(HB, "{{#systemBlock}}x")).rejects.toThrow()
	})
})

describe("the cache is bounded", () => {
	it("never exceeds 128 entries", async () => {
		for (let i = 0; i < 200; i++) {
			await render(HB, `n${i} {{x}}`)
			await render(LQ, `n${i} {{ x }}`)
			expect(_templateCacheSize()).toBeLessThanOrEqual(128)
		}
		expect(_templateCacheSize()).toBe(128)
	})
})

const BENCH_TEMPLATE_HB = (() => {
	let s = "{{#systemBlock}}You are a narrator. {{name}}.{{/systemBlock}}\n"
	for (let i = 0; i < 12; i++)
		s += `Section ${i}: some fixed prose to pad the template out to a realistic size.\n{{#each items}}- {{this.label}}: {{this.text}} ({{@index}})\n{{/each}}\n`
	return s + "{{#userBlock}}{{name}} speaks.{{/userBlock}}"
})()
const BENCH_TEMPLATE_LQ = (() => {
	let s =
		"{% systemBlock %}You are a narrator. {{ name }}.{% endsystemBlock %}\n"
	for (let i = 0; i < 12; i++)
		s += `Section ${i}: some fixed prose to pad the template out to a realistic size.\n{% for it in items %}- {{ it.label }}: {{ it.text }} ({{ forloop.index0 }})\n{% endfor %}\n`
	return s + "{% userBlock %}{{ name }} speaks.{% enduserBlock %}"
})()

describe.skipIf(!process.env.PERF_BENCH)("bench", () => {
	const items = Array.from({ length: 20 }, (_, i) => ({
		label: `item ${i}`,
		text: `description of item number ${i}`
	}))
	for (const [name, engine, tpl] of [
		["handlebars", HB, BENCH_TEMPLATE_HB],
		["liquid", LQ, BENCH_TEMPLATE_LQ]
	] as const) {
		it(`${name} p50 over 50 renders`, async () => {
			console.log(`${name} template bytes`, tpl.length)
			const times: number[] = []
			for (let i = 0; i < 50; i++) {
				const t0 = performance.now()
				await render(engine, tpl, {
					promptFormat: "chatml",
					variables: { name: "Vell", items }
				})
				times.push(performance.now() - t0)
			}
			times.sort((a, b) => a - b)
			console.log(`BENCH ${name} p50 ms`, times[25].toFixed(3))
		})
	}
})
