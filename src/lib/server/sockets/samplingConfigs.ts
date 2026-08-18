import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user } from "./users"
import { systemSettingsGet } from "./systemSettings"
import type { Handler } from "$lib/shared/events"

// --- WEIGHTS SOCKET HANDLERS ---

// Legacy functions for compatibility
export async function samplingConfigsList(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsListHandler.handler(socket, {}, emitToUser)
}

export async function setUserActiveSamplingConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsSetUserActive.handler(
		socket,
		{ id: message.id },
		emitToUser
	)
}

export async function createSamplingConfig(
	socket: any,
	message: { sampling: any },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsCreate.handler(
		socket,
		{ sampling: message.sampling },
		emitToUser
	)
}

export async function deleteSamplingConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsDelete.handler(socket, { id: message.id }, emitToUser)
}

export async function updateSamplingConfig(
	socket: any,
	message: { sampling: any },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsUpdate.handler(
		socket,
		{ sampling: message.sampling },
		emitToUser
	)
}

export const samplingConfigsGet: Handler<
	Sockets.SamplingConfigs.Get.Params,
	Sockets.SamplingConfigs.Get.Response
> = {
	event: "samplingConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configurations."
			)
		}

		const sampling = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, params.id)
		})
		if (!sampling) {
			emitToUser("samplingConfigs:get:error", {
				error: "Sampling config not found"
			})
			throw new Error("Sampling config not found")
		}
		const res: Sockets.SamplingConfigs.Get.Response = { sampling }
		emitToUser("samplingConfigs:get", res)
		return res
	}
}

export const samplingConfigsListHandler: Handler<
	Sockets.SamplingConfigs.List.Params,
	Sockets.SamplingConfigs.List.Response
> = {
	event: "samplingConfigs:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configurations."
			)
		}

		// Built-in presets first, then the user's own, each alphabetical.
		//
		// `desc` on a boolean puts true first. Ordered here rather than in each
		// consumer because this one response feeds several: SamplingSidebar
		// (which groups with its own immutable/mutable filters — those preserve
		// input order, so this is what sorts within each group), EditChatForm,
		// and every per-task override selector in PromptsSidebar. Without it the
		// list came back in whatever order Postgres happened to return, so the
		// flat consumers interleaved presets with user configs.
		const samplingConfigsList = await db.query.samplingConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true
			},
			orderBy: (w, { asc, desc }) => [desc(w.isImmutable), asc(w.name)]
		})
		const res: Sockets.SamplingConfigs.List.Response = {
			samplingConfigsList
		}
		emitToUser("samplingConfigs:list", res)
		return res
	}
}

export const samplingConfigsSetUserActive: Handler<
	Sockets.SamplingConfigs.SetUserActive.Params,
	Sockets.SamplingConfigs.SetUserActive.Response
> = {
	event: "samplingConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active sampling configurations."
			)
		}

		// Update system-wide default sampling config (replaces the old per-user active sampling)
		await db
			.update(schema.systemSettings)
			.set({ defaultSamplingConfigId: params.id })
			.where(eq(schema.systemSettings.id, 1))

		await user(socket, {}, emitToUser)
		if (params.id) {
			await samplingConfigsGet.handler(
				socket,
				{ id: params.id },
				emitToUser
			)
		}

		// Push updated system settings so clients reflect the new default
		// sampling config immediately (this is a system-wide default, not a
		// per-user setting — see the comment above).
		await systemSettingsGet.handler(socket, {}, emitToUser)

		const updatedUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, socket.user!.id)
		})
		const res: Sockets.SamplingConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("samplingConfigs:setUserActive", res)
		return res
	}
}

export const samplingConfigsCreate: Handler<
	Sockets.SamplingConfigs.Create.Params,
	Sockets.SamplingConfigs.Create.Response
