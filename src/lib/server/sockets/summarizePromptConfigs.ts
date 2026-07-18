import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user as loadUser } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminGuard(socket: any, emitToUser: (e: string, d: any) => void) {
	if (!socket.user!.isAdmin) {
		emitToUser("error", { error: "Access denied. Only admin users can manage summarize configurations." })
		throw new Error("Access denied.")
	}
}

// ── World Summarize Configs ───────────────────────────────────────────────────

export const worldSummarizeConfigsListHandler: Handler<
	Sockets.WorldSummarizeConfigs.List.Params,
	Sockets.WorldSummarizeConfigs.List.Response
> = {
	event: "worldSummarizeConfigs:list",
	handler: async (socket, _params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const worldSummarizeConfigsList = await db.query.worldSummarizeConfigs.findMany({
			columns: { id: true, name: true, isImmutable: true },
			orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
		})
		const res: Sockets.WorldSummarizeConfigs.List.Response = { worldSummarizeConfigsList }
		emitToUser("worldSummarizeConfigs:list", res)
		return res
	}
}

export const worldSummarizeConfigsGetHandler: Handler<
	Sockets.WorldSummarizeConfigs.Get.Params,
	Sockets.WorldSummarizeConfigs.Get.Response
> = {
	event: "worldSummarizeConfigs:get",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const worldSummarizeConfig = await db.query.worldSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!worldSummarizeConfig) {
			emitToUser("worldSummarizeConfigs:get:error", { error: "Config not found" })
			throw new Error("World summarize config not found")
		}
		const res: Sockets.WorldSummarizeConfigs.Get.Response = { worldSummarizeConfig }
		emitToUser("worldSummarizeConfigs:get", res)
		return res
	}
}

export const worldSummarizeConfigsCreateHandler: Handler<
	Sockets.WorldSummarizeConfigs.Create.Params,
	Sockets.WorldSummarizeConfigs.Create.Response
> = {
	event: "worldSummarizeConfigs:create",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const [worldSummarizeConfig] = await db
			.insert(schema.worldSummarizeConfigs)
			.values(params.worldSummarizeConfig)
			.returning()
		await worldSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.WorldSummarizeConfigs.Create.Response = { worldSummarizeConfig }
		emitToUser("worldSummarizeConfigs:create", res)
		return res
	}
}

export const worldSummarizeConfigsUpdateHandler: Handler<
	Sockets.WorldSummarizeConfigs.Update.Params,
	Sockets.WorldSummarizeConfigs.Update.Response
> = {
	event: "worldSummarizeConfigs:update",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const id = params.worldSummarizeConfig.id!
		const { id: _, ...updateData } = params.worldSummarizeConfig
		const [worldSummarizeConfig] = await db
			.update(schema.worldSummarizeConfigs)
			.set(updateData)
			.where(eq(schema.worldSummarizeConfigs.id, id))
			.returning()
		await worldSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.WorldSummarizeConfigs.Update.Response = { worldSummarizeConfig }
		emitToUser("worldSummarizeConfigs:update", res)
		return res
	}
}

export const worldSummarizeConfigsDeleteHandler: Handler<
	Sockets.WorldSummarizeConfigs.Delete.Params,
	Sockets.WorldSummarizeConfigs.Delete.Response
> = {
	event: "worldSummarizeConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const currentConfig = await db.query.worldSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("worldSummarizeConfigs:delete:error", {
				error: "Cannot delete a built-in summarize config."
			})
			throw new Error("Cannot delete a built-in summarize config.")
		}
		await db.delete(schema.worldSummarizeConfigs).where(eq(schema.worldSummarizeConfigs.id, params.id))
		await worldSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.WorldSummarizeConfigs.Delete.Response = { success: "Deleted successfully" }
		emitToUser("worldSummarizeConfigs:delete", res)
		return res
	}
}

