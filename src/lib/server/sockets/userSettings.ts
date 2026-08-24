import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import type { AuthenticatedSocket } from "./auth"
import {
	handleUserBackgroundUpload,
	listUserBackgrounds,
	deleteUserBackground
} from "$lib/server/utils"
import { readFileSync } from "fs"
import { join } from "path"
import { dev } from "$app/environment"

const DEFAULT_BACKGROUNDS_MANIFEST = "/backgrounds/defaults/manifest.json"

// The 9 default backgrounds that shipped as .jpg before being re-encoded to
// .webp (see dist size-reduction pass). A user's stored backgroundImagePath
// can still reference one of these old .jpg names from before their install
// was upgraded — the .jpg files themselves are gone from the shipped bundle,
// so without this rewrite the background would just silently fail to load.
const LEGACY_DEFAULT_JPG_BASENAMES = new Set([
	"city-street_tom-w-zwdkxQZu0Ko-unsplash",
	"garden-walkway_veronica-reverse-qYwyRF9u-uo-unsplash",
	"granite-hall_ali-lokhandwala-KUr51Y4dOyo-unsplash",
	"japanese-village_rogerio-toledo-g6se8ozlRV0-unsplash",
	"modern-home-interior_lotus-design-n-print-WgkA3CSFrjc-unsplash",
	"mossy-forest_gustav-gullstrand-d6kSvT2xZQo-unsplash",
	"mountain-castle_andreas-weilguny-2uAVyybMrHI-unsplash",
	"river-under-forest-overgrowth_tienko-dima-uYoVf9I6ANI-unsplash",
	"rustic-pub_nikola-jovanovic-QGPmWrclELg-unsplash"
])

export function resolveBackgroundImagePath(
	storedPath: string | null | undefined
): string | null {
	if (!storedPath) return storedPath ?? null
	const match = storedPath.match(/^\/backgrounds\/defaults\/(.+)\.jpg$/)
	if (!match || !LEGACY_DEFAULT_JPG_BASENAMES.has(match[1])) return storedPath
	return `/backgrounds/defaults/${match[1]}.webp`
}

export function getDefaultBackgrounds(): string[] {
	// In dev, `vite dev` only ever serves static/ — there is no build/client
	// being actively served, so any build/ directory on disk while
	// developing is necessarily a stale leftover from a past `npm run
	// build` (possibly out of sync with the current static/ contents, eg.
	// referencing filenames that no longer exist). Consulting it here would
	// silently mask what's actually being served. In prod, adapter-node's
	// build/client is the actual served static root — static/ is only ever
	// copied into it, never read directly at runtime, and the desktop
	// bundle stopped shipping a second static/ copy (see bundle-dist.js).
	// Try that first; fall back to the old static/ path for one release in
	// case some launch path resolves process.cwd() differently than
	// expected (dist-assets/*/run.* don't cd into the app directory before
	// launching node).
	const candidatePaths = dev
		? [
				join(
					process.cwd(),
					"static",
					"backgrounds",
					"defaults",
					"manifest.json"
				)
			]
		: [
				join(
					process.cwd(),
					"build",
					"client",
					"backgrounds",
					"defaults",
					"manifest.json"
				),
				join(
					process.cwd(),
					"static",
					"backgrounds",
					"defaults",
					"manifest.json"
				)
			]
	for (let i = 0; i < candidatePaths.length; i++) {
		try {
			const manifest = JSON.parse(
				readFileSync(candidatePaths[i], "utf-8")
			) as string[]
			if (i > 0) {
				console.warn(
					`Default backgrounds manifest not found at ${candidatePaths[0]}; ` +
						`fell back to ${candidatePaths[i]}. This usually means the ` +
						`process was launched with an unexpected working directory.`
				)
			}
			return manifest.map((f) => `/backgrounds/defaults/${f}`)
		} catch {
			continue
		}
	}
	return []
}

export const userSettingsGet: Handler<
	Sockets.UserSettings.Get.Params,
	Sockets.UserSettings.Get.Response
