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
 * ## One checker (typed templates P4)
 *
 * Both walkers — the Handlebars AST walk and the Liquid analysis — live in the
 * SDK now (`checkTemplateSource`, `@serene-pub/sdk/template-check`), shared
 * with the editor lint in `contextConfigCards.ts`. This module is the save-time
 * wrapper: parse failures are refusals, every other finding a warning. Core's
 * helper, tag and filter names are handed in (`templateCheckOptions.ts`); the
 * SDK hard-codes none of them.
 *
 * ## Why the warnings are conservative
 *
 * A diagnostics panel is only worth reading if its entries are real. Both
 * analysers therefore report a name **only when it must come from the render
 * scope**: a `{{#each}}` item's field, a `{% for %}` binding, a `{% assign %}`,
 * `@key`/`forloop.last`, and every registered helper or filter name are all
 * excluded by construction. The cost, against bare keys, is that a genuine
 * typo *inside* a loop body goes unreported (a typed scope catches it); the
 * alternative is a list with `each` and `upcase` in it, which teaches people
 * to ignore the panel. A helper nobody registered IS reported — Handlebars
 * throws on it at render time.
 *
 * An engine core does not implement — a plugin's — is not analysed at all, and
 * says so (`checked: false`) rather than reporting an empty, reassuring list.
 */

import {
	canCheckTemplateEngine,
	checkTemplateSourceReport
} from "@serene-pub/sdk/template-check"
import type { TemplateScope } from "@serene-pub/sdk"
import { templateCheckWith } from "./templateCheckOptions"

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
	/** Names referenced that the contract does not supply. */
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

/** Whether this module can say anything at all about a template's engine. */
export const canValidateEngine = (engine: string): boolean =>
	canCheckTemplateEngine(engine)

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
	const syntax = checkTemplateSourceReport(
		engine,
		source,
		{},
		templateCheckWith(undefined)
	).findings.find((f) => f.kind === "syntax")
	if (!syntax) return null
	return {
		message: syntax.message,
		...(syntax.line !== undefined ? { line: syntax.line } : {}),
		...(syntax.column !== undefined ? { column: syntax.column } : {})
	}
}

/**
 * Every name the template references that the contract does not supply, each
 * reported once per place it appears.
 *
 * `contract` is either the bare keys (each unchecked past its root, which is
 * all a key list can say) or a typed scope, whose paths are then checked too.
 * `untyped` is `templateScopeReport().untyped`: it changes nothing here —
 * everything this returns is already a warning — but the message then names
 * the producer that may supply the name after all.
 *
 * A parse failure short-circuits: there is nothing useful to say about the
 * variables in a template that does not parse, and saying it anyway buries the
 * one message that matters under a list of consequences.
 */
export function validateTemplateContext(
	engine: string,
	source: string,
	contract: Iterable<string> | TemplateScope,
	untyped?: readonly string[]
): TemplateValidation {
	if (!canValidateEngine(engine)) return clean(false)

	const scope: TemplateScope =
		Symbol.iterator in Object(contract)
			? Object.fromEntries(
					[...(contract as Iterable<string>)].map((k) => [
						k,
						"any" as const
					])
				)
			: (contract as TemplateScope)

	const report = checkTemplateSourceReport(
		engine,
		source,
		scope,
		templateCheckWith(untyped)
	)
	if (!report.checked) return clean(false)

	const syntax = report.findings.find((f) => f.kind === "syntax")
	if (syntax)
		return {
			error: {
				message: syntax.message,
				...(syntax.line !== undefined ? { line: syntax.line } : {}),
				...(syntax.column !== undefined
					? { column: syntax.column }
					: {})
			},
			warnings: [],
			checked: true
		}

	return {
		error: null,
		warnings: report.findings.map((f) => ({
			name: f.name ?? f.path ?? "",
			line: f.line,
			column: f.column,
			message: f.message
		})),
		checked: true
	}
}
