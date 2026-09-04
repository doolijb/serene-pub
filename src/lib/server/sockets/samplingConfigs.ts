import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user } from "./users"
import { systemSettingsGet } from "./systemSettings"
import type { Handler } from "$lib/shared/events"
import { normalizeSamplingRow, SAMPLING_SCHEMAS, S } from "@serene-pub/sdk"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import {
	modalityLabel,
	modalityOfShape
} from "$lib/shared/constants/ConnectionTypes"
import {
	aggregateCombos,
	type RegistryTypeRow
} from "$lib/shared/capabilities/combos"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"

// --- WEIGHTS SOCKET HANDLERS ---

/**
 * Every capability whose sampling vocabulary is this shape.
 *
 * Asked of the AGGREGATION rather than of a literal list, so a plugin's
 * `text->video` provider gets its default registered by the same star press
 * that registers core's — the whole reason the combo list is derived. Runs the
 * mapping forwards (capability → shape) rather than backwards, because
 * backwards is the direction that cannot be derived: `S.imageGen` does not say
 * which of the three image transforms was meant, and the hand-written inverse
 * exists to name one representative for the pickers, not to enumerate a group.
 *
 * An empty result is returned as empty. There is no `text->image` consolation
 * prize: a shape with no capabilities is a real state (the registry has no node
 * demanding it and no adapter serving it), and inventing one row would put a
 * default on a screen that lists no such capability.
 */
async function capabilitiesForShape(shape: string): Promise<string[]> {
	const rows = (await db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			version: schema.pipelineTypeRegistry.version,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)) as RegistryTypeRow[]
	return aggregateCombos(rows)
		.filter((c) => samplingShapeForCapability(c.id) === shape)
		.map((c) => c.id)
}

/**
 * A shape this build has a vocabulary for.
 *
 * `normalizeSamplingRow` is deliberately lenient — an unknown shape resolves to
 * an empty schema, so it would happily normalise a row whose `enabled` list
 * comes back empty and whose values can therefore never be sent. That is a
 * config that exists, looks saved, and does nothing. The write path refuses it
 * here instead. Asked of the SDK's own registry rather than a literal pair, so a
 * third modality needs no edit in this file.
 */
const isKnownSamplingShape = (shape: string): boolean =>
	Object.prototype.hasOwnProperty.call(SAMPLING_SCHEMAS, shape)

/** The message a rejected shape gets, in one place because two handlers use it. */
const unknownShapeError = (shape: string): string =>
	`Unknown sampling shape "${shape}". A sampling config must be ${S.textGen} or ${S.imageGen}.`

/**
 * The message a rejected NAME gets.
 *
 * Names it as a modality rule rather than as a constraint, because that is the
 * thing the person has to act on: the same name is fine on the other side of the
 * modality line, and "Default" existing for text is not a reason they cannot
 * have "Default" for images.
 */
const nameTakenError = (name: string, modality: string): string =>
	`A sampling config named "${name.trim()}" already exists for ${modalityLabel(modality)}. ` +
	`Sampling names must be unique within a modality — pick a different name.`

/**
 * A name already spoken for by another config of the same modality, or
 * `undefined` if it is free.
 *
 * Checked here rather than left to the unique index because the index's answer
 * is a raw Postgres string ("duplicate key value violates unique constraint
 * …_modality_name_unique") that names a constraint the person has never heard
 * of and does not say which of the two rules — modality scoping, case folding,
 * trimming — they tripped. Cloning is the common path into this: the sidebars
 * build a "New" config by spreading the selected one, so the name arrives
 * already taken.
 *
 * Reads the whole table and compares in JS, deliberately. It is tens of rows,
 * and it means the comparison is `modalityOfShape` — the same expression the
 * index is built on — rather than a second SQL spelling of it that can drift.
 *
 * ⚠ Not a substitute for the index. This is check-then-write, so two admins
 * saving at once can still both pass it; the index is what actually holds the
 * line, and the handlers below translate its violation rather than letting it
 * through raw.
 */
async function nameConflict(
	name: unknown,
	shape: string | null | undefined,
	excludeId?: number
): Promise<string | undefined> {
	if (typeof name !== "string") return undefined
	const modality = modalityOfShape(shape)
	const wanted = name.trim().toLowerCase()
	const rows = await db.query.samplingConfigs.findMany({
		columns: { id: true, name: true, shape: true }
	})
	const clash = rows.find(
		(r) =>
			r.id !== excludeId &&
			modalityOfShape(r.shape) === modality &&
			r.name.trim().toLowerCase() === wanted
	)
	return clash ? nameTakenError(clash.name, modality) : undefined
}

