<script lang="ts">
	/**
	 * A connection's SERVICE form — host, key, request settings — chosen by
	 * its type (or, for the lanes, its modality). One switch, shared by the
	 * Connections view and Admin → Connections' change form, so a new service
	 * gets its form in both places at once.
	 *
	 * Bound to the caller's draft: every form writes into `connection` and
	 * the caller decides when that is saved.
	 */
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import OllamaForm from "$lib/client/connectionForms/OllamaForm.svelte"
	import OpenAIForm from "$lib/client/connectionForms/OpenAIForm.svelte"
	import LmStudioForm from "$lib/client/connectionForms/LMStudioForm.svelte"
	import LlamaCppForm from "$lib/client/connectionForms/LlamaCppForm.svelte"
	import KoboldCppForm from "$lib/client/connectionForms/KoboldCppForm.svelte"
	import KoboldCppManagedForm from "$lib/client/connectionForms/KoboldCppManagedForm.svelte"
	import AnthropicForm from "$lib/client/connectionForms/AnthropicForm.svelte"
	import ImageConnectionForm from "$lib/client/connectionForms/ImageConnectionForm.svelte"
	import EmbeddingConnectionForm from "$lib/client/connectionForms/EmbeddingConnectionForm.svelte"
	import NerConnectionForm from "$lib/client/connectionForms/NerConnectionForm.svelte"

	interface Props {
		connection: any
	}
	let { connection = $bindable() }: Props = $props()
</script>

{#if connection.type === CONNECTION_TYPE.OLLAMA}
	<OllamaForm bind:connection />
{:else if connection.type === CONNECTION_TYPE.OPENAI}
	<OpenAIForm bind:connection />
{:else if connection.type === CONNECTION_TYPE.LM_STUDIO}
	<LmStudioForm bind:connection />
{:else if connection.type === CONNECTION_TYPE.LLAMACPP}
	<LlamaCppForm bind:connection />
{:else if connection.type === CONNECTION_TYPE.KOBOLDCPP}
	<KoboldCppForm bind:connection />
{:else if connection.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED}
	<KoboldCppManagedForm bind:connection />
	<!-- The same process draws: its image settings and test box. -->
	<ImageConnectionForm bind:connection embedded />
{:else if connection.type === CONNECTION_TYPE.ANTHROPIC}
	<AnthropicForm bind:connection />
{:else if CONNECTION_TYPE.isImage(connection.type)}
	<!-- One branch for every image backend: the form is
	     generated from what the adapter declares. -->
	<ImageConnectionForm bind:connection />
{:else if connection.modality === "embeddings"}
	<EmbeddingConnectionForm bind:connection />
{:else if connection.modality === "ner"}
	<NerConnectionForm bind:connection />
{/if}
