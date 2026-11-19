/**
 * The session's panel layout and the layout presets: reading, starting from,
 * setting and the preset verbs (save, rename, delete, usage, share, copy,
 * update, the new-session layout).
 */

import { STANDARD_GENRE_ID } from "$lib/shared/sessions/standardGenre"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	drawnWidgetIds,
	isWidgetInstanceId,
	validateSessionLayout,
	widgetOfInstance,
	type SessionLayoutV1
} from "@serene-pub/sdk"
import { and, eq, inArray } from "drizzle-orm"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	cloneLayoutPreset,
	arrangementOf,
	copyLayoutIntoSession,
	deleteUserLayoutPreset,
	genreDefaultLayoutRow,
	LAYOUT_PRESET_NEEDS_NAME,
	LAYOUT_PRESET_CANT_SAVE,
	LAYOUT_PRESET_UNKNOWN,
	layoutPresetUsage,
	listLayoutPresets,
	renameUserLayoutPreset,
	resolveNewSessionLayout,
	saveAsNewLayout,
	saveChangesToLayout,
	shareLayoutPreset,
	startedFromUpdated
} from "$lib/server/db/layoutPresets"
import { setUserLayoutDefault } from "$lib/server/db/userLayoutDefaults"
import {
	readWidgetSettings,
	storedWidgetInstanceIds,
	writeWidgetSettings
} from "$lib/server/db/widgetSettings"

/**
 * `sessionGenreOf` for many sessions in one read: id → genre, by the same
 * rule (no genre is Chat). A missing session is absent from the map. For the
 * layout-list push (`sessions/startedFromPush.ts`), which has the sessions
 * people have open and needs those of one genre.
 */
