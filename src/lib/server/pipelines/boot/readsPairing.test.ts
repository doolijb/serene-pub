/**
 * `reads<typeof C.X>(…)` pairs with a handler typed `NodeInput<typeof C.X>` —
 * held by a walk over the SOURCE, because the type system cannot hold it.
 *
 * `reads<P>()` narrows the DECLARATION against `P` (a misspelt param does not
 * compile), but takes the handler as a plain `Hook`: nothing proves the
 * handler's own `input` was typed against the same contract. A registration
 * that declared against `C.worldLore` while its handler typed `input` as
 * `C.characterLore` would compile, pass `structuralCompat`, and read fields the
 * declaration never mentioned. The pairing is a convention; this is what keeps
 * it (U2 residual, 2026-09-16 — see the `reads` docblock in the SDK).
 *
 * The walk: for every `reads<typeof C.<name>>(` in a bindings file, the first
 * `typeof C.<other>` that follows it must be `NodeInput<typeof C.<name>>` (or
 * `InputOf`/`SharedInput` naming it) within the handler's opening lines. A
 * registration whose handler is a shared function is paired through the
 * `NodeInput<>` on that function's parameter — the walk follows a bare
 * identifier call to its declaration in the same file.
 */
import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"

const FILES = [
	"src/lib/server/pipelines/runtime/bindings.ts",
	"src/lib/server/pipelines/runtime/bindings.relationships.ts",
	"src/lib/server/pipelines/runtime/bindings.state.ts"
]

interface Site {
	file: string
	line: number
	declared: string
	paired: string | null
}

/** How many lines after `reads<…>(` a handler's `input` annotation may sit. */
const WINDOW = 6

const SHARED = /SharedInput<\s*\[([^\]]+)\]/
const DIRECT = /(?:NodeInput|InputOf)<\s*typeof C\.(\w+)\s*[,>]/
const namesIn = (list: string) =>
	[...list.matchAll(/typeof C\.(\w+)/g)].map((x) => x[1]!)

function walk(file: string): Site[] {
	const src = fs.readFileSync(path.resolve(process.cwd(), file), "utf8")
	const sites: Site[] = []
	// Over the whole source, not line by line: a registration may break the
	// type argument across lines (`reads<\n\ttypeof C.x\n>(`).
	for (const m of src.matchAll(/reads<\s*typeof C\.(\w+)\s*>\(/g)) {
		const declared = m[1]!
		const at = m.index! + m[0].length
		const line = src.slice(0, m.index!).split("\n").length
		const lines = src.slice(at).split("\n")
		const window = lines.slice(0, WINDOW + 1).join("\n")
		const pairedWith = (text: string): string | null => {
			const direct = DIRECT.exec(text)
			if (direct) return direct[1]!
			const shared = SHARED.exec(text)
			if (shared) {
				const names = namesIn(shared[1]!)
				return names.includes(declared) ? declared : names.join("|")
			}
			return null
		}
		const local = pairedWith(window)
		if (local) {
			sites.push({ file, line, declared, paired: local })
			continue
		}
		// The indirect form: the handler is a bare identifier, or an arrow
		// delegating to one, declared elsewhere in the file with a typed
		// `input` parameter.
		const call =
			/^\s*(?:\(\s*\w+\s*,\s*\w+\s*\)\s*=>\s*(\w+)\(|(\w+)\s*,)/.exec(window)
		const fn = call?.[1] ?? call?.[2]
		if (fn) {
			const decl = new RegExp(
				`(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=)([\\s\\S]{0,600})`
			).exec(src)
			const viaDecl = decl ? pairedWith(decl[1]!) : null
			sites.push({ file, line, declared, paired: viaDecl })
			continue
		}
		sites.push({ file, line, declared, paired: null })
	}
	return sites
}

const SITES = FILES.flatMap(walk)

describe("every reads<typeof C.X> pairs with a handler typed against C.X", () => {
	it("found the registrations it is about", () => {
		// A walk that matched nothing would pass the assertion below for free.
		expect(SITES.length).toBeGreaterThan(40)
	})

	it("every site is paired with the same contract", () => {
		const mismatched = SITES.filter((s) => s.paired !== s.declared)
		expect(
			mismatched.map(
				(s) =>
					`${s.file}:${s.line} declares reads<typeof C.${s.declared}> but its ` +
					`handler types input as ${s.paired ? `C.${s.paired}` : "nothing the walk could see"}`
			),
			"a reads<> declaration must sit on a handler whose `input` is " +
				"NodeInput<> of the same contract — the declaration cannot check " +
				"this itself (see the SDK `reads` docblock)"
		).toEqual([])
	})
})
