<script lang="ts">
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { toaster } from "$lib/client/utils/toaster"
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

	/** A create is on its way; the button waits, the text stays. */
	let adding = $state(false)

	let canAdd = $derived(!adding && (!!name.trim() || !!content.trim()))

	/**
	 * ⚠ The typed text is kept until the server has the row. A refusal (shown
	 * by Layout's `:error` toast) or a lost reply leaves it here to retry; a
	 * success adds the book's first entry and the workspace swaps this screen
	 * out on its own.
	 */
	async function addEntry() {
		if (!canAdd) return
		const entryName = name.trim() || "Untitled"
		const entryContent = content
		adding = true
		try {
			await awaitReply({
				socket,
				event: "entries:create",
				params: {
					entry: {
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId,
						name: entryName,
						content: entryContent,
						keys: [],
						secondaryKeys: [],
						selectiveLogic: null,
						useRegex: false,
						caseSensitive: false,
						constant: false,
						enabled: true,
						priority: 1
					} as any
				},
				replyKey: interestKey("entries:create", lorebookId),
				errorEvent: "entries:create:error",
				fallbackError: "The entry could not be added.",
				match: (data) =>
					data.entry?.lorebookId === lorebookId &&
					data.entry.typeId === WORLD_LORE_TYPE_ID &&
					(data.entry.name ?? "") === entryName &&
					(data.entry.content ?? "") === entryContent.trim()
			})
		} catch (err) {
			adding = false
			if (isReplyTimeout(err))
				toaster.error({
					title: "The entry was not added",
					description:
						"The server did not answer in time. Your text is still here."
				})
			return
		}
		adding = false
		name = ""
		content = ""
	}

	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		if (msg.lorebookId !== lorebookId) return
		bindings = msg.lorebookBindingList
	}

	/**
	 * The book's cast, for the content field's `{{char:N}}` slots.
	 *
	 * An effect rather than `useInterest` because the key moves with the
	 * `lorebookId` prop, and `useInterest` keeps the key it was first given.
	 * Declared above `onMount` so the interest exists before the request.
	 */
	$effect(() =>
		declareInterest<"lorebooks:bindingList">(
			interestKey("lorebooks:bindingList", lorebookId),
			handleBindingList
		)
	)

	onMount(() => {
		socket.emit("lorebooks:bindingList", { lorebookId })
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
			it back into the session when it becomes relevant. It is filed as
			World lore.
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
			<span class="text-surface-700-300 text-sm" id="dayOneContentLabel">
				What should the model know?
			</span>
			<LoreContentField
				bind:content
				bind:lorebookBindingList={bindings}
				labelledBy="dayOneContentLabel"
			/>
		</div>
		<button
			class="btn btn-sm preset-filled-primary-500 self-start"
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
			<!-- An import makes a NEW book (and opens it); it never fills this
			     one. Filling the open book from a file needs an owner ruling. -->
			Import as a new lorebook
		</button>
	</div>

	<p class="text-surface-700-300 text-sm">
		Cast members arrive from the session on their own. Read this book into a
		session and its characters and personas appear here.
	</p>

	<p class="text-surface-700-300 text-sm">
		Nesting, dating, relationships, branches and the retrieval controls
		all work in this book; they have nothing to show until it has
		entries. Cast, Time, Lives and Graph open from the views and lenses,
		so you can add a cast member by hand before writing anything.
	</p>

	<p class="text-surface-700-300 border-border border-t pt-2 text-xs">
		Moment: Nothing is dated yet, date an entry and the story time fills in
		here
	</p>
</div>
