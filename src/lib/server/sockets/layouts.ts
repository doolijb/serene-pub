/**
 * The `layouts:*` namespace — the socket half of the v2 **layout document**
 * (session layout v2 §4.6). The OTHER halves are `db/layoutPresets.ts` (the
 * rows, the resolution chain and every refusal sentence),
 * `db/layoutPermissions.ts` (the matrix) and `db/pluginLayouts.ts` (the plugin
 * reconciler); this file only turns a socket payload into a call and a refusal
 * into an `:error`.
 *
 * ## Why a new family rather than more `sessions:layoutPreset:*`
 *
 * The existing `sessions:panelLayout:*` and `sessions:layoutPreset:*` events
 * keep working, unchanged, against the ⏳ legacy blob — the pre-v2 client is
 * still what most people are looking at, and nothing here touches it. This
 * family speaks `LayoutDoc`, knows **origin** and **visibility**, and carries
 * the four verbs the legacy one never had (share, clone, set-default,
 * export/import). They coexist until P6 retires the legacy renderer.
 *
 * ## Refusals are privacy-ordered
 *
 * A row the caller cannot even see is refused with the SAME sentence a missing
 * one gets, so the id space cannot be walked to learn what other people have
 * saved. That ordering lives in the db layer, where the row is; this file must
 * not add a check that answers earlier and differently.
 *
 * ## On "guests"
 *
 * The ruled matrix says a guest may apply anything they can see and save
 * private layouts of their own, and never share one with the instance. ⚠ This
 * instance has no guest ROLE — `users` carries one bit, `isAdmin` — so a guest
 * is a guest ON A SESSION, and the fact is only available to a verb the caller
 * scoped with a `sessionId`. `share` therefore refuses a guest who asked
 * through a session and cannot know about one who did not; `mayShare` in
 * `sockets/widgetStyles.ts` carries the same caveat, and both change the day an
 * account-level guest role exists.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	cloneLayoutPreset,
	deleteUserLayoutPreset,
	exportLayoutPreset,
	importLayoutPreset,
	layoutPresetUsage,
	listLayoutPresets,
	resolveLayoutFor,
	saveUserLayoutPreset,
	shareLayoutPreset,
	updateUserLayoutPreset,
	checkLayoutDoc,
	LAYOUT_PRESET_NEEDS_NAME
} from "$lib/server/db/layoutPresets"
import { setUserLayoutDefault } from "$lib/server/db/userLayoutDefaults"
import type {
	LayoutScope,
	LayoutsCloneParams,
	LayoutsCloneResponse,
	LayoutsDeleteParams,
	LayoutsDeleteResponse,
	LayoutsExportParams,
	LayoutsExportResponse,
	LayoutsImportParams,
	LayoutsImportResponse,
	LayoutsListParams,
	LayoutsListResponse,
	LayoutsResolveParams,
	LayoutsResolveResponse,
	LayoutsSaveParams,
	LayoutsSaveResponse,
	LayoutsSetDefaultParams,
	LayoutsSetDefaultResponse,
	LayoutsShareParams,
	LayoutsShareResponse,
	LayoutsUpdateParams,
	LayoutsUpdateResponse,
	LayoutsUsageParams,
	LayoutsUsageResponse
} from "$lib/shared/sockets/layouts"

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

/** What a verb with no session and no genre is refused with. */
const NO_SCOPE = "That layout has no session type — name a session or a genre."
/** …and what a session the caller is not in is refused with. */
const NO_SESSION = "No access to this session"

/**
 * The genre a verb is about, and whether the caller reached it as a guest.
 *
 * A `sessionId` answers both — and is checked, because a genre read through a
 * session somebody is not in would confirm that session exists. A bare
 * `genreId` answers only the first: genres are not secret (every picker lists
 * them), and the rows the genre's list returns are filtered by the visibility
 * predicate regardless.
 */
async function scopeOf(
	socket: any,
	params: LayoutScope | undefined,
	emitToUser: (event: string, data: any) => void,
	event: string
): Promise<{ genreId: string; isGuest: boolean }> {
	const userId = socket.user!.id
	if (Number.isInteger(params?.sessionId)) {
		const access = await checkSessionAccess(params!.sessionId!, userId)
		if (!access.hasAccess) refuse(emitToUser, event, NO_SESSION)
		const [row] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params!.sessionId!))
			.limit(1)
		if (!row) refuse(emitToUser, event, NO_SESSION)
		return { genreId: row.genreId, isGuest: access.isGuest }
	}
	if (typeof params?.genreId === "string" && params.genreId)
		return { genreId: params.genreId, isGuest: false }
	refuse(emitToUser, event, NO_SCOPE)
}

/** The bundle a save or an import carries, or a refusal. */
async function requireBundle(
	preset: unknown,
	emitToUser: (event: string, data: any) => void,
	event: string
) {
	if (!preset || typeof preset !== "object" || !("layout" in preset))
		refuse(emitToUser, event, "That layout carries no layout document.")
	const checked = await checkLayoutDoc((preset as any).layout)
	if (!checked.ok) refuse(emitToUser, event, checked.error)
	return preset as { layout: any; widgetSettings?: any; widgetStyles?: any }
}

