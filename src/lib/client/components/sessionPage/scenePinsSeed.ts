/**
 * ⏳ The browser's old scene-image pins carried into Scene Portraits, once
 * (PLAN-core-widgets W6, 2026-10-11).
 *
 * Before W6 a person pinned two portraits from the composer's **Pinned
 * images** pane, kept in this browser (`sceneImages:<sessionId>`), and a
 * Scene Portraits instance on the `pinned` source drew them. That pane is
 * gone: a pin becomes the instance's **chosen image** for the member it
 * pictures, and the instance shows those members on a stage — what it drew
 * before. Pure: the page (`ScenePins`) decides when, and writes.
 *
 * REMOVE in 0.7.0 with the pins key.
 */
import type { SessionCharacterV1 } from "@serene-pub/sdk"
import {
	chosenImagesOf,
	withChosenImage
} from "@serene-pub/core-catalog/scene-portraits"

/**
 * Did this instance draw the pins in 0.6? Read off its STORED values (never
 * the effective ones, whose defaults say nothing): a `source: 'pinned'` not
 * yet moved; a `face: 'chosen'` with nothing chosen (the boot reconcile's
 * rewrite of one); or nothing stored about who or which picture at all —
 * the pinned source was the default. A stored `source: 'scene'` (the
 * Adventure layout's) never drew a pin.
 */
export function takesPins(
	stored: Readonly<Record<string, unknown>> | undefined
): boolean {
	const v = stored ?? {}
	if (v.source === "pinned") return true
	if (v.face === "chosen")
		return !(Array.isArray(v.chosenImages) && v.chosenImages.length > 0)
	return !("who" in v) && !("source" in v) && !("face" in v)
}

/** What a pin URL names: the file's uuid (`/media/<uuid>…`), its id in the older `/media/<id>` form, or nothing of ours. */
export function pinFileOf(
	src: string | null | undefined
): { uuid: string } | { id: number } | null {
	if (!src) return null
	const uuid =
		/^\/media\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[?#]|$)/.exec(
			src
		)
	if (uuid) return { uuid: uuid[1]!.toLowerCase() }
	const id = /^\/media\/(\d+)(?:[?#]|$)/.exec(src)
	return id ? { id: Number(id[1]) } : null
}

/** A gallery file as the seed reads it. */
export interface PinGalleryFile {
	id?: number
	uuid: string
}

/** What the pins came to: whom to show, the image each shows, and whether a read failed. */
export interface PinSeed {
	/** The pinned members' names, left pin first — a stage's two. */
	pickMembers: string[]
	/** Each pinned member's chosen image, `character:<id>=<uuid>`. */
	chosenImages: string[]
	/** A gallery could not be read: try again on the next open rather than drop the pins. */
	failed: boolean
}

/**
 * Match the pins, left then right, to the cast: a pin is one of a member's
 * gallery files (an avatar is one too), found by its uuid — by the member's
 * avatar first, then by reading galleries, each at most once. A member keeps
 * its first pin; a pin that pictures nobody here is dropped.
 */
export async function seedFromPins(
	pins: { left: string | null; right: string | null },
	members: readonly SessionCharacterV1[],
	readGallery: (characterId: number) => Promise<readonly PinGalleryFile[]>
): Promise<PinSeed> {
	const out: PinSeed = { pickMembers: [], chosenImages: [], failed: false }
	const galleries = new Map<number, readonly PinGalleryFile[]>()
	const galleryOf = async (m: SessionCharacterV1) => {
		if (!galleries.has(m.characterId))
			galleries.set(m.characterId, await readGallery(m.characterId))
		return galleries.get(m.characterId)!
	}
	for (const src of [pins.left, pins.right]) {
		const file = pinFileOf(src)
		if (!file) continue
		let found: { member: SessionCharacterV1; uuid: string } | null = null
		if ("uuid" in file) {
			const byFace = members.find((m) => {
				const face = pinFileOf(m.face)
				return !!face && "uuid" in face && face.uuid === file.uuid
			})
			if (byFace) found = { member: byFace, uuid: file.uuid }
		}
		for (const m of members) {
			if (found) break
			let gallery: readonly PinGalleryFile[]
			try {
				gallery = await galleryOf(m)
			} catch {
				out.failed = true
				return out
			}
			const hit = gallery.find((g) =>
				"uuid" in file
					? g.uuid.toLowerCase() === file.uuid
					: g.id === file.id
			)
			if (hit) found = { member: m, uuid: hit.uuid }
		}
		if (!found || chosenImagesOf(out.chosenImages).has(found.member.ref))
			continue
		out.pickMembers.push(found.member.name)
		out.chosenImages = withChosenImage(
			out.chosenImages,
			found.member.ref,
			found.uuid
		)
	}
	return out
}

/**
 * The settings one instance is given for the seed: its chosen images, and —
 * where it stored nothing of its own — who (the pinned members) and how (a
 * stage of chosen images): what it drew before. A key it stored is kept.
 */
export function seedPatch(
	stored: Readonly<Record<string, unknown>> | undefined,
	seed: PinSeed
): Record<string, unknown> {
	const v = stored ?? {}
	const who = "who" in v ? v.who : "pick"
	const patch: Record<string, unknown> = { chosenImages: seed.chosenImages }
	if (!("who" in v)) patch.who = "pick"
	if (who === "pick" && !("pickMembers" in v))
		patch.pickMembers = seed.pickMembers
	if (!("face" in v)) patch.face = "chosen"
	if (!("arrangement" in v)) patch.arrangement = "stage"
	return patch
}
