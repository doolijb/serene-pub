<script lang="ts">
	/**
	 * The stop scripts attached to one connection (18 §4b): guards that end a
	 * streamed reply early. Every pipeline using the connection inherits them.
	 *
	 * Handed an id and nothing else — it asks for, holds and changes its own
	 * list over `connections:scripts` / `attachScript` / `detachScript`, like
	 * `ConnectionCapabilities` beside it, so it never touches the caller's
	 * draft and an attach is not an unsaved change. Shared by the Connections
	 * view and Admin → Connections.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import Select from "$lib/client/components/inputs/Select.svelte"

	interface Props {
		connectionId: number
		/** Where "write stop scripts" points. */
		scriptsHref?: string
		/** Draw the heading and the sentence (off inside a titled fieldset). */
		heading?: boolean
	}
	let {
		connectionId,
		scriptsHref = "/admin/scripts",
		heading = true
	}: Props = $props()

	const socket = useTypedSocket()
	let scripts = $state<Sockets.Connections.Scripts.Response | null>(null)
	/** The picker's momentary pick; it empties after attaching. */
	let pick = $state("")

	/**
	 * The replies are emitToUser — another open view asking about another
	 * connection lands here too, so a reply that names a different id is not
	 * ours.
	 */
	function handleScripts(res: Sockets.Connections.Scripts.Response) {
		if (res.connectionId != null && res.connectionId !== connectionId) return
		scripts = res
	}
	function handleError(res: { error?: string }) {
		if (res.error) toaster.error({ title: res.error })
	}
	useInterest<"connections:scripts">("connections:scripts", handleScripts)
	useInterest<"connections:attachScript">(
		"connections:attachScript",
		handleScripts
	)
	useInterest<"connections:detachScript">(
		"connections:detachScript",
		handleScripts
	)
	useInterest<"connections:scripts:error">(
		"connections:scripts:error",
		handleError
	)
	useInterest<"connections:attachScript:error">(
		"connections:attachScript:error",
		handleError
	)
	useInterest<"connections:detachScript:error">(
		"connections:detachScript:error",
		handleError
	)

	$effect(() => {
		scripts = null
		socket.emit("connections:scripts", { id: connectionId })
	})
</script>

<div class="flex flex-col gap-1">
	{#if heading}
		<span class="flex items-center gap-2 font-semibold">
			<Icons.OctagonX size={14} aria-hidden="true" />
			Stop scripts
		</span>
		<p class="text-surface-600-400 text-xs">
			Guards that end a streamed reply early — a leaked template token, an
			echoed name. Every pipeline using this connection inherits them, and
			the run's receipt names which one fired.
		</p>
	{/if}
	{#if !scripts}
		<p class="text-surface-600-400 text-xs">Loading…</p>
	{:else}
		{#each scripts.attached ?? [] as s (s.id)}
			<div
				class="border-surface-200-700 flex items-center gap-2 rounded-lg border px-2 py-1"
			>
				<span
					class="min-w-0 flex-1 truncate text-sm {s.enabled
						? ''
						: 'opacity-50'}"
				>
					{s.name}
				</span>
				{#if !s.enabled}
					<span
						class="text-surface-600-400 text-[11px]"
						title="Disabled on the scripts page — attached, does nothing."
					>
						off
					</span>
				{/if}
				<button
					type="button"
					class="btn btn-icon btn-icon-sm preset-tonal-surface shrink-0"
					title="Detach from this connection (the script itself is kept)"
					aria-label="Detach {s.name}"
					onclick={() =>
						socket.emit("connections:detachScript", {
							id: connectionId,
							scriptId: s.id
						})}
				>
					<Icons.X size={12} />
				</button>
			</div>
		{/each}
		{#if !(scripts.attached ?? []).length}
			<p class="text-surface-600-400 text-xs italic">None attached.</p>
		{/if}
		{#if (scripts.available ?? []).length}
			<!-- An action picker, not a field: it attaches the pick and
			     empties itself again. -->
			<Select
				label="Attach a stop script"
				labelHidden
				placeholder="Attach a stop script…"
				bind:value={pick}
				options={(scripts.available ?? []).map((s) => ({
					value: String(s.id),
					label: s.name
				}))}
				onValueChange={(v) => {
					const id = parseInt(v, 10)
					if (!Number.isNaN(id))
						socket.emit("connections:attachScript", {
							id: connectionId,
							scriptId: id
						})
					pick = ""
				}}
			/>
		{:else}
			<p class="text-surface-600-400 text-xs">
				Write stop scripts on the
				<a class="underline" href={scriptsHref}>scripts page</a>.
			</p>
		{/if}
	{/if}
</div>
