<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * Automatic translation of the app's own interface strings.
	 *
	 * The LibreTranslate URL is buffered rather than emitted per keystroke —
	 * half a URL is not a setting — so the card reports it as unsaved until
	 * Save URL, and the page's navigation guard warns on the way out.
	 */
	import { getContext, untrack } from "svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import SettingSwitch from "./SettingSwitch.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"
	import { requireAdmin } from "./requireAdmin"

	interface Props {
		hasUnsavedChanges?: boolean
	}
	let { hasUnsavedChanges = $bindable(false) }: Props = $props()

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let endpointField = $state("")
	const edits = new UnsavedEdits(() => endpointField.trim())
	/**
	 * The saved URL as a string, so the field follows it only when IT moves —
	 * not on every settings push (toggling the switch re-sends the whole
	 * settings object, which would wipe a half-typed URL). A clean field
	 * takes the new value; a field being typed in keeps its text.
	 */
	let savedEndpoint = $derived(
		systemSettingsCtx.settings?.autoTranslateEndpoint ?? ""
	)
	$effect(() => {
		const next = savedEndpoint
		untrack(() => edits.adoptSaved(next, (v) => (endpointField = v)))
	})
	$effect(() => {
		hasUnsavedChanges = edits.dirty
	})
	$effect(() => () => (hasUnsavedChanges = false))

	function save(next: {
		enabled?: boolean
		engine?: "google" | "libre"
		endpoint?: string | null
	}) {
		if (!requireAdmin(userCtx.user)) return
		const settings = systemSettingsCtx.settings
		socket?.emit("systemSettings:updateAutoTranslate", {
			enabled: next.enabled ?? settings?.autoTranslateEnabled ?? false,
			engine:
				next.engine ??
				((settings?.autoTranslateEngine ?? "google") as
					| "google"
					| "libre"),
			endpoint:
				next.endpoint !== undefined
					? next.endpoint
					: endpointField.trim() || null
		})
	}
</script>

<!-- The service and its address follow the switch, full width under it
     (`below`), only while it is on. -->
{#snippet service()}
	<div class="text-foreground flex flex-col gap-3 text-sm">
		<Select
			label="Translation service"
			options={[
				{ value: "google", label: "Google Translate (no account needed)" },
				{ value: "libre", label: "LibreTranslate (self-hostable)" }
			]}
			value={systemSettingsCtx.settings?.autoTranslateEngine ?? "google"}
			onValueChange={(v) => save({ engine: v as "google" | "libre" })}
		/>
		{#if systemSettingsCtx.settings?.autoTranslateEngine === "libre"}
			<label class="label">
				<span class="label-text text-surface-600-400 text-xs">
					LibreTranslate URL
				</span>
				<input
					class="input"
					type="url"
					placeholder="https://translate.example.org/translate"
					aria-describedby="libre-url-note"
					bind:value={endpointField}
				/>
			</label>
			<FieldHelp id="libre-url-note">
				Your own LibreTranslate keeps everything on your network; empty
				uses the public one.
			</FieldHelp>
			<button
				type="button"
				class="btn preset-filled-primary-500 w-fit"
				onclick={() => save({})}
			>
				Save URL
			</button>
		{/if}
	</div>
{/snippet}

<SettingCard
	title="Automatic translation"
	titleId="auto-translate-heading"
	headingLevel={2}
	help="Interface strings with no translation are sent to a service once and kept; sessions, characters and lore never are."
	layout="switch"
	below={systemSettingsCtx.settings?.autoTranslateEnabled ? service : undefined}
>
	<SettingSwitch
		name="enable-auto-translate"
		label="Automatic translation"
		labelHidden
		checked={systemSettingsCtx.settings?.autoTranslateEnabled ?? false}
		onCheckedChange={(e) => save({ enabled: e.checked })}
	/>
</SettingCard>