export async function sessionGenres(
	sessionIds: readonly number[]
): Promise<Map<number, string>> {
	const out = new Map<number, string>()
	if (!sessionIds.length) return out
	const rows = await db
		.select({ id: schema.sessions.id, genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(inArray(schema.sessions.id, [...sessionIds]))
	for (const row of rows) out.set(row.id, row.genreId ?? STANDARD_GENRE_ID)
	return out
}

/**
 * The first open (the copy model, brief 3 of `PLAN-layout-one-format-2026-09-28`):
 * a person with no layout row for this session gets a COPY of their
 * new-session layout for the genre, else of the genre default layout, else an
 * empty one (`resolveNewSessionLayout`, `copyLayoutIntoSession`). One
 * transaction, and the insert does nothing on a conflict, so two tabs opening
 * the session at once make one row. A session's layout is its own from here
 * on: nothing is layered over it at read time.
 */
async function copyLayoutOnFirstOpen(
	sessionId: number,
	userId: number,
	genreId: string,
	/** 🚧 A guest of the session gets the genre's guests' layout, when it ships one (D6). */
	guest = false
): Promise<void> {
	const mine = and(
		eq(schema.sessionPanelLayouts.sessionId, sessionId),
		eq(schema.sessionPanelLayouts.userId, userId)
	)
	// Every open but the first finds its row here, without taking a
	// transaction (PGlite has one connection; a transaction holds it).
	const [seen] = await db
		.select({ id: schema.sessionPanelLayouts.id })
		.from(schema.sessionPanelLayouts)
		.where(mine)
		.limit(1)
	if (seen) return
	await db.transaction(async (tx) => {
		const [had] = await tx
			.select({ id: schema.sessionPanelLayouts.id })
			.from(schema.sessionPanelLayouts)
			.where(mine)
			.limit(1)
		if (had) return
		await copyLayoutIntoSession(tx, {
			sessionId,
			userId,
			genreId,
			layoutPresetId: await resolveNewSessionLayout(tx, userId, genreId, { guest }),
			onlyIfAbsent: true
		})
	})
}

/**
 * The caller's whole session layout for a session, as `:get` and `:startFrom`
 * both answer it: the row's layout, its provenance and whether that source
 * was **Updated** since, the style pins, the widget settings, and the list the
 * editor offers. A stranger to the session gets the empty answer.
 */
async function panelLayoutAnswer(
	sessionId: number,
	userId: number,
	hasAccess: boolean
): Promise<Sockets.Sessions.PanelLayout.Get.Response> {
	const answer: Sockets.Sessions.PanelLayout.Get.Response = {
		sessionId,
		layout: {},
		startedFromLayoutPresetId: null,
		layoutCopiedAt: null,
		startedFromUpdated: false,
		layoutSettings: {},
		widgetSettings: {},
		presets: []
	}
	if (!hasAccess) return answer
	const [row] = await db
		.select({
			layout: schema.sessionPanelLayouts.layout,
			startedFromLayoutPresetId:
				schema.sessionPanelLayouts.startedFromLayoutPresetId,
			layoutCopiedAt: schema.sessionPanelLayouts.layoutCopiedAt,
			layoutSettings: schema.sessionPanelLayouts.layoutSettings
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
		.limit(1)
	if (row?.layout && typeof row.layout === "object")
		answer.layout = row.layout as Record<string, unknown>
	if (row?.layoutSettings && typeof row.layoutSettings === "object")
		answer.layoutSettings = row.layoutSettings as Record<string, unknown>
	answer.startedFromLayoutPresetId = row?.startedFromLayoutPresetId ?? null
	answer.layoutCopiedAt = row?.layoutCopiedAt
		? row.layoutCopiedAt.toISOString()
		: null
	answer.widgetSettings = await readWidgetSettings(sessionId, userId)
	answer.presets = await listLayoutPresets(await sessionGenreOf(db, sessionId), userId)
	answer.startedFromUpdated = startedFromUpdated(
		answer.presets.find((p) => p.id === answer.startedFromLayoutPresetId),
		row?.layoutCopiedAt ?? null
	)
	return answer
}

/**
 * What `sessions:panelLayout:startedFromUpdated` carries (brief 6b): the
 * **started from** half of `:get`'s answer — the provenance, the **Updated**
 * flag and the refreshed list the editor's pane draws from — for one person
 * on one session. Pushed when a layout it started from moved (built only for
 * a socket that holds the session's scope, `sessions/startedFromPush.ts`),
 * and answered when a page asks. Null for a person who is not in the
 * session: there is nothing of theirs to label.
 */
export async function startedFromUpdatedAnswer(
	sessionId: number,
	userId: number
): Promise<Sockets.Sessions.PanelLayout.StartedFromUpdated.Response | null> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return null
	const [row] = await db
		.select({
			startedFromLayoutPresetId:
				schema.sessionPanelLayouts.startedFromLayoutPresetId,
			layoutCopiedAt: schema.sessionPanelLayouts.layoutCopiedAt
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
		.limit(1)
	const presets = await listLayoutPresets(await sessionGenreOf(db, sessionId), userId)
	const startedFromLayoutPresetId = row?.startedFromLayoutPresetId ?? null
	return {
		sessionId,
		startedFromLayoutPresetId,
		layoutCopiedAt: row?.layoutCopiedAt ? row.layoutCopiedAt.toISOString() : null,
		startedFromUpdated: startedFromUpdated(
			presets.find((p) => p.id === startedFromLayoutPresetId),
			row?.layoutCopiedAt ?? null
		),
		presets
	}
}

/**
 * Ask for the **started from** facts again (brief 6b): what the push
 * carries, for the caller. The page asks after a refused _Save changes to_
 * — the news that the layout changed may not have reached this tab — so the
 * next ask warns. A stranger to the session gets the empty answer.
 */
export const sessionsPanelLayoutStartedFromUpdatedHandler: Handler<
	Sockets.Sessions.PanelLayout.StartedFromUpdated.Params,
	Sockets.Sessions.PanelLayout.StartedFromUpdated.Response
> = {
	event: "sessions:panelLayout:startedFromUpdated",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		const res = (Number.isInteger(sessionId)
			? await startedFromUpdatedAnswer(sessionId, socket.user!.id)
			: null) ?? {
			sessionId,
			startedFromLayoutPresetId: null,
			layoutCopiedAt: null,
			startedFromUpdated: false,
			presets: []
		}
		emitToUser("sessions:panelLayout:startedFromUpdated", res)
		return res
	}
}

/**
 * Read the caller's session layout for a session (21 §10; the copy model).
 * A first open copies one in (`copyLayoutOnFirstOpen`), so the answer is
 * always the person's own whole layout — never a delta over a base.
 * Access-gated like every other session read.
 */
export const sessionsPanelLayoutGetHandler: Handler<
	Sockets.Sessions.PanelLayout.Get.Params,
	Sockets.Sessions.PanelLayout.Get.Response
> = {
	event: "sessions:panelLayout:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (access.hasAccess)
			await copyLayoutOnFirstOpen(
				params.sessionId,
				userId,
				await sessionGenreOf(db, params.sessionId),
				!access.isOwner
			)
		const res = await panelLayoutAnswer(
			params.sessionId,
			userId,
			access.hasAccess
		)
		emitToUser("sessions:panelLayout:get", res)
		return res
	}
}

/**
 * Owner 2026-11-04, item 15: _Reset to genre default layout_ clears the
 * person's settings and style pins for the widgets the layout places, so they
 * look as the genre ships them. Only this person's rows, only these ids; every
 * other key of `layout_settings` rides through. Runs inside the copy's
 * transaction, before the copy, so what the layout itself brings still wins.
 */
async function clearPlacedWidgetValues(
	tx: Db,
	args: { sessionId: number; userId: number; ids: string[] }
): Promise<void> {
	if (!args.ids.length) return
	await tx
		.delete(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, args.sessionId),
				eq(schema.widgetSettings.userId, args.userId),
				inArray(schema.widgetSettings.widgetInstanceId, args.ids)
			)
		)
	const mine = and(
		eq(schema.sessionPanelLayouts.sessionId, args.sessionId),
		eq(schema.sessionPanelLayouts.userId, args.userId)
	)
	const [row] = await tx
		.select({ layoutSettings: schema.sessionPanelLayouts.layoutSettings })
		.from(schema.sessionPanelLayouts)
		.where(mine)
		.limit(1)
	const settings = row?.layoutSettings as Record<string, unknown> | null
	const pins = settings?.widgetStyles
	if (!pins || typeof pins !== "object" || Array.isArray(pins)) return
	const kept = Object.fromEntries(
		Object.entries(pins).filter(([id]) => !args.ids.includes(id))
	)
	await tx
		.update(schema.sessionPanelLayouts)
		.set({ layoutSettings: { ...settings, widgetStyles: kept } })
		.where(mine)
}

/**
 * Replace the caller's session layout by COPYING one in: a session layout
 * preset (_Start from_ a card, _Start again from "X"_, _Reset to genre default
 * layout_) or `null` (_Start from scratch_). The incoming layout's widget
 * settings and style pins win for each widget instance it names; the session
 * keeps its others (owner LB). A preset the caller may not copy — another
 * genre's, a withdrawn one, a stranger's private one, a missing id — is
 * refused with one sentence and nothing is written.
 *
 * `clearPlacedWidgets` (sent by _Reset to genre default layout_ only, and
 * honoured only for the genre default itself) first clears the caller's
 * settings and style pins for the widgets that layout places.
 *
 * Answered like `:get`, so the page re-seeds from one message.
 */
export const sessionsPanelLayoutStartFromHandler: Handler<
	Sockets.Sessions.PanelLayout.StartFrom.Params,
	Sockets.Sessions.PanelLayout.StartFrom.Response
> = {
	event: "sessions:panelLayout:startFrom",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		let ok = false
		let error: string | undefined
		const presetId = params.layoutPresetId ?? null
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (presetId !== null && !Number.isInteger(presetId)) {
			error = LAYOUT_PRESET_UNKNOWN
		} else {
			const genreId = await sessionGenreOf(db, params.sessionId)
			const clearPlaced = params.clearPlacedWidgets === true
			const outcome = await db.transaction(async (tx) => {
				if (clearPlaced && presetId !== null) {
					const row = await genreDefaultLayoutRow(genreId, tx)
					if (row && row.id === presetId)
						await clearPlacedWidgetValues(tx, {
							sessionId: params.sessionId,
							userId,
							ids: drawnWidgetIds(arrangementOf(row.layout) as SessionLayoutV1)
						})
				}
				return copyLayoutIntoSession(tx, {
					sessionId: params.sessionId,
					userId,
					genreId,
					layoutPresetId: presetId
				})
			})
			if (outcome.ok) ok = true
			else error = outcome.error
		}
		const res: Sockets.Sessions.PanelLayout.StartFrom.Response = {
			...(await panelLayoutAnswer(params.sessionId, userId, access.hasAccess)),
			ok,
			error
		}
		emitToUser("sessions:panelLayout:startFrom", res)
		return res
	}
}

