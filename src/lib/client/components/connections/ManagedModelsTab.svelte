<script lang="ts">
	/**
	 * A managed runtime's models (KoboldCPP, Ollama), as model rows: the same
	 * `ModelRow` a host connection's Models tab draws in the dock (STYLE-GUIDE
	 * §6.4, "A model row") — the name, the gold default mark, one quiet facts
	 * line, an outlined **Use**, and every other action in the row's `⋯`.
	 *
	 * ## One component for both runtimes
	 *
	 * Both list `connection.models`, which `syncConnectionModels` fills for
	 * every endpoint, and differ only in which socket event a menu item emits:
	 * four callbacks, not two files. The managers' own `ollama:modelsList` /
	 * `koboldcpp:listModels` are never read here; two sources let two lists
	 * disagree about what is installed. Each model's `facts` (quantisation,
	 * size, context) give the row its `Q4_K_M · 7 GB · 32k context` line.
	 *
	 * ## Rows at every width
	 *
	 * `ModelTable` is a host's list: its columns are context, quant or price,
	 * size and Can do, and its last column is the Hide toggle. A managed model
	 * needs the `⋯` in that place (Model settings, the section moves, Delete
	 * from disk) and lists under its section (text, image, embeddings), so the
	 * rows hold at every pane width.
	 *
	 * ## The row contract, here
	 *
	 * - **Use** shows the section's whole verb (**Use in Reply**) while that job
	 *   has no model, and **Use** in the dock once it has one. Its accessible
	 *   name and its desk-width words keep the whole verb: the verb is the
	 *   consequence (DESIGN-ux-simplification C.3).
	 * - The chat default leads the text section (`chatDefaultFirst`).
	 * - The count and **Refresh** head the list; the filter box appears past
	 *   twelve models (`showsModelsFilter`), as on a host's Models tab.
	 * - Nothing on a row is a filled button, and a row carries no date.
	 * - Unload, where a runtime has it, is the status card's
	 *   (`ManagedConnectionView`): a runtime holds one model in memory, and the
	 *   card names which.
	 *
	 * ⚠ **Delete lives in the `⋯` menu and nowhere else.** It is the one
	 * irreversible thing on this screen, and it asks first (an `alertdialog`).
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import ModelRow, { type ModelRowAction } from "./ModelRow.svelte"
	import {
		chatDefaultFirst,
		modelsHeadline,
		showsModelsFilter
	} from "./connectionViewChrome"
	import { modelDisplay } from "./modelDisplay"
	import type { CapabilityDefaultRef } from "./modelSystemDefaults"
	import { systemCapabilitiesForModel } from "./modelSystemDefaults"
	import { capabilityLabel } from "@serene-pub/sdk"

	type Row = Sockets.Connections.List.Row & { id: number }
	type ModelOf = Row["models"][number]

	interface Props {
		kind: "koboldcpp" | "ollama"
		/** The runtime's one endpoint. Its models carry their own modality. */
		connection: Row | undefined
		capabilityDefaults: Record<string, CapabilityDefaultRef | undefined>
		isAdmin: boolean
		onOpenModel: (connectionId: number, modelId: number) => void
		/** Register a default through the panel's flow (it confirms a reindex). */
		onSetDefault: (
			capability: string,
			connectionId: number,
			model: { id: number; name: string }
		) => void
		onGetModels: () => void
		onRefresh: () => void
	}
	let {
		kind,
		connection,
		capabilityDefaults,
		isAdmin,
		onOpenModel,
		onSetDefault,
		onGetModels,
		onRefresh
	}: Props = $props()

	const socket = useTypedSocket()

	let query = $state("")
	let pendingDelete = $state<{ connectionId: number; model: ModelOf } | null>(
		null
	)

	const total = $derived(connection?.models?.length ?? 0)
	const missingCount = $derived(
		(connection?.models ?? []).filter((m) => !!m.missingSince).length
	)
	/** The filter box, past twelve models — a host's Models tab's rule. */
	const filtering = $derived(showsModelsFilter(total))

	const match = (m: ModelOf) => {
		const q = filtering ? query.trim().toLowerCase() : ""
		if (!q) return true
		const d = modelDisplay(m)
		return (
			d.name.toLowerCase().includes(q) ||
			m.model.toLowerCase().includes(q)
		)
	}

	/**
	 * What a model is listed under. One endpoint serves several jobs — a
	 * KoboldCPP chats and draws, an Ollama chats and embeds — and each section
	 * lists every model the server says can do its job
	 * (`satisfiableCapabilities`, judged as the merged pair), with Use. A "Not
	 * sure" model is listed under every job it can serve.
	 *
	 * A model that serves none of the sections' jobs — switched off, or missing from
	 * the runtime's listing — is still listed once, under the section its own
	 * modality names (text when Not sure), so it can be opened, moved or
	 * deleted. It offers no Use there: the server would refuse it.
	 */
	type Lane = "text" | "image" | "embeddings"
	interface LaneSpec {
		lane: Lane
		heading: string
		useLabel: string
		capability: string
	}
	const LANES: Record<"koboldcpp" | "ollama", LaneSpec[]> = {
		koboldcpp: [
			{
				lane: "text",
				heading: "Text models",
				useLabel: "Use in Reply",
				capability: "text->text"
			},
			{
				lane: "image",
				heading: "Image models",
				useLabel: "Use in Images",
				capability: "text->image"
			},
			{
				lane: "embeddings",
				heading: "Embedding models",
				useLabel: "Use in Embeddings",
				capability: "text->embedding"
			}
		],
		ollama: [
			{
				lane: "text",
				heading: "Chat models",
				useLabel: "Use in Reply",
				capability: "text->text"
			},
			{
				lane: "embeddings",
				heading: "Embedding models",
				useLabel: "Use in Embeddings",
				capability: "text->embedding"
			}
		]
	}
	const serves = (m: ModelOf, capability: string) =>
		(m.satisfiableCapabilities ?? []).includes(capability)
	/** Every section of this runtime's that lists the model. */
	function lanesOf(m: ModelOf): Lane[] {
		const specs = LANES[kind]
		const served = specs.filter((s) => serves(m, s.capability))
		if (served.length) return served.map((s) => s.lane)
		const own: Lane =
			m.modality === "image-gen"
				? "image"
				: m.modality === "embeddings"
					? "embeddings"
					: "text"
		return [specs.some((s) => s.lane === own) ? own : specs[0].lane]
	}

	/** Where a KoboldCPP file may be moved from each section. */
	type Move = "toText" | "toImage" | "toEmbeddings"
	const MOVES: Record<Lane, Move[]> = {
		text: ["toImage", "toEmbeddings"],
		image: ["toText"],
		embeddings: ["toText"]
	}
	const MOVE_LABELS: Record<Move, string> = {
		toText: "Move to text models",
		toImage: "Move to image models",
		toEmbeddings: "Move to embedding models"
	}

	/**
	 * Whether a job has a model. A registration with no model half, or one
	 * naming a model this runtime does not list, is unset (§10, _(endpoint,
	 * model) pair_). One naming another connection counts as set: this tab
	 * sees only its own runtime's list.
	 */
	function jobIsSet(capability: string): boolean {
		const ref = capabilityDefaults[capability]
		if (ref?.connectionId == null || ref.connectionModelId == null)
			return false
		if (connection && ref.connectionId === connection.id)
			return connection.models.some((m) => m.id === ref.connectionModelId)
		return true
	}

	/** The chat default's model id when it is one of this runtime's. */
	const chatModelId = $derived.by(() => {
		const ref = capabilityDefaults["text->text"]
		return connection && ref?.connectionId === connection.id
			? ref.connectionModelId
			: null
	})

	const lanes = $derived(
		LANES[kind]
			.map((spec) => {
				const models = (connection?.models ?? []).filter(
					(m) => lanesOf(m).includes(spec.lane) && match(m)
				)
				return {
					...spec,
					// The dock's word on Use: the whole verb while the job
					// has no model, then the plain one.
					useShortLabel: jobIsSet(spec.capability)
						? "Use"
						: spec.useLabel,
					models:
						spec.lane === "text"
							? chatDefaultFirst(models, chatModelId)
							: models
				}
			})
			.filter((l) => l.models.length)
	)
	/** Headings only when there is more than one lane to tell apart. */
	const showHeadings = $derived(
		new Set((connection?.models ?? []).flatMap(lanesOf)).size > 1
	)

	/** The jobs this model is the default for, as capability ids. */
	function defaultsOf(connectionId: number, model: ModelOf): string[] {
		return systemCapabilitiesForModel(
			capabilityDefaults,
			connectionId,
			model.id
		)
	}

	/**
	 * The `⋯` menu for one row: Model settings, then the runtime's own
	 * items, then Delete from disk (admins only) as the destructive last item.
	 *
	 * ⚠ Every item is an emit the runtime's socket API already answers; the
	 * menu decides where it lives, never what it does. Delete asks first on
	 * both runtimes.
	 */
	function actionsFor(lane: Lane): ModelRowAction[] {
		const items: ModelRowAction[] = [
			{ id: "open", label: "Model settings", icon: "Settings2" }
		]
		// A KoboldCPP file's section is what its header said it was, and a
		// header can be wrong — an embedding GGUF converted without its pooling
		// key reads as a chat model. The moves are how a person says otherwise;
		// image ↔ embeddings is not offered, since no header confuses those two.
		if (kind === "koboldcpp")
			for (const to of MOVES[lane])
				items.push({
					id: to,
					label: MOVE_LABELS[to],
					icon: "ArrowLeftRight"
				})
		if (kind === "ollama")
			items.push({
				id: "site",
				label: "View on ollama.com",
				icon: "ExternalLink"
			})
		if (isAdmin)
			items.push({
				id: "delete",
				label: "Delete from disk",
				icon: "Trash2",
				destructive: true
			})
		return items
	}

	function run(id: string, connectionId: number, model: ModelOf) {
		switch (id) {
			case "open":
				onOpenModel(connectionId, model.id)
				return
			case "delete":
				pendingDelete = { connectionId, model }
				return
			case "site":
				window.open(
					`https://ollama.com/library/${encodeURIComponent(model.model.split(":")[0])}`,
					"_blank",
					"noopener"
				)
				return
			case "toImage":
			case "toText":
			case "toEmbeddings":
				socket.emit("koboldcpp:setModelKind", {
					filename: model.model,
					kind:
						id === "toImage"
							? "image"
							: id === "toEmbeddings"
								? "embeddings"
								: "text"
				})
				return
		}
	}

	function use(spec: LaneSpec, model: ModelOf) {
		// Embeddings go through the panel's own default flow: switching the
		// embedding model rebuilds the index, and that flow asks first.
		if (spec.lane === "embeddings") {
			if (kind === "koboldcpp") {
				void useKoboldCppEmbeddings(spec, model)
				return
			}
			if (connection)
				onSetDefault(spec.capability, connection.id, {
					id: model.id,
					name: model.name
				})
			return
		}
		if (kind === "ollama") {
			// On THIS connection, never a one-model endpoint at the adapter's
			// default address (plan 2026-09-24 B4).
			socket.emit("ollama:connectModel", {
				modelName: model.model,
				connectionId: connection?.id
			})
			return
		}
		if (spec.lane === "image")
			socket.emit("koboldcpp:connectImageModel", {
				filename: model.model
			} as any)
		else
			socket.emit("koboldcpp:connectModel", {
				modelName: model.model
			} as any)
	}

	/**
	 * KoboldCPP's "Use in Embeddings": the server checks the file and makes
	 * sure its row is an embedding model (`koboldcpp:connectEmbeddingModel`),
	 * and answers the pair — it never stars it. The star then moves through
	 * the panel's flow like any other embedding star, behind its re-index
	 * confirmation. A refusal is Layout's toast; only silence is said here.
	 */
	async function useKoboldCppEmbeddings(spec: LaneSpec, model: ModelOf) {
		try {
			const pair = await awaitReply({
				socket,
				event: "koboldcpp:connectEmbeddingModel",
				errorEvent: "koboldcpp:connectEmbeddingModel:error",
				params: { filename: model.model },
				match: (r) => r.filename === model.model
			})
			onSetDefault(spec.capability, pair.connectionId, {
				id: pair.modelId,
				name: pair.name
			})
		} catch (err) {
			if (isReplyTimeout(err))
				toaster.error({
					title: "The embedding model was not chosen",
					description: "The server did not answer in time."
				})
		}
	}

	function confirmDelete() {
		const target = pendingDelete
		pendingDelete = null
		if (!target) return
		if (kind === "ollama")
			socket.emit("ollama:deleteModel", {
				modelName: target.model.model,
				connectionId: target.connectionId
			})
		else
			socket.emit("koboldcpp:deleteModel", {
				modelName: target.model.model
			})
	}
