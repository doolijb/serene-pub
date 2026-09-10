/**
 * Turning a `completion_templates` ROW into the shape the renderer takes.
 *
 * `$lib/shared/constants/completionTemplates` is the built-in data and the
 * pure resolver over it: hand it a key it knows and it answers with a template,
 * hand it one it does not and it answers with the default. That is everything a
 * browser and a parity harness need, and it is exactly what makes an
 * admin-authored row do NOTHING — the row's key is not in the built-in map, so
 * it resolves to Vicuna and the person who authored the delimiters watches the
 * default come out.
 *
 * This is the missing half: the loader. It reads the table, projects each row
 * into a `CompletionTemplate`, and hands it to whoever is about to render.
 *
 * ## ⚠ Nothing here caches, and that is deliberate
 *
 * `registerContextHandlebarsHelpers` wraps every helper in
 * `if (!handlebars.helpers.X)`, so the FIRST registration on a given Handlebars
 * instance is the one that decides the framing for every later render on it.
 * `renderers.ts` calls `Handlebars.create()` per render, which is what keeps
 * that harmless — but a cache HERE would move the pin one level up: the first
 * render after boot would fix the template for every render afterwards, and
 * editing a template on `/admin/completion-templates` would appear to save and
 * change nothing until a restart. That is the same "control with no effect"
 * shape this whole feature exists to remove, so the read is done every time.
 *
 * The cost is one indexed `SELECT` on a table with single-digit rows, on a path
 * that is already doing several. `buildWorld` reads them in the same pass it
 * reads connections and sampling configs — one query per world build, not one
 * per connection.
 *
 * ## Takes `db`, never imports it
 *
 * Same posture as `connections/resolve.ts` next door. The callers
 * (`config/world.ts`, the socket handlers) already hold a database; a module
 * level `import { db }` here would put a live PGlite handle behind every
 * importer of the render path, including unit tests that have no business
 * opening one.
 */

import {
	BLOCK_ROLES,
	completionTemplateOf,
	type CompletionTemplate,
	type RenderMode,
	type RoleFraming
} from "$lib/shared/constants/completionTemplates"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * Reads only, and the handle is the schema-typed global `Db` (`db/types.d.ts`)
 * — still a parameter, never an import, since a global type costs none.
 *
 * `{ select: any }` was the narrow surface `config/world.ts` declares, and it
 * was narrow in the wrong dimension: `any` on `select` types every ROW read
 * through it `any`, so the `SelectCompletionTemplate[]` annotations below were
 * decoration rather than checks — a column this table has never had would have
 * satisfied them.
 */

/** One `{prefix, suffix}` out of JSON, with a shape it can be trusted in. */
function framing(value: unknown, fallback: RoleFraming): RoleFraming {
	if (!value || typeof value !== "object") return fallback
	const { prefix, suffix } = value as Partial<RoleFraming>
	return {
		prefix: typeof prefix === "string" ? prefix : fallback.prefix,
		suffix: typeof suffix === "string" ? suffix : fallback.suffix
	}
}

/**
 * A row, as the renderer takes it.
 *
 * The three JSON columns are `json` rather than `jsonb` with per-key types, so
 * what comes back is whatever was written — including from a build that had one
 * fewer role. Every field is therefore projected rather than cast:
 *
 *  - `roles` is filled out over `BLOCK_ROLES`, so `framingFor` never returns
 *    `undefined` for a role the row predates and no block is ever emitted with
 *    the literal text "undefined" wrapped around it;
 *  - a role the row does not carry falls back to the row's OWN `fallbackRole`,
 *    not to a built-in's — a half-filled custom template must not silently
 *    borrow Vicuna's markers for the roles it is missing;
 *  - `renderMode` is narrowed to the two values that exist. Anything else is
 *    `flat`, because the alternative — treating an unrecognised mode as
 *    role_array — would hand a text adapter `rendered: undefined`.
 */
export function rowToTemplate(
	row: SelectCompletionTemplate
): CompletionTemplate {
	const fallbackRole = framing(row.fallbackRole, { prefix: "", suffix: "" })
	const stored = (row.roles ?? {}) as Record<string, unknown>
	const roles = Object.fromEntries(
		BLOCK_ROLES.map((r) => [r, framing(stored[r], fallbackRole)])
	) as CompletionTemplate["roles"]
	return {
		key: row.key,
		name: row.name,
		renderMode: (row.renderMode === "role_array"
			? "role_array"
			: "flat") as RenderMode,
		roles,
		fallbackRole,
		stopStrings: Array.isArray(row.stopStrings)
			? row.stopStrings.filter((s): s is string => typeof s === "string")
			: [],
		isSelectable: !!row.isSelectable
	}
}

/**
 * Every template on the instance, by key.
 *
 * One query, for callers projecting many connections at once. A caller with a
 * single key wants `resolveCompletionTemplate` below.
 */
export async function completionTemplatesByKey(
	db: Db
): Promise<Map<string, CompletionTemplate>> {
	const rows: SelectCompletionTemplate[] = await db
		.select()
		.from(schema.completionTemplates)
	return new Map(rows.map((r) => [r.key, rowToTemplate(r)]))
}

/**
 * The template a format string names, from the table.
 *
 * Falls back through `completionTemplateOf`, which is the ONE spelling of "and
 * if there isn't one" — so all three absent states (`null`, `""`, and a key
 * whose row is gone) answer the same way here as they do everywhere else. A
 * built-in whose row has somehow been deleted still resolves, because the
 * constants are the floor under the table rather than a second copy of it.
 */
export async function resolveCompletionTemplate(
	db: Db,
	format?: string | null
): Promise<CompletionTemplate> {
	if (!format) return completionTemplateOf(format)
	const [row]: SelectCompletionTemplate[] = await db
		.select()
		.from(schema.completionTemplates)
		.where(eq(schema.completionTemplates.key, format))
		.limit(1)
	return row ? rowToTemplate(row) : completionTemplateOf(format)
}

/**
 * A connection row, with the template it names dereferenced onto it.
 *
 * ## What this is for
 *
 * The adapters need the ROW — its delimiters to re-wrap a summarizer's blocks,
 * its stop strings to end a turn — and they cannot fetch one: an adapter has no
 * `db` (the lazy-adapter architecture, `adapters/importBoundary.test.ts`) and
 * `promptTextFor` is synchronous by contract. So the dereference happens HERE,
 * at the point a connection is already being loaded for a run, and travels with
 * the connection the adapter was going to receive anyway. Six call sites got a
 * key where a row was needed; none of them gained a parameter and none gained a
 * database.
 *
 * Only two places in the app load a connection that reaches a text adapter —
 * `resolveCapabilityTarget` (the one resolver, per its own header) and
 * `resolveStepConfigs` (a node's own pick, for the two flows still outside the
 * executor) — so this is called twice, not at every construction site.
 *
 * ## It always attaches something
 *
 * `resolveCompletionTemplate` answers all three absent states with the DEFAULT
 * rather than with `undefined`, so `completionTemplate` on the returned object
 * is never null and an adapter never has to spell the fallback a second time.
 * The one spelling of "and if there isn't one" stays in one place, which is the
 * whole point of the constant it comes from.
 *
 * ⚠ Returns a NEW object rather than mutating the row, so a caller that kept a
 * reference to the row it passed in still holds a plain row.
 */
export async function withCompletionTemplate<
	T extends { promptFormat?: string | null }
>(
	db: Db,
	connection: T
): Promise<T & { completionTemplate: CompletionTemplate }> {
	return {
		...connection,
		completionTemplate: await resolveCompletionTemplate(
			db,
			connection.promptFormat
		)
	}
}
