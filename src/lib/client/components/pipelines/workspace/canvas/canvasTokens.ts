/**
 * The canvas's colour vocabulary, as roles (STYLE-GUIDE §1.1, §2.3): the kind
 * stripes are the map's (`flow/context.ts` `KIND_STRIPE`) so List, Map and
 * Canvas agree on what a colour means; the run statuses are the receipt
 * inspector's badges; the diff marks are the Changes tab's three verbs.
 */
import type { DiffMark, RunStatus } from "./lineModel"

/** Kind → a CSS colour expression, for SVG fills and inline borders. */
export const KIND_VAR: Record<string, string> = {
	inlet: "var(--color-surface-500)",
	query: "var(--color-success-500)",
	task: "var(--color-primary-500)",
	oracle: "var(--color-warning-500)",
	outlet: "var(--color-error-500)"
}

export const kindVar = (kind: string) => KIND_VAR[kind] ?? KIND_VAR.inlet

/** Run status → a CSS colour expression. Not reached is quiet, like a hint. */
export const STATUS_VAR: Record<RunStatus, string> = {
	ok: "var(--color-success-500)",
	dry: "var(--color-primary-500)",
	skip: "var(--color-surface-500)",
	halt: "var(--color-warning-500)",
	err: "var(--color-error-500)"
}

export const STATUS_LABEL: Record<RunStatus, string> = {
	ok: "ran",
	dry: "dry write",
	skip: "skipped",
	halt: "halted",
	err: "failed"
}

/** The colour of a node that the run never reached. */
export const NOT_REACHED_VAR = "var(--color-surface-400)"

export const MARK_VAR: Record<DiffMark, string> = {
	added: "var(--color-success-500)",
	removed: "var(--color-error-500)",
	changed: "var(--color-primary-500)"
}

export const MARK_LABEL: Record<DiffMark, string> = {
	added: "added",
	removed: "removed",
	changed: "changed"
}

/** A junction branch's predicate as the sentence its declaration is. */
export function predicateSentence(
	p:
		| { path?: string; equals?: unknown; equalsPath?: string; truthy?: boolean; default?: boolean }
		| undefined
): string {
	if (!p) return ""
	if (p.default) return "otherwise"
	const subject = p.path ? p.path : "the value"
	if (p.equals !== undefined) return `when ${subject} = ${JSON.stringify(p.equals)}`
	if (p.equalsPath) return `when ${subject} = ${p.equalsPath}`
	if (p.truthy) return `when ${subject}`
	return `when ${subject} fits`
}

/** What the canvas colours cards by. */
export type Overlay = "none" | "receipt" | "diff"
