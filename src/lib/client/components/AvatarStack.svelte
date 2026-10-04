<script lang="ts">
	import Avatar from "./Avatar.svelte"
	import { AVATAR_PX, type AvatarSize } from "./avatar"
	import * as Icons from "@lucide/svelte"

	/**
	 * A session's faces: up to `max` round avatars overlapping, the first on
	 * top (STYLE-GUIDE §6.4, "Avatars"; notes 36). Each is ringed in the ground
	 * it stands on, which is what separates one face from the next — pass that
	 * ground as `ring` (a row's `ring-surface-50-950`, a card's 100-900).
	 *
	 * Each face after the first is overlapped by 40% of its width, so a group
	 * of three takes 2.2 faces' width rather than three. A cast past `max`
	 * says how many more to a screen reader; the names are the caller's to
	 * show (a row's tooltip, a card's line).
	 */
	type Member = Partial<SelectCharacter> | null | undefined

	interface Props {
		members: Member[]
		size?: AvatarSize
		max?: number
		/** The ring's colour class: the ground the stack stands on. */
		ring?: string
		/** Reserve the width of a full stack, so names beside rows line up. */
		fixedWidth?: boolean
	}

	let {
		members,
		size = "md",
		max = 3,
		ring = "ring-surface-50-950",
		fixedWidth = false
	}: Props = $props()

	const shown = $derived(members.filter(Boolean).slice(0, max))
	const overflow = $derived(
		Math.max(0, members.filter(Boolean).length - max)
	)
	const px = $derived(AVATAR_PX[size])
	const overlap = $derived(Math.round(px * 0.4))
	const width = $derived(px + (max - 1) * (px - overlap))
</script>

<span
	class="flex shrink-0 items-center"
	style={fixedWidth ? `width: ${width}px` : undefined}
	data-avatar-stack
>
	{#if shown.length === 0}
		<span
			class="bg-surface-200-800 grid place-items-center rounded-full"
			style="width: {px}px; height: {px}px"
		>
			<Icons.MessageSquare
				size={Math.round(px * 0.45)}
				class="text-surface-600-400"
				aria-hidden="true"
			/>
		</span>
	{:else}
		{#each shown as member, i (i)}
			<span
				class="relative block shrink-0"
				style="z-index: {max - i}; {i > 0
					? `margin-left: -${overlap}px`
					: ''}"
			>
				<Avatar
					char={member}
					{size}
					shape="round"
					decorative
					class="ring-2 {ring}"
				/>
			</span>
		{/each}
	{/if}
	{#if overflow > 0}
		<span class="sr-only">and {overflow} more</span>
	{/if}
</span>