/**
 * Is this a `{ widgetId: { field: value } }` payload?
 *
 * Shape only: what a field means is the widget's declaration to say, and the
 * client prunes against it before writing. The boot reconciler prunes whatever
 * a stale or hand-made client stored anyway, so the guard here is the one thing
 * the server can know on its own.
 *
 * ⚠ The KEYS are not this function's question — `seatedWidgetSettings` below
 * holds them to the widgets the session can seat. Read together: this one
 * refuses a malformed payload outright, that one quietly drops a key no widget
 * would ever ask for.
 */
function isWidgetSettingsPayload(
	value: unknown
): value is Record<string, Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return false
	return Object.values(value).every(
		(v) => !!v && typeof v === "object" && !Array.isArray(v)
	)
}

/**
 * The widget settings this session will actually store: every key held to the
 * widget ids that can be SEATED in it (`seatableWidgetIds` — core's, the
 * session genre's declared panels, an enabled plugin's) OR that this user
 * already has a row for here (`storedWidgetInstanceIds`).
 *
 * The guard above answers shape only, and a key is not a shape: it becomes a
 * `widget_instance_id` verbatim, so without this anyone who can reach a
 * session could mint rows there under any id they liked — unreadable by any
 * widget, and unbounded in number.
 *
 * The second half of the set is why this closes that door without shutting a
 * user's own (ruled 2026-09-17): **a disable deletes nothing, so the gate must
 * not either.** The gate governs which rows can be MADE, never which survive —
 * the same rule `announcedWidgetIds` lives by for a style. A layout that still
 * names a disabled plugin's widget therefore writes it back untouched, and the
 * re-enable finds the arrangement where it was left.
 *
 * What it does NOT do is preserve a key the client genuinely dropped: absence
 * from the payload still means "remove the row", which is `writeWidgetSettings`'s
 * own sweep and the only way a person clears a setting. The exemption is about
 * a key that is PRESENT and unseatable, nothing else.
 *
 * A key in neither half is dropped rather than refused: failing the whole save
 * would cost the user the edit they were actually making. The warning names the
 * instance id and the session, which is what a person reading a log needs to
 * tell a stale client from a probe.
 */
