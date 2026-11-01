/**
 * 🚧 Voicebank sockets (speech build seam S4). Admin-gated CRUD over
 * `voicebank_voices`, plus `voicebank:pickable` for any signed-in member
 * (name, slug, language, labels, previewUrl, controls; the loadout only to
 * administrators). Each voice speaks through its own `text->audio` loadout (A7
 * is retired): create/update must name one that exists and has a model.
 * Refusals answer `<event>:error`.
 * 🚧 `voicebank:preview` is the voice try-out for any signed-in person: one
 * line spoken through `server/speech/preview.ts`, answered inline with the
 * asker's `requestId` (a refusal carries it too); nothing is stored.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, ne } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { readSpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import type {
	VoicebankLabels,
	VoicebankPickableVoice,
	VoicebankSettings,
	VoiceControls,
	VoicebankVoiceInput
} from "$lib/shared/speech/voicebank"
import { loadoutById } from "$lib/server/loadouts"
import { refusable } from "./refusable"
import { previewVoice, VoicePreviewRefusal } from "$lib/server/speech/preview"
import {
	ensureLoadoutVoice,
	entryLoadout,
	entryLoadouts,
	speakingLoadout,
	voicebankLoadoutOptions,
	toVoicebankView,
	uniqueVoicebankSlug,
	slugifyVoicebank,
	voicebankRefusal,
	cleanSettings
} from "$lib/server/speech/voicebank"

// Moved to the speech seam so the voice try-out can use it without this module's db import.
export { cleanSettings }

type Emit = (event: string, data: any) => void

function requireAdmin(socket: any) {
	if (!socket.user?.isAdmin)
		throw new Error("Only administrators can manage voices.")
}

function requireUser(socket: any) {
	if (!socket.user) throw new Error("Sign in to see voices.")
}

/** The default speaking loadout's model (a new voice starts on its loadout); null when unfilled. */
async function pairModelId(): Promise<number | null> {
	return (await speakingLoadout(db))?.connectionModelId ?? null
}

export async function buildList(): Promise<Sockets.Voicebank.List.Response> {
	await ensureLoadoutVoice(db)
	const rows = await db
		.select()
		.from(schema.voicebankVoices)
		.orderBy(schema.voicebankVoices.id)
	const loadouts = await entryLoadouts(db, rows.map((r) => r.loadoutId))
	return {
		voices: rows.map((r) =>
			toVoicebankView(r, r.loadoutId != null ? (loadouts.get(r.loadoutId) ?? null) : null)
		),
		pairModelId: await pairModelId(),
		loadouts: await voicebankLoadoutOptions(db)
	}
}

async function pushList(emitToUser: Emit, event: string) {
	try {
		emitToUser("voicebank:list", await buildList())
	} catch (e) {
		console.error(`${event}: pushing the voice list failed:`, e)
	}
}

export function cleanLabels(raw: unknown): VoicebankLabels {
	const out: Record<string, string> = {}
	if (raw && typeof raw === "object" && !Array.isArray(raw))
		for (const [k, v] of Object.entries(raw))
			if (typeof v === "string" && v.trim()) out[k] = v.trim()
	return out as VoicebankLabels
}

function cleanLanguage(raw: unknown): string | null {
	if (raw == null || raw === "") return null
	if (typeof raw !== "string" || !/^[a-z]{2}$/.test(raw))
		throw new Error("Language must be a two-letter ISO 639-1 code, such as en.")
	return raw
}

const nonEmpty = (raw: unknown, what: string): string => {
	const s = typeof raw === "string" ? raw.trim() : ""
	if (!s) throw new Error(`${what} is required.`)
	return s
}

/** Whether the model designs its voice from prose (Qwen3 VoiceDesign): then an entry needs no voice id. */
async function modelDesignsVoice(connectionModelId: number): Promise<boolean> {
	const [model] = await db
		.select({ facts: schema.connectionModels.facts })
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.id, connectionModelId))
		.limit(1)
	return readSpeechFacts(model?.facts)?.controls.designsVoice === true
}

/** The voice id as sent, or blank on a voice-designing model (owner report 2026-10-29: Qwen3 VoiceDesign lists no voices, so no entry could be made). */
async function voiceIdFor(raw: unknown, connectionModelId: number): Promise<string> {
	if (typeof raw === "string" && raw.trim()) return raw.trim()
	if (await modelDesignsVoice(connectionModelId)) return ""
	return nonEmpty(raw, "Voice")
}

