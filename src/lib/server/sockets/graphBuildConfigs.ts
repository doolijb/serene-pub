/**
 * CRUD for graph build configs — the prompt/model/sampling settings behind a
 * narrative-graph build.
 *
 * Modelled on narratorPromptConfigs, with one structural difference: the active
 * selection is SYSTEM-wide (`systemSettings.defaultGraphBuildConfigId`) rather
 * than per-user, because a graph belongs to a lorebook rather than to whoever
 * happens to trigger the build. Hence `setDefault` instead of `setUserActive`.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"

const DENIED = "Access denied. Only admin users can manage graph build configs."

function requireAdmin(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	if (!socket.user!.isAdmin) {
		emitToUser("error", { error: DENIED })
		throw new Error(DENIED)
	}
}

export const graphBuildConfigsListHandler: Handler<
	Sockets.GraphBuildConfigs.List.Params,
	Sockets.GraphBuildConfigs.List.Response
> = {
	event: "graphBuildConfigs:list",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		// Built-ins first, matching samplingConfigs:list.
		const graphBuildConfigsList = await db.query.graphBuildConfigs.findMany(
			{
				columns: { id: true, name: true, isImmutable: true },
				orderBy: (c, { asc, desc }) => [
					desc(c.isImmutable),
					asc(c.name)
				]
			}
		)
		const systemSettingsRow = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		const res: Sockets.GraphBuildConfigs.List.Response = {
			graphBuildConfigsList,
			defaultGraphBuildConfigId:
				systemSettingsRow?.defaultGraphBuildConfigId ?? null
		}
		emitToUser("graphBuildConfigs:list", res)
		return res
	}
}

export const graphBuildConfigsGet: Handler<
	Sockets.GraphBuildConfigs.Get.Params,
	Sockets.GraphBuildConfigs.Get.Response
> = {
	event: "graphBuildConfigs:get",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const graphBuildConfig = await db.query.graphBuildConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!graphBuildConfig) {
			emitToUser("graphBuildConfigs:get:error", {
				error: "Graph build config not found"
			})
			throw new Error("Graph build config not found")
		}
		const res: Sockets.GraphBuildConfigs.Get.Response = { graphBuildConfig }
		emitToUser("graphBuildConfigs:get", res)
		return res
	}
}

export const graphBuildConfigsCreate: Handler<
	Sockets.GraphBuildConfigs.Create.Params,
	Sockets.GraphBuildConfigs.Create.Response
> = {
	event: "graphBuildConfigs:create",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		// isImmutable and seedKey are the app's, never the client's: a created
		// row that claimed either would be treated as a seed by db/defaults.ts
		// and have its prompts overwritten on the next boot.
		const { id, isImmutable, seedKey, ...rest } =
			params.graphBuildConfig as any
		const [graphBuildConfig] = await db
			.insert(schema.graphBuildConfigs)
			.values({ ...rest, isImmutable: false, seedKey: null })
			.returning()
		await graphBuildConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.GraphBuildConfigs.Create.Response = {
			graphBuildConfig
		}
		emitToUser("graphBuildConfigs:create", res)
		return res
	}
}

export const graphBuildConfigsUpdate: Handler<
	Sockets.GraphBuildConfigs.Update.Params,
	Sockets.GraphBuildConfigs.Update.Response
> = {
	event: "graphBuildConfigs:update",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const id = params.graphBuildConfig.id!
		const {
			id: _,
			seedKey: __,
			isImmutable: ___,
			...raw
		} = params.graphBuildConfig as any

		const currentConfig = await db.query.graphBuildConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
		if (!currentConfig) {
			emitToUser("graphBuildConfigs:update:error", {
				error: "Graph build config not found"
			})
			throw new Error("Graph build config not found")
		}

		// A built-in keeps its prompts — db/defaults.ts re-forces them on every
		// boot, so letting them be edited here would silently discard the edit
		// at the next restart. Its per-step connection/sampling ARE editable,
		// same rule as narratorPromptConfigs: the seed deliberately leaves those
		// NULL precisely so they belong to the user.
		const updateData = currentConfig.isImmutable
			? {
					nodeResolutionConnectionId: raw.nodeResolutionConnectionId,
					nodeResolutionSamplingConfigId:
						raw.nodeResolutionSamplingConfigId,
					preFilterConnectionId: raw.preFilterConnectionId,
					preFilterSamplingConfigId: raw.preFilterSamplingConfigId,
					perspectiveConnectionId: raw.perspectiveConnectionId,
					perspectiveSamplingConfigId:
						raw.perspectiveSamplingConfigId,
					nodeDescriptionConnectionId:
						raw.nodeDescriptionConnectionId,
					nodeDescriptionSamplingConfigId:
						raw.nodeDescriptionSamplingConfigId,
					stateDetectionConnectionId: raw.stateDetectionConnectionId,
					stateDetectionSamplingConfigId:
						raw.stateDetectionSamplingConfigId
				}
			: raw

		// An immutable row targeted with none of the override fields leaves
		// updateData all-undefined, and an empty .set() throws rather than
		// being the legitimate no-op it should be.
		const hasUpdates = Object.values(updateData).some(
			(v) => v !== undefined
		)
		const graphBuildConfig = hasUpdates
			? (
					await db
						.update(schema.graphBuildConfigs)
						.set(updateData)
						.where(eq(schema.graphBuildConfigs.id, id))
						.returning()
				)[0]
			: currentConfig
		await graphBuildConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.GraphBuildConfigs.Update.Response = {
			graphBuildConfig
		}
		emitToUser("graphBuildConfigs:update", res)
		return res
	}
}

export const graphBuildConfigsDelete: Handler<
	Sockets.GraphBuildConfigs.Delete.Params,
	Sockets.GraphBuildConfigs.Delete.Response
> = {
	event: "graphBuildConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const currentConfig = await db.query.graphBuildConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("graphBuildConfigs:delete:error", {
				error: "Cannot delete a built-in graph build config."
			})
			throw new Error("Cannot delete a built-in graph build config.")
		}

		await db
			.delete(schema.graphBuildConfigs)
			.where(eq(schema.graphBuildConfigs.id, params.id))

		// systemSettings.defaultGraphBuildConfigId is ON DELETE SET NULL, so
		// deleting the selected config would leave the instance with no graph
		// config at all and send every build back to the chat defaults. Hand
		// the selection back to the built-in rather than leaving it empty;
		// db/defaults.ts performs the same backfill on the next boot.
		const settings = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		if (!settings?.defaultGraphBuildConfigId) {
			const seeded = await db.query.graphBuildConfigs.findFirst({
				where: (c, { eq }) => eq(c.seedKey, "graph-build-default")
			})
			if (seeded) {
				await db
					.update(schema.systemSettings)
					.set({ defaultGraphBuildConfigId: seeded.id })
					.where(eq(schema.systemSettings.id, 1))
			}
		}

		await graphBuildConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.GraphBuildConfigs.Delete.Response = {
			success: "Graph build config deleted successfully"
		}
		emitToUser("graphBuildConfigs:delete", res)
		return res
	}
}

export const graphBuildConfigsSetDefault: Handler<
	Sockets.GraphBuildConfigs.SetDefault.Params,
	Sockets.GraphBuildConfigs.SetDefault.Response
> = {
	event: "graphBuildConfigs:setDefault",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const target = await db.query.graphBuildConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!target) {
			emitToUser("graphBuildConfigs:setDefault:error", {
				error: "Graph build config not found"
			})
			throw new Error("Graph build config not found")
		}

		await db
			.update(schema.systemSettings)
			.set({ defaultGraphBuildConfigId: target.id })
			.where(eq(schema.systemSettings.id, 1))

		await graphBuildConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.GraphBuildConfigs.SetDefault.Response = {
			defaultGraphBuildConfigId: target.id
		}
		emitToUser("graphBuildConfigs:setDefault", res)
		return res
	}
}

export function registerGraphBuildConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, graphBuildConfigsListHandler, emitToUser)
	register(socket, graphBuildConfigsGet, emitToUser)
	register(socket, graphBuildConfigsCreate, emitToUser)
	register(socket, graphBuildConfigsUpdate, emitToUser)
	register(socket, graphBuildConfigsDelete, emitToUser)
	register(socket, graphBuildConfigsSetDefault, emitToUser)
}