async function seatedWidgetSettings(
	sessionId: number,
	userId: number,
	next: Record<string, Record<string, unknown>>
): Promise<Record<string, Record<string, unknown>>> {
	const keys = Object.keys(next)
	if (!keys.length) return next
	const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
	const seatable = await seatableWidgetIds(db, await sessionGenreOf(db, sessionId))
	const stored = await storedWidgetInstanceIds(sessionId, userId)
	const out: Record<string, Record<string, unknown>> = {}
	for (const key of keys) {
		// A placed copy (`messages#sanctum`, S1) is seatable exactly when its
		// widget is: the instance name is the layout's, never a new widget.
		if (seatable.has(widgetOfInstance(key)) || stored.has(key))
			out[key] = next[key]
		else
			console.warn(
				`widget settings: dropped '${key}' — no such widget in ` +
					`session ${sessionId}.`
			)
	}
	return out
}

/**
 * Is a session layout sent off the wire one the app can draw — no
 * `validateSessionLayout` ERROR? The errors go to the log; the person reads
 * one plain sentence. Warnings (a key readers ignore, an unknown widget)
 * never refuse.
 */
function drawableLayout(layout: unknown, verb: "set" | "save"): boolean {
	const verdict = validateSessionLayout(layout)
	if (!verdict.ok)
		console.warn(
			`session layout: refused to ${verb} a layout the app cannot draw — ${verdict.errors.join("; ")}`
		)
	return verdict.ok
}

/**
 * Persist the caller's session layout for a session (21 §10; the copy model).
 * One row per (user, session); upsert. The `layout` blob is stored verbatim —
 * its shape is the client surface manager's business.
 *
 * Provenance (`started from`, `layout_copied_at`) is never written here: only
 * a copy (`:startFrom`, the first open) and _Save as new layout_ write it, so a
 * client cannot name a preset it never copied. A `layoutPresetId` key from an
 * older client is ignored. The one exception is a set that INSERTS — no open
 * came first — which stamps `layout_copied_at` with no source, so the row is
 * never mistaken for a pre-copy-model one.
 *
 * `layoutSettings` and `widgetSettings` are written ONLY when the caller sends
 * the key: the surface manager's debounced save posts `layout` alone, several
 * times a minute, and absence meaning "clear" would wipe pins and settings on
 * every drag of a gutter.
 *
 * The `layout` is checked with the SDK's `validateSessionLayout` — its
 * `panels`, and the shape of any ⏳ old slot — and a layout with an error is
 * refused (`LAYOUT_PRESET_CANT_SAVE`, the errors to the log) with nothing
 * written, not even the keys that came with it. Warnings never refuse: the
 * row's own `active` and `tierSizeOverrides` are keys readers of the layout
 * ignore.
 */
export const sessionsPanelLayoutSetHandler: Handler<
	Sockets.Sessions.PanelLayout.Set.Params,
	Sockets.Sessions.PanelLayout.Set.Response
