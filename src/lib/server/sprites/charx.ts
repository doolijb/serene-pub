/**
 * A character as a **CHARX** (CCv3 §CHARX) — the one card container that can
 * carry its sprites back out (DESIGN-sprites §4).
 *
 * Layout, per the spec's SHOULD rules for asset paths:
 *
 *   card.json
 *   assets/icon/images/main.<ext>          the avatar, `icon` named `main`
 *   assets/emotion/images/<n>.<ext>        the default set's first image per
 *                                          sprite label, as `emotion` assets —
 *                                          what RisuAI and SillyTavern read
 *   assets/x_sp_sprite/images/<n>.<ext>    everything else (other sets, and
 *                                          variants), as `x_sp_sprite` named
 *                                          `<set>/<label>` — the spec reserves
 *                                          `x_` types for exactly this, and
 *                                          other apps keep and re-export them
 *
 * The default set's NAME rides in `data.extensions.serenepub.defaultSpriteSet`,
 * so a Serene Pub import files that set's variants back into the default set
 * rather than into a new set that happens to share the name.
 */

import { zipSync, strToU8 } from "fflate"
import { readMedia } from "$lib/server/media"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
import { listSpriteSets } from "$lib/server/sprites"
import { SP_SPRITE_ASSET_TYPE } from "$lib/server/utils/cardSprites"

const EXT_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/apng": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif"
}

interface Asset {
	type: string
	uri: string
	name: string
	ext: string
}

/** The file's original bytes — `readMedia` falls back to the display form
 *  when an admin culled originals. */
async function bytesOf(
	db: Db,
	fileId: number
): Promise<{ bytes: Buffer; ext: string } | null> {
	const read = await readMedia(db, fileId, MediaVariant.ORIGINAL)
	if (!read) return null
	return { bytes: Buffer.from(read.bytes), ext: EXT_BY_MIME[read.mime] ?? "png" }
}

export async function buildCharx(
	db: Db,
	params: {
		characterId: number
		avatarMediaId: number | null
		/** The CCv3 card object `buildCharacterCardV3` built. */
		card: any
	}
): Promise<Buffer> {
	const files: Record<string, Uint8Array> = {}
	const assets: Asset[] = []

	if (params.avatarMediaId) {
		const avatar = await bytesOf(db, params.avatarMediaId)
		if (avatar) {
			const path = `assets/icon/images/main.${avatar.ext}`
			files[path] = avatar.bytes
			assets.push({ type: "icon", uri: `embeded://${path}`, name: "main", ext: avatar.ext })
		}
	}

	const sets = await listSpriteSets(db, params.characterId)
	const defaultSet = sets.find((s) => s.isDefault) ?? sets[0]
	let emotionN = 0
	let otherN = 0
	for (const set of sets) {
		const firstOfLabel = new Set<string>()
		for (const sprite of [...set.sprites].sort(
			(a, b) => a.label.localeCompare(b.label) || a.position - b.position
		)) {
			if (!sprite.media) continue
			const file = await bytesOf(db, sprite.media.id)
			if (!file) continue
			const interop = set === defaultSet && !firstOfLabel.has(sprite.label)
			firstOfLabel.add(sprite.label)
			if (interop) {
				const path = `assets/emotion/images/${emotionN++}.${file.ext}`
				files[path] = file.bytes
				assets.push({ type: "emotion", uri: `embeded://${path}`, name: sprite.label, ext: file.ext })
			} else {
				const path = `assets/${SP_SPRITE_ASSET_TYPE}/images/${otherN++}.${file.ext}`
				files[path] = file.bytes
				assets.push({
					type: SP_SPRITE_ASSET_TYPE,
					uri: `embeded://${path}`,
					name: `${set.name}/${sprite.label}`,
					ext: file.ext
				})
			}
		}
	}

	const card = structuredClone(params.card)
	card.data = card.data ?? {}
	card.data.assets = assets
	if (defaultSet) {
		card.data.extensions = card.data.extensions ?? {}
		card.data.extensions.serenepub = {
			...(card.data.extensions.serenepub ?? {}),
			defaultSpriteSet: defaultSet.name
		}
	}
	files["card.json"] = strToU8(JSON.stringify(card, null, 2))
	return Buffer.from(zipSync(files))
}
