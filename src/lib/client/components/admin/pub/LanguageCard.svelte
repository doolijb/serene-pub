<script lang="ts">
	/** The pub's default language (R5). */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
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

<section class="panel-card flex flex-col gap-3" aria-labelledby="language-heading">
	<h2 id="language-heading" class="text-sm font-medium">Language</h2>
	<p class="text-surface-600-400 text-sm">
		The language this pub is drawn in. Every user who has not chosen
		one of their own follows this, so changing it moves them — and only
		them; anyone with their own choice keeps it.
	</p>
	<LanguagePicker
		label="Default language"
		value={systemSettingsCtx.settings?.defaultLanguage ?? "en"}
		describedBy="default-language-note"
		onValueChange={handleDefaultLanguageChange}
	/>
	<p id="default-language-note" class="text-surface-600-400 text-sm">
		The language also decides which retrieval features apply: stemming is
		used for the languages a stemmer exists for, and trigram matching —
		which works for every language — for the rest. See the Languages
		documentation page.
	</p>
</section>
