/**
 * Every session widget core declares is mounted remote from `/core-ui/<slug>`
 * (R79), so the route serves every component core declares — a widget
 * whose module were missing would mount a box that 404s — and nothing it
 * does not.
 */
import { describe, expect, test } from "vitest"
import { GET } from "./+server"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"

const get = (slug: string) =>
	(GET as unknown as (e: { params: { slug: string }; request: Request }) => Response)({
		params: { slug },
		request: new Request(`http://localhost/core-ui/${slug}`)
	})

const components = CORE_WIDGETS.map((w) => w.component).filter((c): c is string => typeof c === "string")

describe("/core-ui serves every component core declares", () => {
	test.each(components)("'%s' is served", (slug) => {
		expect(get(slug).status).toBe(200)
	})

	test("a slug core declares no component for is not", () => {
		expect(get("inventory").status).toBe(404)
		expect(get("../messages").status).toBe(404)
		expect(get("core-ui.json").status).toBe(404)
	})
})

/**
 * Unit M: core's modules share one runtime in core's worker. What they have
 * in common is built once into `shared-<hash>.js` chunks, served here beside
 * them, so the worker loads Svelte once however many core widgets are shown.
 */
describe("/core-ui shares one runtime among core's modules", () => {
	const served = async () => {
		const seen = new Map<string, string>()
		const visit = async (name: string) => {
			if (seen.has(name)) return
			const res = get(name)
			expect(res.status, `${name} is served`).toBe(200)
			const code = await res.text()
			seen.set(name, code)
			// `./shared-….js` from `/core-ui/<slug>` is `/core-ui/shared-….js`.
			for (const [, spec] of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"']*?["'](\.\/[^"']+)["']/g))
				await visit(spec.slice(2))
		}
		for (const slug of components) await visit(slug)
		return seen
	}

	test("every module a core module imports is served, from /core-ui", async () => {
		const seen = await served()
		for (const [name, code] of seen) {
			// Nothing but its own relative chunks: no bare specifier, no other path.
			for (const [, spec] of code.matchAll(/(?:^|\n)\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/g))
				expect(spec, `${name} imports ${spec}`).toMatch(/^\.\/shared-[A-Za-z0-9_-]+\.js$/)
		}
	})

	test("Svelte's runtime is in exactly one module core's worker loads", async () => {
		const seen = await served()
		// `__svelte` is Svelte's version disclosure: once per copy of its client runtime.
		const carriers = [...seen].filter(([, code]) => code.includes("__svelte")).map(([name]) => name)
		expect(carriers).toHaveLength(1)
		expect(carriers[0]).toMatch(/^shared-/)
	})

	test("a shared chunk is revalidated like a module", async () => {
		const chunk = [...(await served()).keys()].find((n) => n.startsWith("shared-"))!
		const first = get(chunk)
		expect(first.headers.get("content-type")).toMatch(/^text\/javascript/)
		const etag = first.headers.get("etag")!
		const again = (GET as unknown as (e: { params: { slug: string }; request: Request }) => Response)({
			params: { slug: chunk },
			request: new Request(`http://localhost/core-ui/${chunk}`, { headers: { "if-none-match": etag } })
		})
		expect(again.status).toBe(304)
	})
})