/**
 * The unique index firing, as opposed to any other database error.
 *
 * The race the check above cannot close lands here, and it must not reach the
 * client as a constraint name. Matched on the index name because that is what
 * the driver puts in the message; anything else re-throws untouched, since
 * swallowing unrelated failures into "pick a different name" would be worse
 * than the raw error.
 */
const isNameTakenViolation = (e: unknown): boolean =>
	String((e as { message?: unknown } | null)?.message ?? "").includes(
		"sampling_configs_modality_name_unique"
	)

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
		// input order, so this is what sorts within each group), EditSessionForm,
		// and every per-task override selector in PromptsSidebar. Without it the
		// list came back in whatever order Postgres happened to return, so the
		// flat consumers interleaved presets with user configs.
		const samplingConfigsList = await db.query.samplingConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true,
				// The stored config itself (0171). There are no typed sampler
				// columns left to project, so the numbers the admin changelist
				// compares presets by are resolved from these three by the
				// consumer — and `shape` is what a picker filters on, so an
				// image node is never offered a config full of text samplers.
				shape: true,
				values: true,
				enabled: true
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

		// Update system-wide default sampling config (replaces the old per-user
		// active sampling). Which capabilities it lands against is the ROW's own
		// shape, never a parameter the caller passes: a client that could name
		// the capability could set the chat default to an image config, and the
		// whole point of the shape is that it cannot.
		const target = await db.query.samplingConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!target) {
			const res = {
				error: "That sampling configuration no longer exists."
			}
			emitToUser("error", res)
			throw new Error("Sampling config not found.")
		}

		// Registered against EVERY capability whose output kind this shape
		// speaks — not against the one canonical representative.
		//
		// `TRANSFORMS` names `text->image`, `text+image->image` and
		// `image->image`, and all three take the same steps/CFG/sampler
		// vocabulary. Writing only `text->image` would leave a screen whose one
		// control says "the image default" while one of three rows moved: an
		// img2img node would go on reading whatever was registered against
		// `text+image->image` — usually nothing — and the star would look like
		// it had done its job. The fan-out is what makes the control's label
		// true.
		//
		// A shape whose capabilities the aggregation does not name registers
		// NOTHING rather than falling back to text: starring a config of some
		// future shape must not quietly become "this is now the default for
		// chat". And there is deliberately no `text->image`-only fallback for
		// an empty aggregation — that fallback is precisely the silent gap this
		// replaces, and it would hide an aggregation that had stopped working.
		const shape = target.shape ?? S.textGen
		const capabilities = await capabilitiesForShape(shape)
		for (const capability of capabilities)
			await setCapabilityDefault(db, capability, {
				samplingConfigId: params.id
			})

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

		// An absent shape is not an error — normalizeSamplingRow defaults it to
		// S.textGen, which is what every config was before there was a choice. A
		// shape that names no vocabulary IS one; see isKnownSamplingShape.
		const requestedShape = params.sampling.shape
		if (requestedShape != null && !isKnownSamplingShape(requestedShape)) {
			const error = unknownShapeError(requestedShape)
			emitToUser("samplingConfigs:create:error", { error })
			throw new Error(error)
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
		// deletes `id` and still missed this one. normalizeSamplingRow returns
		// only shape/values/enabled, so neither key can sneak back in below.
		const {
			id: _id,
			seedKey: _seedKey,
			...samplingValues
		} = (params.sampling ?? {}) as any

		// Normalised on the way in, so a config a person saved through the form
		// and one this build seeded are byte-for-byte the same kind of row:
		// values coerced to the types the shape declares (a form input arrives
		// as "0.7"), `enabled` de-duplicated and reduced to keys that shape
		// knows. Off-schema keys in `values` are kept — see the SDK's note; the
		// filter belongs on the way out, in resolveSampling.
		const normalized = normalizeSamplingRow(params.sampling)

		// The normalised shape, not the raw one: an absent shape means text-gen,
		// and asking which modality this name has to be unique in has to get the
		// same answer the row will be written with.
		const nameError = await nameConflict(
			samplingValues.name,
			normalized.shape
		)
		if (nameError) {
			emitToUser("samplingConfigs:create:error", { error: nameError })
			throw new Error(nameError)
		}

		let sampling: SelectSamplingConfig
		try {
			;[sampling] = await db
				.insert(schema.samplingConfigs)
				.values({
					...samplingValues,
					...normalized
				})
				.returning()
		} catch (e) {
			if (!isNameTakenViolation(e)) throw e
			const error = nameTakenError(
				String(samplingValues.name ?? ""),
				modalityOfShape(normalized.shape)
			)
			emitToUser("samplingConfigs:create:error", { error })
			throw new Error(error)
		}

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
		// No fallback pick. This used to search for the first immutable config
		// and, failing that, use `id: 1` — a first-capable search plus a
		// hardcoded seed id, which is two of the three things piece 3 exists to
		// delete. Nothing chooses a config because it exists.
		//
		// Nothing needs to happen here at all: `connection_defaults.sampling_config_id`
		// is `ON DELETE SET NULL`, so deleting a starred config clears the
		// registration and leaves the ROW, which is what makes "the default was
		// cleared" a different sentence from "no default was ever set". And a
		// null sampling default is not fatal — `resolveSampling(null)` means
		// "send nothing and let the backend use its own defaults", a perfectly
		// good answer. The connection half is the fatal one, and it is not
		// touched by this.
		// Asked BEFORE the delete, because afterwards the cascade has already
		// erased the evidence — and asked at all so the push below is
		// conditional. A settings push is not free of consequences: it throws on
		// an instance with no settings row, and "delete an id that isn't there"
		// must stay the clean no-op it is (samplingConfigs.notFoundHandling).
		// Nothing registered means nothing to refresh.
		const registeredAgainst = await db
			.select({
				// The key, which since 0183 is the transform's two sides rather
				// than its id. Only the COUNT is read below — nothing here needs
				// the capability named, so nothing here converts it back.
				input: schema.connectionDefaults.input,
				output: schema.connectionDefaults.output
			})
			.from(schema.connectionDefaults)
			.where(eq(schema.connectionDefaults.samplingConfigId, params.id))

		await db
			.delete(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, params.id))
		await samplingConfigsListHandler.handler(socket, {}, emitToUser)
		// `ON DELETE SET NULL` just cleared those registrations, so every
		// client's copy of `capabilityDefaults` still points at a row that no
		// longer exists and the sampling sidebar would keep drawing the star on
		// nothing. This is the push that used to ride along on the fallback
		// setUserActive call the deletion above removed — minus the fallback.
		if (registeredAgainst.length)
			await systemSettingsGet.handler(socket, {}, emitToUser)

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

		// Same normalisation as create, but only when the payload actually
		// carries one of the three sampling fields: normalising unconditionally
		// would answer an {id, name} rename by writing shape/values/enabled the
		// caller never mentioned, resetting the row's parameters to nothing.
		//
		// Merged against the stored row first, and for the same reason — a patch
		// that sends `values` without `shape` must be coerced against the shape
		// this row actually speaks, or an image config would be re-shaped to the
		// text-gen default and lose every enabled key on a partial save.
		if (
			updateData.shape !== undefined ||
			updateData.values !== undefined ||
			updateData.enabled !== undefined
		) {
			const shape = updateData.shape ?? currentSamplingConfig?.shape
			if (shape != null && !isKnownSamplingShape(shape)) {
				const error = unknownShapeError(shape)
				emitToUser("samplingConfigs:update:error", { error })
				throw new Error(error)
			}
			const normalized = normalizeSamplingRow({
				shape,
				values: updateData.values ?? currentSamplingConfig?.values,
				enabled: updateData.enabled ?? currentSamplingConfig?.enabled
			})
			updateData.shape = normalized.shape
			updateData.values = normalized.values
			updateData.enabled = normalized.enabled
		}

		// A rename — or a re-shape, which moves the row into another modality's
		// namespace and can collide there without the name changing at all.
		// `excludeId` is what makes saving a row under the name it already has a
		// no-op rather than a self-collision, which is every save the form makes.
		if (updateData.name !== undefined || updateData.shape !== undefined) {
			const nameError = await nameConflict(
				updateData.name ?? currentSamplingConfig?.name,
				updateData.shape ?? currentSamplingConfig?.shape,
				id
			)
			if (nameError) {
				emitToUser("samplingConfigs:update:error", { error: nameError })
				throw new Error(nameError)
			}
		}

		// A raw client could target a mutable row with an {id}-only payload
		// (no other fields present at all) — updateData then has no defined
		// values, and an empty .set() throws rather than being a legitimate
		// no-op (same round-8 fix already applied to promptConfigsUpdate).
		const hasUpdates = Object.values(updateData).some(
			(v) => v !== undefined
		)
		let updatedSamplingConfig: SelectSamplingConfig
		try {
			updatedSamplingConfig = hasUpdates
				? (
						await db
							.update(schema.samplingConfigs)
							.set(updateData)
							.where(eq(schema.samplingConfigs.id, id))
							.returning()
					)[0]
				: currentSamplingConfig!
		} catch (e) {
			// The check above is check-then-write; this is the race closing.
			if (!isNameTakenViolation(e)) throw e
			const error = nameTakenError(
				String(updateData.name ?? currentSamplingConfig?.name ?? ""),
				modalityOfShape(
					updateData.shape ?? currentSamplingConfig?.shape
				)
			)
			emitToUser("samplingConfigs:update:error", { error })
			throw new Error(error)
		}

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
