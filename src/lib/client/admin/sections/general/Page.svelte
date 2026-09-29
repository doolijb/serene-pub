<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Instance › General — who this instance is and who may use it: its
	 * language, user accounts, the shared community-library account, and
	 * the instance-wide scripts switch. Split out of the old one-page System settings (2026-09-27);
	 * each card owns its own save.
	 */
	import { getContext } from "svelte"
	import { adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import LanguageCard from "$lib/client/components/admin/instance/LanguageCard.svelte"
	import AutoTranslateCard from "$lib/client/components/admin/instance/AutoTranslateCard.svelte"
	import AccountsCard from "$lib/client/components/admin/instance/AccountsCard.svelte"
	import CharaVaultCard from "$lib/client/components/admin/instance/CharaVaultCard.svelte"
	import ScriptsCard from "$lib/client/components/admin/instance/ScriptsCard.svelte"

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
		purpose="What this instance is called in, who may sign in to it, and the switches that apply to everyone on it."
	/>

	{#if systemSettingsCtx.settings}
		<div class="flex flex-col gap-4">
			<LanguageCard />
			<AutoTranslateCard bind:hasUnsavedChanges={translateDirty} />
			<!-- Android is single-user by design; the server refuses the
			     change regardless. -->
			{#if !systemSettingsCtx.settings.isAndroidWrapper}
				<AccountsCard />
			{/if}
			<CharaVaultCard bind:hasUnsavedChanges={charaVaultDirty} />
			<ScriptsCard />

			{#if systemSettingsCtx.settings.isAndroidWrapper}
				<section class="panel-card flex flex-col gap-2" aria-labelledby="runtimes-heading">
					<h2 id="runtimes-heading" class="text-sm font-medium">
						Local model runtimes
					</h2>
					<p class="text-surface-600-400 text-sm">
						Serene Pub can't run Ollama or KoboldCPP for you in the
						Android app — both depend on locally-run binaries this
						build can't bundle. Connect to a remote Ollama or
						KoboldCPP in Models › Connections instead. Local
						embeddings aren't available either, but an external
						embeddings API works fine.
					</p>
				</section>
			{/if}

			<p class="text-surface-600-400 text-sm">
				Embeddings moved to <a class="anchor" href="/admin/defaults">Models › Defaults</a>.
			</p>
		</div>
	{:else}
		<p class="text-surface-600-400 text-sm">Loading…</p>
	{/if}
</div>
