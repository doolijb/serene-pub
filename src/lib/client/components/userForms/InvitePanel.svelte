<script lang="ts">
	/**
	 * Creating and sharing invites (plan 27 §2–§3).
	 *
	 * One component, used from both the Users admin page and the Users sidebar,
	 * so the two never drift. `compact` trims it for the sidebar's width rather
	 * than forking the logic.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import QrCode from "$lib/client/components/auth/QrCode.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

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

	/**
	 * The issue reply and the three refusals, BARE — nothing in either family
	 * is in `SCOPED_EVENTS` — and standing, because this panel stays open
	 * across repeated issues and revocations.
	 *
	 * `invites:` is RESTRICTED interest, so for a non-admin the registry
	 * refuses these keys outright: nothing is listened for and nothing is sent
	 * (plan ruling 6a). The panel is only reachable from the Users admin page
	 * and the Users sidebar, so that costs nobody anything; the server's own
	 * admin checks remain the boundary.
	 */
	useInterest<"invites:create">("invites:create", handleCreated)
	for (const e of ERRORS) {
		useInterest<"invites:list:error">(e, handleError)
	}

	onMount(() => {
		/**
		 * Declare-then-emit in one call, so each key is on the wire ahead of
		 * the request its reply answers. Both held for as long as the panel
		 * is open rather than released on the first reply: `invites:list` is
		 * re-sent as a cascade after an issue or a revoke, and `users:list`
		 * after a user is added, which is how the account-invite picker and
		 * the outstanding list stay current without asking again.
		 */
		const releases = [
			requestWithInterest("invites:list", {}, handleList),
			requestWithInterest("users:list", {}, handleUsers)
		]
		return () => {
			for (const release of releases) release()
		}
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

			<Select
				label="Address to share"
				class="text-xs"
				options={choices.map((c) => ({ value: c.origin, label: c.label }))}
				bind:value={selectedHost}
			/>

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
			<Select
				label="Account"
				placeholder="Choose an account…"
				class="min-w-0 flex-1 text-xs"
				options={users.map((u) => ({
					value: String(u.id),
					label: u.username
				}))}
				bind:value={
					() => (accountUserId == null ? "" : String(accountUserId)),
					(v) => (accountUserId = v ? Number(v) : null)
				}
			/>
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
