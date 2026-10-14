/**
 * 🚧 **Re-express from neutral** — redraw a card's `neutral` sprite with
 * another expression (DESIGN-image-generation §6.3, NovelAI bullet).
 *
 * Not a pipeline: one adapter call (`expressImage`) on the pair the Sprites
 * loadout resolves to, offered only when that pair's drawing sheet says
 * `expressions: true`. The picture lands under the label through the same
 * placement rule every way in shares (`placeSpriteFile`): an empty sprite is
 * filled, otherwise it is a variant beside what is there — never a
 * replacement.
 *
 * ⚠ Members never see a connection or a model: a refusal names the pair for
 * an admin only.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveCapabilityTarget } from "$lib/server/connections/capabilityTarget"
import { getImageAdapter } from "$lib/server/utils/getImageAdapter"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { createMedia, readMedia } from "$lib/server/media"
import { listSpriteSets, placeSpriteFile } from "$lib/server/sprites"
import { mayFillSprites } from "$lib/server/sprites/attach"
import { resolvedSteps } from "$lib/server/sprites/fillAction"
import { normalizeSpriteName } from "$lib/shared/sprites"
import type { DrawingSheet } from "$lib/shared/imageGen/types"

export class ReexpressRefusal extends Error {}

/** The label a set's neutral face lives under (`STANDARD_SPRITE_LABELS`). */
export const NEUTRAL_SPRITE_LABEL = "neutral"

export type SpriteExpressionPair =
	| {
			ok: true
			connection: AdapterConnection
			sheet: DrawingSheet
			/** *Connection · model* — for an admin's eyes only. */
			pairName: string
			Adapter: new (c: AdapterConnection) => unknown
	  }
	| { ok: false; reason: string }

/**
 * The pair `core:spec/sprite-set-fill`'s picture step resolves to — its own
 * pick, else the Sprites loadout's, else the Image default — and its sheet.
 */
export async function spriteExpressionPair(
	db: Db
): Promise<SpriteExpressionPair> {
	const steps = await resolvedSteps(db)
	const resolved = await resolveCapabilityTarget(db, {
		capability: "text->image",
		pipelineConfig: {
			connectionId: steps.connectionId,
			connectionModelId: steps.connectionModelId,
			samplingConfigId: null
		}
	})
	if (!resolved.ok) return { ok: false, reason: resolved.problem.message }
	const exports = await getImageAdapter(resolved.connection.type)
	const sheet = exports.sheetFor?.(resolved.connection) ?? exports.sheet
	const c = resolved.connection as AdapterConnection & {
		connectionModelName?: string | null
		model?: string | null
	}
	const model = c.connectionModelName ?? c.model ?? null
	return {
		ok: true,
		connection: resolved.connection,
		sheet,
		pairName: model ? `${c.name} · ${model}` : String(c.name),
		Adapter: exports.Adapter as any
	}
}

export interface ReexpressResult {
	setId: number
	setName: string
	attached: Array<{ label: string; spriteId: number; fileId: number }>
	missing: string[]
}

/**
 * Redraw the set's neutral sprite as `label` and file it under that label.
 * Throws `ReexpressRefusal` (one sentence) for every refusal.
 */
export async function reexpressSprite(
	db: Db,
	req: {
		characterId: number
		/** The set; omitted = the default set. */
		setId?: number | null
		label: string
		userId: number
		isAdmin: boolean
		signal?: AbortSignal
	}
): Promise<ReexpressResult> {
	if (!(await mayFillSprites(db, req.userId, req.characterId)))
		throw new ReexpressRefusal(
			"Only the card's owner or an admin can redraw its sprites."
		)
	const label = normalizeSpriteName(req.label)
	if (!label) throw new ReexpressRefusal("A sprite needs a label.")
	if (label === NEUTRAL_SPRITE_LABEL)
		throw new ReexpressRefusal(
			"Pick a label other than neutral to re-express."
		)

	const sets = await listSpriteSets(db, req.characterId)
	const set =
		(req.setId != null
			? sets.find((s) => s.id === req.setId)
			: undefined) ??
		sets.find((s) => s.isDefault) ??
		sets[0]
	if (!set)
		throw new ReexpressRefusal("This character has no sprite set yet.")
	const neutral = set.sprites
		.filter((s) => s.label === NEUTRAL_SPRITE_LABEL && s.media)
		.sort((a, b) => a.position - b.position)[0]
	if (!neutral?.media)
		throw new ReexpressRefusal(
			"This set has no neutral sprite with a picture to re-express from."
		)

	const pair = await spriteExpressionPair(db)
	if (!pair.ok) throw new ReexpressRefusal(pair.reason)
	const who = req.isAdmin ? pair.pairName : "The model set for sprites"
	if (pair.sheet.expressions !== true)
		throw new ReexpressRefusal(
			`${who} cannot redraw a picture with another expression.`
		)

	// The stored apiKey is encrypted at rest — decrypted into the adapter's
	// copy only, as `dispatchImage` does.
	const conn = pair.connection
	const key = (conn.extraJson as any)?.apiKey
	const target =
		typeof key === "string"
			? {
					...conn,
					extraJson: {
						...(conn.extraJson as any),
						apiKey: decryptApiKeyField(key) ?? ""
					}
				}
			: conn
	const adapter = new pair.Adapter(target as AdapterConnection) as {
		expressImage?: (
			ref: { uuid: string; kind: "image"; mime: string; bytes: number },
			label: string,
			opts: {
				signal?: AbortSignal
				loadMedia?: (
					ref: unknown
				) => Promise<{ bytes: Uint8Array; mime: string }>
			}
		) => Promise<{
			media: Array<{
				base64?: string
				mime?: string
				meta?: Record<string, unknown>
			}>
			isAborted: boolean
		}>
	}
	if (typeof adapter.expressImage !== "function")
		throw new ReexpressRefusal(
			`${who} cannot redraw a picture with another expression.`
		)

	const fileId = neutral.media.id
	const source = await readMedia(db, fileId)
	if (!source)
		throw new ReexpressRefusal("The neutral sprite's picture is gone.")
	let result
	try {
		result = await adapter.expressImage(
			{
				uuid: neutral.media.uuid,
				kind: "image",
				mime: source.mime,
				bytes: source.bytes.length
			},
			label,
			{
				signal: req.signal,
				loadMedia: async () => ({
					bytes: source.bytes,
					mime: source.mime
				})
			}
		)
	} catch (e) {
		throw new ReexpressRefusal(e instanceof Error ? e.message : String(e))
	}
	const picture = result.media.find((m) => typeof m.base64 === "string")
	if (result.isAborted || !picture?.base64)
		return {
			setId: set.id,
			setName: set.name,
			attached: [],
			missing: [label]
		}

	const { file } = await createMedia(db, {
		userId: req.userId,
		characterId: req.characterId,
		bytes: Buffer.from(picture.base64, "base64"),
		filename: `${label}.png`,
		meta: { ...(picture.meta ?? {}), reexpressedFrom: neutral.media.uuid }
	})
	// Provenance, as `attach-sprite` does: the picture is the card's file.
	if (file.characterId == null)
		await db
			.update(schema.files)
			.set({ characterId: req.characterId })
			.where(eq(schema.files.id, file.id))
	const row = await placeSpriteFile(db, set.id, label, file.id, "generated")
	return {
		setId: set.id,
		setName: set.name,
		attached: [{ label, spriteId: row.id, fileId: file.id }],
		missing: []
	}
}
