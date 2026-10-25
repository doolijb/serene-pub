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
	 * shows how many more as a small `+n` notch on the last face's corner
	 * (PLAN-0-5-polish-parity L6, 2026-10-24: "max 3 + '+n'") — on the
	 * corner, so it costs no width and a `fixedWidth` slot still lines names
	 * up — and says it to a screen reader; the names are the caller's to
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
		/**
		 * What a face with no picture shows: the kind's glyph (characters,
		 * the default) or the name's initial (people, who have no picture —
		 * the Messages view's faces).
		 */
		fallback?: "glyph" | "initial"
	}

	let {
		members,
		size = "md",
		max = 3,
		ring = "ring-surface-50-950",
		fixedWidth = false,
		fallback = "glyph"
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
	class="relative flex shrink-0 items-center"
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
					{fallback}
					decorative
					class="ring-2 {ring}"
				/>
			</span>
		{/each}
	{/if}
	{#if overflow > 0}
		<!-- Ringed in the same ground as the faces, so it reads as a notch.
		     11px: the scale's count row (STYLE-GUIDE §3.2). -->
		<span
			class="bg-surface-300-700 text-surface-950-50 absolute -right-1 -bottom-1 z-10 rounded-full px-1 text-meta leading-4 font-medium tabular-nums ring-2 {ring}"
			data-avatar-stack-more
			aria-hidden="true"
		>
			+{overflow}
		</span>
		<span class="sr-only">and {overflow} more</span>
	{/if}
</span>
