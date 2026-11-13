/**
 * 🚧 **Generate portrait** — the Gallery tab's action, server side
 * (DESIGN-image-generation §6.2, §4.7; I8).
 *
 * Four halves around one spec, `core:spec/character-portrait`:
 *
 *  - `buildProofs` — `count` identical series items keyed `1…n`: the
 *    host of `core:task/build-proofs@1`, and what the preview prices.
 *  - `offerMediaToGallery` — `core:outlet/offer-media@1`'s write: each
 *    picture becomes one of the card's gallery pictures. Nothing chosen.
 *  - `previewPortrait` — the dialog's cost line (*2 pictures · 1 call*), the
 *    notices the picture step would raise before the run, a refusal.
 *  - `runPortrait` — the run as a card action (`runCardAction`), reported
 *    as it goes.
 *
 * **Style** picks the picture step's prompt row (*Portrait, tags* or
 * *Portrait, prose*). *Tags* is whatever the pipeline's config resolves (the
 * shipped default is the tags row); *Prose* layers the prose row at the
 * person's own scope for this one run (`styleOverrides`).
 *
 * ⚠ Members never see a connection or a model: the cost line names the pair
 * (and its price) for an admin only.
 */

import { and, eq, isNull, max } from "drizzle-orm"
import { resolveConfig, type ImageSeriesItemV1, type OverrideRow } from "@serene-pub/sdk"
import {
	CHARACTER_PORTRAIT_NODES,
	CHARACTER_PORTRAIT_PROMPT_SEED_KEYS,
	CHARACTER_PORTRAIT_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { slotConnectionId, slotModelId } from "$lib/shared/connections/slotRef"
import { addToMemberGallery, fileForOwner, getMediaByUuid } from "$lib/server/media"
import { canEditCastMember } from "$lib/server/cast/memberAccess"
import { mayFillSprites } from "$lib/server/sprites/attach"
import type { SpriteOwner } from "$lib/server/sprites"
import { money, perImagePrice, pictureCount } from "$lib/server/sprites/fillAction"
import {
	cardActionInput,
	cardActionOwnerOf
} from "$lib/server/pipelines/runtime/cardAction"

/** The form's bounds (§6.2): one to four pictures, two by default. */
export const PORTRAIT_COUNT = Object.freeze({ min: 1, max: 4, default: 2 })
/** The task's own ceiling — the default `seriesMax`. */
export const PROOFS_MAX = 8

export type PortraitStyle = "tags" | "prose"

/** A count from untrusted input: a whole number in `[1, max]`, else 1. */
export function clampCount(raw: unknown, ceiling = PROOFS_MAX): number {
	const n = typeof raw === "number" ? raw : Number(raw)
	if (!Number.isFinite(n)) return 1
	return Math.min(ceiling, Math.max(1, Math.floor(n)))
}

/**
 * `count` identical series items, keyed `"1"` … `"n"` — the host of
 * `core:task/build-proofs@1`. No vars: every item renders the same
 * prompt, which is what lets the host pack them as one batch call.
 */
export function buildProofs(count: unknown): ImageSeriesItemV1[] {
	const n = clampCount(count)
	return Array.from({ length: n }, (_, i) => ({ key: String(i + 1), vars: {} }))
}

/** A style from untrusted input; anything but `prose` is `tags`. */
export function portraitStyleOf(raw: unknown): PortraitStyle {
	return raw === "prose" ? "prose" : "tags"
}

/**
 * The picture step's prompt fields for a style, or null to keep whatever
 * the pipeline's config resolves (*tags*, or a row the prose seed is gone
 * from).
 */
async function stylePromptFields(
	db: Db,
	style: PortraitStyle
): Promise<Record<string, string> | null> {
	if (style !== "prose") return null
	const row = await db.query.pipelinePrompts.findFirst({
		where: eq(
			schema.pipelinePrompts.seedKey,
			CHARACTER_PORTRAIT_PROMPT_SEED_KEYS.prose
		),
		columns: { fields: true }
	})
	const fields = (row?.fields ?? null) as Record<string, string> | null
	return fields && typeof fields.positive === "string" ? fields : null
}

/** The style as override rows on the picture step, at the person's scope. */
export async function styleOverrides(
	db: Db,
	style: PortraitStyle
): Promise<OverrideRow[]> {
	const fields = await stylePromptFields(db, style)
	if (!fields) return []
	return Object.entries(fields).map(([path, value]) => ({
		nodeKey: CHARACTER_PORTRAIT_NODES.draw,
		slot: "prompts",
		path,
		value,
		scopeKind: "session" as const
	}))
}

// ── The outlet's write ──────────────────────────────────────────────────

export class OfferMediaRefusal extends Error {}

export interface OfferMediaResult {
	offered: Array<{ mediaId: number; key: string | null }>
}

/**
 * `core:outlet/offer-media@1`'s write: each image in `media` becomes one of
 * the card's gallery pictures, after the ones already there. A picture must
 * be the person's own file or already the card's; one that is the card's
 * stays where it is. Refused unless the person owns the card or is an admin.
 *
 * 🚧 For a cast member (`castMemberId`): refused unless the person may edit
 * its lorebook; the pictures are its book owner's files (a copy when the run
 * person is not the owner) linked into the member's gallery.
 */
export async function offerMediaToGallery(
	db: Db,
	input: {
		characterId?: number
		castMemberId?: number
		media: unknown
		userId: number
	}
): Promise<OfferMediaResult> {
	if ((input.characterId == null) === (input.castMemberId == null))
		throw new OfferMediaRefusal("name a character or a cast member, not both.")
	if (input.castMemberId != null) return offerMediaToMemberGallery(db, input)
	const characterId = input.characterId!
	if (!(await mayFillSprites(db, input.userId, characterId)))
		throw new OfferMediaRefusal(
			"only the card's owner or an admin can add pictures to its gallery."
		)
	const items = Array.isArray(input.media)
		? input.media
		: input.media
			? [input.media]
			: []
	const [{ last } = { last: null }] = await db
		.select({ last: max(schema.files.position) })
		.from(schema.files)
		.where(eq(schema.files.characterId, characterId))
	let position = typeof last === "number" ? last + 1 : 0

	const offered: OfferMediaResult["offered"] = []
	for (const item of items) {
		if (!item || typeof item !== "object") continue
		const ref = item as { uuid?: unknown; key?: unknown; kind?: unknown }
		if (ref.kind !== undefined && ref.kind !== "image") continue
		if (typeof ref.uuid !== "string") continue
		const file = await getMediaByUuid(db, ref.uuid)
		if (!file || file.kind !== "image") continue
		const key =
			ref.key === undefined || ref.key === null || ref.key === ""
				? null
				: String(ref.key)
		if (file.characterId === characterId) {
			offered.push({ mediaId: file.id, key })
			continue
		}
		if (file.userId !== input.userId || file.characterId != null)
			throw new OfferMediaRefusal(
				"a picture handed to it is neither yours nor this card's."
			)
		// Provenance: the picture becomes the card's file — its visibility,
		// its gallery. Only a file nobody else claims is stamped.
		await db
			.update(schema.files)
			.set({ characterId: characterId, position: position++ })
			.where(and(eq(schema.files.id, file.id), isNull(schema.files.characterId)))
		offered.push({ mediaId: file.id, key })
	}
	return { offered }
}

/** The member half of `offerMediaToGallery`. */
async function offerMediaToMemberGallery(
	db: Db,
	input: { castMemberId?: number; media: unknown; userId: number }
): Promise<OfferMediaResult> {
	const member = await canEditCastMember(db, input.castMemberId!, input.userId)
	if (!member)
		throw new OfferMediaRefusal(
			"only someone who can edit this cast member's lorebook can add pictures to its gallery."
		)
	const items = Array.isArray(input.media)
		? input.media
		: input.media
			? [input.media]
			: []
	const inGallery = new Set(
		(
			await db
				.select({ fileId: schema.castMemberFiles.fileId })
				.from(schema.castMemberFiles)
				.where(eq(schema.castMemberFiles.castMemberId, member.id))
		).map((r) => r.fileId)
	)
	const offered: OfferMediaResult["offered"] = []
	const toLink: number[] = []
	for (const item of items) {
		if (!item || typeof item !== "object") continue
		const ref = item as { uuid?: unknown; key?: unknown; kind?: unknown }
		if (ref.kind !== undefined && ref.kind !== "image") continue
		if (typeof ref.uuid !== "string") continue
		const file = await getMediaByUuid(db, ref.uuid)
		if (!file || file.kind !== "image") continue
		const key =
			ref.key === undefined || ref.key === null || ref.key === ""
				? null
				: String(ref.key)
		// Already in the member's gallery: offered as is.
		if (inGallery.has(file.id)) {
			offered.push({ mediaId: file.id, key })
			continue
		}
		const isMembers =
			file.userId === member.bookOwnerId && file.lorebookId === member.lorebookId
		if (file.userId !== input.userId && !isMembers)
			throw new OfferMediaRefusal(
				"a picture handed to it is neither yours nor this cast member's."
			)
		let fileId = file.id
		if (file.userId !== member.bookOwnerId)
			// A session's notes editor ran it: the member's picture is the owner's copy.
			fileId = await fileForOwner(db, file.id, {
				userId: member.bookOwnerId,
				lorebookId: member.lorebookId
			})
		else if (file.characterId == null && file.lorebookId == null)
			// The owner's own file nobody else claims: the book is its provenance.
			await db
				.update(schema.files)
				.set({ lorebookId: member.lorebookId })
				.where(
					and(
						eq(schema.files.id, file.id),
						isNull(schema.files.characterId),
						isNull(schema.files.lorebookId)
					)
				)
		toLink.push(fileId)
		inGallery.add(fileId)
		offered.push({ mediaId: fileId, key })
	}
	if (toLink.length) await addToMemberGallery(db, member.id, toLink)
	return { offered }
}

// ── The dialog's preview ────────────────────────────────────────────────

export interface PortraitPreview {
	/** The card's id; absent for a cast member. */
	characterId?: number
	/** 🚧 The cast member's id; absent for a card. */
	castMemberId?: number
	count: number
	style: PortraitStyle
	pictures: number
	/** Null when the step would be refused before a call is planned. */
	calls: number | null
	/** *2 pictures · 1 call* — the pair and price for an admin only. */
	line: string
	notices: string[]
	refusal?: string
	/** Whether the run stops to show the prompt first (the config's review). */
	review: boolean
}

/** A stored `workflow` slot value — `{ id }` or a bare id — as a row id. */
const workflowIdOf = (v: unknown): number | null =>
	typeof v === "number"
		? v
		: typeof (v as { id?: unknown } | undefined)?.id === "number"
			? (v as { id: number }).id
			: null

/** The resolved config of the picture step, for the spec alone. */
async function resolvedDraw(db: Db, style: PortraitStyle) {
	const world = await buildWorld(db, { specId: CHARACTER_PORTRAIT_SPEC_ID })
	world.overrides.push(...(await styleOverrides(db, style)))
	const resolved = resolveConfig(world, [CHARACTER_PORTRAIT_NODES.draw])
	const draw = resolved[CHARACTER_PORTRAIT_NODES.draw] ?? {}
	const samplingStored = draw.sampling?.[""]
	const samplingId =
		typeof samplingStored === "number"
			? samplingStored
			: typeof (samplingStored as { id?: unknown } | undefined)?.id === "number"
				? (samplingStored as { id: number }).id
				: null
	return {
		connectionId: slotConnectionId(draw.connection?.[""]),
		connectionModelId: slotModelId(draw.connection?.[""]),
		samplingId,
		// The `workflow` slot, as the run reads it (`host.ts`): the step's own
		// pick, else its loadout's — `buildWorld` already projected the
		// loadout layer (`applyLoadoutLayer`) onto these three slots.
		workflowId: workflowIdOf(draw.workflow?.[""]),
		prompts: (draw.prompts ?? {}) as { positive?: string; negative?: string },
		params: (draw.params ?? {}) as Record<string, unknown>,
		review: (draw.settings as { review?: unknown } | undefined)?.review === "on"
	}
}

/**
 * The refusal a portrait meets with nothing to draw from (owner ruling
 * 2026-11-08): no likeness image and no likeness line. Until then it was a
 * notice and the portrait was drawn from the fixed tail alone — a generic
 * face that carried nothing of the card. Null when there is a likeness.
 */
export function likenessRefusal(
	owner: SpriteOwner,
	input: { likenessImage?: unknown; likeness?: unknown }
): string | null {
	const hasImage = Array.isArray(input.likenessImage) && input.likenessImage.length > 0
	if (hasImage || String(input.likeness ?? "").trim()) return null
	return "castMemberId" in owner
		? "Add a likeness first: this cast member has no likeness image or likeness line, so there is nothing to draw them from."
		: "Add a likeness first — a picture or a line of looks on the character's Likeness tab — so the portrait is drawn as them."
}

/** The dialog's preview for *Generate portrait*. */
export async function previewPortrait(
	db: Db,
	req: {
		characterId?: number
		castMemberId?: number
		count?: unknown
		style?: unknown
		userId: number
		isAdmin: boolean
	}
): Promise<PortraitPreview> {
	const count = clampCount(req.count ?? PORTRAIT_COUNT.default, PORTRAIT_COUNT.max)
	const style = portraitStyleOf(req.style)
	const owner = cardActionOwnerOf(req)
	const input = await cardActionInput(db, owner, { count, style })
	const draw = await resolvedDraw(db, style)
	const series = buildProofs(count)
	const base = {
		...owner,
		count,
		style,
		pictures: count,
		review: draw.review
	}

	const notices: string[] = []
	const noLikeness = likenessRefusal(owner, input)
	if (noLikeness)
		return { ...base, calls: null, line: pictureCount(count), notices, refusal: noLikeness }

	const { previewImageRun } = await import(
		"$lib/server/pipelines/runtime/dispatchImage"
	)
	const pick = <T extends string>(v: unknown, of: readonly T[]) =>
		of.includes(v as T) ? (v as T) : null
	const preview = await previewImageRun(db, {
		prompt: String(input.likeness ?? ""),
		negative: String(input.likenessNegative ?? ""),
		prompts: draw.prompts,
		connectionId: draw.connectionId,
		connectionModelId: draw.connectionModelId,
		samplingId: draw.samplingId,
		workflowId: draw.workflowId,
		userId: req.userId,
		series,
		references: input.likenessImage as any,
		orientation: pick(draw.params.orientation, [
			"free",
			"square",
			"portrait",
			"landscape"
		] as const),
		cutOut: pick(draw.params.cutOut, [
			"off",
			"native-or-task",
			"native-only"
		] as const),
		referencesPolicy: pick(draw.params.references, [
			"preferred",
			"required"
		] as const)
	})
	if (!preview.ok)
		return {
			...base,
			calls: null,
			line: pictureCount(count),
			notices,
			refusal: preview.refusal
		}

	notices.push(...preview.preRunNotices)
	const calls = preview.plan.calls.length
	let line = `${pictureCount(preview.plan.pictures)} · ${calls} ${calls === 1 ? "call" : "calls"}`
	if (req.isAdmin) {
		const pair = preview.pair.modelName
			? `${preview.pair.connectionName} · ${preview.pair.modelName}`
			: preview.pair.connectionName
		line += ` on ${pair}`
		const price = await perImagePrice(db, preview.pair.connectionModelId)
		if (price)
			line += ` · about ${money(price.each, price.currency)} a picture, ${money(
				price.each * preview.plan.pictures,
				price.currency
			)} in all`
	}
	return { ...base, calls, line, notices }
}

// ── The run ─────────────────────────────────────────────────────────────

export interface PortraitProgress {
	/** The card's id; absent for a cast member. */
	characterId?: number
	/** 🚧 The cast member's id; absent for a card. */
	castMemberId?: number
	runId: string
	/** Where the run is. `done` and `failed` are final. */
	phase: "drawing" | "offering" | "done" | "failed"
	count: number
	status?: unknown
	/** The backend's own line (*In the Horde's queue…*), when no `status` is. */
	message?: string
	percent?: number
	/** The pictures placed in the gallery, with the series key each was drawn for. */
	offered?: Array<{ mediaId: number; key: string | null }>
	/** Series keys that came back with no picture. */
	missing?: string[]
	error?: string
}

/**
 * Run the portrait and report as it goes. Resolves when the run ends;
 * `report` has been told the final phase by then. Never throws for a run
 * that failed — the failure is the final report. A run parked at review
 * stays in `drawing` until the person decides on the review card.
 */
export async function runPortrait(
	db: Db,
	req: {
		characterId?: number
		castMemberId?: number
		count?: unknown
		style?: unknown
		userId: number
		runId: string
		signal?: AbortSignal
		cancelSignal?: () => { by: string; reason: string } | undefined
		report: (p: PortraitProgress) => void
	}
): Promise<void> {
	const count = clampCount(req.count ?? PORTRAIT_COUNT.default, PORTRAIT_COUNT.max)
	const style = portraitStyleOf(req.style)
	const head = { ...cardActionOwnerOf(req), runId: req.runId, count }
	const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
	const { haltExplanation } = await import(
		"$lib/server/pipelines/runtime/haltExplanation"
	)
	let phase: PortraitProgress["phase"] = "drawing"
	// The same door the preview closes: a run started past a stale preview
	// (or without one) is refused here, before anything is drawn.
	const owner = cardActionOwnerOf(req)
	const noLikeness = likenessRefusal(owner, await cardActionInput(db, owner, { count, style }))
	if (noLikeness) {
		req.report({ ...head, phase: "failed", error: noLikeness })
		return
	}
	req.report({ ...head, phase })
	try {
		const receipt = await runCardAction({
			db,
			specId: CHARACTER_PORTRAIT_SPEC_ID,
			...cardActionOwnerOf(req),
			userId: req.userId,
			fields: { count, style },
			overrides: await styleOverrides(db, style),
			runId: req.runId,
			signal: req.signal,
			cancelSignal: req.cancelSignal,
			onProgress: (e) =>
				req.report({
					...head,
					phase,
					...(e.percent != null ? { percent: e.percent } : {}),
					...(e.status ? { status: e.status } : {}),
					// The adapter's sentence — a queue position, a wait, "this
					// server does not say how far along it is" — is plain
					// text beside the structured status, and is what a person
					// waiting on the Horde needs to see.
					...(e.message ? { message: e.message } : {})
				}),
			onStatus: (_node, text) => req.report({ ...head, phase, status: text }),
			onNode: (e) => {
				if (e.phase !== "start" || e.nodeKey !== CHARACTER_PORTRAIT_NODES.offer)
					return
				phase = "offering"
				req.report({ ...head, phase })
			}
		})
		if (receipt.outcome !== "ok") {
			req.report({
				...head,
				phase: "failed",
				error: haltExplanation(receipt) ?? "The portrait stopped before it finished."
			})
			return
		}
		const out = (receipt.nodes.find(
			(n) => n.nodeKey === CHARACTER_PORTRAIT_NODES.offer && n.result === "ok"
		)?.output ?? {}) as { offered?: unknown }
		const offered = Array.isArray(out.offered)
			? (out.offered as PortraitProgress["offered"])!
			: []
		const got = new Set(offered.map((o) => o.key))
		const missing = buildProofs(count)
			.map((i) => i.key)
			.filter((k) => !got.has(k))
		req.report({ ...head, phase: "done", offered, missing })
	} catch (e) {
		req.report({
			...head,
			phase: "failed",
			error: e instanceof Error ? e.message : String(e)
		})
	}
}
