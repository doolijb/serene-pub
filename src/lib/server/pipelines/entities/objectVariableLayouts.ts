/**
 * Every OBJECT variable gets a layout of its own — automatically, and always
 * (owner ruling 2026-09-27: "Give objects their own variable template for now.
 * Primitive values don't get one for now. Make it automatic and a requirement
 * for objects.").
 *
 * ## Which variables are objects
 *
 * Decided from the declaration's `scope`, never from a sample: a root is
 * object-valued when handing its value to `String()` could only ever produce
 * `[object Object]` — which is exactly the failure a layout exists to prevent.
 *
 * - `object` and `record` — keyed values. Objects.
 * - `list` whose element is one of those (at any depth of lists) — its
 *   `String()` is `[object Object],[object Object]`, so it needs a layout as
 *   much as a single object does. A list of strings or numbers is not: it
 *   joins into text.
 * - the legacy `string[]` form — a bare list of an object's field names, so an
 *   object.
 * - `'any'` is unchecked and may as well be a string; it is NOT counted. A
 *   variable that wants a layout declares its shape.
 * - `string` / `number` / `boolean` are primitives and get nothing.
 *
 * ## What the automatic layout is
 *
 * Minified JSON of each object root — `{{{json <root>}}}` — named "JSON".
 * JSON because that is the shape A/B-tested against prose before 0.1.0 and the
 * shape every core object variable already defaults to; minified because that
 * is byte for byte what an unselected plugin band renders today (Assemble's
 * `bandValue` floor), so selecting the automatic row changes no prompt.
 *
 * The code floor for an object value that reaches `renderVariable` with no
 * layout at all (a failed seed, a dangling reference) is the same expression
 * (`variableLayouts.ts`) — never `String(value)`.
 *
 * Deliberately free of any database import, like `variableLayouts.ts`.
 */

import {
	allVariables,
	type VarDecl,
	type VariableDecl
} from "@serene-pub/sdk"
import { CORE_TEMPLATE_ENGINE } from "$lib/shared/pipelines/templateEngines"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	seedKeyFor
} from "$lib/server/pipelines/entities/variableLayouts"

/** The display name every automatic layout carries. */
export const OBJECT_LAYOUT_NAME = "JSON"

/** Whether one scope root's declared value is an object (see the header). */
export function isObjectValued(decl: VarDecl | undefined): boolean {
	if (decl === undefined || decl === "any") return false
	if (Array.isArray(decl)) return true
	if (typeof decl !== "object" || decl === null) return false
	if (decl.type === "object" || decl.type === "record") return true
	if (decl.type === "list") return isObjectValued(decl.of)
	return false
}

/** The roots of a declaration's scope whose value is an object, in order. */
export function objectRootsOf(decl: Pick<VariableDecl, "scope">): string[] {
	const scope = decl?.scope
	if (!scope || typeof scope !== "object" || Array.isArray(scope)) return []
	return Object.entries(scope)
		.filter(([, v]) => isObjectValued(v as VarDecl))
		.map(([k]) => k)
}

/** A variable is an object variable when any of its roots is object-valued. */
export const isObjectVariable = (decl: Pick<VariableDecl, "scope">): boolean =>
	objectRootsOf(decl).length > 0

/** A root as a Handlebars path — `this.[x y]` when it is not an identifier. */
const hbPath = (root: string): string =>
	/^[A-Za-z_$][\w$]*$/.test(root) ? root : `this.[${root}]`

/**
 * The automatic layout's source: each object root as minified JSON, one per
 * line when a declaration has more than one. `null` for a primitive variable,
 * which gets no layout.
 */
export function objectLayoutSource(
	decl: Pick<VariableDecl, "scope">
): string | null {
	const roots = objectRootsOf(decl)
	if (!roots.length) return null
	return roots.map((r) => `{{{json ${hbPath(r)}}}}`).join("\n")
}

/**
 * The template id a plugin variable's automatic layout is projected under:
 * `<slug>:template/<variable name>-json@<variable major>`. Derived from the
 * variable id, so the same variable always names the same row and a new major
 * of the variable gets a new row. `null` when the id is not a variable id.
 */
export function objectLayoutTemplateId(
	pluginId: string,
	variableId: string
): string | null {
	const m = /^[^:]+:var\/(.+)@(\d+)$/.exec(variableId)
	if (!m) return null
	const name = m[1]!
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
	if (!name) return null
	return `${pluginId}:template/${name}-json@${m[2]}`
}

/**
 * The seed a plugin's object variable projects when its manifest ships no
 * layout for it — a `variables` template seed in the SDK's own vocabulary, so
 * `syncPluginTemplates` projects, refreshes, adopts and withdraws it by the
 * rules every other plugin template follows.
 */
export interface ObjectLayoutSeed {
	id: string
	kind: "variables"
	variableId: string
	engine: string
	label: string
	body: string
	/** Marks the seed as derived here rather than declared by the package. */
	automatic: true
}

/**
 * Every automatic layout seed one manifest's variables need: one per object
 * variable the manifest does not already ship a `variables` layout for.
 * Malformed entries are skipped — `registerPluginVariables` is what refuses
 * them out loud.
 */
export function objectLayoutSeedsFor(
	manifest: unknown,
	pluginId: string,
	declared: ReadonlyArray<{ id?: unknown; kind?: unknown; variableId?: unknown }>
): ObjectLayoutSeed[] {
	const raw = (manifest as { variables?: unknown } | null)?.variables
	if (!Array.isArray(raw)) return []
	const laidOut = new Set(
		declared
			.filter((s) => s?.kind === "variables")
			.map((s) => s.variableId)
	)
	const ids = new Set(declared.map((s) => s?.id))
	const out: ObjectLayoutSeed[] = []
	for (const v of raw as Array<Partial<VariableDecl> | null>) {
		if (!v || typeof v.id !== "string" || !v.id.startsWith(`${pluginId}:`))
			continue
		if (laidOut.has(v.id)) continue
		const source = objectLayoutSource(v as VariableDecl)
		if (source === null) continue
		const id = objectLayoutTemplateId(pluginId, v.id)
		if (!id || ids.has(id)) continue
		ids.add(id)
		laidOut.add(v.id)
		out.push({
			id,
			kind: "variables",
			variableId: v.id,
			engine: CORE_TEMPLATE_ENGINE,
			label: OBJECT_LAYOUT_NAME,
			body: source,
			automatic: true
		})
	}
	return out
}

/**
 * Core's automatic layouts: one per `core:` object variable core ships no
 * layout for. Empty today — every core object variable has hand-written rows
 * (`variableLayouts.ts`) — and it is what keeps a new one from ever reaching a
 * prompt without a layout. Seeded under the variable's `content` seed key,
 * the key a hand-written bare row would take, so writing one later adopts the
 * row rather than adding a second.
 */
export function coreObjectLayouts(
	decls: readonly VariableDecl[] = allVariables()
): Array<{
	variableId: string
	variant: "content"
	name: string
	source: string
	seedKey: string
}> {
	const shipped = new Set(SHIPPED_VARIABLE_TEMPLATES.map((t) => t.variableId))
	return decls
		.filter((d) => d.id.startsWith("core:") && !shipped.has(d.id))
		.flatMap((d) => {
			const source = objectLayoutSource(d)
			if (source === null) return []
			const variant = "content" as const
			return [
				{
					variableId: d.id,
					variant,
					name: OBJECT_LAYOUT_NAME,
					source,
					seedKey: seedKeyFor({ variableId: d.id, variant })
				}
			]
		})
}
