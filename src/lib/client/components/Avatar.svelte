<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		// Optional: the template below already treats a falsy `char` as the
		// "unknown" case (fallback icon + "Unknown" alt text), so callers that
		// haven't resolved a character/persona yet (eg. a deleted reference)
		// can legitimately pass undefined.
		char: Partial<SelectCharacter> | Partial<SelectPersona> | undefined
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
	// the min-w/min-h mirror whatever `size` asks for, which is what every
	// correct call site was previously repeating by hand.
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

	// Determine if this is a character or persona
	// Characters have specific fields that personas don't have like 'personality', 'scenario', 'firstMessage'
	// Personas have 'isDefault' field that characters don't have
	let isCharacter = $derived(
		char &&
			("personality" in char ||
				"scenario" in char ||
				"firstMessage" in char)
	)
</script>

<Avatar class="{size} {sizeGuards} shrink-0">
	<Avatar.Image
		src={src ? src : char ? avatarSrc(char) || undefined : undefined}
		alt={char
			? "nickname" in char && char.nickname
				? char.nickname
				: char.name!
			: "Unknown"}
		class="object-cover"
	/>
	<!-- Fallback glyph scales with the avatar. It was a fixed size={36},
	     which overflowed any avatar smaller than ~40px. -->
	<Avatar.Fallback>
		{#if isCharacter}
			<Icons.UsersRound class="h-[55%] w-[55%]" />
		{:else}
			<Icons.UserRound class="h-[55%] w-[55%]" />
		{/if}
	</Avatar.Fallback>
</Avatar>