> = {
	event: "sessions:panelLayout:set",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		// ⏳ A page still holding a version 1 layout (or only the old slots) is
		// saved as panels version 2, its moved Messages settings and style pins
		// with it, BEFORE it is checked (PLAN-session-layout-simplify D14).
		if (access.hasAccess && params.layout && typeof params.layout === "object") {
			const { panelLayoutWriteAsV2 } = await import("$lib/server/db/sessionLayoutPanels")
			params = await panelLayoutWriteAsV2(params.sessionId, userId, params)
		}
		let ok = false
		let error: string | undefined
		const setsSettings = "layoutSettings" in params
		const setsWidgets = "widgetSettings" in params
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else if (!drawableLayout(params.layout, "set")) {
			error = LAYOUT_PRESET_CANT_SAVE
		} else if (
			setsSettings &&
			(!params.layoutSettings ||
				typeof params.layoutSettings !== "object")
		) {
			error = "Invalid layout settings"
		} else if (
			setsWidgets &&
			!isWidgetSettingsPayload(params.widgetSettings)
		) {
			error = "Invalid widget settings"
		} else {
			// Built conditionally so an absent key leaves its column alone.
			// Typed against the table so a mistyped column name is a compile
			// error rather than a silently ignored write.
			const changes: Partial<
				typeof schema.sessionPanelLayouts.$inferInsert
			> = { layout: params.layout }
			if (setsSettings) changes.layoutSettings = params.layoutSettings
			await db
				.insert(schema.sessionPanelLayouts)
				.values({
					sessionId: params.sessionId,
					userId,
					layoutCopiedAt: new Date(),
					...changes
				})
				.onConflictDoUpdate({
					target: [
						schema.sessionPanelLayouts.userId,
						schema.sessionPanelLayouts.sessionId
					],
					set: {
						...changes,
						updatedAt: new Date()
					}
				})
			if (setsWidgets)
				await writeWidgetSettings(
					params.sessionId,
					userId,
					await seatedWidgetSettings(
						params.sessionId,
						userId,
						params.widgetSettings!
					)
				)
			ok = true
		}
		const res: Sockets.Sessions.PanelLayout.Set.Response = {
			sessionId: params.sessionId,
			ok,
			error
		}
		emitToUser("sessions:panelLayout:set", res)
		return res
	}
}

/**
 * **Save as new layout** (owner L3): a new private session layout preset for
 * this session's genre, written from this session's layout — the sent
 * arrangement, with the settings and style pins of every widget instance the
 * page draws (`drawnWidgetIds`, the floor's included) packed in server-side
 * (`saveAsNewLayout`) — and made what this session **started from**, in one
 * transaction. It is offered to every session of the genre, and choosing it
 * there copies it in. An id that is not a widget instance id is dropped; a
 * layout the app cannot draw is refused and nothing is written.
 */
export const sessionsLayoutPresetSaveHandler: Handler<
	Sockets.Sessions.PanelLayout.Save.Params,
	Sockets.Sessions.PanelLayout.Save.Response
> = {
	event: "sessions:layoutPreset:save",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const name = typeof params.name === "string" ? params.name.trim() : ""
		let ok = false
		let error: string | undefined
		let preset: Sockets.Sessions.LayoutPreset | undefined
		let presets: Sockets.Sessions.LayoutPreset[] = []
		let startedFromLayoutPresetId: number | undefined
		let layoutCopiedAt: string | undefined
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!name) {
			error = LAYOUT_PRESET_NEEDS_NAME
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else if (!drawableLayout(params.layout, "save")) {
			error = LAYOUT_PRESET_CANT_SAVE
		} else {
			const genreId = await sessionGenreOf(db, params.sessionId)
			const saved = await saveAsNewLayout({
				sessionId: params.sessionId,
				genreId,
				userId,
				name,
				description:
					typeof params.description === "string"
						? params.description
						: undefined,
				layout: params.layout,
				drawnWidgetIds: Array.isArray(params.drawnWidgetIds)
					? params.drawnWidgetIds.filter(isWidgetInstanceId)
					: []
			})
			if (!saved.ok) {
				error = saved.error
			} else {
				preset = saved.preset
				startedFromLayoutPresetId = saved.startedFromLayoutPresetId
				layoutCopiedAt = saved.layoutCopiedAt.toISOString()
				presets = await listLayoutPresets(genreId, userId)
				ok = true
			}
		}
		const res: Sockets.Sessions.PanelLayout.Save.Response = {
			sessionId: params.sessionId,
			ok,
			error,
			preset,
			presets,
			startedFromLayoutPresetId,
			layoutCopiedAt
		}
		emitToUser("sessions:layoutPreset:save", res)
		return res
	}
}