/**
 * The loadout a voice is saved on: it must exist, do `text->audio`, and have a
 * model. Returns the loadout's model (the voice id belongs to it).
 */
async function assertSpeechLoadout(raw: unknown): Promise<{ loadoutId: number; modelId: number }> {
	if (typeof raw !== "number") throw new Error("Choose the loadout this voice speaks through.")
	const row = await loadoutById(db, raw)
	if (!row) throw new Error("That loadout no longer exists.")
	if (row.transform !== "text->audio")
		throw new Error(`${row.name} does not speak; choose a text-to-audio loadout.`)
	const l = await entryLoadout(db, raw)
	if (!l?.filled || l.connectionModelId == null)
		throw new Error(`${row.name} has no model yet. Choose a model for it in Loadouts first.`)
	return { loadoutId: l.loadoutId, modelId: l.connectionModelId }
}

type Patch = Partial<typeof schema.voicebankVoices.$inferInsert>

async function rowById(id: unknown) {
	if (typeof id !== "number") throw new Error("Voice not found.")
	const [row] = await db
		.select()
		.from(schema.voicebankVoices)
		.where(eq(schema.voicebankVoices.id, id))
		.limit(1)
	if (!row) throw new Error("Voice not found.")
	return row
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export const voicebankList: Handler<
	Sockets.Voicebank.List.Params,
	Sockets.Voicebank.List.Response
> = refusable(
	"voicebank:list",
	async (socket, _params, emitToUser) => {
		requireAdmin(socket)
		const res = await buildList()
		emitToUser("voicebank:list", res)
		return res
	},
	"The voices could not be loaded."
)

export const voicebankCreate: Handler<
	Sockets.Voicebank.Create.Params,
	Sockets.Voicebank.Create.Response
> = refusable(
	"voicebank:create",
	async (socket, params, emitToUser) => {
		requireAdmin(socket)
		const v = (params?.voice ?? {}) as VoicebankVoiceInput
		const name = nonEmpty(v.name, "Name")
		const target = await assertSpeechLoadout(v.loadoutId)
		const voiceId = await voiceIdFor(v.voiceId, target.modelId)
		const settings = cleanSettings(v.settings)
		const labels = cleanLabels(v.labels)
		const language = cleanLanguage(v.language)
		const wanted = typeof v.slug === "string" && v.slug.trim() ? slugifyVoicebank(v.slug) : null
		const row = await db.transaction(async (tx) => {
			const slug = wanted ?? (await uniqueVoicebankSlug(tx as unknown as Db, "pub", name))
			const [clash] = await tx
				.select({ id: schema.voicebankVoices.id })
				.from(schema.voicebankVoices)
				.where(
					and(
						eq(schema.voicebankVoices.owner, "pub"),
						eq(schema.voicebankVoices.slug, slug)
					)
				)
				.limit(1)
			if (clash) throw new Error("A voice with that slug already exists.")
			const [created] = await tx
				.insert(schema.voicebankVoices)
				.values({
					slug,
					name,
					description:
						typeof v.description === "string" && v.description.trim()
							? v.description.trim()
							: null,
					owner: "pub",
					loadoutId: target.loadoutId,
					voiceId,
					language,
					settings: settings as Record<string, unknown>,
					labels: labels as Record<string, string>,
					enabled: v.enabled !== false
				})
				.returning()
			return created
		})
		await ensureLoadoutVoice(db)
		const res = { voice: toVoicebankView(row, await entryLoadout(db, row.loadoutId)) }
		emitToUser("voicebank:create", res)
		await pushList(emitToUser, "voicebank:create")
		return res
	},
	"The voice could not be saved."
)

export const voicebankUpdate: Handler<
	Sockets.Voicebank.Update.Params,
	Sockets.Voicebank.Update.Response
> = refusable(
	"voicebank:update",
	async (socket, params, emitToUser) => {
		requireAdmin(socket)
		const existing = await rowById(params?.id)
		const v = (params?.voice ?? {}) as Partial<VoicebankVoiceInput>
		const patch: Patch = { updatedAt: new Date() }
		if (existing.owner !== "pub") {
			// A declared voice is the plugin's: only on/off is the pub's to change.
			if (v.enabled !== undefined) patch.enabled = v.enabled === true
		} else {
			if (v.name !== undefined) patch.name = nonEmpty(v.name, "Name")
			let modelId: number | null = null
			if (v.loadoutId !== undefined) {
				const target = await assertSpeechLoadout(v.loadoutId)
				patch.loadoutId = target.loadoutId
				modelId = target.modelId
			}
			if (v.voiceId !== undefined) {
				modelId ??= (await entryLoadout(db, existing.loadoutId))?.connectionModelId ?? null
				if (modelId == null)
					throw new Error("Choose the loadout this voice speaks through.")
				patch.voiceId = await voiceIdFor(v.voiceId, modelId)
			}
			if (v.description !== undefined)
				patch.description =
					typeof v.description === "string" && v.description.trim()
						? v.description.trim()
						: null
			if (v.language !== undefined) patch.language = cleanLanguage(v.language)
			if (v.settings !== undefined)
				patch.settings = cleanSettings(v.settings) as Record<string, unknown>
			if (v.labels !== undefined)
				patch.labels = cleanLabels(v.labels) as Record<string, string>
			if (v.enabled !== undefined) patch.enabled = v.enabled === true
			if (v.slug !== undefined) {
				const slug = slugifyVoicebank(String(v.slug))
				if (!SLUG_RE.test(slug)) throw new Error("That slug is not usable.")
				const [clash] = await db
					.select({ id: schema.voicebankVoices.id })
					.from(schema.voicebankVoices)
					.where(
						and(
							eq(schema.voicebankVoices.owner, existing.owner),
							eq(schema.voicebankVoices.slug, slug),
							ne(schema.voicebankVoices.id, existing.id)
						)
					)
					.limit(1)
				if (clash) throw new Error("A voice with that slug already exists.")
				patch.slug = slug
			}
		}
		const moved = patch.loadoutId !== undefined && patch.loadoutId !== existing.loadoutId
		const turnedOff = patch.enabled === false && existing.enabled
		const row = await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(schema.voicebankVoices)
				.set(patch)
				.where(eq(schema.voicebankVoices.id, existing.id))
				.returning()
			// A voice that left its loadout (or was turned off) stops being that
			// loadout's voice / other-speakers pick.
			if ((moved || turnedOff) && existing.loadoutId != null) {
				await tx
					.update(schema.loadouts)
					.set({ defaultVoiceId: null })
					.where(
						and(
							eq(schema.loadouts.id, existing.loadoutId),
							eq(schema.loadouts.defaultVoiceId, existing.id)
						)
					)
				await tx
					.update(schema.loadouts)
					.set({ otherSpeakersVoiceId: null })
					.where(
						and(
							eq(schema.loadouts.id, existing.loadoutId),
							eq(schema.loadouts.otherSpeakersVoiceId, existing.id)
						)
					)
			}
			return updated
		})
		await ensureLoadoutVoice(db)
		const res = { voice: toVoicebankView(row, await entryLoadout(db, row.loadoutId)) }
		emitToUser("voicebank:update", res)
		await pushList(emitToUser, "voicebank:update")
		return res
	},
	"The voice could not be saved."
)

