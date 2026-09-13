<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import LoreContentField from "$lib/client/components/lorebookForms/LoreContentField.svelte"
	import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

	/**
	 * Day one: a book with nothing in it, and one thing to do.
	 *
	 * One composer rather than a choice of kinds, because on day one the reader
	 * has nothing to compare a kind against. Everything the workspace can do is
	 * present and switched on; it simply has nothing to show yet, so it stays
	 * out of the way until there is something for it to draw.
	 */
	interface Props {
		lorebookId: number
		onImport: () => void
	}

	let { lorebookId, onImport }: Props = $props()

	const socket = useTypedSocket()

	let name = $state("")
	let content = $state("")
	let bindings = $state<
		Sockets.Lorebooks.BindingList.Response["lorebookBindingList"]
	>([])

	let canAdd = $derived(!!name.trim() || !!content.trim())

	function addEntry() {
		if (!canAdd) return
		socket.emit("entries:create", {
			entry: {
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name: name.trim() || "Untitled",
				content,
				keys: "",
				secondaryKeys: "",
				selectiveLogic: null,
				useRegex: false,
				caseSensitive: false,
				constant: false,
				enabled: true,
				priority: 1
			} as any
		})
		name = ""
		content = ""
	}

	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		if (msg.lorebookId !== lorebookId) return
		bindings = msg.lorebookBindingList
	}

	onMount(() => {
		socket.on("lorebooks:bindingList", handleBindingList)
		socket.emit("lorebooks:bindingList", { lorebookId })
	})

	onDestroy(() => {
		socket.off("lorebooks:bindingList", handleBindingList)
	})
</script>

<div
	class="mx-auto flex min-h-0 w-full max-w-2xl flex-col gap-4 overflow-y-auto p-2"
	data-lore-day-one
>
	<div class="flex flex-col gap-1">
		<h2 class="text-lg font-semibold">
			Write the first thing you don’t want to repeat.
		</h2>
		<p class="text-surface-700-300 text-sm">
			A place, a person, a rule, something that happened. Serene Pub reads
			it back into the session when it becomes relevant, and works out for
			itself what kind of thing it is.
		</p>
	</div>

	<div class="card preset-filled-surface-100-900 flex flex-col gap-3 p-3">
		<input
			class="input"
			type="text"
			placeholder="Name it…"
			aria-label="Name it"
			bind:value={name}
		/>
		<div class="flex flex-col gap-1">
			<span class="text-surface-700-300 text-sm">
				What should the model know?
			</span>
			<LoreContentField
				bind:content
				bind:lorebookBindingList={bindings}
			/>
		</div>
		<button
			class="btn btn-sm preset-filled-success-500 self-start"
			type="button"
			disabled={!canAdd}
			onclick={addEntry}
		>
			<Icons.Plus size={14} aria-hidden="true" />
			Add entry
		</button>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<span class="text-surface-700-300 text-sm">or</span>
		<button
			class="btn btn-sm preset-tonal-surface"
			type="button"
			onclick={onImport}
		>
			<Icons.Upload size={14} aria-hidden="true" />
			Import a lorebook
		</button>
	</div>

	<p class="text-surface-700-300 text-sm">
		Cast members arrive from the session on their own. Read this book into a
		session and its characters and personas appear here.
	</p>

	<p class="text-surface-700-300 text-sm">
		Nothing here is switched off. Nesting, dating, relationships, branches
		and the retrieval controls are all present, they just have nothing to
		show yet, so they stay out of the way.
	</p>

	<p class="text-surface-700-300 border-border border-t pt-2 text-xs">
		Moment: Nothing is dated yet, date an entry and the story time fills in
		here
	</p>
</div>
