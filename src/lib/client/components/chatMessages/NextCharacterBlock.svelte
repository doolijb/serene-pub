<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		nextCharacter: SelectCharacter | undefined
		shouldShow: boolean
		onContinueWithNextCharacter: () => void
		onChooseDifferentCharacter: () => void
	}

	let {
		nextCharacter,
		shouldShow,
		onContinueWithNextCharacter,
		onChooseDifferentCharacter
	}: Props = $props()
</script>

{#if shouldShow && nextCharacter}
	<li
		class="my-2 flex min-w-0 items-center justify-between gap-2 px-4"
	>
		<div class="flex min-w-0 flex-col">
			<span class="text-surface-700-300 truncate text-sm font-medium">
				{nextCharacter.nickname || nextCharacter.name}
			</span>
			<span class="text-surface-500 text-xs">ready to continue</span>
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
			<button
				class="btn btn-sm preset-tonal-primary"
				onclick={onChooseDifferentCharacter}
				title="Choose a different character"
			>
				<Icons.Users size={16} />
			</button>
		</div>
	</li>
{/if}