export const worldSummarizeConfigsSetUserActiveHandler: Handler<
	Sockets.WorldSummarizeConfigs.SetUserActive.Params,
	Sockets.WorldSummarizeConfigs.SetUserActive.Response
> = {
	event: "worldSummarizeConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const userId = socket.user!.id
		let userSettings = await db.query.userSettings.findFirst({ where: (us, { eq }) => eq(us.userId, userId) })
		if (!userSettings) await db.insert(schema.userSettings).values({ userId })
		await db.update(schema.userSettings).set({ activeSummarizeWorldConfigId: params.id }).where(eq(schema.userSettings.userId, userId))
		await loadUser(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) await worldSummarizeConfigsGetHandler.handler(socket, { id: params.id }, emitToUser)
		const updatedUser = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId), with: { userSettings: true } })
		const res: Sockets.WorldSummarizeConfigs.SetUserActive.Response = { user: updatedUser! }
		emitToUser("worldSummarizeConfigs:setUserActive", res)
		return res
	}
}

// ── Character Summarize Configs ───────────────────────────────────────────────

export const characterSummarizeConfigsListHandler: Handler<
	Sockets.CharacterSummarizeConfigs.List.Params,
	Sockets.CharacterSummarizeConfigs.List.Response
> = {
	event: "characterSummarizeConfigs:list",
	handler: async (socket, _params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const characterSummarizeConfigsList = await db.query.characterSummarizeConfigs.findMany({
			columns: { id: true, name: true, isImmutable: true },
			orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
		})
		const res: Sockets.CharacterSummarizeConfigs.List.Response = { characterSummarizeConfigsList }
		emitToUser("characterSummarizeConfigs:list", res)
		return res
	}
}

export const characterSummarizeConfigsGetHandler: Handler<
	Sockets.CharacterSummarizeConfigs.Get.Params,
	Sockets.CharacterSummarizeConfigs.Get.Response
> = {
	event: "characterSummarizeConfigs:get",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const characterSummarizeConfig = await db.query.characterSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!characterSummarizeConfig) {
			emitToUser("characterSummarizeConfigs:get:error", { error: "Config not found" })
			throw new Error("Character summarize config not found")
		}
		const res: Sockets.CharacterSummarizeConfigs.Get.Response = { characterSummarizeConfig }
		emitToUser("characterSummarizeConfigs:get", res)
		return res
	}
}

export const characterSummarizeConfigsCreateHandler: Handler<
	Sockets.CharacterSummarizeConfigs.Create.Params,
	Sockets.CharacterSummarizeConfigs.Create.Response
> = {
	event: "characterSummarizeConfigs:create",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const [characterSummarizeConfig] = await db
			.insert(schema.characterSummarizeConfigs)
			.values(params.characterSummarizeConfig)
			.returning()
		await characterSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.CharacterSummarizeConfigs.Create.Response = { characterSummarizeConfig }
		emitToUser("characterSummarizeConfigs:create", res)
		return res
	}
}

export const characterSummarizeConfigsUpdateHandler: Handler<
	Sockets.CharacterSummarizeConfigs.Update.Params,
	Sockets.CharacterSummarizeConfigs.Update.Response
> = {
	event: "characterSummarizeConfigs:update",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const id = params.characterSummarizeConfig.id!
		const { id: _, ...updateData } = params.characterSummarizeConfig
		const [characterSummarizeConfig] = await db
			.update(schema.characterSummarizeConfigs)
			.set(updateData)
			.where(eq(schema.characterSummarizeConfigs.id, id))
			.returning()
		await characterSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.CharacterSummarizeConfigs.Update.Response = { characterSummarizeConfig }
		emitToUser("characterSummarizeConfigs:update", res)
		return res
	}
}

export const characterSummarizeConfigsDeleteHandler: Handler<
	Sockets.CharacterSummarizeConfigs.Delete.Params,
	Sockets.CharacterSummarizeConfigs.Delete.Response
