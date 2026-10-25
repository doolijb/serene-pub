<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Pub › General — who this instance is and who may use it: its
	 * language, user accounts, messages between people, the shared
	 * community-library account, the
	 * instance-wide scripts switch, and how sessions write to lorebooks. Split out of the old one-page System settings (2026-09-27);
	 * each card owns its own save.
	 */
	import { getContext } from "svelte"
	import { adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import LanguageCard from "$lib/client/components/admin/pub/LanguageCard.svelte"
	import AutoTranslateCard from "$lib/client/components/admin/pub/AutoTranslateCard.svelte"
	import AccountsCard from "$lib/client/components/admin/pub/AccountsCard.svelte"
	import CharaVaultCard from "$lib/client/components/admin/pub/CharaVaultCard.svelte"
	import ScriptsCard from "$lib/client/components/admin/pub/ScriptsCard.svelte"
	import MessagingCard from "$lib/client/components/admin/pub/MessagingCard.svelte"
	import LoreWriteModeCard from "$lib/client/components/admin/pub/LoreWriteModeCard.svelte"
	import RoutineCapsCard from "$lib/client/components/settingsTabs/RoutineCapsCard.svelte"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	let translateDirty = $state(false)
	let charaVaultDirty = $state(false)

	/**
	 * Two cards buffer what is typed (a translation URL, a CharaVault
	 * credential); leaving the section while either differs from what is
	 * saved asks through the Admin view's dialog.
	 */
	adminUnsavedEdits(() => translateDirty || charaVaultDirty)
</script>

<div class="@container/view mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="General"
		doc={docsHref("system-settings", "general")}
		purpose="What this pub is called in, who may sign in to it, and the switches that apply to everyone on it."
	/>

	{#if systemSettingsCtx.settings}
		<!-- One card per setting (STYLE-GUIDE §6.4, setting cards). -->
		<div class="flex flex-col gap-3">
			<LanguageCard />
			<AutoTranslateCard bind:hasUnsavedChanges={translateDirty} />
			<!-- Android is single-user by design; the server refuses the
			     change regardless. -->
			{#if !systemSettingsCtx.settings.isAndroidWrapper}
				<AccountsCard />
				<!-- Messages need accounts, so they sit with them and are
				     absent where accounts are (Android). -->
				<MessagingCard />
			{/if}
			<CharaVaultCard bind:hasUnsavedChanges={charaVaultDirty} />
			<ScriptsCard />
			<LoreWriteModeCard />
			<!-- 🚧 The pub's two limits on real-time routines (R11; lane 7). -->
			<RoutineCapsCard scope="system" />

			{#if systemSettingsCtx.settings.isAndroidWrapper}
				<section class="panel-card flex flex-col gap-1" aria-labelledby="runtimes-heading">
					<h2 id="runtimes-heading" class="text-lead font-medium">
						Local model runtimes
					</h2>
					<p class="text-surface-600-400 text-chip">
						The Android app can't run Ollama, KoboldCPP or local
						embeddings; connect to remote ones in Models › Connections.
					</p>
				</section>
			{/if}
		</div>
	{:else}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{/if}
</div>