</script>

<div class="flex flex-col gap-3 py-3">
	{#if !total}
		<EmptyState
			icon={Icons.Boxes}
			message="No models yet. Get one and it appears here."
			ctaLabel="Get a model"
			onCta={onGetModels}
		/>
	{:else}
		<!-- The count and Refresh, as a host connection's Models tab heads
		     its list. -->
		<div class="flex min-w-0 items-center gap-2">
			<Icons.Boxes
				size={16}
				class="text-surface-500 shrink-0"
				aria-hidden="true"
			/>
			<p class="min-w-0 flex-1 truncate text-sm font-medium">
				{modelsHeadline({ modelCount: total, missingCount })}
			</p>
			<button
				type="button"
				class="btn btn-icon btn-icon-sm hover:preset-tonal-primary shrink-0"
				onclick={onRefresh}
				title="Ask the runtime for its models again"
				aria-label="Refresh model list"
			>
				<Icons.RefreshCw size={14} aria-hidden="true" />
			</button>
		</div>

		{#if filtering}
			<PanelFilterInput
				id="managed-model-filter"
				bind:value={query}
				placeholder="models"
				singular="model"
				count={total}
				aria-label="Filter models by name or identifier"
			/>
		{/if}

		{#if connection}
			{#each lanes as spec (spec.lane)}
				<section
					class="flex flex-col gap-3"
					aria-labelledby={showHeadings
						? `managed-models-${spec.lane}`
						: undefined}
					data-managed-models={spec.lane}
				>
					{#if showHeadings}
						<ListGroupLabel
							id="managed-models-{spec.lane}"
							label={spec.heading}
						/>
					{/if}
					{#each spec.models as model (model.id)}
						{@const defaults = defaultsOf(connection.id, model)}
						<ModelRow
							{model}
							defaultFor={defaults.map((c) =>
								capabilityLabel(c as any)
							)}
							canUse={serves(model, spec.capability) &&
								!defaults.includes(spec.capability)}
							useLabel={spec.useLabel}
							useShortLabel={spec.useShortLabel}
							actions={actionsFor(spec.lane)}
							onOpen={() => onOpenModel(connection.id, model.id)}
							onUse={() => use(spec, model)}
							onAction={(id) => run(id, connection.id, model)}
						/>
					{/each}
				</section>
			{/each}
		{/if}

		{#if filtering && query && !lanes.length}
			<EmptyState
				icon={Icons.SearchX}
				message="Nothing matches."
				ctaLabel="Clear filter"
				onCta={() => (query = "")}
			/>
		{/if}

		<button
			type="button"
			class="border-surface-300-700 hover:preset-tonal-primary flex items-center gap-2.5 rounded-base border border-dashed px-3 py-2.5 text-left"
			onclick={onGetModels}
		>
			<Icons.Download
				size={16}
				class="text-primary-500 shrink-0"
				aria-hidden="true"
			/>
			<span class="min-w-0 flex-1">
				<span class="block text-chip font-medium">
					Get another model
				</span>
				<span class="text-surface-600-400 block text-meta">
					Recommended lists and Hugging Face
				</span>
			</span>
			<Icons.ChevronRight
				size={15}
				class="text-surface-500 shrink-0"
				aria-hidden="true"
			/>
		</button>
	{/if}
</div>

<!-- An alertdialog (STYLE-GUIDE §6.6): answered, never dismissed by a click
     outside, and its confirm is filled error because it only takes away. -->
<Dialog
	open={!!pendingDelete}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e) => {
		if (!e.open) pendingDelete = null
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Delete this model?
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{pendingDelete
						? modelDisplay(pendingDelete.model).name
						: ""}
					is removed from this machine. The download can be repeated, but
					the file goes now.
				</Dialog.Description>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={() => (pendingDelete = null)}
					>
						Keep it
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
					>
						Delete from disk
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