> = {
	event: "characterSummarizeConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const currentConfig = await db.query.characterSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("characterSummarizeConfigs:delete:error", {
				error: "Cannot delete a built-in summarize config."
			})
			throw new Error("Cannot delete a built-in summarize config.")
		}
		await db.delete(schema.characterSummarizeConfigs).where(eq(schema.characterSummarizeConfigs.id, params.id))
		await characterSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.CharacterSummarizeConfigs.Delete.Response = { success: "Deleted successfully" }
		emitToUser("characterSummarizeConfigs:delete", res)
		return res
	}
}

export const characterSummarizeConfigsSetUserActiveHandler: Handler<
	Sockets.CharacterSummarizeConfigs.SetUserActive.Params,
	Sockets.CharacterSummarizeConfigs.SetUserActive.Response
> = {
	event: "characterSummarizeConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const userId = socket.user!.id
		let userSettings = await db.query.userSettings.findFirst({ where: (us, { eq }) => eq(us.userId, userId) })
		if (!userSettings) await db.insert(schema.userSettings).values({ userId })
		await db.update(schema.userSettings).set({ activeSummarizeCharacterConfigId: params.id }).where(eq(schema.userSettings.userId, userId))
		await loadUser(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) await characterSummarizeConfigsGetHandler.handler(socket, { id: params.id }, emitToUser)
		const updatedUser = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId), with: { userSettings: true } })
		const res: Sockets.CharacterSummarizeConfigs.SetUserActive.Response = { user: updatedUser! }
		emitToUser("characterSummarizeConfigs:setUserActive", res)
		return res
	}
}

// ── Scene Summarize Configs ───────────────────────────────────────────────────

export const sceneSummarizeConfigsListHandler: Handler<
	Sockets.SceneSummarizeConfigs.List.Params,
	Sockets.SceneSummarizeConfigs.List.Response
> = {
	event: "sceneSummarizeConfigs:list",
	handler: async (socket, _params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const sceneSummarizeConfigsList = await db.query.sceneSummarizeConfigs.findMany({
			columns: { id: true, name: true, isImmutable: true },
			orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
		})
		const res: Sockets.SceneSummarizeConfigs.List.Response = { sceneSummarizeConfigsList }
		emitToUser("sceneSummarizeConfigs:list", res)
		return res
	}
}

export const sceneSummarizeConfigsGetHandler: Handler<
	Sockets.SceneSummarizeConfigs.Get.Params,
	Sockets.SceneSummarizeConfigs.Get.Response
> = {
	event: "sceneSummarizeConfigs:get",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const sceneSummarizeConfig = await db.query.sceneSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!sceneSummarizeConfig) {
			emitToUser("sceneSummarizeConfigs:get:error", { error: "Config not found" })
			throw new Error("Scene summarize config not found")
		}
		const res: Sockets.SceneSummarizeConfigs.Get.Response = { sceneSummarizeConfig }
		emitToUser("sceneSummarizeConfigs:get", res)
		return res
	}
}

export const sceneSummarizeConfigsCreateHandler: Handler<
	Sockets.SceneSummarizeConfigs.Create.Params,
	Sockets.SceneSummarizeConfigs.Create.Response
> = {
	event: "sceneSummarizeConfigs:create",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const [sceneSummarizeConfig] = await db
			.insert(schema.sceneSummarizeConfigs)
			.values(params.sceneSummarizeConfig)
			.returning()
		await sceneSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.SceneSummarizeConfigs.Create.Response = { sceneSummarizeConfig }
		emitToUser("sceneSummarizeConfigs:create", res)
		return res
	}
}

export const sceneSummarizeConfigsUpdateHandler: Handler<
	Sockets.SceneSummarizeConfigs.Update.Params,
	Sockets.SceneSummarizeConfigs.Update.Response
