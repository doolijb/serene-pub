/**
 * The derivation, proven to REFUSE — by compiling code that must not compile.
 *
 * `bindingInput.typetest.ts` beside this file pins the same rule with
 * `@ts-expect-error`, and that is the guard `npm run check` enforces on every
 * commit. It has one blind spot: a directive proves *an* error happened on that
 * line, never *which*. A derivation that had degenerated into `never` would
 * satisfy every one of them.
 *
 * So this test writes a handler that reads an undeclared parameter, runs `tsc`
 * over it for real, and asserts the diagnostic **names the parameter**. That is
 * the exact defect the guards used to catch after the fact — `paramsSlotWiring`
 * and the signal-wiring re-projections found `topK`, `limit` and `minScore`
 * *once they had shipped*, by comparing declarations against specs. This finds
 * the same class before the file saves.
 *
 * ⚠ The fixture is compiled in isolation, against the two published
 * declaration files, not against the app project. That is deliberate on both
 * counts: it is what a plugin author's build actually looks like, and it keeps
 * this test at well under a second instead of typechecking seven thousand
 * files.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repo = process.cwd()
const modules = join(repo, "node_modules")
const tsc = join(modules, "typescript", "bin", "tsc")

/**
 * Every fixture directory this file made, removed when it is done.
 *
 * Several integration tests in this repo leave theirs behind; a typecheck is
 * six directories a run and there is no database in them worth keeping, so this
 * one tidies up after itself.
 */
const made: string[] = []
afterAll(() => {
	for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/** Compile one fixture against the published SDK + contracts declarations. */
function typecheck(source: string): string {
	const dir = mkdtempSync(join(tmpdir(), "sp-inputof-"))
	made.push(dir)
	writeFileSync(join(dir, "fixture.ts"), source, "utf8")
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				noEmit: true,
				strict: true,
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "bundler",
				skipLibCheck: true,
				types: [],
				baseUrl: modules,
				paths: {
					"@serene-pub/sdk": ["@serene-pub/sdk/dist/index.d.ts"],
					"@serene-pub/contracts": [
						"@serene-pub/contracts/dist/index.d.ts"
					]
				}
			},
			files: ["fixture.ts"]
		}),
		"utf8"
	)
	try {
		execFileSync(
			process.execPath,
			[tsc, "-p", join(dir, "tsconfig.json")],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"]
			}
		)
		return ""
	} catch (e: any) {
		// tsc reports diagnostics on stdout and exits non-zero.
		return `${e.stdout ?? ""}${e.stderr ?? ""}`
	}
}

const PRELUDE = `import type { InputOf } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
`

describe("a handler's input type comes from its contract", () => {
	beforeAll(() => {
		// The walk that could lie. A missing compiler or a missing declaration
		// file makes every "this must not compile" assertion pass by failing to
		// compile *anything*.
		expect(existsSync(tsc), `no tsc at ${tsc}`).toBe(true)
		expect(
			existsSync(
				resolve(modules, "@serene-pub/contracts/dist/index.d.ts")
			)
		).toBe(true)
	})

	it("compiles a handler that reads only declared names", () => {
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.vectorSearch>) => ({
	vectors: input.vectors,
	scope: input.scope,
	topK: input.params?.topK ?? 40
})
`
		)
		// Stated first and asserted plainly: if the fixture could not compile
		// for some unrelated reason, every refusal below would be vacuous.
		expect(out).toBe("")
	})

	it("REFUSES a read of an undeclared parameter, and names it", () => {
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.vectorSearch>) =>
	input.params?.minScore ?? 0.35
`
		)
		expect(out).not.toBe("")
		expect(out).toContain("minScore")
		expect(out).toContain("error TS2339")
		// The type is named in the diagnostic, so the reader is told which
		// contract failed to declare it rather than only that something did.
		expect(out).toContain("core:query/vector-search@1")
	})

	it("REFUSES a parameter read at the top level — the shipped defect", () => {
		// `topK` IS declared, as a parameter. Read here it is `undefined`, and
		// the `?? 40` behind it is what every install actually searched at.
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.vectorSearch>) =>
	input.topK ?? 40
`
		)
		expect(out).toContain("error TS2339")
		expect(out).toContain("topK")
	})

	it("REFUSES the same defect on session-history's `limit`", () => {
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.sessionHistory>) =>
	input.limit ?? 100
`
		)
		expect(out).toContain("error TS2339")
		expect(out).toContain("limit")
	})

	it("REFUSES `input.params` on a type that declares no parameters slot", () => {
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.userMessage>) =>
	input.params
`
		)
		expect(out).toContain("error TS2339")
		expect(out).toContain("params")
	})

	/**
	 * The declaration side (R-12). `reads<C>()` types its arrays against the
	 * same contract `InputOf<C>` derives from, so the list a handler SAYS it
	 * reads cannot name what the definition lacks — the diagnostic names the
	 * bad literal and the accepted union, which is what makes the guard in
	 * `boot/declaredReads.ts` able to trust a declaration.
	 */
	it("REFUSES a `reads` declaration naming a parameter the definition lacks, and names it", () => {
		const out = typecheck(
			PRELUDE +
				`import { reads, ok } from "@serene-pub/sdk"
export const h = reads<typeof C.vectorSearch>(
	async (input: InputOf<typeof C.vectorSearch>) => ok({ main: input.vectors }),
	{ ports: ["scope", "vectors"], params: ["topK", "minScore"] }
)
`
		)
		expect(out).toContain("error TS2322")
		expect(out).toContain("minScore")
		expect(out).toContain('"similarityFalloff"')
	})

	it("REFUSES a `reads` declaration naming a parameter as a port — the shipped confusion", () => {
		const out = typecheck(
			PRELUDE +
				`import { reads, ok } from "@serene-pub/sdk"
export const h = reads<typeof C.vectorSearch>(
	async (input: InputOf<typeof C.vectorSearch>) => ok({ main: input.vectors }),
	{ ports: ["topK"] }
)
`
		)
		expect(out).toContain("error TS2322")
		expect(out).toContain("topK")
	})

	it("compiles a `reads` declaration that names only what the definition declares", () => {
		const out = typecheck(
			PRELUDE +
				`import { reads, ok } from "@serene-pub/sdk"
export const h = reads<typeof C.vectorSearch>(
	async (input: InputOf<typeof C.vectorSearch>) => ok({ main: input.vectors }),
	{ ports: ["scope", "vectors"], params: ["maxEntries", "topK", "similarityFalloff"] }
)
`
		)
		expect(out).toBe("")
	})

	it("types a parameter's VALUE from the schema, not just its name", () => {
		const out = typecheck(
			PRELUDE +
				`export const h = async (input: InputOf<typeof C.sessionHistory>) => {
	const wrong: string = input.params?.limit ?? ""
	return wrong
}
`
		)
		// `limit` is declared `integer`, so a `string` annotation is a type
		// error rather than an unchecked `any`.
		expect(out).toContain("error TS2322")
		expect(out).toContain("number")
	})
})
