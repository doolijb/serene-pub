<script lang="ts">
	/** The pub's default language (R5). */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	function handleDefaultLanguageChange(language: string) {
		if (!language || !requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateDefaultLanguage", { language })
	}
</script>

<SettingCard
	title="Language"
	titleId="language-heading"
	headingLevel={2}
	helpId="default-language-note"
>
	{#snippet help()}
		Everyone without a language of their own follows this one.
		<a
			class="anchor"
			href={docsHref("languages", "for-power-users-language-and-lore-search")}
		>
			How language affects search
		</a>
	{/snippet}
	<LanguagePicker
		label="Default language"
		labelHidden
		value={systemSettingsCtx.settings?.defaultLanguage ?? "en"}
		describedBy="default-language-note"
		onValueChange={handleDefaultLanguageChange}
	/>
</SettingCard>
