<script lang="ts">
	import { getContext } from "svelte"
	import { t } from "$lib/client/i18n/state.svelte"
	import { DISPLAY_NAME_MAX_LENGTH } from "$lib/shared/validation/displayName"

	/**
	 * The welcome screen's "What should we call you?" field. It shows only to
	 * someone with no display name yet and is never required; the wizard
	 * saves it with `saveWelcomeName` as it moves on, and skips an empty one.
	 */
	interface Props {
		value?: string
	}

	let { value = $bindable("") }: Props = $props()

	const userCtx: UserCtx = getContext("userCtx")

	let hasName = $derived(!!userCtx?.user?.displayName?.trim())
</script>

{#if userCtx?.user && !hasName}
	<div class="mx-auto flex w-full max-w-sm flex-col gap-2">
		<label for="wizard-display-name" class="font-semibold">
			{t("What should we call you?")}
		</label>
		<input
			id="wizard-display-name"
			type="text"
			class="input"
			autocomplete="nickname"
			maxlength={DISPLAY_NAME_MAX_LENGTH}
			aria-describedby="wizard-display-name-note"
			bind:value
		/>
		<p id="wizard-display-name-note" class="text-surface-600-400 text-sm">
			{t(
				"This is the name the characters will see. You can change it later in Settings."
			)}
		</p>
	</div>
{/if}
