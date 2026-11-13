/**
 * Co-loading a text and an image model in the managed KoboldCPP (owner ruling
 * 2026-11-11: "yes, make sure it's manageable via the admin").
 *
 * koboldcpp holds both when one .kcpps names `model` and `sdmodel`
 * (`modelManager.ts`, `planResidency`). Whether to is a SCHEDULING decision,
 * made here and nowhere else, by measurement and never by guess (P1):
 *
 *  - the admin's switch, `koboldcpp_settings.koboldcpp_managed_co_load`
 *    (on by default; off = one slot, the two swap as before);
 *  - the graphics memory free NOW, with the resident model in place
 *    (`freeGpuMemoryGib`, nvidia-smi) — no figure, no co-load;
 *  - what the incoming model needs: an image model's `recommended_vram` from
 *    the list (`image.yaml`), a text model's file size plus a fixed working
 *    allowance for its context — no figure, no co-load;
 *  - a headroom of one GiB, so the sampler is never squeezed to the byte.
 *
 * The answer carries its cause in words, for the log and the card.
 */

/** GiB kept free beyond the incoming model's own need. */
export const CO_LOAD_HEADROOM_GIB = 1

/** A text model's working memory beyond its weights (KV cache, scratch), GiB. */
export const TEXT_WORKING_GIB = 1.5

export interface CoLoadQuestion {
	/** The kind being loaded. */
	kind: "text" | "image"
	/** The other kind's resident file, when one is loaded. */
	residentOther: string | null
	/** The admin's switch. */
	enabled: boolean
	/** Free graphics memory now, GiB; null when nothing could measure it. */
	freeGib: number | null
	/** What the incoming model needs, GiB; null when nothing says. */
	needGib: number | null
}

export interface CoLoadAnswer {
	/** Keep the other kind resident beside this load. */
	keep: boolean
	/** Why, in one sentence. */
	reason: string
}

export function decideCoLoad(q: CoLoadQuestion): CoLoadAnswer {
	const other = q.kind === "text" ? "image" : "text"
	if (!q.residentOther) return { keep: false, reason: `No ${other} model is loaded.` }
	if (!q.enabled)
		return {
			keep: false,
			reason: `Keeping both models loaded is switched off, so the ${other} model is unloaded first.`
		}
	if (q.freeGib == null)
		return {
			keep: false,
			reason: `No measure of free graphics memory, so the ${other} model is unloaded first.`
		}
	if (q.needGib == null)
		return {
			keep: false,
			reason: `No figure for what the ${q.kind} model needs, so the ${other} model is unloaded first.`
		}
	const wanted = q.needGib + CO_LOAD_HEADROOM_GIB
	const free = Math.round(q.freeGib * 10) / 10
	if (q.freeGib >= wanted)
		return {
			keep: true,
			reason: `Kept the ${other} model loaded: ${free} GiB free, the ${q.kind} model needs about ${q.needGib} GiB.`
		}
	return {
		keep: false,
		reason: `Unloaded the ${other} model first: ${free} GiB free, the ${q.kind} model needs about ${q.needGib} GiB plus headroom.`
	}
}

/** A text model's need from its file size: weights plus working memory. */
export function textNeedGib(fileBytes: number | null | undefined): number | null {
	if (!fileBytes || !Number.isFinite(fileBytes) || fileBytes <= 0) return null
	return Math.round((fileBytes / 1024 ** 3 + TEXT_WORKING_GIB) * 10) / 10
}
