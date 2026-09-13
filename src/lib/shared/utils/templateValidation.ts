/**
 * Does this template parse, and does it reference anything nobody supplies?
 *
 * Two questions with two different answers. A template that does not parse is a
 * **refusal** — saving it would break every pipeline that selects it, and the
 * engine already knows exactly where the mistake is. A template that references
 * `speakerRelationship` where the contract says `speakerRelationships` is a
 * **warning**: it parses, it renders, and what it renders is an empty string
 * where a block of world lore should have been. Nothing today tells anyone
 * that, and the silence is the whole reason this module exists.
 *
 * Pure and engine-aware, in that order. It takes the contract keys as an
 * argument rather than reaching for the variable registry, so a test can state
 * the contract in one line and the editor can pass whatever the running build
 * actually declares.
 *
 * ## Why the warnings are conservative
 *
 * A diagnostics panel is only worth reading if its entries are real. Both
 * analysers therefore report a name **only when it must come from the render
 * scope**: a `{{#each}}` item's field, a `{% for %}` binding, a `{% assign %}`,
 * `@key`/`forloop.last`, and every helper or filter name are all excluded by
 * construction. The cost is that a genuine typo *inside* a loop body goes
 * unreported; the alternative is a list with `each` and `upcase` in it, which
 * teaches people to ignore the panel.
 *
 * An engine core does not implement — a plugin's — is not analysed at all, and
 * says so (`checked: false`) rather than reporting an empty, reassuring list.
 */

import Handlebars from "handlebars"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"
import { createContextLiquid } from "./contextLiquid"

/** Where in the source something is, 1-based, as both engines report it. */
export interface TemplatePosition {
	line: number
	column: number
}

export interface TemplateSyntaxError extends Partial<TemplatePosition> {
	/** The engine's own words. Not rephrased — it names the construct. */
	message: string
}

export interface TemplateVariableWarning extends Partial<TemplatePosition> {
	/** The top-level name as the template spells it. */
	name: string
	message: string
}

export interface TemplateValidation {
	/** Null when the source parsed. Anything else is a refusal, not advice. */
	error: TemplateSyntaxError | null
	/** Names referenced at the top level that the contract does not supply. */
	warnings: TemplateVariableWarning[]
	/**
	 * False when the engine is one core cannot analyse — a plugin's. The
	 * absence of warnings then means "not looked at", and a caller that
	 * reported it as "clean" would be inventing an assurance.
	 */
	checked: boolean
}

const clean = (checked: boolean): TemplateValidation => ({
	error: null,
	warnings: [],
	checked
})

// ── Handlebars ──────────────────────────────────────────────────────────────

/**
 * Names Handlebars resolves itself, which are never context variables.
 *
 * `this` and the bare `.` arrive as a path with no parts and are handled by
 * shape; these are the ones that arrive looking like a name.
 */
const HANDLEBARS_BUILTIN_PATHS = new Set([
	"this",
	"true",
	"false",
	"null",
	"undefined"
])

interface HandlebarsScope {
	/** How many `{{#each}}`/`{{#with}}` frames deep. `../` walks back out. */
	depth: number
	/** `as |a b|` bindings, innermost last. */
	blockParams: string[]
}

/**
 * Walk the AST, collecting paths that must resolve against the root context.
 *
 * The depth rule is what keeps this honest. A path inside `{{#each characters}}`
 * resolves against a character, not the context, so it is skipped — unless it
 * carries enough `../` to climb back out, which is exactly how the shipped
 * template reads `../injectionsByIndex` from inside the message loop.
 */
function handlebarsTopLevelPaths(
	source: string
): Array<{ name: string } & TemplatePosition> {
	const found: Array<{ name: string } & TemplatePosition> = []
	const ast: any = Handlebars.parse(source)

	const note = (path: any, scope: HandlebarsScope) => {
		// `@key`, `@index`, `@last`, `@root` — Handlebars' own frame data.
		if (path?.data) return
		if (path?.type !== "PathExpression") return
		// `this` / `.` — the current scope itself, not a name.
		if (!path.parts?.length) return
		const first: string = path.parts[0]
		if (HANDLEBARS_BUILTIN_PATHS.has(first)) return
		// `../` climbs out; anything still inside a frame is that frame's.
		if (scope.depth - (path.depth ?? 0) > 0) return
		if (scope.blockParams.includes(first)) return
		found.push({
			name: first,
			line: path.loc?.start?.line ?? 1,
			column: (path.loc?.start?.column ?? 0) + 1
		})
	}

	/** Params and hash values are expressions; the helper's own name is not. */
	const walkArgs = (node: any, scope: HandlebarsScope) => {
		for (const p of node.params ?? []) walkExpression(p, scope)
		for (const pair of node.hash?.pairs ?? [])
			walkExpression(pair.value, scope)
	}

	const walkExpression = (node: any, scope: HandlebarsScope) => {
		if (!node) return
		if (node.type === "SubExpression") {
			// `(eq a b)` — `eq` is the helper, `a` and `b` are the variables.
			walkArgs(node, scope)
			return
		}
		note(node, scope)
	}

	const walkProgram = (program: any, scope: HandlebarsScope) => {
		for (const stmt of program?.body ?? []) walkStatement(stmt, scope)
	}

	const walkStatement = (node: any, scope: HandlebarsScope) => {
		switch (node?.type) {
			case "MustacheStatement": {
				// `{{pad x 2}}` is a helper call; `{{{x}}}` is a variable.
				if (node.params?.length || node.hash?.pairs?.length)
					walkArgs(node, scope)
				else walkExpression(node.path, scope)
				return
			}
			case "BlockStatement": {
				// `{{#foo}}` is always an invocation, never a variable.
				walkArgs(node, scope)
				const helper: string = node.path?.parts?.[0] ?? ""
				// Only `each` and `with` move the scope; `if`, `unless` and the
				// block helpers leave it where it was.
				const shifts = helper === "each" || helper === "with"
				const inner: HandlebarsScope = {
					depth: scope.depth + (shifts ? 1 : 0),
					blockParams: [
						...scope.blockParams,
						...(node.program?.blockParams ?? [])
					]
				}
				walkProgram(node.program, inner)
				walkProgram(node.inverse, {
					depth: scope.depth + (shifts ? 1 : 0),
					blockParams: [
						...scope.blockParams,
						...(node.inverse?.blockParams ?? [])
					]
				})
				return
			}
			case "PartialStatement":
			case "PartialBlockStatement":
				walkArgs(node, scope)
				return
			default:
				return
		}
	}

	walkProgram(ast, { depth: 0, blockParams: [] })
	return found
}

