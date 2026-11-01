<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { acppBackendLabel } from "$lib/client/components/connections/managedConnectionView"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		diffSettings,
		draftsFrom,
		runsOnLine,
		type SettingsDrafts
	} from "./audioCppSettingsFields"

	interface Props {
		onChangeBinary?: () => void
	}
	let { onChangeBinary }: Props = $props()

	const socket = useTypedSocket()
	const ctx = getContext<AudioCppSettingsCtx | undefined>("audioCppSettingsCtx")
	let settings = $derived(ctx?.settings)

	type Field = keyof SettingsDrafts

	let drafts = $state<SettingsDrafts>({
		port: 5002,
		modelsDir: "",
		idleSeconds: null,
		maxLoadedModels: null,
		subprocessTimeoutMinutes: 0
	})
	/** What each draft was last seeded with; a field is re-seeded only while the person has not typed in it. */
	let seeded: SettingsDrafts | null = null
	let saving = $state<Field | null>(null)

	$effect(() => {
		const s = settings
		if (!s) return
		const next = draftsFrom(s)
		const prev = seeded
		for (const k of Object.keys(next) as Field[]) {
			if (!prev || drafts[k] === prev[k]) {
				;(drafts as Record<Field, unknown>)[k] = next[k]
			}
		}
		seeded = next
	})

	/** The payload one field's Save sends: the diff, narrowed to that field. */
	const FIELD_KEYS: Record<Field, keyof Sockets.AudioCpp.EditableSettings> = {
		port: "port",
		modelsDir: "modelsDir",
		idleSeconds: "idleUnloadMs",
		maxLoadedModels: "maxLoadedModels",
		subprocessTimeoutMinutes: "subprocessTimeoutMinutes"
	}

	function patchFor(field: Field): Sockets.AudioCpp.UpdateSettings.Params {
		if (!settings) return {}
		const all = diffSettings(settings, drafts)
		const key = FIELD_KEYS[field]
		return key in all ? ({ [key]: all[key] } as typeof all) : {}
	}

	function isDirty(field: Field): boolean {
		return Object.keys(patchFor(field)).length > 0
	}

	function save(field: Field) {
		const patch = patchFor(field)
		if (!Object.keys(patch).length) return
		saving = field
		socket.emit("audiocpp:updateSettings", patch)
	}

	function handleUpdated() {
		saving = null
	}
	function handleUpdateError() {
		saving = null
	}
	useInterest<"audiocpp:updateSettings">(
		"audiocpp:updateSettings",
		handleUpdated
	)
	useInterest<"audiocpp:updateSettings:error">(
		"audiocpp:updateSettings:error",
		handleUpdateError
	)
</script>

{#snippet saveButton(field: Field)}
	<button
		class="btn btn-sm preset-filled-primary-500 text-xs"
		onclick={() => save(field)}
		disabled={saving !== null || !isDirty(field)}
	>
		{#if saving === field}<Icons.Loader2
				size={12}
				class="animate-spin"
			/>{:else}Save{/if}
	</button>
{/snippet}

{#if !settings}
	<div class="flex items-center gap-2 p-3 text-sm">
		<Icons.Loader2 size={14} class="animate-spin" />
		Loading settings…
	</div>
{:else}
	<div class="flex flex-col gap-5 p-3">
		<div>
			<label class="text-surface-600-400 mb-2 text-xs" for="acppPort">
				Port
			</label>
			<div class="panel-actions">
				<input
					id="acppPort"
					type="number"
					min="1024"
					max="65535"
					bind:value={drafts.port}
					class="input w-24 text-sm"
					placeholder="5002"
				/>
				{@render saveButton("port")}
			</div>
			<p class="text-surface-700-300 mt-1 text-xs">Restarts audio.cpp.</p>
		</div>

		<div>
			<label class="text-surface-600-400 mb-2 text-xs" for="acppModelsDir">
				Models folder
			</label>
			<div class="panel-actions">
				<input
					id="acppModelsDir"
					type="text"
					bind:value={drafts.modelsDir}
					class="input w-full text-sm"
					placeholder={settings.modelsDirResolved}
				/>
				{@render saveButton("modelsDir")}
			</div>
			<p class="text-surface-700-300 mt-1 text-xs">
				Leave empty for {settings.modelsDirResolved}. Files land in
				&lt;folder&gt;/&lt;task&gt;/&lt;family&gt;/…
			</p>
		</div>

		<div>
			<label class="text-surface-600-400 mb-2 text-xs" for="acppIdle">
				Unload an idle model after (seconds)
			</label>
			<div class="panel-actions">
				<input
					id="acppIdle"
					type="number"
					min="0"
					bind:value={drafts.idleSeconds}
					class="input w-24 text-sm"
					placeholder="default"
				/>
				{@render saveButton("idleSeconds")}
			</div>
			<p class="text-surface-700-300 mt-1 text-xs">
				Leave empty for audio.cpp's default.
			</p>
		</div>

		<div>
			<label class="text-surface-600-400 mb-2 text-xs" for="acppMaxLoaded">
				Models held at once
			</label>
			<div class="panel-actions">
				<input
					id="acppMaxLoaded"
					type="number"
					min="1"
					bind:value={drafts.maxLoadedModels}
					class="input w-24 text-sm"
					placeholder="auto"
				/>
				{@render saveButton("maxLoadedModels")}
			</div>
			<p class="text-surface-700-300 mt-1 text-xs">
				Leave empty for Serene Pub's rule: 2 on GPU builds, 1 on CPU.
			</p>
		</div>

		<div>
			<label class="text-surface-600-400 mb-2 text-xs" for="acppTimeout">
				Stop audio.cpp after idle (minutes)
			</label>
			<div class="panel-actions">
				<input
					id="acppTimeout"
					type="number"
					min="0"
					bind:value={drafts.subprocessTimeoutMinutes}
					class="input w-24 text-sm"
					placeholder="0"
				/>
				{@render saveButton("subprocessTimeoutMinutes")}
			</div>
			<p class="text-surface-700-300 mt-1 text-xs">0 means never.</p>
		</div>

		<p class="text-surface-700-300 text-xs">
			{runsOnLine({
				backendLabel: acppBackendLabel(settings.backend),
				deviceIndex: settings.deviceIndex,
				threads: settings.threads
			})}
		</p>

		<div>
			<p class="text-surface-600-400 mb-1 text-xs">Installed build</p>
			{#if settings.binaryVariant}
				<p class="text-xs">
					{settings.binaryVariant}
					{#if settings.releaseTag}
						<span class="text-surface-600-400">
							· {settings.releaseTag}
						</span>
					{/if}
				</p>
			{:else}
				<p class="text-surface-700-300 text-xs">No build installed yet.</p>
			{/if}
			{#if onChangeBinary}
				<button
					class="btn btn-sm preset-tonal-surface mt-2 text-xs"
					onclick={onChangeBinary}
				>
					Change binary
				</button>
			{/if}
		</div>
	</div>
{/if}
