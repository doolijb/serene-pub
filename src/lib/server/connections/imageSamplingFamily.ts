/**
 * 🚧 **Use** and the image sampling preset (owner ruling 2026-11-08).
 *
 * Putting a model in an image loadout said nothing about how it is driven:
 * the loadout kept the seeded *SD 1.5 · 512²* preset, so the first picture
 * from an SDXL checkpoint was the doubled-torso mess. This decides the
 * preset the way P1 allows — from what code can READ, never from a guess:
 *
 *  - the managed KoboldCPP's image GGUF carries `general.architecture`
 *    (`sdxl`, `flux`, `sd1`…), the same key `modelKind.ts` classifies by; a
 *    family read there picks the matching core preset;
 *  - a `.safetensors`, a ComfyUI checkpoint or an A1111 one has no metadata
 *    this app reads — a file NAME is a guess, and a guess written into a
 *    loadout is a hidden decision — so the preset is left and the person is
 *    TOLD, in the Use toast, where to switch it.
 *
 * Only a loadout still on a core family preset is touched: a sampling config
 * the admin chose or made is theirs.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { capabilityDefault, setCapabilityDefault } from "./capabilityDefaults"

/** The core image presets (`db/defaults.ts`), by the GGUF architecture prefix that wants them. */
export const IMAGE_PRESET_FOR_ARCH: ReadonlyArray<readonly [prefix: string, seedKey: string]> = [
	["sdxl", "sampling-image-sdxl"],
	["sd3", "sampling-image-sd3"],
	["sd1", "sampling-image-default"],
	["sd2", "sampling-image-default"],
	["stable_diffusion", "sampling-image-default"],
	["flux", "sampling-image-flux"]
]

/** The seed-key prefix every core image family preset shares. */
const CORE_IMAGE_PRESET_PREFIX = "sampling-image-"

/** The preset an architecture wants, or null for one no core preset is written for. */
export function imagePresetForArchitecture(architecture: string | null | undefined): string | null {
	const arch = (architecture ?? "").trim().toLowerCase()
	if (!arch) return null
	const hit = IMAGE_PRESET_FOR_ARCH.find(([prefix]) => arch.startsWith(prefix))
	return hit?.[1] ?? null
}

/**
 * The family of the pair's model, read from file metadata — a managed
 * KoboldCPP image GGUF's `general.architecture` — or null when nothing can
 * be read (another connection type, a `.safetensors`, a missing file).
 */
export async function imagePresetFromModelFile(
	db: Db,
	pair: { connectionId: number; connectionModelId: number | null }
): Promise<string | null> {
	const connection = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, pair.connectionId)
	})
	if (!connection || connection.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE) return null
	const row =
		pair.connectionModelId != null
			? await db.query.connectionModels.findFirst({
					where: (m, { eq }) => eq(m.id, pair.connectionModelId!)
				})
			: null
	// The file is the MODEL row's (0128); an endpoint row names none.
	const file = row?.model
	if (!file || !file.toLowerCase().endsWith(".gguf")) return null
	try {
		const [{ resolveModelPath }, { readGgufMetadataWindow }, settings] = await Promise.all([
			import("$lib/server/koboldcpp/modelsDir"),
			import("$lib/server/koboldcpp/modelKind"),
			db.query.koboldCppSettings.findFirst()
		])
		if (!settings) return null
		const path = await resolveModelPath("image", file, settings, { mustExist: true })
		const metadata = await readGgufMetadataWindow(path)
		const arch = metadata?.get("general.architecture")
		return imagePresetForArchitecture(typeof arch === "string" ? arch : null)
	} catch {
		// Unreadable is "nothing read": the preset stays and the toast says so.
		return null
	}
}

/**
 * After a pair lands in an image transform's default loadout: swap a core
 * family preset to the one the model file says, or say that it stayed.
 * Returns the sentence for the Use toast, or null when there is nothing to
 * say (the loadout runs on the admin's own sampling config).
 */
export async function settleImageSamplingAfterUse(
	db: Db,
	capability: string,
	pair: { connectionId: number; connectionModelId: number | null }
): Promise<string | null> {
	const current = await capabilityDefault(db, capability)
	const samplingId = current?.samplingConfigId ?? null
	const sampling =
		samplingId != null
			? await db.query.samplingConfigs.findFirst({
					where: (s, { eq }) => eq(s.id, samplingId)
				})
			: null
	// Not a core family preset: the admin's choice, left alone and unmentioned.
	if (!sampling?.seedKey?.startsWith(CORE_IMAGE_PRESET_PREFIX)) return null

	const wanted = await imagePresetFromModelFile(db, pair)
	if (!wanted) {
		return `Sampling stays ${sampling.name} — switch it on the loadout if this is an SDXL, SD 3 or Flux model.`
	}
	if (wanted === sampling.seedKey) return `Sampling is ${sampling.name}, read from the model file.`
	const [target] = await db
		.select({ id: schema.samplingConfigs.id, name: schema.samplingConfigs.name })
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, wanted))
		.limit(1)
	if (!target) return null
	await setCapabilityDefault(db, capability, { samplingConfigId: target.id })
	return `Sampling set to ${target.name}, read from the model file.`
}