export const voicebankDelete: Handler<
	Sockets.Voicebank.Delete.Params,
	Sockets.Voicebank.Delete.Response
> = refusable(
	"voicebank:delete",
	async (socket, params, emitToUser) => {
		requireAdmin(socket)
		const existing = await rowById(params?.id)
		await db
			.delete(schema.voicebankVoices)
			.where(eq(schema.voicebankVoices.id, existing.id))
		await ensureLoadoutVoice(db)
		const res = { id: existing.id }
		emitToUser("voicebank:delete", res)
		await pushList(emitToUser, "voicebank:delete")
		return res
	},
	"The voice could not be deleted."
)

export const voicebankPickable: Handler<
	Sockets.Voicebank.Pickable.Params,
	Sockets.Voicebank.Pickable.Response
> = refusable(
	"voicebank:pickable",
	async (socket, _params, emitToUser) => {
		requireUser(socket)
		await ensureLoadoutVoice(db)
		const rows = await db
			.select()
			.from(schema.voicebankVoices)
			.orderBy(schema.voicebankVoices.id)
		const loadouts = await entryLoadouts(db, rows.map((r) => r.loadoutId))
		const loadoutOf = (r: (typeof rows)[number]) =>
			r.loadoutId != null ? (loadouts.get(r.loadoutId) ?? null) : null
		const usable = rows.filter((r) => voicebankRefusal(r, loadoutOf(r)) === null)
		const isAdmin = socket.user?.isAdmin === true

		// One facts read per distinct model (voices on one model share it).
		const modelIds = new Set<number>()
		for (const r of usable) modelIds.add(loadoutOf(r)!.connectionModelId!)
		const pair = await pairModelId()
		if (pair != null) modelIds.add(pair)
		const speechByModel = new Map<number, ReturnType<typeof readSpeechFacts>>()
		for (const id of modelIds) {
			const [model] = await db
				.select({ facts: schema.connectionModels.facts })
				.from(schema.connectionModels)
				.where(eq(schema.connectionModels.id, id))
				.limit(1)
			speechByModel.set(id, readSpeechFacts(model?.facts))
		}

		let controls: Sockets.Voicebank.Pickable.Response["controls"] = null
		if (pair != null) {
			const speech = speechByModel.get(pair)
			controls = {}
			if (speech?.controls.designsVoice === true) controls.designsVoice = true
			if (speech?.controls.instruction === "prose") controls.instruction = "prose"
		}
		const controlsOf = (modelId: number): VoiceControls | null => {
			const c = speechByModel.get(modelId)?.controls
			if (!c) return {}
			const out: VoiceControls = {}
			if (c.designsVoice === true) out.designsVoice = true
			if (c.instruction === "prose") out.instruction = "prose"
			if (c.settings) out.settings = c.settings
			if (c.speed) out.speed = c.speed
			if (c.language) out.language = c.language
			return out
		}
		const voices: VoicebankPickableVoice[] = usable.map((r) => {
			const l = loadoutOf(r)!
			const modelId = l.connectionModelId!
			const v: VoicebankPickableVoice = {
				name: r.name,
				slug: r.slug,
				language: r.language ?? null,
				labels: (r.labels ?? {}) as VoicebankLabels,
				controls: controlsOf(modelId)
			}
			const previewUrl = speechByModel
				.get(modelId)
				?.voices.find((sv) => sv.id === r.voiceId)?.previewUrl
			if (previewUrl) v.previewUrl = previewUrl
			// Members never see loadouts.
			if (isAdmin) {
				v.loadoutId = l.loadoutId
				v.loadoutName = l.name
			}
			return v
		})
		const res = { voices, controls }
		emitToUser("voicebank:pickable", res)
		return res
	},
	"The voices could not be loaded."
)

