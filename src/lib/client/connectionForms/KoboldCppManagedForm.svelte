<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import ConnectionFieldSelect from "./ConnectionFieldSelect.svelte"
	import {
		KOBOLDCPP_REQUEST_SWITCHES,
		KOBOLDCPP_FLASH_ATTENTION,
		PROMPT_FORMAT,
		TOKEN_COUNTER
	} from "./connectionFieldWords"
	import { getContext } from "svelte"
	import { mergeExtraJson, useExtraJsonSync } from "./extraJsonSync.svelte"

	interface ManagedConfig {
		gpuLayers: number
		flashAttention: boolean
		batchSize: number
	}

	/**
	 * ⚠ `enableThinking` is gone from this form (ruling 2026-09-12), the same
	 * way it left `KoboldCppForm`: reasoning is a SAMPLING parameter now,
	 * chosen per step on the sampling config. The managed adapter extends the
	 * plain one, so the read it depended on is gone too. Stale keys in an
	 * existing row's `extraJson` are read by nothing and cost nothing.
	 */
	interface ExtraFieldData {
		stream: boolean
		useMemory: boolean
		memory: string
		trimStop: boolean
		renderSpecial: boolean
		bypassEos: boolean
		grammarRetainState: boolean
		replaceInstructPlaceholders: boolean
		managedConfig: ManagedConfig
	}

	interface ExtraJson {
		stream?: boolean
		useMemory?: boolean
		memory?: string
		trimStop?: boolean
		renderSpecial?: boolean
		bypassEos?: boolean
		grammarRetainState?: boolean
		replaceInstructPlaceholders?: boolean
		managedConfig?: ManagedConfig
	}

	interface Props {
		connection: SelectConnection
	}

	let { connection = $bindable() } = $props()

	/**
	 * A completion template only means something in COMPLETION wire mode.
	 *
	 * In chat mode the roles carry the structure: no delimiter is emitted and no
	 * stop string from the template is sent, so the picker below would be a
	 * saved preference that changes no byte of any request. Same "no control
	 * without an effect" rule the retrieval audit applied.
	 *
	 * Read through the store rather than off `connection.capabilities`, so the
	 * wire-mode switches in the capability panel underneath take effect here at
	 * once — that panel deliberately never writes into `connection`.
	 */
	const wireMode = connectionWireMode()
	const showFormat = $derived(usesCompletionTemplate(wireMode.of(connection)))

	/**
	 * The format picker's options, read from `completion_templates` instead of
	 * the eight-entry constant that used to sit beside the table — so a template
	 * an admin authored is offered by the one control that selects it. Falls back
	 * to the built-ins until the reply lands.
	 */
	const formatOptions = completionTemplateOptions()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED].extraJson

	let managerEnabled = $derived(
		koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled ?? false
	)

	let koboldCppFields: ExtraFieldData | undefined = $state()

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? true,
			useMemory: extraJson.useMemory ?? false,
			memory: extraJson.memory ?? "",
			trimStop: extraJson.trimStop ?? true,
			renderSpecial: extraJson.renderSpecial ?? false,
			bypassEos: extraJson.bypassEos ?? false,
			grammarRetainState: extraJson.grammarRetainState ?? false,
			replaceInstructPlaceholders:
				extraJson.replaceInstructPlaceholders ?? false,
			managedConfig: {
				gpuLayers:
					extraJson.managedConfig?.gpuLayers ??
					defaultExtraJson.managedConfig?.gpuLayers ??
					-1,
				flashAttention:
					extraJson.managedConfig?.flashAttention ??
					defaultExtraJson.managedConfig?.flashAttention ??
					false,
				batchSize:
					extraJson.managedConfig?.batchSize ??
					defaultExtraJson.managedConfig?.batchSize ??
					512
			}
		}
	}

	/**
	 * Empty number inputs bind `null`: such a key is left OUT of
	 * `managedConfig`, so the adapter's default applies instead of a null
	 * reaching the launch flags.
	 */
	function managedConfigFromFields(
		managed: ManagedConfig
	): Partial<ManagedConfig> {
		const out: Partial<ManagedConfig> = {}
		if (isSetNumber(managed.gpuLayers)) out.gpuLayers = managed.gpuLayers
		out.flashAttention = managed.flashAttention
		if (isSetNumber(managed.batchSize)) out.batchSize = managed.batchSize
		return out
	}

	function isSetNumber(value: unknown): value is number {
		return typeof value === "number" && Number.isFinite(value)
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			useMemory: fields.useMemory,
			memory: fields.memory,
			trimStop: fields.trimStop,
			renderSpecial: fields.renderSpecial,
			bypassEos: fields.bypassEos,
			grammarRetainState: fields.grammarRetainState,
			replaceInstructPlaceholders: fields.replaceInstructPlaceholders,
			managedConfig: managedConfigFromFields(
				fields.managedConfig
			) as ManagedConfig
		}
	}

	// Seeds the fields from `{...defaults, ...connection.extraJson}` on mount
	// and whenever the draft is replaced from outside (an external save, Reset),
	// and writes back only on a real edit — merged over `extraJson`, so keys
	// this form doesn't own (`profile`, legacy keys) survive. See
	// `useExtraJsonSync` for why the seed's own write-back is skipped.
	//
	// `managedConfig` merges one level deeper: keys this form owns are set or
	// removed (an emptied number input), anything else in it survives.
	useExtraJsonSync<ExtraFieldData>({
		connection: () => connection,
		fields: () => koboldCppFields,
		seed: (extraJson) => {
			koboldCppFields = extraJsonToExtraFields({
				...defaultExtraJson,
				...(extraJson ?? {})
			} as ExtraJson)
		},
		project: (fields) => extraFieldsToExtraJson(fields),
		merge: (current, projected) => {
			const managed = {
				...((current.managedConfig as Record<string, unknown>) ?? {})
			}
			delete managed.gpuLayers
			delete managed.batchSize
			return {
				...mergeExtraJson(current, projected),
				managedConfig: {
					...managed,
					...(projected.managedConfig as Record<string, unknown>)
				}
			}
		}
	})
