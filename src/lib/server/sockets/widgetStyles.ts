/**
 * The `widgetStyles:*` namespace — the socket half of `widget_styles` (PLAN 25,
 * ownership ruled 2026-08-30). The OTHER half is `db/widgetStyles.ts`, the seed
 * reconciler, and the split between them is the whole design: the reconciler
 * owns every `source = 'system'` row and this file owns every `source = 'user'`
 * one, and neither reaches into the other's.
 *
 * ## Two different questions, kept apart
 *
 * **Visibility** answers who may SEE and USE a row; **management** answers who
 * may change it. They are not the same question and an admin is a superset of
 * the second one only:
 *
 *   system  → everyone sees and uses it. Nobody edits or deletes it here — not
 *             even an admin, because a reseed would quietly undo the edit and
 *             leave an admin sure they had changed something. Clone instead.
 *   private → the owner alone, for both questions.
 *   shared  → the whole instance sees and uses it; the owner OR an admin
 *             manages it.
 *
 * Anyone who can SEE a row may clone it, which is how a built-in becomes
 * editable: the clone is a private row of the caller's that SNAPSHOTS css/vars
 * and keeps no reference back, so the original moving does not move the copy.
 *
 * ## `list` is the resolver's candidate set
 *
 * `shared/widgets/resolve.ts` is documented to be handed "only rows this user
 * may USE", and this list is where that promise is kept. A pin to a row that
 * has since gone private, or to somebody else's, therefore falls out of the
 * candidate set and degrades to the widget's default — quietly, which is the
 * intent — rather than rendering a stranger's CSS.
 *
 * ## On "guests"
 *
 * The ruled matrix says a guest may create private styles and never share one.
 * ⚠ **This instance has no guest role to ask about.** `users` carries exactly
 * one role bit, `isAdmin`; the codebase's "guest" is a guest ON A SESSION
 * (`session_guests`), and a widget style is not scoped to a session — it is an
 * account-level object, so there is no session whose membership could answer.
 * The refusal therefore has no subject and sharing is open to any signed-in
 * account. `mayShare()` below is the one place that changes the day a guest
 * role exists.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, or, type SQL } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { assertSafeThemeCss } from "./customThemes"

/** A style's CSS is a skin, not a stylesheet — 64 KB is generous for one. */
const MAX_CSS_BYTES = 64 * 1024
/** The whole token override set, serialized. Bounds an unbounded json column. */
const MAX_VARS_BYTES = 8 * 1024
const MAX_TITLE_LENGTH = 120

/**
 * A var key is spelled the way CSS spells it — `--accent`, not `accent`.
 *
 * Chosen over the bare form deliberately: the client applies these with
 * `setProperty(key, value)`, and storing the literal property name means there
 * is no place where a `--` gets added or forgotten. The stored key IS the CSS
 * property.
 */
const VAR_KEY_RE = /^--[a-z0-9-]+$/

/**
 * Emit the refusal on the event's own `:error` channel, then throw.
 *
 * The throw is what `register()` in index.ts expects: it notices the specific
 * `:error` already went out and skips its generic one, so the caller gets the
 * sentence that names what was actually wrong rather than "an error occurred".
 */
function refuse(
	emitToUser: (event: string, data: any) => void,
	event: string,
	message: string
): never {
	emitToUser(`${event}:error`, { error: message })
	throw new Error(message)
}

/** ⚠ See the file header: no guest role exists, so this has no subject yet. */
function mayShare(_socket: any): boolean {
	return true
}

type StyleRow = typeof schema.widgetStyles.$inferSelect

/** The wire projection. Spelled out, so a new column never joins it silently. */
function toRow(row: StyleRow): Sockets.WidgetStyles.WidgetStyleRow {
	return {
		id: row.id,
		slug: row.slug,
		widgetSlug: row.widgetSlug,
		source: row.source as "system" | "user",
		ownerUserId: row.ownerUserId,
		visibility: row.visibility as "system" | "private" | "shared",
		title: row.title,
		css: row.css,
		vars: row.vars ?? {},
		updatedAt: row.updatedAt.toISOString()
	}
}

