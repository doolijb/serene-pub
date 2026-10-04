<script lang="ts">
	import Avatar from "$lib/client/components/Avatar.svelte"
	import type { AvatarSize } from "$lib/client/components/avatar"
	import type { CastKind } from "../castPool"

	/**
	 * A cast member's face (note 7, 2026-10-02) — the app's one `Avatar`
	 * (notes 36) in its identity shape, the rounded square a character row
	 * uses: the linked card's avatar; a carded member with no picture gets the
	 * character or persona glyph, and a background member — who has no card —
	 * their initial.
	 */
	interface Props {
		name: string
		kind: CastKind
		src?: string
		/** A step of the avatar scale; `md` (40px) is a list row's. */
		size?: AvatarSize
	}

	let { name, kind, src, size = "md" }: Props = $props()
</script>

<span
	class="contents"
	data-cast-avatar={src ? "image" : kind === "background" ? "initial" : "glyph"}
>
	<Avatar
		{src}
		{name}
		{size}
		decorative
		fallback={kind === "background" ? "initial" : "glyph"}
		kind={kind === "persona" ? "persona" : "character"}
	/>
</span>