> = {
	event: "userSettings:get",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			let settings = await db.query.userSettings.findFirst({
				where: (t, { eq }) => eq(t.userId, userId),
				columns: {
					id: false, // We don't need the ID in the response
					userId: false // We don't need the userId in the response
				}
			})

			// If no user settings found, create default ones
			if (!settings) {
				await db
					.insert(schema.userSettings)
					.values({
						userId: userId,
						theme: "hamlindigo",
						darkMode: true,
						showHomePageBanner: true,
						enableEasyPersonaCreation: true,
						enableEasyCharacterCreation: true,
						showAllCharacterFields: false
					})
					.onConflictDoNothing()

				// Fetch the newly created settings
				settings = await db.query.userSettings.findFirst({
					where: (t, { eq }) => eq(t.userId, userId),
					columns: {
						id: false,
						userId: false
					}
				})
			}

			if (!settings) {
				throw new Error("Failed to create user settings")
			}

			const res: Sockets.UserSettings.Get.Response = {
				userSettings: {
					activeContextConfigId: settings.activeContextConfigId,
					activePromptConfigId: settings.activePromptConfigId,
					activeNarratorPromptConfigId:
						settings.activeNarratorPromptConfigId,
					activeSummarizeWorldConfigId:
						settings.activeSummarizeWorldConfigId,
					activeSummarizeCharacterConfigId:
						settings.activeSummarizeCharacterConfigId,
					activeSummarizeSceneConfigId:
						settings.activeSummarizeSceneConfigId,
					theme: settings.theme || "hamlindigo",
					darkMode:
						settings.darkMode !== null ? settings.darkMode : true,
					showHomePageBanner: settings.showHomePageBanner ?? true,
					enableEasyPersonaCreation:
						settings.enableEasyPersonaCreation,
					enableEasyCharacterCreation:
						settings.enableEasyCharacterCreation,
					showAllCharacterFields: settings.showAllCharacterFields,
					backgroundImagePath: resolveBackgroundImagePath(
						settings.backgroundImagePath
					),
					backgroundOpacity: settings.backgroundOpacity ?? 75,
					charaVaultIncludeNsfw:
						settings.charaVaultIncludeNsfw ?? false
				}
			}

			emitToUser("userSettings:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching user settings:", error)
			emitToUser("userSettings:get:error", {
				error: "Failed to fetch user settings"
			})
			throw error
		}
	}
}

export const userSettingsUpdateCharaVaultIncludeNsfw: Handler<
	Sockets.UserSettings.UpdateCharaVaultIncludeNsfw.Params,
	Sockets.UserSettings.UpdateCharaVaultIncludeNsfw.Response