/**
 * Rows this caller may see and use: every system row, every shared row, and
 * their own.
 *
 * The first branch asks `source`, not `visibility`, on purpose — `source` is a
 * column no user-facing verb here can write, so a row cannot be made to
 * masquerade as a built-in by setting its visibility.
 */
function usableBy(userId: number): SQL | undefined {
	return or(
		eq(schema.widgetStyles.source, "system"),
		eq(schema.widgetStyles.visibility, "shared"),
		eq(schema.widgetStyles.ownerUserId, userId)
	)
}

/**
 * The widget ids a style may be attached to.
 *
 * Three sources, because a widget has three possible declarers. `CORE_WIDGETS`
 * is core's announcement. A genre's widgets reach this table as system rows
 * when their package's install seeds the presets they ship, so the system rows
 * already present are the second part. And an enabled plugin's own widgets are
 * read from its stored manifest under the id the session view seats them by
 * (`<pluginId>:<panelId>`) — they ship no presets, so nothing would ever have
 * put them in this table on their own.
 *
 * Anything in none of the three is a typo or a stale client, and a row attached
 * to it would be permanently unreachable — no widget would ever ask for it.
 */
async function announcedWidgetIds(): Promise<Set<string>> {
	const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
	const { enabledPluginWidgetIds } = await import(
		"$lib/server/plugins/frameHost"
	)
	const ids = new Set(CORE_WIDGETS.map((w) => w.id))
	const seeded = await db
		.selectDistinct({ widgetSlug: schema.widgetStyles.widgetSlug })
		.from(schema.widgetStyles)
		.where(eq(schema.widgetStyles.source, "system"))
	for (const r of seeded) ids.add(r.widgetSlug)
	for (const id of await enabledPluginWidgetIds(db)) ids.add(id)
	return ids
}

/**
 * A user row's slug: `user:<userId>:<widget>:<random>`.
 *
 * Four segments where a system slug (`systemStyleSlug`, `<widget>:<preset>`)
 * has two, and it begins with the literal `user:` — so a user row can never be
 * minted onto a system row's reference target, which is what would let a reseed
 * and a person fight over the same `slug` unique index.
 *
 * ⚠ The argument does NOT rest on a widget id being colon-free: a plugin's
 * carries one of its own (`<pluginId>:<panelId>`). It rests on segment count.
 * For a system slug to collide, its widget id would have to BE
 * `user:<userId>:<widget>` — three segments or more — and a widget id carries
 * at most one colon.
 */
function userStyleSlug(userId: number, widgetSlug: string): string {
	const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
	return `user:${userId}:${widgetSlug}:${random}`
}

/** The name, trimmed and bounded. */
function cleanTitle(
	title: unknown,
	emitToUser: (event: string, data: any) => void,
	event: string
): string {
	const trimmed = typeof title === "string" ? title.trim() : ""
	if (!trimmed) refuse(emitToUser, event, "A style needs a name.")
	if (trimmed.length > MAX_TITLE_LENGTH)
		refuse(
			emitToUser,
			event,
			`That name is too long — ${MAX_TITLE_LENGTH} characters at most.`
		)
	return trimmed
}

/**
 * The CSS, bounded and checked for the two exfiltration vectors theme CSS is
 * checked for.
 *
 * ⚠ `assertSafeThemeCss` is REUSED rather than re-stated: this CSS is injected
 * into the widget container (native) or the frame document (frame), which is
 * the same page a custom theme's CSS reaches, so `@import` and an external
 * `url(...)` are the same hole here that they are there (see the long note in
 * customThemes.ts — `img-src` deliberately allows any https host, so this
 * rejection is the actual defense, not a backstop behind CSP).
 */
