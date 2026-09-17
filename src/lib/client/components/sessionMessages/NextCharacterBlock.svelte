<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"

	interface Props {
		nextCharacter: SelectCharacter | undefined
		shouldShow: boolean
		onContinueWithNextCharacter: () => void
		onChooseDifferentCharacter: () => void
		/**
		 * Whether there is anyone else to hand the turn to. Defaults true so a
		 * caller that doesn't pass it keeps the choice; a one-character session
		 * has no alternative to offer.
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

	let displayName = $derived(
		nextCharacter?.nickname || nextCharacter?.name || ""
	)
</script>

{#if shouldShow && nextCharacter}
	<!-- One line: who is up, and the two things you can do about it. -->
	<div class="my-2 flex min-w-0 items-center gap-2 px-4">
		<Avatar char={nextCharacter} size="w-6 h-6" />
		<span
			class="text-surface-700 dark:text-surface-300 min-w-0 truncate text-[13px] leading-[1.45]"
		>
			{displayName} is ready to continue
		</span>
		<div class="ml-auto flex shrink-0 items-center gap-1">
			{#if canChooseDifferentCharacter}
				<button
					type="button"
					class="composer-quiet-btn px-2"
					onclick={onChooseDifferentCharacter}
					title="Someone else"
					aria-label="Pick someone else to continue"
				>
					<Icons.Users size={14} aria-hidden="true" />
					<span class="max-sm:sr-only">Someone else</span>
				</button>
			{/if}
			<button
				type="button"
				class="btn composer-send preset-filled-primary-500"
				onclick={onContinueWithNextCharacter}
				title="Continue"
				aria-label="Continue with {displayName}"
			>
				<Icons.Play aria-hidden="true" />
				<span>Continue</span>
			</button>
		</div>
	</div>
{/if}
