<script lang="ts">
	/**
	 * Creating and sharing invites (plan 27 §2–§3).
	 *
	 * One component, used from both the Users admin page and the Users sidebar,
	 * so the two never drift. `compact` trims it for the sidebar's width rather
	 * than forking the logic.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import QrCode from "$lib/client/components/auth/QrCode.svelte"

	let {
		compact = false,
		showOutstanding = true
	}: { compact?: boolean; showOutstanding?: boolean } = $props()

	const socket = useTypedSocket()

	let invites = $state<Sockets.Invites.InviteView[]>([])
	let hostOptions = $state<Sockets.Invites.HostOption[]>([])
	let users = $state<SelectUser[]>([])
	let issued = $state<Sockets.Invites.Create.Response | null>(null)
	let selectedHost = $state("")
	let accountUserId = $state<number | null>(null)
	let busy = $state(false)

	/**
	 * Every address this link could point at.
	 *
	 * The admin's own origin is contributed here because only the browser knows
	 * it, and it is the right answer for a hand-off on the same network. A
	 * running tunnel outranks it: that is the address someone outside the
	 * network can actually reach.
	 */
	const choices = $derived.by(() => {
		const here = typeof window === "undefined" ? "" : window.location.origin
		const proto =
			typeof window === "undefined" ? "https:" : window.location.protocol
		return [
			{ origin: here, label: `This device (${here})`, priority: 1 },
			...hostOptions.map((h) => ({
				origin: `${h.forceHttps ? "https:" : proto}//${h.hostname}`,
				label: `${h.label} (${h.hostname})`,
				priority: h.priority
			}))
		].filter((c) => c.origin)
	})

	$effect(() => {
		if (!selectedHost && choices.length) {
			selectedHost = [...choices].sort(
				(a, b) => b.priority - a.priority
			)[0].origin
		}
	})

	const link = $derived(
		issued && selectedHost
			? `${selectedHost}/invite?token=${encodeURIComponent(issued.token)}`
			: null
	)

	const active = $derived(
		invites.filter(
			(i) =>
				!i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date()
		)
	)

	function handleList(res: Sockets.Invites.List.Response) {
		invites = res.invites
		hostOptions = res.hostOptions
		busy = false
	}
	function handleCreated(res: Sockets.Invites.Create.Response) {
		issued = res
		busy = false
	}
	function handleUsers(res: Sockets.Users.List.Response) {
		users = res.users ?? []
	}
	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		toaster.error({ title: res.error })
	}

	const ERRORS = [
		"invites:list:error",
		"invites:create:error",
		"invites:revoke:error"
	] as const

	onMount(() => {
		socket.on("invites:list", handleList)
		socket.on("invites:create", handleCreated)
		socket.on("users:list", handleUsers)
		for (const e of ERRORS) socket.on(e, handleError)
		socket.emit("invites:list", {})
		socket.emit("users:list", {})
	})
	onDestroy(() => {
		socket.off("invites:list", handleList)
		socket.off("invites:create", handleCreated)
		socket.off("users:list", handleUsers)
		for (const e of ERRORS) socket.off(e, handleError)
	})

	function create(kind: "register" | "account") {
		busy = true
		issued = null
		socket.emit("invites:create", {
			kind,
			...(kind === "account" ? { userId: accountUserId! } : {})
		})
	}

	async function copyLink() {
		if (!link) return
		await navigator.clipboard.writeText(link)
		toaster.success({ title: "Invite link copied" })
	}
</script>

<div class="space-y-4">
	{#if issued && link}
		<div class="border-primary-500 space-y-3 rounded-lg border p-3">
			<p class="text-sm font-semibold">
				Share this link — it is shown once
			</p>
			<p class="text-surface-600-400 text-xs">
				Not stored and not recoverable. It stops working after the first
				use, or in two hours.
			</p>

			<label class="label">
				<span class="label-text text-xs">Address to share</span>
				<select class="select select-sm" bind:value={selectedHost}>
					{#each choices as c (c.origin)}
						<option value={c.origin}>{c.label}</option>
					{/each}
				</select>
			</label>

			<div class="flex flex-wrap items-start gap-3">
				<QrCode
					value={link}
					size={compact ? 132 : 180}
					label="Invite link QR code"
				/>
				<!-- `basis-64` rather than `min-w-0`: a flex item with
					     min-width 0 shrinks below its content instead of
					     wrapping, which squeezed this column to 130px beside
					     the QR and pushed the buttons out of the panel. A basis
					     makes it take its own line when the row is narrow —
					     see the panel-actions note in app.css. -->
				<div class="flex-1 basis-64 space-y-2">
					<!-- `whitespace-normal` is load-bearing: `code` carries
					     white-space: nowrap, which beats break-all outright —
					     the text simply cannot wrap, and a token URL runs
					     hundreds of pixels past the panel. -->
					<code class="block text-xs break-all whitespace-normal">
						{link}
					</code>
					<div class="panel-actions">
						<button
							type="button"
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={copyLink}
						>
							<Icons.Copy size={14} /> Copy
						</button>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							onclick={() => (issued = null)}
						>
							Done
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="space-y-2">
		<p class="text-surface-600-400 text-xs">
			They choose their own username and password. The account is created
			when the link is used, never as an administrator.
		</p>
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500"
			disabled={busy}
			onclick={() => create("register")}
		>
			<Icons.UserPlus size={15} /> New registration link
		</button>
	</div>

	<div class="border-surface-300-700 space-y-2 border-t pt-3">
		<p class="text-surface-600-400 text-xs">
			Locked out of an existing account? This replaces their password,
			removes two-factor, and signs out their other sessions.
		</p>
		<div class="flex flex-wrap items-end gap-2">
			<label class="label min-w-0 flex-1">
				<span class="label-text text-xs">Account</span>
				<select class="select select-sm" bind:value={accountUserId}>
					<option value={null}>Choose an account…</option>
					{#each users as u (u.id)}
						<option value={u.id}>{u.username}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn btn-sm preset-tonal-error"
				disabled={busy || accountUserId === null}
				onclick={() => create("account")}
			>
				Recovery link
			</button>
		</div>
	</div>

	{#if showOutstanding}
		<div class="border-surface-300-700 space-y-2 border-t pt-3">
			<p class="text-sm font-semibold">Outstanding</p>
			{#if !active.length}
				<p class="text-surface-600-400 text-xs">No active invites.</p>
			{:else}
				<ul class="space-y-2">
					{#each active as inv (inv.id)}
						<li
							class="border-surface-300-700 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs"
						>
							<span class="min-w-0 truncate">
								{inv.kind === "register"
									? "Registration"
									: `Recovery — ${inv.username}`}
								<span class="text-surface-600-400">
									· expires {new Date(
										inv.expiresAt
									).toLocaleTimeString()}
								</span>
							</span>
							<button
								type="button"
								class="btn btn-sm preset-tonal-error shrink-0"
								onclick={() =>
									socket.emit("invites:revoke", {
										id: inv.id
									})}
							>
								Revoke
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