function cleanCss(
	css: unknown,
	emitToUser: (event: string, data: any) => void,
	event: string
): string {
	if (css === undefined || css === null) return ""
	if (typeof css !== "string")
		refuse(emitToUser, event, "A style's CSS has to be text.")
	if (css.length > MAX_CSS_BYTES)
		refuse(
			emitToUser,
			event,
			"That CSS is too long — a style's CSS is capped at 64 KB."
		)
	try {
		assertSafeThemeCss(css)
	} catch (e: any) {
		refuse(emitToUser, event, e?.message || String(e))
	}
	return css
}

/** The token overrides: custom-property keys, text values, bounded as a set. */
function cleanVars(
	vars: unknown,
	emitToUser: (event: string, data: any) => void,
	event: string
): Record<string, string> {
	if (vars === undefined || vars === null) return {}
	if (typeof vars !== "object" || Array.isArray(vars))
		refuse(
			emitToUser,
			event,
			"Style variables have to be a set of name/value pairs."
		)
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(
		vars as Record<string, unknown>
	)) {
		if (!VAR_KEY_RE.test(key))
			refuse(
				emitToUser,
				event,
				`'${key}' is not a CSS custom property — variable names look like '--accent'.`
			)
		if (typeof value !== "string")
			refuse(emitToUser, event, `The value for '${key}' has to be text.`)
		// A value reaches the page as CSS too, so it gets the same check.
		try {
			assertSafeThemeCss(value)
		} catch (e: any) {
			refuse(emitToUser, event, e?.message || String(e))
		}
		out[key] = value
	}
	if (JSON.stringify(out).length > MAX_VARS_BYTES)
		refuse(
			emitToUser,
			event,
			"Too many style variables — the whole set is capped at 8 KB."
		)
	return out
}

/** The requested visibility for a row this caller owns or manages. */
function cleanVisibility(
	visibility: unknown,
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string
): "private" | "shared" | undefined {
	if (visibility === undefined) return undefined
	if (visibility !== "private" && visibility !== "shared")
		refuse(emitToUser, event, "A style can only be private or shared.")
	if (visibility === "shared" && !mayShare(socket))
		refuse(
			emitToUser,
			event,
			"You can use and make your own styles, but not share one with the instance."
		)
	return visibility
}

/**
 * The row this verb is about, and whether the caller may MANAGE it.
 *
 * ⚠ A row the caller cannot even see answers with the same sentence a missing
 * one gets — `entries:testRetrieval`'s rule, for the same reason: otherwise an
 * id probe distinguishes "not yours" from "not there" and enumerates other
 * people's private styles one number at a time.
 */
async function manageable(
	id: number,
	socket: any,
	emitToUser: (event: string, data: any) => void,
	event: string,
	verb: "change" | "delete"
): Promise<StyleRow> {
	// A payload with no usable id is a miss, not a database error: the query
	// below would otherwise reach drizzle with `undefined` and come back as the
	// generic "an error occurred".
	if (!Number.isInteger(id)) refuse(emitToUser, event, "Style not found.")
	const row = await db.query.widgetStyles.findFirst({
		where: eq(schema.widgetStyles.id, id)
	})
	if (!row) refuse(emitToUser, event, "Style not found.")
	if (row.source === "system")
		refuse(
			emitToUser,
			event,
			verb === "delete"
				? "Built-in styles can't be deleted — they are part of the widget. Clone one to make your own."
				: "Built-in styles can't be edited. Clone it to make your own."
		)
	const userId = socket.user!.id
	if (row.ownerUserId === userId) return row
	// Not theirs. A private row is answered as absent; a shared one is a real
	// object they can see, so it gets the real reason.
	if (row.visibility !== "shared")
		refuse(emitToUser, event, "Style not found.")
	if (!socket.user?.isAdmin)
		refuse(
			emitToUser,
			event,
			`Only the owner or an admin can ${verb} a shared style.`
		)
	return row
}

export const widgetStylesList: Handler<
	Sockets.WidgetStyles.List.Params,
	Sockets.WidgetStyles.List.Response