</script>

{#if connection}
	{#if !managerEnabled}
		<div
			class="border-warning-500 bg-warning-500/10 mt-4 flex items-start gap-2 rounded-lg border p-3"
		>
			<Icons.AlertTriangle
				size={16}
				class="text-warning-700-300 mt-0.5 shrink-0"
			/>
			<p class="text-warning-700-300 text-sm">
				This connection is KoboldCPP, run by Serene Pub, which is turned
				off. Turn it on from Connections → Add → KoboldCPP, run by Serene
				Pub to use this connection.
			</p>
		</div>
	{/if}

	<!-- No model picker and no Refresh here: the managed process's ggufs are
	     synced into this connection's models on their own, and downloaded or
	     removed in the managed connection view. -->

	{#if showFormat}
		<ConnectionFieldSelect
			class="mt-2"
			words={PROMPT_FORMAT}
			options={formatOptions.value}
			bind:value={connection.promptFormat}
		/>
	{/if}
	<ConnectionFieldSelect
		class="mt-2"
		words={TOKEN_COUNTER}
		options={TokenCounterOptions.options}
		bind:value={connection.tokenCounter}
	/>
	<details class="mt-4">
		<summary
			class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-base px-2 py-2 text-chip font-medium"
		>
			Request settings
		</summary>
		<p class="text-surface-600-400 mt-2 text-xs">
			Base URL is the address Serene Pub runs KoboldCPP at, and isn't
			set per-connection.
		</p>
		{#if koboldCppFields}
			<section class="w-full space-y-4 pt-4">
				<!-- "Use Chat Mode" lived here. It is a CAPABILITY now —
				     Chat messages / Text completion, in the Capabilities panel
				     below, graded through the same four layers as everything
				     else and with a hand-set value outranking every later test.
				     Left as two controls for one fact, the switch and the
				     capability could disagree, and only one of them decided
				     what went on the wire. -->
				<!-- Each switch's label and help line come from
				     `connectionFieldWords`, shared by both KoboldCPP forms so
				     the two cannot say different things. -->
				{#each KOBOLDCPP_REQUEST_SWITCHES as s (s.key)}
					<div class="flex flex-col gap-1">
						<Switch
							name={s.key}
							checked={koboldCppFields[s.key]}
							onCheckedChange={(e) =>
								(koboldCppFields![s.key] = e.checked)}
							class="flex items-center justify-between gap-4"
						>
							<Switch.Label class="font-semibold">
								{s.label}
							</Switch.Label>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
						<p class="text-surface-600-400 text-xs">{s.help}</p>
					</div>
					{#if s.key === "useMemory" && koboldCppFields.useMemory}
						<div class="flex flex-col gap-1">
							<label class="font-semibold" for="memory">
								Memory text
							</label>
							<!-- What it does is the Use memory line just
							     above; no second sentence for it here. -->
							<textarea
								id="memory"
								bind:value={koboldCppFields.memory}
								placeholder="Notes the model should always see"
								class="textarea h-20"
							></textarea>
						</div>
					{/if}
				{/each}
				<hr class="border-surface-200-800" />
				<p class="text-surface-600-400 text-xs">
					Managed mode launch settings — applied the next time this
					model is loaded.
				</p>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="gpuLayers">
						GPU layers
					</label>
					<input
						id="gpuLayers"
						type="number"
						step="1"
						bind:value={koboldCppFields.managedConfig.gpuLayers}
						class="input"
					/>
					<p class="text-surface-600-400 text-xs">
						-1 = autofit as many layers as fit on GPU, 0 = CPU only
					</p>
				</div>
				<div class="flex flex-col gap-1">
					<Switch
						name="flashAttention"
						checked={koboldCppFields.managedConfig.flashAttention}
						onCheckedChange={(e) =>
							(koboldCppFields!.managedConfig.flashAttention =
								e.checked)}
						class="flex items-center justify-between gap-4"
					>
						<Switch.Label class="font-semibold">
							{KOBOLDCPP_FLASH_ATTENTION.label}
						</Switch.Label>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
					</Switch>
					<p class="text-surface-600-400 text-xs">
						{KOBOLDCPP_FLASH_ATTENTION.help}
					</p>
				</div>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="batchSize">
						Batch size
					</label>
					<input
						id="batchSize"
						type="number"
						step="1"
						min="1"
						bind:value={koboldCppFields.managedConfig.batchSize}
						class="input"
					/>
				</div>
			</section>
		{/if}
	</details>
{/if}
