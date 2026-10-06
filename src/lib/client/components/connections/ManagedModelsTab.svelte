<script lang="ts">
	/**
	 * The models a runtime this pub manages has, as ROWS.
	 *
	 * ## What it replaces, and why one component replaces two
	 *
	 * `KoboldCppModelsTab` (875 lines) and `OllamaInstalledTab` (470) each drew
	 * their own card per model: the raw identifier as a two-line title, a
	 * `Size: / Modified: / Parameters:` table, and a green filled **Use for
	 * chat** beside a red filled **Delete** wrapping onto a second row. Two
	 * models fitted on screen out of four. They were the last surface still
	 * drawing the pre-2026-09-17 manager, and the 09-18 handover flagged them as
	 * "a restyle, not a rewire".
	 *
	 * They are one component now because they were never two ideas. Both list
	 * the same thing — `connection.models`, which `syncConnectionModels` fills
	 * for every endpoint including these two — and differ only in which socket
	 * event a menu item emits. That difference is four callbacks, not two files.
	 *
	 * ## Where the rows come from
	 *
	 * The connection's own `models[]` off the list, which since 2026-09-23
	 * carries `facts` — quantisation, size, context — so a row can say
	 * `Q4_K_M · 7 GB · 32k context` without a second request. The managers' own
	 * `ollama:modelsList` / `koboldcpp:listModels` are never read HERE: they
	 * answer the same question a sync already answers, from a different shape,
	 * and two sources let two lists disagree about what is installed.
	 *
	 * ⚠ **Delete lives in the `⋯` menu and nowhere else.** It is the one
	 * irreversible thing on this screen; a red filled button on every row put it
	 * under the thumb four times over.
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
	import ModelRow, { type ModelRowAction } from "./ModelRow.svelte"
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

	const match = (m: ModelOf) => {
		const q = query.trim().toLowerCase()
		if (!q) return true
		const d = modelDisplay(m)
		return (
			d.name.toLowerCase().includes(q) ||
			m.model.toLowerCase().includes(q)
		)
	}

	/**
	 * What a model is listed under. One endpoint serves several modalities —
	 * a KoboldCPP chats and draws, an Ollama chats and embeds — and each
	 * model's own `modality` (from the host's listing) says which it is for.
	 * A model the host said nothing about is listed as text, the lane every
	 * such model was in before modality was recorded.
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
			{ lane: "text", heading: "Text models", useLabel: "Use for chat", capability: "text->text" },
			{ lane: "image", heading: "Image models", useLabel: "Use for images", capability: "text->image" },
			{ lane: "embeddings", heading: "Embedding models", useLabel: "Use for embeddings", capability: "text->embedding" }
		],
		ollama: [
			{ lane: "text", heading: "Chat models", useLabel: "Use for chat", capability: "text->text" },
			{ lane: "embeddings", heading: "Embedding models", useLabel: "Use for embeddings", capability: "text->embedding" }
		]
	}
	const laneOf = (m: ModelOf): Lane =>
		m.modality === "image-gen"
			? "image"
			: m.modality === "embeddings"
				? "embeddings"
				: "text"

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

	const lanes = $derived(
		LANES[kind]
			.map((spec) => ({
				...spec,
				models: (connection?.models ?? []).filter(
					(m) => laneOf(m) === spec.lane && match(m)
				)
			}))
			.filter((l) => l.models.length)
	)
	/** Headings only when there is more than one lane to tell apart. */
	const showHeadings = $derived(
		new Set((connection?.models ?? []).map(laneOf)).size > 1
	)

	function defaultsFor(connectionId: number, model: ModelOf): string[] {
		return systemCapabilitiesForModel(
			capabilityDefaults,
			connectionId,
			model.id
		).map((c) => capabilityLabel(c as any))
	}

	/**
	 * The menu for one row.
	 *
	 * ⚠ Every item here is an emit one of the two legacy tabs already made. This
	 * is a restyle of where they live, not a new capability — the only genuinely
	 * new thing is that Delete asks first for Ollama too, which it did before,
	 * and for KoboldCPP, which it also did. Nothing gained a confirmation it
	 * lacked and nothing lost one.
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

	function run(
		id: string,
		connectionId: number,
		model: ModelOf
	) {
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
			// On THIS connection — the legacy call made a one-model endpoint
			// at the adapter's default address (plan 2026-09-24 B4).
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
	 * KoboldCPP's "Use for embeddings": the server checks the file and makes
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

	const total = $derived(connection?.models?.length ?? 0)
</script>

<div class="flex flex-col gap-3 py-3">
	{#if total > 0}
		<div class="flex shrink-0 items-center gap-2">
			<div class="min-w-0 flex-1">
				<label class="sr-only" for="managed-model-filter">
					Filter models
				</label>
				<input
					id="managed-model-filter"
					class="input"
					type="text"
					bind:value={query}
					placeholder={total === 1 ? "1 model" : `${total} models`}
				/>
			</div>
			<button
				type="button"
				class="btn preset-tonal-surface shrink-0"
				onclick={onRefresh}
				aria-label="Refresh model list"
			>
				<Icons.RefreshCw size={16} aria-hidden="true" />
			</button>
		</div>
	{/if}

	{#if !total}
		<div class="panel-card flex flex-col items-start gap-2">
			<p class="text-sm font-medium">No models yet</p>
			<p class="text-surface-600-400 text-xs">
				This runtime has nothing to load. Get one and it appears here.
			</p>
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500"
				onclick={onGetModels}
			>
				<Icons.Download size={15} aria-hidden="true" />
				Get a model
			</button>
		</div>
	{:else}
		{#if connection}
			{#each lanes as spec (spec.lane)}
				<section class="flex flex-col gap-3">
					{#if showHeadings}
						<h3 class="text-surface-600-400 px-0.5 text-xs font-medium">
							{spec.heading}
						</h3>
					{/if}
					{#each spec.models as model (model.id)}
						{@const defaults = defaultsFor(connection.id, model)}
						<ModelRow
							{model}
							defaultFor={defaults}
							canUse={!defaults.length}
							useLabel={spec.useLabel}
							actions={actionsFor(spec.lane)}
							onOpen={() => onOpenModel(connection.id, model.id)}
							onUse={() => use(spec, model)}
							onAction={(id) => run(id, connection.id, model)}
						/>
					{/each}
				</section>
			{/each}
		{/if}

		{#if query && !lanes.length}
			<p class="text-surface-600-400 px-0.5 text-sm">Nothing matches.</p>
		{/if}

		<button
			type="button"
			class="border-surface-300-700 hover:preset-tonal-primary flex items-center gap-2.5 rounded-[10px] border border-dashed px-3 py-2.5 text-left"
			onclick={onGetModels}
		>
			<Icons.Download
				size={16}
				class="text-primary-500 shrink-0"
				aria-hidden="true"
			/>
			<span class="min-w-0 flex-1">
				<span class="block text-[13px] font-medium">
					Get another model
				</span>
				<span class="text-surface-600-400 block text-[11px]">
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

<Dialog
	open={!!pendingDelete}
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
				role="alertdialog"
			>
				<h2 class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold">
					Delete this model?
				</h2>
				<p class="text-surface-600-400 text-sm">
					{pendingDelete
						? modelDisplay(pendingDelete.model).name
						: ""}
					is removed from this machine. The download can be repeated, but
					the file goes now.
				</p>
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
