<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		nextCharacter: SelectCharacter | undefined
		shouldShow: boolean
		onContinueWithNextCharacter: () => void
		onChooseDifferentCharacter: () => void
		/**
		 * Whether there is anyone else to hand the turn to. Defaults true so the
		 * control keeps its previous behaviour for any caller that doesn't pass
		 * it; a one-character chat has no alternative to choose.
		 */
		canChooseDifferentCharacter?: boolean
	}

	let {
		nextCharacter,
		shouldShow,
		onContinueWithNextCharacter,
		onChooseDifferentCharacter,
		canChooseDifferentCharacter = true
	}: Props = $props()
</script>

{#if shouldShow && nextCharacter}
	<li class="my-2 flex min-w-0 items-center justify-between gap-2 px-4">
		<div class="flex min-w-0 flex-col">
			<span class="text-surface-700-300 truncate text-sm font-medium">
				{nextCharacter.nickname || nextCharacter.name}
			</span>
			<span class="text-surface-700-300 text-xs">ready to continue</span>
		</div>
		<div class="flex shrink-0 gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={onContinueWithNextCharacter}
				title="Continue with {nextCharacter.nickname ||
					nextCharacter.name}"
			>
				<Icons.Play size={16} />
				<span class="hidden sm:inline">Continue</span>
			</button>
			{#if canChooseDifferentCharacter}
				<button
					class="btn btn-sm preset-tonal-primary"
					onclick={onChooseDifferentCharacter}
					title="Choose a different character"
				>
					<Icons.Users size={16} />
				</button>
			{/if}
		</div>
	</li>
{/if}