> = {
	event: "userSettings:updateCharaVaultIncludeNsfw",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					charaVaultIncludeNsfw: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateCharaVaultIncludeNsfw.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateCharaVaultIncludeNsfw", res)
			await userSettingsGet.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("Update CharaVault include-NSFW error:", error)
			emitToUser("userSettings:updateCharaVaultIncludeNsfw:error", {
				error: "Failed to update setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateShowHomePageBanner: Handler<
	Sockets.UserSettings.UpdateShowHomePageBanner.Params,
	Sockets.UserSettings.UpdateShowHomePageBanner.Response
> = {
	event: "userSettings:updateShowHomePageBanner",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					showHomePageBanner: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateShowHomePageBanner.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateShowHomePageBanner", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update show home page banner error:", error)
			emitToUser("userSettings:updateShowHomePageBanner:error", {
				error: "Failed to update show home page banner setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateEasyPersonaCreation: Handler<
	Sockets.UserSettings.UpdateEasyPersonaCreation.Params,
	Sockets.UserSettings.UpdateEasyPersonaCreation.Response
> = {
	event: "userSettings:updateEasyPersonaCreation",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					enableEasyPersonaCreation: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateEasyPersonaCreation.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateEasyPersonaCreation", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update easy persona creation error:", error)
			emitToUser("userSettings:updateEasyPersonaCreation:error", {
				error: "Failed to update easy persona creation setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateEasyCharacterCreation: Handler<
	Sockets.UserSettings.UpdateEasyCharacterCreation.Params,
	Sockets.UserSettings.UpdateEasyCharacterCreation.Response
> = {
	event: "userSettings:updateEasyCharacterCreation",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					enableEasyCharacterCreation: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateEasyCharacterCreation.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateEasyCharacterCreation", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update easy character creation error:", error)
			emitToUser("userSettings:updateEasyCharacterCreation:error", {
				error: "Failed to update easy character creation setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateShowAllCharacterFields: Handler<
	Sockets.UserSettings.UpdateShowAllCharacterFields.Params,
	Sockets.UserSettings.UpdateShowAllCharacterFields.Response
> = {
	event: "userSettings:updateShowAllCharacterFields",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({
					showAllCharacterFields: params.enabled
				})
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateShowAllCharacterFields.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("userSettings:updateShowAllCharacterFields", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update show all character fields error:", error)
			emitToUser("userSettings:updateShowAllCharacterFields:error", {
				error: "Failed to update show all character fields setting"
			})
			throw error
		}
	}
}

export const userSettingsUpdateTheme: Handler<
	Sockets.UserSettings.UpdateTheme.Params,
	Sockets.UserSettings.UpdateTheme.Response
> = {
	event: "userSettings:updateTheme",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({ theme: params.theme })
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateTheme.Response = {
				success: true,
				theme: params.theme
			}
			emitToUser("userSettings:updateTheme", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update theme error:", error)
			emitToUser("userSettings:updateTheme:error", {
				error: "Failed to update theme"
			})
			throw error
		}
	}
}

export const userSettingsUpdateDarkMode: Handler<
	Sockets.UserSettings.UpdateDarkMode.Params,
	Sockets.UserSettings.UpdateDarkMode.Response
> = {
	event: "userSettings:updateDarkMode",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) {
				throw new Error("User not authenticated")
			}

			await db
				.update(schema.userSettings)
				.set({ darkMode: params.enabled })
				.where(eq(schema.userSettings.userId, userId))

			const res: Sockets.UserSettings.UpdateDarkMode.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("userSettings:updateDarkMode", res)
			await userSettingsGet.handler(socket, {}, emitToUser) // Refresh user settings after update
			return res
		} catch (error: any) {
			console.error("Update dark mode error:", error)
			emitToUser("userSettings:updateDarkMode:error", {
				error: "Failed to update dark mode"
			})
			throw error
		}
	}
}

export const userSettingsListBackgrounds: Handler<
	Sockets.UserSettings.ListBackgrounds.Params,
	Sockets.UserSettings.ListBackgrounds.Response
> = {
	event: "userSettings:listBackgrounds",
	handler: async (socket: AuthenticatedSocket, _params, emitToUser) => {
		const userId = socket.user!.id
		const defaults = getDefaultBackgrounds()
		const uploads = await listUserBackgrounds({ userId })
		const res: Sockets.UserSettings.ListBackgrounds.Response = {
			defaults,
			uploads
		}
		emitToUser("userSettings:listBackgrounds", res)
		return res
	}
}

export const userSettingsUploadBackground: Handler<
	Sockets.UserSettings.UploadBackground.Params,
	Sockets.UserSettings.UploadBackground.Response
> = {
	event: "userSettings:uploadBackground",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		const userId = socket.user!.id
		const bgPath = await handleUserBackgroundUpload({
			userId,
			backgroundFile: params.backgroundFile,
			mimeType: params.mimeType
		})
		const res: Sockets.UserSettings.UploadBackground.Response = {
			success: true,
			path: bgPath
		}
		emitToUser("userSettings:uploadBackground", res)
		// Refresh list so client gets updated uploads
		await userSettingsListBackgrounds.handler(socket, {}, emitToUser)
		return res
	}
}

export const userSettingsDeleteBackground: Handler<
	Sockets.UserSettings.DeleteBackground.Params,
	Sockets.UserSettings.DeleteBackground.Response
> = {
	event: "userSettings:deleteBackground",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		const userId = socket.user!.id
		await deleteUserBackground({ userId, path: params.path })
		const res: Sockets.UserSettings.DeleteBackground.Response = {
			success: true
		}
		emitToUser("userSettings:deleteBackground", res)
		// Refresh list
		await userSettingsListBackgrounds.handler(socket, {}, emitToUser)
		return res
	}
}

export const userSettingsUpdateBackground: Handler<
	Sockets.UserSettings.UpdateBackground.Params,
	Sockets.UserSettings.UpdateBackground.Response
> = {
	event: "userSettings:updateBackground",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		const userId = socket.user!.id

		// params.path is later interpolated unescaped into a CSS url(...) on
		// the user's own page (Layout.svelte) — restrict it to an actual
		// shipped default or one of this user's own uploads, the same two
		// lists userSettings:listBackgrounds itself offers, rather than
		// accepting an arbitrary string verbatim.
		if (params.path !== null) {
			const [defaults, uploads] = await Promise.all([
				Promise.resolve(getDefaultBackgrounds()),
				listUserBackgrounds({ userId })
			])
			if (
				!defaults.includes(params.path) &&
				!uploads.includes(params.path)
			) {
				throw new Error("Invalid background image.")
			}
		}

		await db
			.update(schema.userSettings)
			.set({
				backgroundImagePath: params.path,
				backgroundOpacity: params.opacity
			})
			.where(eq(schema.userSettings.userId, userId))
		const res: Sockets.UserSettings.UpdateBackground.Response = {
			success: true,
			path: params.path,
			opacity: params.opacity
		}
		emitToUser("userSettings:updateBackground", res)
		await userSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

// Registration function for all user settings handlers
export function registerUserSettingsHandlers(
	socket: AuthenticatedSocket,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: AuthenticatedSocket,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, userSettingsGet, emitToUser)
	register(socket, userSettingsUpdateCharaVaultIncludeNsfw, emitToUser)
	register(socket, userSettingsUpdateShowHomePageBanner, emitToUser)
	register(socket, userSettingsUpdateEasyPersonaCreation, emitToUser)
	register(socket, userSettingsUpdateEasyCharacterCreation, emitToUser)
	register(socket, userSettingsUpdateShowAllCharacterFields, emitToUser)
	register(socket, userSettingsUpdateTheme, emitToUser)
	register(socket, userSettingsUpdateDarkMode, emitToUser)
	register(socket, userSettingsListBackgrounds, emitToUser)
	register(socket, userSettingsUploadBackground, emitToUser)
	register(socket, userSettingsDeleteBackground, emitToUser)
	register(socket, userSettingsUpdateBackground, emitToUser)
}
