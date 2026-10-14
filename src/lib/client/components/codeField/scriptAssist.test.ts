import { describe, expect, test } from "vitest"
import { EditorState } from "@codemirror/state"
import { ensureSyntaxTree } from "@codemirror/language"
import { javascript } from "@codemirror/lang-javascript"
import { CompletionContext } from "@codemirror/autocomplete"
import { scriptCompletions, scriptDiagnostics } from "./scriptAssist"

const assist = { declared: ["messages"], offered: ["messages", "cast", "seed"] }

function state(src: string) {
	const s = EditorState.create({ doc: src, extensions: [javascript()] })
	ensureSyntaxTree(s, src.length, 1000)
	return s
}

describe("script lint", () => {
	test("a clean body with declared reads has no findings", () => {
		expect(scriptDiagnostics(state("return { messages: messages.slice(-2) }"), assist)).toEqual([])
	})

	test("an offered read the script uses but never ticked is a warning, once", () => {
		const d = scriptDiagnostics(state("if (cast.length) return { messages: cast }"), assist)
		expect(d).toHaveLength(1)
		expect(d[0]!.severity).toBe("warning")
		expect(d[0]!.message).toContain("“cast”")
		expect(d[0]!.from).toBe(4)
	})

	test("a property with an offered name is not a read", () => {
		expect(scriptDiagnostics(state("return { cast: messages }"), assist)).toEqual([])
	})

	test("a syntax error is one placed error, not a run of them", () => {
		const d = scriptDiagnostics(state("const x = { a: 1,\nreturn x"), assist)
		expect(d.filter((f) => f.severity === "error")).toHaveLength(1)
		expect(d[0]!.message).toMatch(/^Syntax error/)
	})
})

describe("script completion", () => {
	const complete = (src: string, pos = src.length, explicit = false) => {
		const ctx = new CompletionContext(state(src), pos, explicit)
		return scriptCompletions(ctx, assist)
	}

	test("the declared reads and ctx while a word is typed; nothing on whitespace", () => {
		const r = complete("return me")!
		expect(r.from).toBe(7)
		expect(r.options.map((o) => o.label)).toEqual(["messages", "ctx"])
		expect(complete("return ")).toBeNull()
		expect(complete("return ", 7, true)).not.toBeNull()
	})

	test("after ctx. only its two members", () => {
		const r = complete("const n = ctx.r")!
		expect(r.from).toBe(14)
		expect(r.options.map((o) => o.label)).toEqual(["random", "log"])
	})
})
