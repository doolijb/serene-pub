/**
 * 🚧 (M2c) **The applet door** — what every applet server handler opens first
 * (`appletApi:libraryCharacters`, `appletApi:libraryLorebooks`,
 * `appletApi:librarySessions`, `appletApi:updateSession`, …; and `appletApi:userAnnex`'s
 * twin rule). A plugin's authority is the INTERSECTION of its granted applet
 * permissions, its ownership and the acting person's own rights (plan §8):
 * this resolves the first and the third; each handler then asks `personMay`
 * about the row it touches and checks ownership where a write needs it.
 *
 * - The person is ALWAYS the signed-in socket's (`actingPersonFor({ via:
 *   'view' })`) — never a param.
 * - The plugin must be installed, switched on and not a core row; its grant
 *   is read from the manifest's declared permissions minus the admin's
 *   denials (`appletGrant`), never from the request.
 * - `ownGenres` is the grant's `applet:sessions:<genre>` list clamped to
 *   genres in the plugin's own namespace (`<pluginId>:genre/…`): the packager
 *   refuses a foreign genre, and the runtime treats the stored manifest as a
 *   request, never a setting.
 *
 * Every refusal is a sentence a person can read (thrown; the socket's
 * `refusable` wrapper answers it as `<event>:error`).
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { pluginsEnabled } from "$lib/server/plugins"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import { appletGrant, effectivePermissions, type AppletGrant } from "$lib/server/plugins/permissions"
import { declaredPermissions } from "$lib/shared/plugins/declaredPermissions"
import { actingPersonFor, type ActingPerson } from "$lib/server/auth/actingPerson"

export interface AppletDoor {
	pluginId: string
	person: ActingPerson
	grant: AppletGrant
	/** The genres whose sessions the plugin reaches: granted AND its own. */
	ownGenres: string[]
}

/** A genre id in the plugin's own namespace (`<pluginId>:genre/…`). Pure. */
export function isOwnGenre(pluginId: string, genreId: unknown): genreId is string {
	return typeof genreId === "string" && genreId.startsWith(`${pluginId}:genre/`)
}

/** Open the door for one request: the person, the plugin's applet grant, its own genres. Throws a sentence. */
export async function openAppletDoor(db: Db, socketUserId: unknown, pluginId: unknown): Promise<AppletDoor> {
	if (!Number.isInteger(socketUserId)) throw new Error("Sign in to use an extension.")
	if (typeof pluginId !== "string" || !pluginId) throw new Error("That request names no extension.")
	if (!pluginsEnabled()) throw new Error("Extensions are switched off.")
	const [row] = await db
		.select({ manifest: schema.plugins.manifest, adminDenied: schema.plugins.adminDenied })
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, pluginId), eq(schema.plugins.enabled, true), notCoreRow()))
		.limit(1)
	if (!row) throw new Error("That extension is not installed and switched on.")
	const person = await actingPersonFor(db, { via: "view", userId: socketUserId as number })
	if (!person) throw new Error("Sign in to use an extension.")
	const grant = appletGrant(effectivePermissions(declaredPermissions(row.manifest), row.adminDenied))
	const ownGenres = [...new Set(grant.sessionGenres.filter((g) => isOwnGenre(pluginId, g)))]
	return { pluginId, person, grant, ownGenres }
}

/** The applet grant's library level, or a refusal sentence when it falls short. Pure. */
export function libraryGrantRefusal(
	door: Pick<AppletDoor, "grant">,
	what: "characters" | "lorebooks",
	need: "read" | "write"
): string | null {
	const has = door.grant[what]
	if (has === "write" || (need === "read" && has === "read")) return null
	return need === "write"
		? `That extension has not been given leave to change ${what}.`
		: `That extension has not been given the person's ${what}.`
}

/** A refusal when the genre is not one whose sessions the plugin reaches. Pure. */
export function sessionGenreRefusal(door: Pick<AppletDoor, "ownGenres">, genreId: unknown): string | null {
	return typeof genreId === "string" && door.ownGenres.includes(genreId)
		? null
		: `'${String(genreId ?? "")}' is not one of this extension's genres.`
}