/**
 * Rename one of the caller's OWN layout presets (PLAN 25 redesign) — or, for
 * an admin, a shared one (`db/layoutPermissions.ts`'s matrix: a shared row is
 * its author's and an admin's; a private one is its author's alone).
 *
 * Not session-scoped: a preset belongs to a genre and an author, not to the
 * session you happened to be looking at when you saved it. So there is no
 * session access check here — the only question is who manages the row, and
 * it is asked once, in `db/layoutPresets.ts`, for all of rename/delete/usage.
 *
 * The refreshed list rides the response exactly as `layoutPreset:save`'s does,
 * so the Presets tab never re-fetches to see its own edit.
 */
export const sessionsLayoutPresetRenameHandler: Handler<
	Sockets.Sessions.PanelLayout.Rename.Params,
	Sockets.Sessions.PanelLayout.Rename.Response
> = {
	event: "sessions:layoutPreset:rename",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const outcome = await renameUserLayoutPreset({
			presetId: params.id,
			userId,
			isAdmin: !!socket.user?.isAdmin,
			name: params.name
		})
		const res: Sockets.Sessions.PanelLayout.Rename.Response = outcome.ok
			? {
					id: params.id,
					ok: true,
					genreId: outcome.preset.genreId,
					preset: outcome.preset,
					presets: await listLayoutPresets(
						outcome.preset.genreId,
						userId
					)
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					// A refusal names no genre and lists nothing: it must not say
					// where an id it declined to touch actually lives.
					presets: []
				}
		emitToUser("sessions:layoutPreset:rename", res)
		// A shared layout's new name reaches everyone else offered it.
		if (outcome.ok && outcome.preset.visibility === "shared")
			await pushListToOthers(outcome.preset.genreId, userId, socket)
		return res
	}
}

/**
 * Delete one of the caller's own layout presets, saying how many sessions had
 * started from it. No session's layout changes: each holds its own copy, and
 * `session_panel_layouts.layout_preset_id` is `ON DELETE SET NULL`, so they
 * lose only their "started from" label. The client asks first
 * (`layoutPreset:usage`) and confirms with the counts.
 */
export const sessionsLayoutPresetDeleteHandler: Handler<
	Sockets.Sessions.PanelLayout.Delete.Params,
	Sockets.Sessions.PanelLayout.Delete.Response
> = {
	event: "sessions:layoutPreset:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const outcome = await deleteUserLayoutPreset({
			presetId: params.id,
			userId,
			isAdmin: !!socket.user?.isAdmin
		})
		const res: Sockets.Sessions.PanelLayout.Delete.Response = outcome.ok
			? {
					id: outcome.id,
					ok: true,
					genreId: outcome.genreId,
					affectedSessions: outcome.affectedSessions,
					presets: await listLayoutPresets(outcome.genreId, userId)
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					affectedSessions: 0,
					presets: []
				}
		emitToUser("sessions:layoutPreset:delete", res)
		// A shared layout's card leaves everyone else's list, and the
		// sessions that started from it lose the name (the FK nulled it).
		if (outcome.ok && outcome.visibility === "shared")
			await pushListToOthers(outcome.genreId, userId, socket)
		return res
	}
}

/**
 * What the delete confirmation says about one of the caller's own presets —
 * sessions that started from it, and people using it for new sessions —
 * behind the same authorship gate as the delete it precedes.
 */
export const sessionsLayoutPresetUsageHandler: Handler<
	Sockets.Sessions.PanelLayout.Usage.Params,
	Sockets.Sessions.PanelLayout.Usage.Response
> = {
	event: "sessions:layoutPreset:usage",
	handler: async (socket, params, emitToUser) => {
		const outcome = await layoutPresetUsage({
			presetId: params.id,
			userId: socket.user!.id,
			isAdmin: !!socket.user?.isAdmin
		})
		const res: Sockets.Sessions.PanelLayout.Usage.Response = outcome.ok
			? {
					id: outcome.id,
					ok: true,
					sessions: outcome.sessions,
					newSessionLayoutUsers: outcome.newSessionLayoutUsers
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					sessions: 0,
					newSessionLayoutUsers: 0
				}
		emitToUser("sessions:layoutPreset:usage", res)
		return res
	}
}

