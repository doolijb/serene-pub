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
 * The member is named by 🚧 `memberRef` (`seated-member:<castMemberId>`,
 * ★S3-8) or ⏳ `characterRef` (`character:<id>`), and FOUND in the cast the
 * page projects — never parsed: a `memberRef` matches the member whose host-
 * filled `ref` it is (exact `ref` wins), else whose `castMemberId` formats to it. The pair is
 * stored under the found member's own `ref`, the form the host emits (member
 * form from the flip, whose boot pass rekeys old lines; ⏳ card form before),
 * so nothing stored changes form here.
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

/** ⏳ A card-form member ref (`characterRef`). */
const CHARACTER_REF = /^character:\d+$/
/** 🚧 A member-form ref (`memberRef`): the prefix and something after it. */
const MEMBER_PREFIX = "seated-member:"

/** Answer one `set-chosen-image` for the asking instance. */
export function answerSetChosenImage(
	params: Params,
	from: { widgetId: string },
	d: SetChosenImageDeps
): void {
	const p = (params ?? {}) as Partial<Params>
	const byMember = typeof p.memberRef === "string"
	const named = (
		byMember
			? p.memberRef
			: typeof p.characterRef === "string"
				? p.characterRef
				: ""
	)!.trim()
	if (
		byMember
			? !named.startsWith(MEMBER_PREFIX) ||
				named.length === MEMBER_PREFIX.length
			: !CHARACTER_REF.test(named)
	)
		throw new Error(
			"set-chosen-image names a member as memberRef (seated-member:<id>), or characterRef (character:<id>)"
		)
	const image =
		p.mediaRef === null
			? null
			: typeof p.mediaRef === "string"
				? p.mediaRef.trim()
				: undefined
	// A ref holds no `=`: the stored pair is `<member's ref>=<image ref>`,
	// the member's ref as the host emits it (`seated-member:<id>` / `player-seat:<id>` from the flip; ⏳ `character:<id>` before).
	if (image === undefined || image === "" || image?.includes("="))
		throw new Error(
			"set-chosen-image takes an image's ref, or null for none"
		)
	const cast = d.characters()
	if (!cast) throw new Error("the session's cast has not arrived yet")
	// An exact `ref` wins; only then the member whose `castMemberId` formats to
	// it — a K-2 member in both seats is two members with one `castMemberId`,
	// and `named` is the character seat's ref.
	const found = byMember
		? (cast.members.find((m) => m.ref === named) ??
			cast.members.find(
				(m) =>
					m.castMemberId != null &&
					`${MEMBER_PREFIX}${m.castMemberId}` === named
			))
		: cast.members.find((m) => m.ref === named)
	if (!found) throw new Error("that character is not in this session")
	const member = found.ref
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
