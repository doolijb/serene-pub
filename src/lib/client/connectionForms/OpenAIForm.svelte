<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import ConnectionFieldSelect from "./ConnectionFieldSelect.svelte"
	import { PROMPT_FORMAT, TOKEN_COUNTER } from "./connectionFieldWords"
	import { useExtraJsonSync } from "./extraJsonSync.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import SchemaForm from "$lib/client/components/pipelines/SchemaForm.svelte"
	import { PRESET_CAPABILITIES } from "$lib/shared/connectionAdapters/manifest"
	import type { ImageProfileSchemaResponse } from "$lib/shared/sockets/imageGen"

	interface ExtraFieldData {
		stream: boolean
		apiKey: string
	}

	interface ExtraJson {
		stream?: boolean
		apiKey?: string
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
	const defaultExtraJson = {
		stream: false,
		apiKey: ""
	}

	let openAIFields: ExtraFieldData | undefined = $state()

	// No Test and no test listener here: the connection view's status card
	// owns Test and says what it found.

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? false,
			apiKey: extraJson.apiKey || ""
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			apiKey: fields.apiKey
		}
	}

	// Seeds the fields from `{...defaults, ...connection.extraJson}` on mount
	// and whenever the draft is replaced from outside (an external save, Reset),
	// and writes back only on a real edit — merged over `extraJson`, so keys
	// this form doesn't own survive. See `useExtraJsonSync` for why the seed's
	// own write-back is skipped.
	useExtraJsonSync<ExtraFieldData>({
		connection: () => connection,
		fields: () => openAIFields,
		seed: (extraJson) => {
			openAIFields = extraJsonToExtraFields({
				...defaultExtraJson,
				...(extraJson ?? {})
			} as ExtraJson)
		},
		project: (fields) =>
			extraFieldsToExtraJson(fields)
	})

	// ── Image settings (the OPENAI type's image module's own profile) ─────
	// The same generated section `ImageConnectionForm` draws for an image
	// type — quality, moderation, compression; Gemini's size and safety —
	// shown only where the preset's manifest row claims `text->image`.
	const socket = useTypedSocket()
	const draws = $derived(
		PRESET_CAPABILITIES[connection?.preset ?? ""]?.["text->image"] === true
	)
	let profileSchema = $state<Record<string, any> | null>(null)
	let profileDefaults = $state<Record<string, unknown>>({})
	/** A local view over the declared defaults; only an edit is written. */
	let profileView = $state<Record<string, unknown>>({})
	const profileSync = useExtraJsonSync<Record<string, unknown>>({
		connection: () => connection,
		fields: () => profileView,
		seed: (extraJson) => {
			profileView = {
				...profileDefaults,
				...((extraJson?.profile as Record<string, unknown>) ?? {})
			}
		},
		project: (view) => ({ profile: JSON.parse(JSON.stringify(view)) })
	})
	const onProfileSchema = (msg: ImageProfileSchemaResponse) => {
		if (msg.type !== connection?.type) return
		profileSchema = (msg.schema as Record<string, any>) ?? null
		profileDefaults = (msg.defaults as Record<string, unknown>) ?? {}
		profileSync.reseed()
	}
	useInterest<"images:profileSchema">("images:profileSchema", onProfileSchema)
	// After every declaration above: an emit flushes the pending interest sync.
	$effect(() => {
		if (draws && connection?.type)
			socket.emit("images:profileSchema", { type: connection.type })
	})
</script>

{#if connection}
	<!--
		The CREDENTIAL first. It was the last field on the form, under Token
		Counter and Base URL and below the fold — the one thing this connection
		cannot work without, placed after two things most people never touch.
		Prompt format and token counter moved into Advanced for the same reason.
	-->
	{#if openAIFields}
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="apiKey">API Key</label>
			<input
				id="apiKey"
				type="password"
				bind:value={openAIFields.apiKey}
				placeholder="sk-..."
				class="input"
			/>
		</div>
		<!-- Model picker removed: models live in the Models section below. -->
		<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="baseUrl">Base URL</label>
			<input
				id="baseUrl"
				type="text"
				bind:value={connection.baseUrl}
				placeholder="https://api.openai.com/v1/"
				required
				class="input"
			/>
		</div>
		<details class="mt-4">
			<summary
				class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-base px-2 py-2 text-chip font-medium"
			>
				Request settings
			</summary>
			<section class="w-full space-y-4 pt-2">
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
				<Switch
					name="stream"
					checked={openAIFields.stream}
					onCheckedChange={(e) => (openAIFields!.stream = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">Stream</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<!-- "Prerender Prompt" lived here. It is a CAPABILITY now —
				     Text completion, in the Capabilities panel below, graded
				     through the same four layers as everything else. Both modes
				     still POST /v1/chat/completions; what the capability selects
				     is what the MODEL receives, one formatted prompt or
				     role-tagged turns. -->
			</section>
		</details>
		{#if draws && profileSchema && Object.keys(profileSchema).length}
			<details class="mt-2">
				<summary
					class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-base px-2 py-2 text-chip font-medium"
				>
					Image settings
				</summary>
				<section class="w-full space-y-2 pt-2">
					<p class="text-surface-600-400 text-xs">
						Used when this connection draws pictures. Steps, size and
						seed live in Sampling.
					</p>
					<SchemaForm schema={profileSchema} bind:values={profileView} />
				</section>
			</details>
		{/if}
	{/if}
{/if}