/** The asker's `requestId` when it sent a usable one, for the reply and the refusal. */
const previewEcho = (params: unknown): Record<string, unknown> => {
	const id = (params as { requestId?: unknown } | null | undefined)?.requestId
	return typeof id === "string" && id.length > 0 && id.length <= 64 ? { requestId: id } : {}
}

export const voicebankPreview: Handler<
	Sockets.Voicebank.Preview.Params,
	Sockets.Voicebank.Preview.Response
> = refusable(
	"voicebank:preview",
	async (socket, params, emitToUser) => {
		if (!socket.user) throw new VoicePreviewRefusal("Sign in to try a voice.")
		const requestId = previewEcho(params).requestId as string | undefined
		if (!requestId) throw new VoicePreviewRefusal("The voice try-out needs a request id.")
		const ac = new AbortController()
		const onDisconnect = () => ac.abort()
		socket.once?.("disconnect", onDisconnect)
		try {
			const result = await previewVoice(db as unknown as Db, socket.user, params, {
				signal: ac.signal
			})
			// Nobody left to answer.
			if (ac.signal.aborted) return undefined as unknown as Sockets.Voicebank.Preview.Response
			const res = { requestId, ...result }
			emitToUser("voicebank:preview", res)
			return res
		} catch (e) {
			if (ac.signal.aborted && !(e instanceof VoicePreviewRefusal))
				return undefined as unknown as Sockets.Voicebank.Preview.Response
			throw e
		} finally {
			socket.off?.("disconnect", onDisconnect)
		}
	},
	"The voice could not be tried.",
	(e) => (e instanceof VoicePreviewRefusal ? e.message : undefined),
	previewEcho
)

export function registerVoicebankHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, voicebankList, emitToUser)
	register(socket, voicebankCreate, emitToUser)
	register(socket, voicebankUpdate, emitToUser)
	register(socket, voicebankDelete, emitToUser)
	register(socket, voicebankPickable, emitToUser)
	register(socket, voicebankPreview, emitToUser)
}
