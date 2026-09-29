/**
 * The editor's lint: the SDK checker's findings, each placed on the source
 * with its severity and — when the finding names a near miss — a quick fix
 * (typed templates P7).
 *
 * The checker is `@serene-pub/sdk/template-check` (P4) with core's
 * vocabulary (`templateCheckWith`), so what the editor squiggles is exactly
 * what a save, a selection and law T1 refuse. The fix is only ever the
 * checker's own "did you mean" — this file finds where in the written path
 * the wrong segment is and what to type instead, and nothing more.
 */

import { checkTemplateSourceReport } from "@serene-pub/sdk/template-check"
import type { TemplateFinding, TemplateScope } from "@serene-pub/sdk"
import { templateCheckWith } from "$lib/shared/utils/templateCheckOptions"

const LIQUID_ENGINE = "core:template/liquid@1"

export interface TemplateQuickFix {
	/** What the button says — `Use "secretEntry"`. */
	label: string
	start: number
	end: number
	text: string
}

export interface TemplateDiagnostic {
	start: number
	end: number
	severity: "error" | "warning"
	kind?: TemplateFinding["kind"]
	message: string
	line?: number
	fix?: TemplateQuickFix
}

export interface TemplateDiagnosticsOptions {
	/** `templateScopeReport().untyped` — non-empty makes name findings warnings. */
	untyped?: readonly string[]
	/**
	 * No step in view (the library): the scope is the definition's static one,
	 * so a name it does not know may still be supplied where the row is
	 * picked. Name and path findings become warnings.
	 */
	lenient?: boolean
}

/** 1-based line/column → offset. */
function offsetAt(source: string, line?: number, column?: number): number {
	if (!line) return 0
	let at = 0
	for (let i = 1; i < line; i++) {
		const next = source.indexOf("\n", at)
		if (next < 0) return at
		at = next + 1
	}
	return at + Math.max(0, (column ?? 1) - 1)
}

/** The segments of a written path, with their offsets in it. */
function segmentsOf(written: string): { text: string; start: number; bracketed: boolean }[] {
	const out: { text: string; start: number; bracketed: boolean }[] = []
	const re = /\[\s*["']?([^\]"']+)["']?\s*\]|([^.[\]\s"']+)/g
	for (const m of written.matchAll(re)) {
		if (m[1] !== undefined)
			out.push({ text: m[1], start: m.index! + m[0].indexOf(m[1]), bracketed: true })
		else out.push({ text: m[2]!, start: m.index!, bracketed: false })
	}
	return out
}

function quickFix(
	engine: string,
	source: string,
	f: TemplateFinding
): TemplateQuickFix | undefined {
	if (!f.suggestion || f.start === undefined || f.end === undefined) return undefined
	const written = source.slice(f.start, f.end)
	const segs = segmentsOf(written)
	const target =
		f.kind === "unknown-path"
			? // The first segment after the root the suggestion is near; the
				// root resolved, or this would be an unknown-name finding.
				(segs.length > 1 ? segs.slice(1) : segs).find(
					(s) => s.text !== f.suggestion && near(s.text, f.suggestion!)
				)
			: segs.find((s) => s.text === f.name) ?? segs[0]
	if (!target) return undefined
	const start = f.start + target.start
	const end = start + target.text.length
	let text = f.suggestion
	let from = start
	if (!target.bracketed) {
		if (engine === LIQUID_ENGINE && !/^[A-Za-z_][\w-]*$/.test(text)) {
			// `annex.showcase` → `annex["showcase.twenty-questions"]`.
			if (source[start - 1] === ".") from = start - 1
			text = `["${text}"]`
		} else if (engine !== LIQUID_ENGINE && !/^[A-Za-z_$][\w$]*$/.test(text)) text = `[${text}]`
	}
	return { label: `Use "${f.suggestion}"`, start: from, end, text }
}

/** Near enough to be the one the suggestion replaces. */
function near(a: string, b: string): boolean {
	const x = a.toLowerCase()
	const y = b.toLowerCase()
	if (Math.abs(x.length - y.length) > 2) return false
	const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) =>
		Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
	)
	for (let i = 1; i <= x.length; i++)
		for (let j = 1; j <= y.length; j++)
			d[i]![j] = Math.min(
				d[i - 1]![j]! + 1,
				d[i]![j - 1]! + 1,
				d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1)
			)
	return d[x.length]![y.length]! <= 2
}

/**
 * The findings for `source`, placed. `checked: false` = an engine core cannot
 * parse (a plugin's): say nothing rather than "clean".
 */
export function templateDiagnostics(
	engine: string,
	source: string,
	scope: TemplateScope,
	options: TemplateDiagnosticsOptions = {}
): { checked: boolean; diagnostics: TemplateDiagnostic[] } {
	const report = checkTemplateSourceReport(
		engine,
		source,
		scope,
		templateCheckWith(options.untyped)
	)
	if (!report.checked) return { checked: false, diagnostics: [] }
	const diagnostics = report.findings.map((f): TemplateDiagnostic => {
		const start = f.start ?? offsetAt(source, f.line, f.column)
		const end = Math.max(f.end ?? start, start + 1)
		const scopeKind = f.kind === "unknown-name" || f.kind === "unknown-path"
		const fix = quickFix(engine, source, f)
		return {
			start,
			end: Math.min(end, Math.max(source.length, start)),
			severity: options.lenient && scopeKind ? "warning" : f.severity,
			...(f.kind ? { kind: f.kind } : {}),
			message: f.message,
			...(f.line ? { line: f.line } : {}),
			...(fix ? { fix } : {})
		}
	})
	return { checked: true, diagnostics }
}
