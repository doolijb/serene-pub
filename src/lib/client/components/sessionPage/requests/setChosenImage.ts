/**
 * 🚧 `set-chosen-image` (F2, 2026-10-11 — W6 ruling 1): core's Scene
 * Portraits chooses the image one member's face shows. Core's widgets only
 * (the askers table, `./askers.ts`): it writes the asking widget's own
 * settings, which a plugin's copy writes through its own actions.
 *
 * Written into the ASKING instance's settings — `from.widgetId` is the
 * instance id its panel mounted it under (`Panel.svelte` → `RemoteWidget` →
 * the wire's `from`) — as the viewer's own values: `chosenImages` with this
 * member's pair set (or taken out, for null) by `withChosenImage`, the
 * catalogue's one writer of that list, and handed to `patchWidgetSettings`,
 * which prunes against the instance's declaration and persists in one write.
 * Nothing comes back in the reply: the new settings reach the widget as its
 * `settings` section, and its face follows.
 *
 * Refused, in words, for a member not in the session's cast, a ref that is
 * not one, or an instance whose settings hold no chosen images.
 */
import type { SessionCharactersV1, WidgetRequests } from "@serene-pub/sdk"
import { withChosenImage } from "@serene-pub/core-catalog/scene-portraits"

type Params = WidgetRequests["set-chosen-image"]["params"]

/** The page's per-instance settings, as this answer reads and writes them. */
export interface InstanceSettings {
	/** Does this instance's declaration have the setting `key`? */
	declares(instanceId: string, key: string): boolean
	/** The instance's stored values (this person's own). */
	values(instanceId: string): Record<string, unknown>
	/** Write a patch of fields onto the instance (`patchWidgetSettings`). */
	patch(instanceId: string, patch: Record<string, unknown>): void
}

export interface SetChosenImageDeps {
	/** The cast the page projects — who may be named. */
	characters(): SessionCharactersV1 | undefined
	settings: InstanceSettings
}

/** A member ref the cast names its people by. */
const MEMBER_REF = /^character:\d+$/

/** Answer one `set-chosen-image` for the asking instance. */
export function answerSetChosenImage(
	params: Params,
	from: { widgetId: string },
	d: SetChosenImageDeps
): void {
	const p = (params ?? {}) as Partial<Params>
	const member =
		typeof p.characterRef === "string" ? p.characterRef.trim() : ""
	if (!MEMBER_REF.test(member))
		throw new Error("set-chosen-image names a member as character:<id>")
	const image =
		p.mediaRef === null
			? null
			: typeof p.mediaRef === "string"
				? p.mediaRef.trim()
				: undefined
	// A ref holds no `=`: the stored pair is `character:<id>=<ref>`.
	if (image === undefined || image === "" || image?.includes("="))
		throw new Error(
			"set-chosen-image takes an image's ref, or null for none"
		)
	const cast = d.characters()
	if (!cast) throw new Error("the session's cast has not arrived yet")
	if (!cast.members.some((m) => m.ref === member))
		throw new Error("that character is not in this session")
	const instance = from?.widgetId
	if (!instance || !d.settings.declares(instance, "chosenImages"))
		throw new Error("this widget keeps no chosen images")
	const stored = d.settings.values(instance).chosenImages
	const current = Array.isArray(stored)
		? stored.filter((e): e is string => typeof e === "string")
		: []
	d.settings.patch(instance, {
		chosenImages: withChosenImage(current, member, image)
	})
}
