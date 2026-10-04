/**
 * The session page's half of B8's request storm (lorebooks consolidation
 * plan, 2026-09-29), pinned from its source — the page is not mountable in a
 * test, so its children are measured in `sessionStream.dom.test.svelte.ts`
 * and its own wiring is read here.
 *
 * `session` is replaced wholesale on every streamed chunk
 * (`handleSessionMessage`), so anything that reads THROUGH the object re-runs
 * per token even when nothing it cares about moved. Two shapes carried it:
 *
 *  1. **An `$effect` whose own body reads `session`.** The page re-asked
 *     `lorebooks:bindingList` and `sessions:getNarratorName` per token,
 *     re-declared the book's binding-list key, reset the persona the person
 *     had picked, and kept pushing the draft's save timer. A read inside a
 *     callback the effect hands off (a handler, a timer, `untrack`) is not
 *     tracked, and is not counted here.
 *  2. **A component prop written `{session.x}`.** A bare member chain
 *     compiles to a getter over `session`, not a memoised `$derived`
 *     (svelte 5.57 memoises an optional chain, a `??`, a call — not this), so
 *     the child's effects track the whole object.
 *
 * The page reads `$derived` primitives instead (`loadedSessionId`,
 * `sessionLorebookId`, …), which notify only when the value moves.
 *
 * Shape 1 is followed INDIRECTLY too: an effect reading a `$derived` that
 * builds an object from `session` (the header's cast, a new array per
 * chunk), or calling a function that reads it, re-runs per token just the
 * same. The reader walks those chains and stops at a primitive derived.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"
import { describe, expect, test } from "vitest"

const PAGE = resolve(process.cwd(), "src/routes/sessions/[id]/+page.svelte")
const source = readFileSync(PAGE, "utf8")
const scriptOpen = source.indexOf(">", source.indexOf("<script")) + 1
const scriptClose = source.indexOf("</script>")
const script = source.slice(scriptOpen, scriptClose)
const markup = source.slice(scriptClose)

function isEffectCallee(e: ts.Expression): boolean {
	if (ts.isIdentifier(e)) return e.text === "$effect"
	return (
		ts.isPropertyAccessExpression(e) &&
		ts.isIdentifier(e.expression) &&
		e.expression.text === "$effect" &&
		e.name.text === "pre"
	)
}

/**
 * The page's `$derived` values that read the streamed `session` and hold a
 * PRIMITIVE. A `$derived` compares its value, so one of these notifies only
 * when the value moves — a read of it is where a chain stops streaming.
 * Reviewed by hand: a derived holding an object or an array is new on every
 * chunk and must never be listed. A declaration annotated with a primitive
 * type (`: boolean`, `: string | null`, …) counts without being listed.
 */
const PRIMITIVE_DERIVEDS = new Set([
	"loadedSessionId",
	"sessionName",
	"sessionUserId",
	"sessionLorebookId",
	"sessionLorebookBranchId",
	"storyClockYear",
	"storyClockMonth",
	"storyClockDay",
	"messageLandingStep"
])

/** An identifier that SUBSCRIBES — not a write, not another thing's name. */
function isTrackedRead(id: ts.Identifier): boolean {
	const p = id.parent
	if (
		ts.isBinaryExpression(p) &&
		p.left === id &&
		p.operatorToken.kind === ts.SyntaxKind.EqualsToken
	)
		return false
	if (ts.isPropertyAccessExpression(p) && p.name === id) return false
	if (ts.isPropertyAssignment(p) && p.name === id) return false
	if (ts.isVariableDeclaration(p) && p.name === id) return false
	return true
}

/** Is this identifier the callee of a call — a function RUN here, not handed on? */
function isCalled(id: ts.Identifier): boolean {
	return ts.isCallExpression(id.parent) && id.parent.expression === id
}

type Decl = { kind: "derived" | "function"; body: ts.Node; primitive: boolean }

