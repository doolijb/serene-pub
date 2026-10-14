<!--
	@component
	The readiness strip (PLAN-models-view-admin-bridge lane D): one line above
	the composer while the chat job has no model, so a member learns why the
	session will not reply where they are, not in a view they cannot open.

	Same dot and words as the Models view's chat strip (`StatusStrip`): the
	`unfinished` dot (gold) and *Sessions can't reply yet.* It reads only the
	capability defaults every client holds, so it never says *broken* — that
	takes admin-only facts. An admin gets **Fill the Reply loadout**, which opens Loadouts
	on the Reply loadout's sheet (`digest.connectionsJob = "text->text"`).
-->
<script lang="ts">
	import { getContext } from "svelte"
	import {
		CONNECTION_STATE_DOT,
		CONNECTION_STATE_LABEL
	} from "$lib/client/components/connections/connectionRowStatus"
	import { readinessStripState } from "./readinessStrip"

	interface Props {
		/** The composer is there to type into (not read-only, not a genre without one). */
		show: boolean
	}

	let { show }: Props = $props()

	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	const userCtx: UserCtx | undefined = getContext("userCtx")
	const panelsCtx: PanelsCtx | undefined = getContext("panelsCtx")

	const strip = $derived(
		show
			? readinessStripState(
					// `capabilityDefaults` starts as `{}`: until settings
					// arrive, an empty map is "not known", not "unset".
					systemSettingsCtx?.settings
						? systemSettingsCtx.capabilityDefaults
						: null,
					!!userCtx?.user?.isAdmin && !!panelsCtx
				)
			: null
	)

	function setUpChat() {
		if (!panelsCtx) return
		// The chat job is the Reply loadout's sheet (I12).
		panelsCtx.digest.connectionsJob = "text->text"
		panelsCtx.openPanel({ key: "loadouts", toggle: false })
	}
</script>

{#if strip}
	<div
		class="preset-tonal-surface flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
		role="status"
		data-state="unfinished"
	>
		<span
			class="ring-primary-500/20 size-2.5 shrink-0 rounded-full ring-3 {CONNECTION_STATE_DOT.unfinished}"
			title={CONNECTION_STATE_LABEL.unfinished}
			aria-hidden="true"
		></span>
		<p class="min-w-0 flex-1 truncate" title={`${strip.headline} ${strip.sentence}`}>
			<span class="font-semibold">{strip.headline}</span>
			<span class="text-surface-700-300">{strip.sentence}</span>
		</p>
		{#if strip.action}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 shrink-0 text-xs"
				onclick={setUpChat}
			>
				{strip.action.label}
			</button>
		{/if}
	</div>
{/if}
