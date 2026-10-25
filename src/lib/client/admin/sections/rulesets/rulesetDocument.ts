/**
 * 🚧 Admin › Rulesets › one ruleset: the **Document** and **Publish** helpers
 * every view shares (moved out of the design path's `rulesetForm.ts`, lane
 * A4, 2026-10-23) — the document as its code field shows it, whether its text
 * says something other than the saved draft, the version Publish offers and
 * why one cannot be published, and a finding split into its reason and its
 * sentence.
 *
 * Pure (no Svelte, no socket).
 */
import { bumpRulesetVersion, compareRulesetVersions, RULESET_VERSION } from "@serene-pub/sdk"
import { isObject, type Json } from "./rulesetFormParts"

/** The document as the Document field shows it. */
export const prettyDocument = (doc: unknown): string => (doc == null ? "" : JSON.stringify(doc, null, 2))

export type ParsedDocument = { ok: true; value: Json } | { ok: false; error: string }

export function parseDocumentText(source: string): ParsedDocument {
	let value: unknown
	try {
		value = JSON.parse(source)
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) }
	}
	if (!isObject(value)) return { ok: false, error: "the document is one JSON object, in braces" }
	return { ok: true, value }
}

/** Keys sorted all the way down, so two documents compare by content. */
export function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
	if (isObject(v))
		return `{${Object.keys(v)
			.sort()
			.filter((k) => v[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
			.join(",")}}`
	return JSON.stringify(v) ?? "null"
}

/** The Document's text says something other than the saved draft (unparseable counts). */
export function documentTextChanged(source: string, saved: unknown): boolean {
	if (source === prettyDocument(saved)) return false
	const parsed = parseDocumentText(source)
	return !parsed.ok || canonical(parsed.value) !== canonical(saved ?? null)
}

/* ── publishing ────────────────────────────────────────────────────── */

/**
 * The version Publish offers: the draft's own when it is ahead of what is
 * published (or nothing is), else the next patch after the published one.
 */
export function suggestedVersion(draftVersion: string | null | undefined, publishedVersion: string | null | undefined): string {
	const d = typeof draftVersion === "string" && RULESET_VERSION.test(draftVersion) ? draftVersion : null
	const p = typeof publishedVersion === "string" && RULESET_VERSION.test(publishedVersion) ? publishedVersion : null
	if (!p) return d ?? "1.0.0"
	return d && compareRulesetVersions(d, p) > 0 ? d : bumpRulesetVersion(p)
}

/** Why a version cannot be published, in a sentence; null when it can. */
export function versionProblem(version: string, publishedVersion: string | null | undefined): string | null {
	const v = version.trim()
	if (!RULESET_VERSION.test(v)) return "A version is three numbers with dots, like 1.0.1."
	if (publishedVersion && RULESET_VERSION.test(publishedVersion) && compareRulesetVersions(v, publishedVersion) <= 0)
		return `Version ${publishedVersion} is published. Publish as a later one, like ${bumpRulesetVersion(publishedVersion)}.`
	return null
}

/** A finding as the server words it: `[reason] sentence`. */
export function splitFinding(f: string): { reason: string | null; sentence: string } {
	const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(f)
	return m ? { reason: m[1]!, sentence: m[2]! } : { reason: null, sentence: f }
}

/** The upgrade findings that are about stored data (the version ones are the version field's). */
export const dataUpgradeFindings = (findings: readonly string[]): string[] => findings.filter((f) => !f.startsWith("[version-"))

/** What an upgrade finding means for data already stored, in one sentence. */
export function upgradeMeaning(reason: string | null): string {
	switch (reason) {
		case "dropped-stat":
		case "dropped-attribute":
			return "Values stored under it are kept, but these rules no longer read them."
		case "dropped-repertoire":
		case "dropped-entry-type":
		case "dropped-field":
			return "What is stored there is kept, but these rules no longer read it."
		case "changed-field-type":
			return "Values saved before hold the old kind of value and may not read as the new one."
		case "newly-required":
			return "Things saved before may not have it yet."
		default:
			return "Data stored under the published version may read differently."
	}
}
