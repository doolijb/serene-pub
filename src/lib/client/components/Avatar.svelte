<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		// Optional: the template below already treats a falsy `char` as the
		// "unknown" case (fallback icon + "Unknown" alt text), so callers that
		// haven't resolved a character yet (eg. a deleted reference)
		// can legitimately pass undefined.
		char: Partial<SelectCharacter> | undefined
		src?: string
		/**
		 * Sizing classes. REPLACES the default rather than merging, so pass a
		 * complete pair, eg. "w-12 h-12".
		 *
		 * Pass the size HERE rather than wrapping this component in a sized
		 * box: Skeleton's avatar hard-sizes its root, so a wrapper of a
		 * different size doesn't constrain it, it just gets overflowed. That
		 * was the wizard's "askew avatar" bug — a 4em (64px) avatar inside an
		 * h-12 w-12 (48px) wrapper, spilling 16px into the description text.
		 */
		size?: string
	}

	let {
		char = $bindable(),
		src = $bindable(),
		size = "w-[4em] h-[4em]"
	}: Props = $props()

	// Applied regardless of `size` so callers can't lose them by overriding.
	// shrink-0 stops the avatar being squashed when it's a direct flex child;
	// the min-w/min-h mirror whatever `size` asks for, so no call site has to
	// repeat them by hand.
	const sizeGuards = $derived(
		size
			.split(/\s+/)
			.filter(Boolean)
			.map((c) =>
				c.startsWith("w-") || c.startsWith("h-") ? `min-${c}` : ""
			)
			.filter(Boolean)
			.join(" ")
	)

	// `object-top` matches the thumbnail rule (`$lib/shared/media/frame`): both
	// keep the top of a portrait, so an image that still renders whole — a local
	// preview, a URL that is not ours — is cropped the same way as one the
	// server already cut.

	// The glyph reads the flag the row carries, never the row's shape (sniffing
	// `personality` / `scenario` / `firstMessage` misreads a lightweight view
	// object): `UserRound` for a
	// character the user plays, `UsersRound` for everyone else — the two glyphs
	// NOMENCLATURE fixes to those two ideas. A payload that did not join the
	// flag falls through to the character glyph, which is what it is.
	let isPersona = $derived(!!char && (char as any).isPersona === true)
</script>

<Avatar class="{size} {sizeGuards} shrink-0">
	<Avatar.Image
		src={src ? src : char ? avatarSrc(char) || undefined : undefined}
		alt={char
			? "nickname" in char && char.nickname
				? char.nickname
				: char.name!
			: "Unknown"}
		class="object-cover object-top"
	/>
	<!-- Fallback glyph scales with the avatar. It was a fixed size={36},
	     which overflowed any avatar smaller than ~40px. -->
	<Avatar.Fallback>
		{#if isPersona}
			<Icons.UserRound class="h-[55%] w-[55%]" />
		{:else}
			<Icons.UsersRound class="h-[55%] w-[55%]" />
		{/if}
	</Avatar.Fallback>
</Avatar>