/* ── the L4 verbs (brief 6a of PLAN-layout-one-format-2026-09-28) ─────────
 * Share, make a copy, save changes to, and the new-session layout — on the
 * live `sessions:layoutPreset:*` family, over the db module's functions and
 * `db/layoutPermissions.ts`'s matrix. Every answer carries the refreshed list
 * for the row's genre, so the editor's pane re-renders from one message; a
 * refusal names no genre and lists nothing, as rename's does.
 */

/**
 * After a verb that changes what OTHER people are offered — sharing, stopping
 * sharing, renaming or deleting a shared layout — every other person with a
 * session of its genre open gets their refreshed list, live
 * (`pushLayoutListChanged`). After the caller's own answer; gated, so nobody
 * watching reads nothing.
 */
async function pushListToOthers(
	genreId: string,
	actorId: number,
	// `Handler`'s socket is untyped; its `io` is the server.
	socket: { io?: Parameters<typeof import("$lib/server/sessions/startedFromPush").pushLayoutListChanged>[1] }
): Promise<void> {
	const { pushLayoutListChanged } = await import("$lib/server/sessions/startedFromPush")
	await pushLayoutListChanged({ genreId, actorId }, socket.io)
}

/** The answer a managing verb gives: the row and its genre's list, or a refusal. */
async function managedAnswer(
	id: number,
	userId: number,
	outcome:
		| { ok: true; preset: Sockets.Sessions.LayoutPreset }
		| { ok: false; error: string }
): Promise<Sockets.Sessions.PanelLayout.ManagedAnswer> {
	if (!outcome.ok) return { id, ok: false, error: outcome.error, presets: [] }
	return {
		id,
		ok: true,
		genreId: outcome.preset.genreId,
		preset: outcome.preset,
		presets: await listLayoutPresets(outcome.preset.genreId, userId)
	}
}

/**
 * _Share with everyone on this server_ / _Stop sharing_ (`shareLayoutPreset`,
 * behind `canShare`: the author, or an admin for a shared row; never a
 * shipped row).
 *
 * ## Who is a guest (⚠ advisory)
 *
 * There is no account-level guest role (`users` carries one bit, `isAdmin`);
 * a guest is a guest ON A SESSION (`session_guests`). So the verb names the
 * session the editor is open in — the caller must be in it, and it must be of
 * the layout's genre (its list is where the layout was offered) — and a guest
 * THERE is refused publishing: the ruled matrix's "a guest may keep and change
 * their own layouts, never publish one". A share that names no session, or
 * one the caller is not in, is refused outright rather than read as "not a
 * guest".
 *
 * This does NOT stop a person who is a guest somewhere from publishing: anyone
 * may make a session, and in their own they are its owner, so the same share
 * named through it is allowed (pinned by a test). "A guest never publishes"
 * holds per session, not per account, until accounts carry a guest role —
 * an owner question (plan: brief 6a review). Taking a layout private is never
 * publishing, so it needs only the manage gate.
 */
export const sessionsLayoutPresetShareHandler: Handler<
	Sockets.Sessions.PanelLayout.Share.Params,
	Sockets.Sessions.PanelLayout.Share.Response
> = {
	event: "sessions:layoutPreset:share",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = Number.isInteger(params?.sessionId)
			? await checkSessionAccess(params.sessionId, userId)
			: null
		const res = await managedAnswer(
			params?.id,
			userId,
			!access?.hasAccess
				? { ok: false, error: "No access to this session" }
				: await shareLayoutPreset({
						presetId: params.id,
						userId,
						isAdmin: !!socket.user?.isAdmin,
						isGuest: access.isGuest && !access.isOwner,
						genreId: await sessionGenreOf(db, params.sessionId),
						visibility: params.visibility
					})
		)
		emitToUser("sessions:layoutPreset:share", res)
		// Shared or taken private: everyone else's list gains or loses it.
		if (res.ok && res.genreId) await pushListToOthers(res.genreId, userId, socket)
		return res
	}
}

/**
 * _Make a copy_ (`cloneLayoutPreset`): any layout the caller can see becomes
 * a new private layout of theirs. Seeing is the whole permission, so a guest
 * may, and no session is named; a stranger's private row, a withdrawn one and
 * a missing id all get the one unknown-layout sentence.
 */
export const sessionsLayoutPresetCloneHandler: Handler<
	Sockets.Sessions.PanelLayout.Clone.Params,
	Sockets.Sessions.PanelLayout.Clone.Response