const PRIMITIVE_TYPES = new Set([
	ts.SyntaxKind.BooleanKeyword,
	ts.SyntaxKind.StringKeyword,
	ts.SyntaxKind.NumberKeyword,
	ts.SyntaxKind.NullKeyword,
	ts.SyntaxKind.UndefinedKeyword,
	ts.SyntaxKind.LiteralType
])
function isPrimitiveType(t: ts.TypeNode | undefined): boolean {
	if (!t) return false
	if (ts.isUnionTypeNode(t)) return t.types.every(isPrimitiveType)
	return PRIMITIVE_TYPES.has(t.kind)
}

/** The script's top-level `$derived`s and functions, by name. */
function declarationsOf(file: ts.SourceFile): Map<string, Decl> {
	const decls = new Map<string, Decl>()
	for (const st of file.statements) {
		if (ts.isFunctionDeclaration(st) && st.name && st.body)
			decls.set(st.name.text, { kind: "function", body: st.body, primitive: false })
		if (!ts.isVariableStatement(st)) continue
		for (const d of st.declarationList.declarations) {
			if (!ts.isIdentifier(d.name) || !d.initializer) continue
			const init = d.initializer
			if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
				decls.set(d.name.text, { kind: "function", body: init.body, primitive: false })
				continue
			}
			if (!ts.isCallExpression(init)) continue
			const callee = init.expression.getText(file)
			const arg = init.arguments[0]
			if (!arg) continue
			const primitive =
				PRIMITIVE_DERIVEDS.has(d.name.text) || isPrimitiveType(d.type)
			if (callee === "$derived")
				decls.set(d.name.text, { kind: "derived", body: arg, primitive })
			else if (
				callee === "$derived.by" &&
				(ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))
			)
				decls.set(d.name.text, { kind: "derived", body: arg.body, primitive })
		}
	}
	return decls
}

/**
 * The chain by which reading `body` reaches the streamed `session` — `[]`
 * for `session` itself, `["headerCast"]` through a derived, `null` when it
 * does not. Followed through `$derived`s it reads and functions it CALLS
 * (svelte tracks what a called function reads); it stops at a primitive
 * derived, and skips any callback the body hands off (a handler, a timer,
 * `untrack`) and any function it only names.
 */
function sessionChain(
	body: ts.Node,
	decls: Map<string, Decl>,
	seen = new Set<string>()
): string[] | null {
	let chain: string[] | null = null
	const walk = (n: ts.Node) => {
		if (chain || ts.isFunctionLike(n)) return
		if (ts.isIdentifier(n) && isTrackedRead(n)) {
			if (n.text === "session") {
				chain = []
				return
			}
			const d = decls.get(n.text)
			if (
				d &&
				!d.primitive &&
				!seen.has(n.text) &&
				(d.kind === "derived" || isCalled(n))
			) {
				seen.add(n.text)
				const rest = sessionChain(d.body, decls, seen)
				if (rest) {
					chain = [n.text, ...rest]
					return
				}
			}
		}
		ts.forEachChild(n, walk)
	}
	if (ts.isBlock(body)) ts.forEachChild(body, walk)
	else walk(body)
	return chain
}