> = {
	event: "samplingConfigs:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can create sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create sampling configurations."
			)
		}

		// seedKey marks a row as one of the built-in seeded configs and is
		// UNIQUE, so it must never come from the client. The sidebars build a
		// "New" config by spreading the currently-selected one and deleting a
		// couple of fields; cloning a SEEDED config therefore carried its
		// seedKey straight through and the insert died on the unique index:
		//   duplicate key value violates unique constraint "sampling_configs_seed_key_unique"
		//   Key (seed_key)=(sampling-default) already exists.
		//
		// id is stripped for the same reason personasCreate strips it: both are
		// server-owned, and honouring either lets a caller collide with or
		// overwrite an existing row. Done here rather than in the sidebar
		// because a handler must not trust its payload — the sidebar already
		// deletes `id` and still missed this one.
		const { id: _id, seedKey: _seedKey, ...samplingValues } = (params.sampling ?? {}) as any

		const [sampling] = await db
			.insert(schema.samplingConfigs)
			.values(samplingValues)
			.returning()

		// Unlike every sibling *ConfigsCreate handler, this used to also call
		// samplingConfigsSetUserActive — which writes
		// systemSettings.defaultSamplingConfigId, an instance-wide setting,
		// not per-user — silently making every newly created sampling config
		// the default for all users. The client already has a separate,
		// deliberate "Set as Default" action for that
		// (SamplingSidebar.svelte's handleSetDefault); create doing it too
		// was a bug, not a UX dependency. samplingConfigsGet still pushes the
		// new row so the client can show it for editing.
		await samplingConfigsGet.handler(
			socket,
			{ id: sampling.id },
			emitToUser
		)
		await samplingConfigsListHandler.handler(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Create.Response = { sampling }
		emitToUser("samplingConfigs:create", res)
		return res
	}
}

export const samplingConfigsDelete: Handler<
	Sockets.SamplingConfigs.Delete.Params,
	Sockets.SamplingConfigs.Delete.Response
> = {
	event: "samplingConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can delete sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete sampling configurations."
			)
		}

		const currentSamplingConfig = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, params.id)
		})
		if (currentSamplingConfig?.isImmutable) {
			emitToUser("samplingConfigs:delete:error", {
				error: "Cannot delete immutable samplingConfigs."
			})
			throw new Error("Cannot delete immutable samplingConfigs")
		}
		// If the deleted config is the system default, fall back to the first immutable config
		const systemSettings = await db.query.systemSettings.findFirst({
			columns: { id: true, defaultSamplingConfigId: true }
		})
		if (systemSettings?.defaultSamplingConfigId === params.id) {
			const fallback = await db.query.samplingConfigs.findFirst({
				where: (sc, { eq }) => eq(sc.isImmutable, true),
				columns: { id: true }
			})
			await samplingConfigsSetUserActive.handler(
				socket,
				{ id: fallback?.id ?? 1 },
				emitToUser
			)
		}
		await db
			.delete(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, params.id))
		await samplingConfigsListHandler.handler(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Delete.Response = {
			success: "Sampling config deleted successfully"
		}
		emitToUser("samplingConfigs:delete", res)
		return res
	}
}

export const samplingConfigsUpdate: Handler<
	Sockets.SamplingConfigs.Update.Params,
	Sockets.SamplingConfigs.Update.Response
> = {
	event: "samplingConfigs:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can update sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update sampling configurations."
			)
		}

		const id = params.sampling.id!
		const { id: _, ...updateData } = params.sampling // Remove id from sampling object to avoid conflicts

		const currentSamplingConfig = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, id)
		})
		if (currentSamplingConfig?.isImmutable) {
			emitToUser("samplingConfigs:update:error", {
				error: "Cannot update immutable samplingConfigs."
			})
			throw new Error("Cannot update immutable samplingConfigs")
		}

		// A raw client could target a mutable row with an {id}-only payload
		// (no other fields present at all) — updateData then has no defined
		// values, and an empty .set() throws rather than being a legitimate
		// no-op (same round-8 fix already applied to promptConfigsUpdate).
		const hasUpdates = Object.values(updateData).some(
			(v) => v !== undefined
		)
		const updatedSamplingConfig = hasUpdates
			? (
					await db
						.update(schema.samplingConfigs)
						.set(updateData)
						.where(eq(schema.samplingConfigs.id, id))
						.returning()
				)[0]
			: currentSamplingConfig!

		await samplingConfigsListHandler.handler(socket, {}, emitToUser)
		await samplingConfigsGet.handler(socket, { id }, emitToUser)
		await user(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Update.Response = {
			sampling: updatedSamplingConfig
		}
		emitToUser("samplingConfigs:update", res)
		return res
	}
}

// Registration function for all sampling config handlers
export function registerSamplingConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, samplingConfigsListHandler, emitToUser)
	register(socket, samplingConfigsGet, emitToUser)
	register(socket, samplingConfigsSetUserActive, emitToUser)
	register(socket, samplingConfigsCreate, emitToUser)
	register(socket, samplingConfigsUpdate, emitToUser)
	register(socket, samplingConfigsDelete, emitToUser)
}