> = {
	event: "widgetStyles:list",
	handler: async (socket, params, emitToUser) => {
		const widgetSlug =
			typeof params?.widgetSlug === "string"
				? params.widgetSlug
				: undefined
		const res = await listResponse(socket.user!.id, widgetSlug)
		emitToUser("widgetStyles:list", res)
		return res
	}
}

/**
 * The usable set as the client reads it.
 *
 * Split out of the handler so the post-mutation re-list can be handed to
 * `emitToUser` as a thunk — see `relist`. Eager here on purpose: this one IS
 * the request's own reply, so the caller declared interest in it before asking.
 */
async function listResponse(
	userId: number,
	widgetSlug: string | undefined
): Promise<Sockets.WidgetStyles.List.Response> {
	const rows = await db
		.select()
		.from(schema.widgetStyles)
		.where(
			widgetSlug
				? and(
						usableBy(userId),
						eq(schema.widgetStyles.widgetSlug, widgetSlug)
					)
				: usableBy(userId)
		)
		.orderBy(asc(schema.widgetStyles.id))
	// Styles for a disabled plugin's widgets are not listed (R67): the widget
	// itself is not shown, and its styles come back with it.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	return {
		styles: rows.filter((r) => !off.ownsId(r.widgetSlug)).map(toRow)
	}
}

/**
 * The whole usable set, re-sent to the actor after every mutation.
 *
 * Deliberately UNFILTERED even when the mutation named one widget: the client
 * may be holding a full list or a per-widget one, and a superset reconciles
 * with both, where a filtered payload would blank the widgets it omitted.
 */
async function relist(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	// The LAZY form (socket-interest plan, ruling 4): `widgetStyles:list` is a
	// gated event, and the whole usable set is a table scan — so a mutation
	// made from a surface that shows no styles (the layout editor saving a
	// pin, a script) pays for no re-list at all. Awaited, because the client's
	// reducer needs the refreshed rows BEFORE the create reply that names the
	// new one (`onCreated` resolves the row it just pinned out of them).
	await emitToUser("widgetStyles:list", () =>
		listResponse(socket.user!.id, undefined)
	)
}

export const widgetStylesCreate: Handler<
	Sockets.WidgetStyles.Create.Params,
	Sockets.WidgetStyles.Create.Response
> = {
	event: "widgetStyles:create",
	handler: async (socket, params, emitToUser) => {
		const event = "widgetStyles:create"
		const userId = socket.user!.id

		const widgetSlug =
			typeof params?.widgetSlug === "string" ? params.widgetSlug : ""
		const known = await announcedWidgetIds()
		if (!known.has(widgetSlug))
			refuse(
				emitToUser,
				event,
				`'${widgetSlug}' is not a widget on this instance.`
			)

		const title = cleanTitle(params.title, emitToUser, event)
		const css = cleanCss(params.css, emitToUser, event)
		const vars = cleanVars(params.vars, emitToUser, event)
		const visibility =
			cleanVisibility(params.visibility, socket, emitToUser, event) ??
			"private"

		const [row] = await db
			.insert(schema.widgetStyles)
			.values({
				// NO id — the identity sequence assigns one, the same rule the
				// seed reconciler keeps.
				slug: userStyleSlug(userId, widgetSlug),
				widgetSlug,
				source: "user",
				ownerUserId: userId,
				visibility,
				title,
				css,
				vars
			})
			.returning()

		await relist(socket, emitToUser)
		const res: Sockets.WidgetStyles.Create.Response = { style: toRow(row) }
		emitToUser(event, res)
		return res
	}
}

export const widgetStylesUpdate: Handler<
	Sockets.WidgetStyles.Update.Params,
	Sockets.WidgetStyles.Update.Response
