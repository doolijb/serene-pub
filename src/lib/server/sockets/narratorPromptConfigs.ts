import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user as loadUser } from "./users"
import { buildUserSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"

/**
 * The config list and one config, as functions, so the four write cascades below
 * can be handed the BUILDER rather than the handler. Both events are gated, so a
 * write made from anywhere but the admin list pays for no re-read. Skipping the
 * emit alone would save nothing; the query is the cost.
 *
 * No admin check here — that belongs to the handlers, which are the surface a
 * client can reach, and every cascade below has already made it.
 */
async function buildNarratorPromptConfigsList(): Promise<Sockets.NarratorPromptConfigs.List.Response> {
	const narratorPromptConfigsList =
		await db.query.narratorPromptConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true
			},
			orderBy: (c, { asc, desc }) => [desc(c.isImmutable), asc(c.name)]
		})
	return { narratorPromptConfigsList }
}

/** One config. See `buildNarratorPromptConfigsList`. */
async function buildNarratorPromptConfigsGet(
	id: number
): Promise<Sockets.NarratorPromptConfigs.Get.Response> {
	const narratorPromptConfig =
		await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
	if (!narratorPromptConfig)
		throw new Error("Narrator prompt config not found")
	return { narratorPromptConfig }
}

export const narratorPromptConfigsListHandler: Handler<
	Sockets.NarratorPromptConfigs.List.Params,
	Sockets.NarratorPromptConfigs.List.Response
> = {
	event: "narratorPromptConfigs:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage prompt configurations."
			)
		}

		const res = await buildNarratorPromptConfigsList()
		emitToUser("narratorPromptConfigs:list", res)
		return res
	}
}

export const narratorPromptConfigsGet: Handler<
	Sockets.NarratorPromptConfigs.Get.Params,
	Sockets.NarratorPromptConfigs.Get.Response
> = {
	event: "narratorPromptConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage prompt configurations."
			)
		}

		let res: Sockets.NarratorPromptConfigs.Get.Response
		try {
			res = await buildNarratorPromptConfigsGet(params.id)
		} catch (error) {
			emitToUser("narratorPromptConfigs:get:error", {
				error: "Narrator prompt config not found"
			})
			throw error
		}
		emitToUser("narratorPromptConfigs:get", res)
		return res
	}
}

export const narratorPromptConfigsCreate: Handler<
	Sockets.NarratorPromptConfigs.Create.Params,
	Sockets.NarratorPromptConfigs.Create.Response
> = {
	event: "narratorPromptConfigs:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can create prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create prompt configurations."
			)
		}

		// seedKey marks a row as one of the built-in seeded configs and is
		// UNIQUE, so it must never come from the client. The sidebars build a
		// "New" config by spreading the currently-selected one and deleting a
		// couple of fields; cloning a SEEDED config therefore carried its
		// seedKey straight through and the insert died on the unique index:
		//   duplicate key value violates unique constraint "narrator_prompt_configs_seed_key_unique"
		//   a duplicate seed_key.
		//
		// id is stripped for the same reason personasCreate strips it: both are
		// server-owned, and honouring either lets a caller collide with or
		// overwrite an existing row. Done here rather than in the sidebar
		// because a handler must not trust its payload — the sidebar already
		// deletes `id` and still missed this one.
		const { id: _id, seedKey: _seedKey, ...narratorPromptConfigValues } = (params.narratorPromptConfig ?? {}) as any

		const [narratorPromptConfig] = await db
			.insert(schema.narratorPromptConfigs)
			.values(narratorPromptConfigValues)
			.returning()
		// Lazy — see `buildNarratorPromptConfigsList`.
		await emitToUser("narratorPromptConfigs:list", () =>
			buildNarratorPromptConfigsList()
		)
		const res: Sockets.NarratorPromptConfigs.Create.Response = {
			narratorPromptConfig
		}
		emitToUser("narratorPromptConfigs:create", res)
		return res
	}
}

export const narratorPromptConfigsUpdate: Handler<
	Sockets.NarratorPromptConfigs.Update.Params,
	Sockets.NarratorPromptConfigs.Update.Response