// ── Liquid ──────────────────────────────────────────────────────────────────

/**
 * LiquidJS answers this question itself.
 *
 * `globalVariables` is defined as the names *not* in scope — everything a
 * `{% for %}` binds, everything `{% assign %}` creates and `forloop` are
 * already excluded, which is the same conservative line the Handlebars walk
 * draws by hand. The custom block tags expose their bodies through `children()`
 * so a name inside `{% systemBlock %}` is seen too.
 */
function liquidTopLevelPaths(
	source: string
): Array<{ name: string } & TemplatePosition> {
	const liquid = createContextLiquid({ promptFormat: "" })
	const analysis = liquid.parseAndAnalyzeSync(source, undefined, {
		// There are no partials — `{% include %}` refuses at parse time — and
		// asking for them would send the analyser looking for files.
		partials: false
	})
	const found: Array<{ name: string } & TemplatePosition> = []
	for (const [name, uses] of Object.entries(analysis.globals))
		for (const use of uses)
			found.push({
				name,
				line: use.location.row,
				column: use.location.col
			})
	return found
}

// ── The seam ────────────────────────────────────────────────────────────────

/** Whether this module can say anything at all about a template's engine. */
export const canValidateEngine = (engine: string): boolean =>
	engine === CORE_TEMPLATE_ENGINE || engine === CORE_LIQUID_ENGINE

/**
 * Read a line and column off whatever the engine threw.
 *
 * Three shapes, all of them the engine's own report rather than a guess:
 * Handlebars sets `lineNumber` when a block does not match its closer, and
 * otherwise states the line in the first words of the message; LiquidJS puts
 * the position on the token it failed at. None is guaranteed, so both fields
 * are optional and the message — which always names the construct — is not.
 */
function positionOf(err: any): Partial<TemplatePosition> {
	const hbs = err?.lineNumber
	if (typeof hbs === "number")
		return { line: hbs, column: (err?.column ?? 0) + 1 }
	const stated = /^Parse error on line (\d+)/.exec(String(err?.message ?? ""))
	if (stated) return { line: Number(stated[1]) }
	const token = err?.token
	if (token && typeof token.getPosition === "function") {
		const [line, column] = token.getPosition()
		if (typeof line === "number") return { line, column }
	}
	return {}
}

/**
 * Parse `source` with `engine`, and hand back what went wrong.
 *
 * Called on save. A refusal here is the whole point: a malformed template
 * stored is a pipeline that fails at generation time, far from the edit that
 * caused it and with an error nobody reading a chat can act on.
 */
export function parseTemplate(
	engine: string,
	source: string
): TemplateSyntaxError | null {
	try {
		if (engine === CORE_TEMPLATE_ENGINE) Handlebars.parse(source)
		else if (engine === CORE_LIQUID_ENGINE)
			createContextLiquid({ promptFormat: "" }).parse(source)
		else return null
		return null
	} catch (err: any) {
		return {
			message: String(err?.message ?? err),
			...positionOf(err)
		}
	}
}

/**
 * Every top-level name the template references that `contractKeys` does not
 * contain, each reported once per place it appears.
 *
 * A parse failure short-circuits: there is nothing useful to say about the
 * variables in a template that does not parse, and saying it anyway buries the
 * one message that matters under a list of consequences.
 */
export function validateTemplateContext(
	engine: string,
	source: string,
	contractKeys: Iterable<string>
): TemplateValidation {
	if (!canValidateEngine(engine)) return clean(false)

	const error = parseTemplate(engine, source)
	if (error) return { error, warnings: [], checked: true }

	const known = new Set(contractKeys)
	let referenced: Array<{ name: string } & TemplatePosition>
	try {
		referenced =
			engine === CORE_TEMPLATE_ENGINE
				? handlebarsTopLevelPaths(source)
				: liquidTopLevelPaths(source)
	} catch {
		// The source parsed a moment ago, so this is the analyser failing on
		// something it did not expect rather than the template being wrong.
		// Reporting nothing is right; claiming it was checked is not.
		return clean(false)
	}

	const warnings: TemplateVariableWarning[] = []
	const seen = new Set<string>()
	for (const ref of referenced) {
		if (known.has(ref.name)) continue
		const at = `${ref.name}@${ref.line}:${ref.column}`
		if (seen.has(at)) continue
		seen.add(at)
		warnings.push({
			name: ref.name,
			line: ref.line,
			column: ref.column,
			message:
				`'${ref.name}' is not one of the values this step supplies, so it ` +
				`renders as nothing. Check the spelling against the variable list.`
		})
	}
	return { error: null, warnings, checked: true }
}