> = {
	event: "widgetStyles:update",
	handler: async (socket, params, emitToUser) => {
		const event = "widgetStyles:update"
		const existing = await manageable(
			params.id,
			socket,
			emitToUser,
			event,
			"change"
		)

		// Absent keys leave their column alone — the property that lets a UI
		// save one field without carrying the rest of the row.
		const changes: Partial<typeof schema.widgetStyles.$inferInsert> = {}
		if (params.title !== undefined)
			changes.title = cleanTitle(params.title, emitToUser, event)
		if (params.css !== undefined)
			changes.css = cleanCss(params.css, emitToUser, event)
		if (params.vars !== undefined)
			changes.vars = cleanVars(params.vars, emitToUser, event)
		const visibility = cleanVisibility(
			params.visibility,
			socket,
			emitToUser,
			event
		)
		if (visibility) changes.visibility = visibility

		// `widgetSlug`, `source` and `ownerUserId` are absent from the payload
		// by design: a style cannot be moved to another widget, promoted to a
		// built-in, or handed to someone else. An admin managing a shared row
		// changes the row, never who owns it.
		const [row] = Object.keys(changes).length
			? await db
					.update(schema.widgetStyles)
					.set(changes)
					.where(eq(schema.widgetStyles.id, existing.id))
					.returning()
			: [existing]

		await relist(socket, emitToUser)
		const res: Sockets.WidgetStyles.Update.Response = { style: toRow(row) }
		emitToUser(event, res)
		return res
	}
}

export const widgetStylesDelete: Handler<
	Sockets.WidgetStyles.Delete.Params,
	Sockets.WidgetStyles.Delete.Response
> = {
	event: "widgetStyles:delete",
	handler: async (socket, params, emitToUser) => {
		const event = "widgetStyles:delete"
		const existing = await manageable(
			params.id,
			socket,
			emitToUser,
			event,
			"delete"
		)

		// Layouts pin a style by id+slug and resolve against the usable set, so
		// a pin to the row going away degrades to the widget's default on its
		// own (`shared/widgets/resolve.ts`). Nothing else needs unpinning.
		await db
			.delete(schema.widgetStyles)
			.where(eq(schema.widgetStyles.id, existing.id))

		await relist(socket, emitToUser)
		const res: Sockets.WidgetStyles.Delete.Response = { id: existing.id }
		emitToUser(event, res)
		return res
	}
}

export const widgetStylesClone: Handler<
	Sockets.WidgetStyles.Clone.Params,
	Sockets.WidgetStyles.Clone.Response
> = {
	event: "widgetStyles:clone",
	handler: async (socket, params, emitToUser) => {
		const event = "widgetStyles:clone"
		const userId = socket.user!.id

		// Seeing it is the whole permission — cloning takes nothing from the
		// original and leaves nothing pointing at it.
		if (!Number.isInteger(params?.id))
			refuse(emitToUser, event, "Style not found.")
		const [source] = await db
			.select()
			.from(schema.widgetStyles)
			.where(and(eq(schema.widgetStyles.id, params.id), usableBy(userId)))
			.limit(1)
		if (!source) refuse(emitToUser, event, "Style not found.")

		const title = cleanTitle(
			params.title ?? `${source.title} (copy)`,
			emitToUser,
			event
		)

		const [row] = await db
			.insert(schema.widgetStyles)
			.values({
				slug: userStyleSlug(userId, source.widgetSlug),
				widgetSlug: source.widgetSlug,
				source: "user",
				ownerUserId: userId,
				// A copy starts private however the original was published;
				// sharing it is a separate decision the cloner makes.
				visibility: "private",
				title,
				// SNAPSHOT, not reference: the copy stops tracking here.
				css: source.css,
				vars: source.vars ?? {},
				// Provenance belongs to the reconciler's rows. Carrying it over
				// would label a hand-made row as seeded by a version.
				seededByVersion: null
			})
			.returning()

		await relist(socket, emitToUser)
		const res: Sockets.WidgetStyles.Clone.Response = { style: toRow(row) }
		emitToUser(event, res)
		return res
	}
}

export function registerWidgetStyleHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, widgetStylesList, emitToUser)
	register(socket, widgetStylesCreate, emitToUser)
	register(socket, widgetStylesUpdate, emitToUser)
	register(socket, widgetStylesDelete, emitToUser)
	register(socket, widgetStylesClone, emitToUser)
}