> = {
	event: "narratorPromptConfigs:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can update prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update prompt configurations."
			)
		}

		const id = params.narratorPromptConfig.id!
		const { id: _, ...rawUpdateData } = params.narratorPromptConfig

		const currentConfig = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
		// Immutable (built-in) configs may still have their AI Override
		// (connection/sampling) changed — that's the one thing the UI
		// leaves editable for them — but nothing else. Every other field
		// must come only from seeding.
		const updateData = currentConfig?.isImmutable
			? {
					connectionId: rawUpdateData.connectionId,
					samplingConfigId: rawUpdateData.samplingConfigId
				}
			: rawUpdateData

		// A raw client could target an immutable row with neither override
		// field present at all — updateData then has no defined values, and
		// an empty .set() throws rather than being a legitimate no-op.
		const hasUpdates = Object.values(updateData).some(
			(v) => v !== undefined
		)
		const narratorPromptConfig = hasUpdates
			? (
					await db
						.update(schema.narratorPromptConfigs)
						.set(updateData)
						.where(eq(schema.narratorPromptConfigs.id, id))
						.returning()
				)[0]
			: currentConfig!
		// Lazy — see `buildNarratorPromptConfigsList`.
		await emitToUser("narratorPromptConfigs:list", () =>
			buildNarratorPromptConfigsList()
		)
		const res: Sockets.NarratorPromptConfigs.Update.Response = {
			narratorPromptConfig
		}
		emitToUser("narratorPromptConfigs:update", res)
		return res
	}
}

export const narratorPromptConfigsDelete: Handler<
	Sockets.NarratorPromptConfigs.Delete.Params,
	Sockets.NarratorPromptConfigs.Delete.Response
> = {
	event: "narratorPromptConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can delete prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete prompt configurations."
			)
		}

		const currentConfig = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("narratorPromptConfigs:delete:error", {
				error: "Cannot delete a built-in narrator prompt config."
			})
			throw new Error("Cannot delete a built-in narrator prompt config.")
		}

		await db
			.delete(schema.narratorPromptConfigs)
			.where(eq(schema.narratorPromptConfigs.id, params.id))
		// Lazy — see `buildNarratorPromptConfigsList`.
		await emitToUser("narratorPromptConfigs:list", () =>
			buildNarratorPromptConfigsList()
		)
		const res: Sockets.NarratorPromptConfigs.Delete.Response = {
			success: "Narrator prompt config deleted successfully"
		}
		emitToUser("narratorPromptConfigs:delete", res)
		return res
	}
}

export const narratorPromptConfigsSetUserActive: Handler<
	Sockets.NarratorPromptConfigs.SetUserActive.Params,
	Sockets.NarratorPromptConfigs.SetUserActive.Response
> = {
	event: "narratorPromptConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active prompt configurations."
			)
		}

		const userId = socket.user!.id
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})
		if (!currentUser) {
			emitToUser("narratorPromptConfigs:setUserActive:error", {
				error: "User not found."
			})
			throw new Error("User not found")
		}

		// Find or create user settings
		let userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, currentUser.id)
		})

		if (!userSettings) {
			await db
				.insert(schema.userSettings)
				.values({
					userId: currentUser.id
				})
				.onConflictDoNothing()
		}

		await db
			.update(schema.userSettings)
			.set({
				activeNarratorPromptConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		// Three cross-family refreshes, all lazy: the user row, this user's
		// settings, and — when one was chosen — the config itself. All three
		// go through `emitToUser`, so all three answer to the gate.
		await loadUser(socket, {}, emitToUser) // Emit updated user info
		await emitToUser("userSettings:get", () =>
			buildUserSettingsGet(currentUser.id)
		)
		if (params.id) {
			await emitToUser("narratorPromptConfigs:get", () =>
				buildNarratorPromptConfigsGet(params.id!)
			)
		}

		// Get the updated user to return in response
		const updatedUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUser.id),
			with: {
				userSettings: true
			}
		})
		const res: Sockets.NarratorPromptConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("narratorPromptConfigs:setUserActive", res)
		return res
	}
}

// Registration function for all narrator-prompt-config handlers
export function registerNarratorPromptConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, narratorPromptConfigsListHandler, emitToUser)
	register(socket, narratorPromptConfigsGet, emitToUser)
	register(socket, narratorPromptConfigsCreate, emitToUser)
	register(socket, narratorPromptConfigsUpdate, emitToUser)
	register(socket, narratorPromptConfigsDelete, emitToUser)
	register(socket, narratorPromptConfigsSetUserActive, emitToUser)
}
