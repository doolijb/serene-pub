import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { isUniqueViolation } from "$lib/server/db/errors"
import { eq, notInArray } from "drizzle-orm"
import { user } from "./users"
import { buildSystemSettingsGet } from "./systemSettings"
import type { Handler } from "$lib/shared/events"
import { normalizeSamplingRow, SAMPLING_SCHEMAS, S } from "@serene-pub/sdk"
import {
	capabilityDefaults as readCapabilityDefaults,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"
import {
	modalityLabel,
	modalityOfShape
} from "$lib/shared/constants/ConnectionTypes"
import {
	aggregateCombos,
	type RegistryDefinitionRow
} from "$lib/shared/capabilities/combos"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"

// --- WEIGHTS SOCKET HANDLERS ---

/** Every capability the registry aggregates, once, for every shape to filter. */
async function demandedCapabilities(): Promise<string[]> {
	// The same rows `combosFor` reads (connectionDefaults.ts), minus the same
	// two statuses and for its reason: a capability only a `provisional` or
	// `removed` node demands is one no pipeline can run (plans/29 R-2).
	const rows = (await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			slots: schema.pipelineDefinitionRegistry.slots
		})
		.from(schema.pipelineDefinitionRegistry)
		.where(
			notInArray(schema.pipelineDefinitionRegistry.status, [
				"provisional",
				"removed"
			])
		)) as RegistryDefinitionRow[]
	return aggregateCombos(rows).map((c) => c.id)
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
 * client as a constraint name. Matched on the driver's `constraint` field
 * (Postgres reports a unique index's name there), read under drizzle's
 * wrapper; anything else re-throws untouched, since swallowing unrelated
 * failures into "pick a different name" would be worse than the raw error.
 */
const isNameTakenViolation = (e: unknown): boolean =>
	isUniqueViolation(e, "sampling_configs_modality_name_unique")

// Legacy functions for compatibility
export async function samplingConfigsList(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsListHandler.handler(socket, {}, emitToUser)
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

/**
 * One sampling config, and the whole list, as functions — so the ten cascades in
 * this file can be handed the BUILDER rather than the handler. Both events are
 * gated, so a create, an edit or a delete made from anywhere but the admin
 * sampling surfaces pays for no re-read. Skipping the emit alone would save
 * nothing; the query is the cost.
 *
 * No admin check here — that belongs to the handlers, which are the surface a
 * client can reach, and every cascade below has already made it.
 */
async function buildSamplingConfigsGet(
	id: number
): Promise<Sockets.SamplingConfigs.Get.Response> {
	const sampling = await db.query.samplingConfigs.findFirst({
		where: (w, { eq }) => eq(w.id, id)
	})
	if (!sampling) throw new Error("Sampling config not found")
	return { sampling }
}

export async function buildSamplingConfigsList(): Promise<Sockets.SamplingConfigs.List.Response> {
	// Built-in presets first, then the user's own, each alphabetical.
	//
	// `desc` on a boolean puts true first. Ordered here rather than in each
	// consumer because this one response feeds several: SamplingSidebar
	// (which groups by modality and keeps this order within each group) and
	// EditSessionForm. Without it the list came back in whatever order
	// Postgres happened to return, so the flat consumer interleaved presets
	// with user configs.
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
	return { samplingConfigsList }
}

/**
 * Every job a sampling config can be the default for, with the config each
 * one's default names today.
 *
 * Two sources, one list: the transforms the registry demands whose output
 * kind has a sampling vocabulary, and every `connection_defaults` row that
 * names a config. The ★ in the Sampling view reads every row, so the list
 * that explains it reads every row too, including a transform no node
 * demands any more.
 */
async function samplingJobs(): Promise<Sockets.SamplingConfigs.UsedBy.Job[]> {
	const defaults = await readCapabilityDefaults(db)
	const jobs = new Map<string, Sockets.SamplingConfigs.UsedBy.Job>()
	const add = (capability: string) => {
		if (jobs.has(capability)) return
		const shape = samplingShapeForCapability(capability)
		if (!shape || !isKnownSamplingShape(shape)) return
		jobs.set(capability, {
			capability,
			shape,
			samplingConfigId: defaults[capability]?.samplingConfigId ?? null
		})
	}
	for (const capability of await demandedCapabilities()) add(capability)
	for (const [capability, d] of Object.entries(defaults))
		if (d.samplingConfigId != null) add(capability)
	return [...jobs.values()]
}

/**
 * The jobs and pipelines that pick each sampling config.
 *
 * The pipeline half is the library's own walk (`libraryView`'s
 * `samplingUsedBy`, the answer Admin › Sampling's "Used by" column reads), so
 * there is one definition of "a pipeline picks this config": a value or an
 * override in a `sampling-ref` slot. The library names a pipeline by its
 * label; the slug beside it is what a link opens.
 */
async function buildSamplingConfigsUsedBy(): Promise<Sockets.SamplingConfigs.UsedBy.Response> {
	const { libraryView } = await import("$lib/server/pipelines/config/library")
	const library = await libraryView(db)
	const slugByLabel = new Map<string, string>()
	for (const p of library.pipelines)
		if (!slugByLabel.has(p.label)) slugByLabel.set(p.label, p.slug)
	const pipelines: Record<number, Sockets.SamplingConfigs.UsedBy.Pipeline[]> =
		{}
	for (const [id, labels] of Object.entries(library.samplingUsedBy))
		pipelines[Number(id)] = labels.map((label) => ({
			label,
			slug: slugByLabel.get(label) ?? null
		}))
	return { jobs: await samplingJobs(), pipelines }
}

/**
 * Name `id` as the sampling default of each transform, in one transaction.
 *
 * Each transform must speak the config's shape and be one of the jobs
 * `samplingJobs` lists: a client that could name any capability could make
 * an image config the chat default, and the shape exists so that it cannot.
 * `undefined` means every job of the shape. Returns what was written.
 */
async function setSamplingDefaultFor(
	id: number,
	shape: string,
	transforms: readonly string[] | undefined
): Promise<string[]> {
	const ofShape = (await samplingJobs())
		.filter((j) => j.shape === shape)
		.map((j) => j.capability)
	const wanted = transforms ? [...new Set(transforms)] : ofShape
	const refused = wanted.filter((t) => !ofShape.includes(t))
	if (refused.length)
		throw new Error(
			`${refused.join(", ")} cannot take a ${modalityLabel(modalityOfShape(shape))} sampling config.`
		)
	await db.transaction(async (tx) => {
		for (const capability of wanted)
			await setCapabilityDefault(tx as unknown as typeof db, capability, {
				samplingConfigId: id
			})
	})
	return wanted
}

export const samplingConfigsUsedBy: Handler<
	Sockets.SamplingConfigs.UsedBy.Params,
	Sockets.SamplingConfigs.UsedBy.Response
> = {
	event: "samplingConfigs:usedBy",
	// No admin check: which jobs and pipelines pick a config are read-only
	// facts, the same names the pickers already show.
	handler: async (_socket, _params, emitToUser) => {
		const res = await buildSamplingConfigsUsedBy()
		emitToUser("samplingConfigs:usedBy", res)
		return res
	}
}

export const samplingConfigsSetDefaultFor: Handler<
	Sockets.SamplingConfigs.SetDefaultFor.Params,
	Sockets.SamplingConfigs.SetDefaultFor.Response
> = {
	event: "samplingConfigs:setDefaultFor",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const error =
				"Access denied. Only admin users can set default sampling configs."
			emitToUser("samplingConfigs:setDefaultFor:error", { error })
			throw new Error(error)
		}
		const target = await db.query.samplingConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!target) {
			const error = "That sampling config no longer exists."
			emitToUser("samplingConfigs:setDefaultFor:error", { error })
			throw new Error(error)
		}
		let transforms: string[]
		try {
			transforms = await setSamplingDefaultFor(
				target.id,
				target.shape ?? S.textGen,
				params.transforms
			)
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			emitToUser("samplingConfigs:setDefaultFor:error", { error })
			throw e
		}
		// Every client's `capabilityDefaults` moves with the write, which is
		// what the ★ and every default picker read.
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())
		const res: Sockets.SamplingConfigs.SetDefaultFor.Response = {
			id: target.id,
			transforms
		}
		emitToUser("samplingConfigs:setDefaultFor", res)
		return res
	}
}

