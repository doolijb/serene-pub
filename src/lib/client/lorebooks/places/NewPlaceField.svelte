<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { isReplyTimeout } from "$lib/client/utils/awaitReply"

	/**
	 * Making a place on the spot: its name, and Create (plan places-graph B4).
	 *
	 * The Places lens's toolbar opens it as **New place**, and the other-end
	 * picker as **New place…**. The typed name stays until the server has the
	 * row — a refusal or silence says why here, and Create can be pressed
	 * again. Everything else about the place is written in its own editor.
	 */
	interface Props {
		/** Make it; resolves once the place exists, rejects with why not. */
		onCreate: (name: string) => Promise<unknown>
		onCancel: () => void
		/** Pre-filled, when the picker was already typing a name. */
		initialName?: string
	}

	let { onCreate, onCancel, initialName = "" }: Props = $props()

	const id = $props.id()
	// Seeded once: the field is the writer's from the first keystroke.
	let name = $state(untrack(() => initialName))
	let busy = $state(false)
	let error = $state<string | null>(null)
	let input = $state<HTMLInputElement | undefined>(undefined)

	$effect(() => {
		input?.focus()
	})

	async function create() {
		const typed = name.trim()
		if (!typed || busy) return
		busy = true
		error = null
		try {
			await onCreate(typed)
		} catch (err) {
			error = isReplyTimeout(err)
				? "The server did not answer. Nothing was made; try again."
				: err instanceof Error
					? err.message
					: "The place could not be made."
		} finally {
			busy = false
		}
	}
</script>

<form
	class="flex flex-col gap-1"
	data-new-place
	onsubmit={(e) => {
		e.preventDefault()
		void create()
	}}
>
	<div class="flex flex-wrap items-center gap-1.5">
		<label for="{id}-name" class="sr-only">New place's name</label>
		<input
			id="{id}-name"
			bind:this={input}
			bind:value={name}
			class="input min-w-40 flex-1 text-sm"
			placeholder="The Drowned Hall"
			autocomplete="off"
			disabled={busy}
			onkeydown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault()
					onCancel()
				}
			}}
		/>
		<!-- Tonal: it sits inside a form (Name it) or beside a column (Update)
		     whose own action is the one filled primary (STYLE-GUIDE §6.1). -->
		<button
			class="btn btn-sm preset-tonal-primary shrink-0"
			type="submit"
			disabled={busy || !name.trim()}
			title={name.trim() ? undefined : "Name the place first."}
		>
			<Icons.MapPinPlus size={13} aria-hidden="true" /> Create
		</button>
		<button
			class="btn btn-sm preset-tonal-surface shrink-0"
			type="button"
			disabled={busy}
			onclick={onCancel}
		>
			Cancel
		</button>
	</div>
	{#if error}
		<p class="text-error-500 text-xs" role="alert">{error}</p>
	{/if}
</form>
