<script lang="ts">
	/**
	 * The character scene portraits, refactored from fixed viewport overlays
	 * into a real surface-grid panel (plan 21). Previously `leftSceneImage` /
	 * `rightSceneImage` were painted `position:fixed` at the screen edges behind
	 * the sidebars (Layout.svelte); now they live in a panel that flows,
	 * resizes, and drawers with everything else. The images are still *set* from
	 * the avatar gallery modal (which writes the shared `sceneImages` store);
	 * this panel is their new home for display and clearing.
	 */
	import * as Icons from "@lucide/svelte"
	import { sceneImages } from "$lib/client/stores/sceneImages"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId }: Props = $props()

	function clear(side: "left" | "right") {
		sceneImages.update((s) => ({ ...s, [side]: null }))
		// Mirror the page's persistence so a clear survives reload.
		if (sessionId == null) return
		const s = { ...$sceneImages, [side]: null }
		try {
			if (s.left || s.right)
				localStorage.setItem(
					`sceneImages:${sessionId}`,
					JSON.stringify(s)
				)
			else localStorage.removeItem(`sceneImages:${sessionId}`)
		} catch {}
	}

	let hasAny = $derived(!!$sceneImages.left || !!$sceneImages.right)
</script>

<div class="flex h-full flex-col p-2">
	{#if !hasAny}
		<div
			class="text-surface-500 flex h-full flex-col items-center justify-center gap-2 text-center text-xs"
		>
			<Icons.Users size={22} />
			<span>
				No scene portraits set. Click a character's avatar in the chat to
				pin one here.
			</span>
		</div>
	{:else}
		<div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
			{#each ["left", "right"] as const as side}
				{@const src = $sceneImages[side]}
				<div class="relative flex min-h-0 items-end justify-center">
					{#if src}
						<img
							{src}
							alt="{side} scene portrait"
							class="max-h-full w-full object-contain object-bottom drop-shadow-lg"
						/>
						<button
							class="btn-icon preset-tonal-surface btn-icon-sm absolute top-1 right-1 opacity-70 hover:opacity-100"
							onclick={() => clear(side)}
							title="Clear {side} portrait"
							aria-label="Clear {side} portrait"
						>
							<Icons.X size={13} />
						</button>
					{:else}
						<div
							class="border-surface-300-700 text-surface-500 flex h-full w-full items-center justify-center rounded-lg border border-dashed text-[11px]"
						>
							Empty
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
