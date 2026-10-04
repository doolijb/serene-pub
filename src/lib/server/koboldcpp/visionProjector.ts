/**
 * A managed KoboldCPP model's VISION PROJECTOR — the `mmproj` file KoboldCPP
 * loads beside a text model so it can read images (`--mmproj [filename]`;
 * `mmproj` in a .kcpps, not one of the args reload_config protects, so it has to
 * be written into the file every load — see `buildConfigContent`).
 *
 * ## Where it lives
 *
 * On the MODEL row, as `connection_models.extra_json.mmproj`: a projector
 * belongs to one model's architecture (a Gemma 3 projector is useless to a
 * Qwen), so an instance-wide setting would be wrong the moment a person
 * switched models. `extra_json` is the adapter's own bag and the pair merge
 * already carries the model's half to the adapter, so no column was needed.
 *
 * ⚠ `connections:updateModel` refuses `extraJson` from a client outright (an
 * API key written there would sit in plaintext). This one key is let through
 * as its own field, `visionProjector`, validated here as a bare `.gguf` file
 * name — the models folder is the only place it may point.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/** The longest name a person can mean; a filesystem caps it near here too. */
const MAX_NAME = 255

/**
 * What a client sent for `visionProjector`, read: a bare `.gguf` file name, or
 * `null` to clear it. Blank is clear.
 */
export function parseVisionProjector(
	input: unknown
): { value: string | null } | { error: string } {
	if (input == null) return { value: null }
	if (typeof input !== "string")
		return { error: "A vision projector is a file name." }
	const name = input.trim()
	if (!name) return { value: null }
	if (
		name.length > MAX_NAME ||
		/[\\/]/.test(name) ||
		name === "." ||
		name === ".." ||
		name.includes("\0")
	)
		return {
			error:
				"A vision projector is the name of a file in the models folder, with no folder in front of it."
		}
	if (!/\.gguf$/i.test(name))
		return {
			error: "A vision projector is a .gguf file (its name usually starts with mmproj)."
		}
	return { value: name }
}

/**
 * The model row's `extra_json` with the projector set or cleared. Every other
 * key is kept: the bag is the adapter's, and this writes one key of it.
 */
export function withVisionProjector(
	extraJson: Record<string, unknown> | null | undefined,
	value: string | null
): Record<string, unknown> {
	const { mmproj: _old, ...rest } = extraJson ?? {}
	return value ? { ...rest, mmproj: value } : rest
}

/** Only the managed KoboldCPP launches models, so only it has a projector. */
export function takesVisionProjector(endpointType: string): boolean {
	return endpointType === CONNECTION_TYPE.KOBOLDCPP_MANAGED
}