export const samplingConfigsGet: Handler<
	Sockets.SamplingConfigs.Get.Params,
	Sockets.SamplingConfigs.Get.Response
> = {
	event: "samplingConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configs."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configs."
			)
		}

		let res: Sockets.SamplingConfigs.Get.Response
		try {
			res = await buildSamplingConfigsGet(params.id)
		} catch (error) {
			emitToUser("samplingConfigs:get:error", {
				error: "Sampling config not found"
			})
			throw error
		}
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
				error: "Access denied. Only admin users can manage sampling configs."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configs."
			)
		}

		const res = await buildSamplingConfigsList()
		emitToUser("samplingConfigs:list", res)
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
				error: "Access denied. Only admin users can create sampling configs."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create sampling configs."
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

		// Create never names a default. That is the deliberate "Set as
		// default…" action (`samplingConfigs:setDefaultFor`); a create that
		// did it too would make every new config the default for every job.
		// The new row is pushed so the client can show it for editing.
		// Lazy — see `buildSamplingConfigsGet`.
		await emitToUser("samplingConfigs:get", () =>
			buildSamplingConfigsGet(sampling.id)
		)
		// Lazy — see `buildSamplingConfigsList`.
		await emitToUser("samplingConfigs:list", () =>
			buildSamplingConfigsList()
		)

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
				error: "Access denied. Only admin users can delete sampling configs."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete sampling configs."
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
		// Since I12 the defaults are default-flagged LOADOUTS; any loadout
		// naming this config is cleared by the same `ON DELETE SET NULL`.
		const registeredAgainst = await db
			.select({ id: schema.loadouts.id })
			.from(schema.loadouts)
			.where(eq(schema.loadouts.samplingConfigId, params.id))

		await db
			.delete(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, params.id))
		// Lazy — see `buildSamplingConfigsList`.
		await emitToUser("samplingConfigs:list", () =>
			buildSamplingConfigsList()
		)
		// `ON DELETE SET NULL` just cleared those registrations, so every
		// client's copy of `capabilityDefaults` still points at a row that no
		// longer exists and the sampling sidebar would keep drawing the star on
		// nothing, so the settings that carry them are pushed again.
		if (registeredAgainst.length)
			await emitToUser("systemSettings:get", () =>
				buildSystemSettingsGet()
			)

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
				error: "Access denied. Only admin users can update sampling configs."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update sampling configs."
			)
		}

		const id = params.sampling.id!
		// Only name, shape, values and enabled are the editor's to change. The
		// id addresses the row; `isImmutable` and `seedKey` belong to the
		// seeder, and a client (or a stale round-tripped copy) must not be able
		// to lock a row or re-key it as a built-in.
		const {
			id: _,
			isImmutable: _immutable,
			seedKey: _seedKey,
			...updateData
		} = params.sampling as typeof params.sampling & {
			isImmutable?: unknown
			seedKey?: unknown
		}

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
			const row = {
				shape,
				values: updateData.values ?? currentSamplingConfig?.values,
				enabled: updateData.enabled ?? currentSamplingConfig?.enabled
			}
			const normalized = normalizeSamplingRow(row)
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

		// Lazy — see `buildSamplingConfigsList`.
		await emitToUser("samplingConfigs:list", () =>
			buildSamplingConfigsList()
		)
		// ⚠ Stated here, rather than left to the `samplingConfigs:get` cascade
		// below, which states it only by accident: for an id that does not
		// exist, that push's builder throws "Sampling config not found" on its
		// way past, and that throw — not any check in this handler — is what
		// refuses the request. A thunk's rejection is logged rather than raised
		// (`evaluate` in sockets/index), and a push nobody declared interest in
		// never runs at all, so a refusal riding on one is not a refusal.
		// Placed exactly where the cascade sits, so the list above still goes
		// out first.
		if (!currentSamplingConfig) throw new Error("Sampling config not found")
		// Lazy — see `buildSamplingConfigsGet`.
		await emitToUser("samplingConfigs:get", () =>
			buildSamplingConfigsGet(id)
		)
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
	register(socket, samplingConfigsSetDefaultFor, emitToUser)
	register(socket, samplingConfigsUsedBy, emitToUser)
	register(socket, samplingConfigsCreate, emitToUser)
	register(socket, samplingConfigsUpdate, emitToUser)
	register(socket, samplingConfigsDelete, emitToUser)
}