> = {
	event: "sceneSummarizeConfigs:update",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const id = params.sceneSummarizeConfig.id!
		const { id: _, ...updateData } = params.sceneSummarizeConfig
		const [sceneSummarizeConfig] = await db
			.update(schema.sceneSummarizeConfigs)
			.set(updateData)
			.where(eq(schema.sceneSummarizeConfigs.id, id))
			.returning()
		await sceneSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.SceneSummarizeConfigs.Update.Response = { sceneSummarizeConfig }
		emitToUser("sceneSummarizeConfigs:update", res)
		return res
	}
}

export const sceneSummarizeConfigsDeleteHandler: Handler<
	Sockets.SceneSummarizeConfigs.Delete.Params,
	Sockets.SceneSummarizeConfigs.Delete.Response
> = {
	event: "sceneSummarizeConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const currentConfig = await db.query.sceneSummarizeConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("sceneSummarizeConfigs:delete:error", {
				error: "Cannot delete a built-in summarize config."
			})
			throw new Error("Cannot delete a built-in summarize config.")
		}
		await db.delete(schema.sceneSummarizeConfigs).where(eq(schema.sceneSummarizeConfigs.id, params.id))
		await sceneSummarizeConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.SceneSummarizeConfigs.Delete.Response = { success: "Deleted successfully" }
		emitToUser("sceneSummarizeConfigs:delete", res)
		return res
	}
}

export const sceneSummarizeConfigsSetUserActiveHandler: Handler<
	Sockets.SceneSummarizeConfigs.SetUserActive.Params,
	Sockets.SceneSummarizeConfigs.SetUserActive.Response
> = {
	event: "sceneSummarizeConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		adminGuard(socket, emitToUser)
		const userId = socket.user!.id
		let userSettings = await db.query.userSettings.findFirst({ where: (us, { eq }) => eq(us.userId, userId) })
		if (!userSettings) await db.insert(schema.userSettings).values({ userId })
		await db.update(schema.userSettings).set({ activeSummarizeSceneConfigId: params.id }).where(eq(schema.userSettings.userId, userId))
		await loadUser(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) await sceneSummarizeConfigsGetHandler.handler(socket, { id: params.id }, emitToUser)
		const updatedUser = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId), with: { userSettings: true } })
		const res: Sockets.SceneSummarizeConfigs.SetUserActive.Response = { user: updatedUser! }
		emitToUser("sceneSummarizeConfigs:setUserActive", res)
		return res
	}
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerSummarizePromptConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	// World
	register(socket, worldSummarizeConfigsListHandler, emitToUser)
	register(socket, worldSummarizeConfigsGetHandler, emitToUser)
	register(socket, worldSummarizeConfigsCreateHandler, emitToUser)
	register(socket, worldSummarizeConfigsUpdateHandler, emitToUser)
	register(socket, worldSummarizeConfigsDeleteHandler, emitToUser)
	register(socket, worldSummarizeConfigsSetUserActiveHandler, emitToUser)
	// Character
	register(socket, characterSummarizeConfigsListHandler, emitToUser)
	register(socket, characterSummarizeConfigsGetHandler, emitToUser)
	register(socket, characterSummarizeConfigsCreateHandler, emitToUser)
	register(socket, characterSummarizeConfigsUpdateHandler, emitToUser)
	register(socket, characterSummarizeConfigsDeleteHandler, emitToUser)
	register(socket, characterSummarizeConfigsSetUserActiveHandler, emitToUser)
	// Scene
	register(socket, sceneSummarizeConfigsListHandler, emitToUser)
	register(socket, sceneSummarizeConfigsGetHandler, emitToUser)
	register(socket, sceneSummarizeConfigsCreateHandler, emitToUser)
	register(socket, sceneSummarizeConfigsUpdateHandler, emitToUser)
	register(socket, sceneSummarizeConfigsDeleteHandler, emitToUser)
	register(socket, sceneSummarizeConfigsSetUserActiveHandler, emitToUser)
}
