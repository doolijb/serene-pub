<script lang="ts">
	/**
	 * `sp-avatar` — a participant's avatar, by reference; the page supplies
	 * the lookup. It keeps its own parts (`.sp-avatar-image`,
	 * `.sp-avatar-fallback`: the host-element contract plugins style), but
	 * draws them on the app's avatar scale and rules (STYLE-GUIDE §6.4, notes
	 * 36): a face among faces is round, cropped from the top, and a missing
	 * picture is the initial on the surface ground. `sm` · `md` · `lg` are the
	 * scale's xs 24 · sm 32 · lg 56.
	 */
	import type { SpElementProps } from "./spElement.svelte"
	import { hostElementContext } from "./context.svelte"
	import {
		AVATAR_PX,
		avatarInitial,
		type AvatarSize
	} from "$lib/client/components/avatar"

	let { attrs }: SpElementProps = $props()
	const who = $derived(
		attrs.ref ? (hostElementContext.participant?.(attrs.ref) ?? null) : null
	)
	const STEP: Record<string, AvatarSize> = { sm: "xs", md: "sm", lg: "lg" }
	const px = $derived(AVATAR_PX[STEP[attrs.size ?? "md"] ?? "sm"])
	const initial = $derived(avatarInitial(who?.name))

	/** The one address that failed, so a new picture is tried afresh. */
	let failedUrl: string | null = $state(null)
	const showImage = $derived(!!who?.avatarUrl && failedUrl !== who.avatarUrl)
</script>

<span
	class="sp-avatar-frame bg-surface-200-800 text-surface-700-300 rounded-full"
	role="img"
	aria-label={who?.name ?? "Avatar"}
	style:display="inline-grid"
	style:place-items="center"
	style:overflow="hidden"
	style:inline-size="{px}px"
	style:block-size="{px}px"
	data-avatar-px={px}
>
	{#if showImage}
		<img
			class="sp-avatar-image"
			src={who?.avatarUrl}
			alt=""
			style="inline-size:100%;block-size:100%;object-fit:cover;object-position:top"
			onerror={() => (failedUrl = who?.avatarUrl ?? null)}
		/>
	{:else}
		<span
			class="sp-avatar-fallback font-semibold"
			style:font-size="{Math.round(px * 0.42)}px"
			aria-hidden="true"
		>
			{initial}
		</span>
	{/if}
</span>
