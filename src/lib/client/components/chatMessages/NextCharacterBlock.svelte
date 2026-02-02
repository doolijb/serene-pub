<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"

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
		class="preset-tonal-surface-100-900 border-surface-300-700 my-2 flex items-center justify-between rounded-full px-4"
	>
		<div class="flex items-center gap-3">
			<Avatar char={nextCharacter} />
			<div class="flex flex-col">
				<span class="text-surface-700-300 text-sm font-medium">
					{nextCharacter.nickname || nextCharacter.name}
				</span>
				<span class="text-surface-500 text-xs">ready to continue</span>
			</div>
		</div>
		<div class="flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={onContinueWithNextCharacter}
				title="Continue with {nextCharacter.nickname ||
					nextCharacter.name}"
			>
				<Icons.Play size={16} />
				Continue
			</button>
			<button
				class="btn btn-sm preset-tonal-surface-500"
				onclick={onChooseDifferentCharacter}
				title="Choose a different character"
			>
				<Icons.Users size={16} />
			</button>
		</div>
	</li>
{/if}