/** Every `$effect` in `code` that re-runs per streamed chunk, with how. */
function streamingEffectsIn(code: string, lineOffset = 0): string[] {
	const file = ts.createSourceFile("page.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const decls = declarationsOf(file)
	const hits: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && isEffectCallee(node.expression)) {
			const fn = node.arguments[0]
			if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
				const chain = sessionChain(fn.body, decls)
				if (chain) {
					const { line } = file.getLineAndCharacterOfPosition(node.getStart())
					hits.push(
						`+page.svelte:${lineOffset + line + 1} reads ${[...chain, "session"].join(" -> ")}`
					)
				}
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return hits
}

/**
 * An `$effect` that writes an OBJECT into `openSessionCtx` (a `$state`
 * proxy) re-proxies it on every run, so whatever reads that field — the
 * lorebooks rail reads `storyClock`, the header `cast` — re-runs with it.
 * Each such write gets an effect of its own that reads nothing else.
 */
const OBJECT_FIELDS = ["cast", "storyClock"]
function objectWritesSharingAnEffect(code: string): string[] {
	const file = ts.createSourceFile("page.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const hits: string[] = []
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && isEffectCallee(node.expression)) {
			const fn = node.arguments[0]
			if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
				const written: string[] = []
				const reads = new Set<string>()
				const walk = (n: ts.Node) => {
					if (ts.isFunctionLike(n)) return
					if (
						ts.isBinaryExpression(n) &&
						n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
						ts.isPropertyAccessExpression(n.left) &&
						n.left.expression.getText(file) === "openSessionCtx" &&
						OBJECT_FIELDS.includes(n.left.name.text)
					)
						written.push(n.left.name.text)
					if (
						ts.isIdentifier(n) &&
						isTrackedRead(n) &&
						n.text !== "openSessionCtx"
					)
						reads.add(n.text)
					ts.forEachChild(n, walk)
				}
				if (ts.isBlock(fn.body)) ts.forEachChild(fn.body, walk)
				else walk(fn.body)
				for (const field of written)
					if (written.length > 1 || reads.size > 1)
						hits.push(`openSessionCtx.${field} shares an effect with ${[...reads].join(", ")}`)
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return hits
}

const firstLine = source.slice(0, scriptOpen).split("\n").length - 1

describe("the session page tracks ids, not the streamed session object", () => {
	test("the reader finds a tracked read, and skips one in a handed-off callback", () => {
		expect(
			streamingEffectsIn(
				"$effect(() => { const id = session?.lorebookId; setTimeout(() => session.id) })"
			)
		).toHaveLength(1)
		expect(
			streamingEffectsIn(
				"$effect(() => { session = undefined; setTimeout(() => session.id); untrack(() => session) })"
			)
		).toEqual([])
	})

	test("the reader follows a derived and a called function, and stops at a primitive", () => {
		const code = `
			let cast = $derived.by(() => session?.sessionCharacters.map((c) => c.id))
			let shown = $derived(cast.length > 0 ? cast : [])
			function lastLine() { return session?.sessionMessages.at(-1) }
			const handler = () => session?.id
			let generating: boolean = $derived(!!session?.isGenerating)
			const loadedSessionId = $derived(session?.id ?? null)
			$effect(() => { ctx.cast = shown })
			$effect(() => { const m = lastLine() })
			$effect(() => { socket.on("x", handler) })
			$effect(() => { if (generating) stop() })
			$effect(() => { ping(loadedSessionId) })
		`
		expect(streamingEffectsIn(code)).toEqual([
			"+page.svelte:8 reads shown -> cast -> session",
			"+page.svelte:9 reads lastLine -> session"
		])
	})

	test("no $effect reads `session`, directly or through what it reads and calls", () => {
		expect(streamingEffectsIn(script, firstLine)).toEqual([])
	})

	test("every listed primitive derived is still one of the page's deriveds", () => {
		const file = ts.createSourceFile("page.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
		const decls = declarationsOf(file)
		const stale = [...PRIMITIVE_DERIVEDS].filter((n) => decls.get(n)?.kind !== "derived")
		expect(stale).toEqual([])
	})

	test("openSessionCtx's object fields are each written by an effect of their own", () => {
		expect(
			objectWritesSharingAnEffect(
				"$effect(() => { openSessionCtx.cast = headerCast; openSessionCtx.isGenerating = busy })"
			)
		).toHaveLength(1)
		expect(objectWritesSharingAnEffect(script)).toEqual([])
	})

	test("no component prop is a bare member chain on `session`", () => {
		const raw = [...markup.matchAll(/\b([\w-]+)=\{session\.[\w.]+\}/g)].map((m) => m[0])
		expect(raw).toEqual([])
	})
})