> = {
	event: "sessions:layoutPreset:clone",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const res = await managedAnswer(
			params?.id,
			userId,
			await cloneLayoutPreset({
				presetId: params?.id,
				userId,
				name: typeof params?.name === "string" ? params.name : undefined
			})
		)
		emitToUser("sessions:layoutPreset:clone", res)
		return res
	}
}

/**
 * _Save changes to "*Name*"_ (`saveChangesToLayout`): re-capture this
 * session's layout into one of the caller's layouts — packed as Save as new
 * packs it, from the session's own widget settings and style pins — and make
 * it what this session **started from**. Behind session access and the manage
 * gate (the author, or an admin for a shared row); a layout of another genre
 * than the session's is unknown. Other sessions that started from it only
 * read **Updated**, and only when the layout moved — and they are TOLD, live,
 * after the caller's own answer (`pushStartedFromUpdated`, brief 6b).
 *
 * A session that itself reads the layout as **Updated** would overwrite what
 * was saved into it since the copy, so that save is refused unless the page
 * asked the person and sends `overwriteUpdated` (brief 6b).
 */
export const sessionsLayoutPresetUpdateHandler: Handler<
	Sockets.Sessions.PanelLayout.Update.Params,
	Sockets.Sessions.PanelLayout.Update.Response
> = {
	event: "sessions:layoutPreset:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = Number.isInteger(params?.sessionId)
			? await checkSessionAccess(params.sessionId, userId)
			: null
		let startedFromLayoutPresetId: number | undefined
		let layoutCopiedAt: string | undefined
		let moved = false
		let outcome:
			| { ok: true; preset: Sockets.Sessions.LayoutPreset }
			| { ok: false; error: string }
		if (!access?.hasAccess) {
			outcome = { ok: false, error: "No access to this session" }
		} else if (!params.layout || typeof params.layout !== "object") {
			outcome = { ok: false, error: "Invalid layout" }
		} else {
			const saved = await saveChangesToLayout({
				presetId: params.id,
				sessionId: params.sessionId,
				genreId: await sessionGenreOf(db, params.sessionId),
				userId,
				isAdmin: !!socket.user?.isAdmin,
				layout: params.layout,
				drawnWidgetIds: Array.isArray(params.drawnWidgetIds)
					? params.drawnWidgetIds.filter(isWidgetInstanceId)
					: [],
				overwriteUpdated: params.overwriteUpdated === true
			})
			outcome = saved
			if (saved.ok) {
				startedFromLayoutPresetId = saved.startedFromLayoutPresetId
				layoutCopiedAt = saved.layoutCopiedAt.toISOString()
				moved = saved.moved
			}
		}
		const res: Sockets.Sessions.PanelLayout.Update.Response = {
			...(await managedAnswer(params?.id, userId, outcome)),
			sessionId: params?.sessionId,
			startedFromLayoutPresetId,
			layoutCopiedAt
		}
		emitToUser("sessions:layoutPreset:update", res)
		// After the caller's answer: the sessions that started from it and now
		// read Updated hear it live (scoped, gated; nothing built for nobody).
		if (moved) {
			const { pushStartedFromUpdated } = await import(
				"$lib/server/sessions/startedFromPush"
			)
			await pushStartedFromUpdated({ layoutPresetIds: [params.id] }, socket.io)
		}
		return res
	}
}

/**
 * _Use for new *Genre* sessions_ / _Stop using for new sessions_
 * (`setUserLayoutDefault`): the caller's **new-session layout** for a genre,
 * copied in by their next first open of a session of it. It must be a layout
 * of that genre they can see; `null` clears it (the genre default layout
 * applies). Genre-scoped, not session-scoped: a guest chooses their own.
 */
export const sessionsLayoutPresetSetNewSessionLayoutHandler: Handler<
	Sockets.Sessions.PanelLayout.SetNewSessionLayout.Params,
	Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response
> = {
	event: "sessions:layoutPreset:setNewSessionLayout",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const genreId = typeof params?.genreId === "string" ? params.genreId : ""
		const outcome = await setUserLayoutDefault({
			userId,
			genreId,
			presetId: params?.layoutPresetId ?? null
		})
		const res: Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response =
			outcome.ok
				? {
						genreId,
						ok: true,
						layoutPresetId: outcome.presetId,
						presets: await listLayoutPresets(genreId, userId)
					}
				: { genreId, ok: false, error: outcome.error, presets: [] }
		emitToUser("sessions:layoutPreset:setNewSessionLayout", res)
		return res
	}
}
