<!--
	🚧 Admin › Data: the pub's whole Edit history in one row — count, size,
	Clear. Unlike Spoken lines an edit history cannot be made again, so Clear
	asks first. The server answers admins only; a refusal is said under the row.
-->
<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import ClearEditHistoryDialog from "./ClearEditHistoryDialog.svelte"
	import {
		ADMIN_CLEAR_LOSES,
		adminRowLabel,
		CLEAR_ALL_QUESTION,
		clearAllSentence
	} from "./editHistoryCopy"

	const socket = useTypedSocket()

	let count = $state<number | null>(null)
	let bytes = $state(0)
	let error = $state("")
	let open = $state(false)
	let busy = $state(false)
	let dialogError = $state("")

	async function ask() {
		try {
			const res = await awaitReply({
				socket,
				event: "admin:redlineSummary",
				params: {},
				errorEvent: "admin:redlineSummary:error",
				fallbackError: "The edit history could not be counted.",
				match: () => true
			})
			count = res.count
			bytes = res.bytes
			error = ""
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		}
	}

	async function openDialog() {
		dialogError = ""
		await ask()
		open = true
	}

	async function confirm() {
		busy = true
		dialogError = ""
		try {
			await awaitReply({
				socket,
				event: "admin:clearRedlines",
				params: {},
				errorEvent: "admin:clearRedlines:error",
				fallbackError: "The edit history could not be cleared.",
				match: () => true
			})
			open = false
			await ask()
		} catch (e) {
			dialogError = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	$effect(() => {
		ask()
	})
</script>

<div class="flex flex-col gap-1" data-testid="edit-history-admin-row">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="min-w-0 text-sm" aria-live="polite">
			{#if count === null}
				<span class="text-surface-600-400">Edit history…</span>
			{:else}
				{adminRowLabel(count, bytes)}
			{/if}
		</p>
		<button
			type="button"
			class="btn btn-sm text-error-600-400 hover:preset-tonal-error"
			disabled={busy || !count}
			onclick={openDialog}
		>
			<Icons.Trash2 size={16} aria-hidden="true" />
			<span>Clear</span>
		</button>
	</div>
	<p class="text-surface-600-400 text-xs">{ADMIN_CLEAR_LOSES}</p>
	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{/if}
</div>

{#if open}
	<ClearEditHistoryDialog
		{open}
		question={CLEAR_ALL_QUESTION}
		sentence={count === null ? null : clearAllSentence(count)}
		{busy}
		error={dialogError}
		onConfirm={confirm}
		onCancel={() => (open = false)}
	/>
{/if}