export const layoutsList: Handler<LayoutsListParams, LayoutsListResponse> = {
	event: "layouts:list",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:list"
		const { genreId } = await scopeOf(socket, params, emitToUser, event)
		const res: LayoutsListResponse = {
			genreId,
			presets: await listLayoutPresets(genreId, socket.user!.id)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsSave: Handler<LayoutsSaveParams, LayoutsSaveResponse> = {
	event: "layouts:save",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:save"
		const userId = socket.user!.id
		const { genreId } = await scopeOf(socket, params, emitToUser, event)
		const name = typeof params?.name === "string" ? params.name.trim() : ""
		if (!name) refuse(emitToUser, event, LAYOUT_PRESET_NEEDS_NAME)
		const preset = await requireBundle(params?.preset, emitToUser, event)

		const saved = await saveUserLayoutPreset({
			genreId,
			userId,
			name,
			description: params?.description,
			preset
		})
		const res: LayoutsSaveResponse = {
			preset: saved,
			presets: await listLayoutPresets(genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsUpdate: Handler<
	LayoutsUpdateParams,
	LayoutsUpdateResponse
> = {
	event: "layouts:update",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:update"
		const userId = socket.user!.id
		const outcome = await updateUserLayoutPreset({
			presetId: params?.presetId as number,
			userId,
			isAdmin: !!socket.user?.isAdmin,
			name: params?.name,
			description: params?.description,
			preset: params?.preset
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsUpdateResponse = {
			preset: outcome.preset,
			presets: await listLayoutPresets(outcome.preset.genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsShare: Handler<LayoutsShareParams, LayoutsShareResponse> = {
	event: "layouts:share",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:share"
		const userId = socket.user!.id
		// The guest fact only exists when the caller named a session; see the
		// file header. A bare id is asked as "not acting as a guest".
		let isGuest = false
		if (Number.isInteger(params?.sessionId))
			isGuest = (await scopeOf(socket, params, emitToUser, event)).isGuest

		const outcome = await shareLayoutPreset({
			presetId: params?.presetId as number,
			userId,
			isAdmin: !!socket.user?.isAdmin,
			isGuest,
			visibility: params?.visibility
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsShareResponse = {
			preset: outcome.preset,
			presets: await listLayoutPresets(outcome.preset.genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsClone: Handler<LayoutsCloneParams, LayoutsCloneResponse> = {
	event: "layouts:clone",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:clone"
		const userId = socket.user!.id
		const outcome = await cloneLayoutPreset({
			presetId: params?.presetId as number,
			userId,
			name: params?.name
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsCloneResponse = {
			preset: outcome.preset,
			presets: await listLayoutPresets(outcome.preset.genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsDelete: Handler<
	LayoutsDeleteParams,
	LayoutsDeleteResponse
> = {
	event: "layouts:delete",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:delete"
		const userId = socket.user!.id
		const outcome = await deleteUserLayoutPreset({
			presetId: params?.presetId as number,
			userId,
			isAdmin: !!socket.user?.isAdmin
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsDeleteResponse = {
			id: outcome.id,
			genreId: outcome.genreId,
			affectedSessions: outcome.affectedSessions,
			presets: await listLayoutPresets(outcome.genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsUsage: Handler<LayoutsUsageParams, LayoutsUsageResponse> = {
	event: "layouts:usage",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:usage"
		const outcome = await layoutPresetUsage({
			presetId: params?.presetId as number,
			userId: socket.user!.id,
			isAdmin: !!socket.user?.isAdmin
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsUsageResponse = {
			id: outcome.id,
			sessions: outcome.sessions
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsSetDefault: Handler<
	LayoutsSetDefaultParams,
	LayoutsSetDefaultResponse
> = {
	event: "layouts:setDefault",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:setDefault"
		const { genreId } = await scopeOf(socket, params, emitToUser, event)
		const presetId =
			params?.presetId == null ? null : (params.presetId as number)
		const outcome = await setUserLayoutDefault({
			userId: socket.user!.id,
			genreId,
			presetId
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsSetDefaultResponse = {
			genreId: outcome.genreId,
			presetId: outcome.presetId
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsExport: Handler<
	LayoutsExportParams,
	LayoutsExportResponse
> = {
	event: "layouts:export",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:export"
		const outcome = await exportLayoutPreset({
			presetId: params?.presetId as number,
			userId: socket.user!.id
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsExportResponse = {
			presetId: outcome.presetId,
			genreId: outcome.genreId,
			name: outcome.name,
			description: outcome.description,
			preset: outcome.preset
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsImport: Handler<
	LayoutsImportParams,
	LayoutsImportResponse
> = {
	event: "layouts:import",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:import"
		const userId = socket.user!.id
		const { genreId } = await scopeOf(socket, params, emitToUser, event)
		const preset = await requireBundle(params?.preset, emitToUser, event)
		const outcome = await importLayoutPreset({
			genreId,
			userId,
			name: params?.name,
			description: params?.description,
			preset
		})
		if (!outcome.ok) refuse(emitToUser, event, outcome.error)
		const res: LayoutsImportResponse = {
			preset: outcome.preset,
			presets: await listLayoutPresets(genreId, userId)
		}
		emitToUser(event, res)
		return res
	}
}

export const layoutsResolve: Handler<
	LayoutsResolveParams,
	LayoutsResolveResponse
> = {
	event: "layouts:resolve",
	handler: async (socket, params, emitToUser) => {
		const event = "layouts:resolve"
		const userId = socket.user!.id
		if (!Number.isInteger(params?.sessionId))
			refuse(emitToUser, event, NO_SESSION)
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) refuse(emitToUser, event, NO_SESSION)
		const res = await resolveLayoutFor(params.sessionId, userId)
		emitToUser(event, res)
		return res
	}
}

export function registerLayoutHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, layoutsList, emitToUser)
	register(socket, layoutsSave, emitToUser)
	register(socket, layoutsUpdate, emitToUser)
	register(socket, layoutsShare, emitToUser)
	register(socket, layoutsClone, emitToUser)
	register(socket, layoutsDelete, emitToUser)
	register(socket, layoutsUsage, emitToUser)
	register(socket, layoutsSetDefault, emitToUser)
	register(socket, layoutsExport, emitToUser)
	register(socket, layoutsImport, emitToUser)
	register(socket, layoutsResolve, emitToUser)
}
