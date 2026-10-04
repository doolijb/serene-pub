/** The avatar scale and helpers, shared by `Avatar.svelte` and the faces built on it. */

/**
 * The avatar scale (STYLE-GUIDE §6.4, "Avatars"; notes 36, 2026-10-02).
 * Fixed pixels, so a face is the same size wherever the same job puts it.
 *
 *   xs 24 — an inline mention, a chip, the session header's faces
 *   sm 32 — a one-line chip, a relationship line, a detail's cast list
 *   md 40 — a list or picker row (characters, cast, sessions)
 *   lg 56 — a card's faces, a picker card in a select modal
 *   xl 72 — a detail's hero (DetailHero's tile)
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl"

export const AVATAR_PX: Readonly<Record<AvatarSize, number>> = {
	xs: 24,
	sm: 32,
	md: 40,
	lg: 56,
	xl: 72
}

/** The letter a face without a picture shows. */
export function avatarInitial(name: string | null | undefined): string {
	return ((name ?? "").trim().charAt(0) || "?").toUpperCase()
}
