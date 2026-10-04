<script lang="ts">
	/**
	 * Pub › Updates — the in-app update (docs/updating.md).
	 *
	 * A settings-form section (STYLE-GUIDE §6.11): one column of cards. The
	 * server prepares the update — download, checksum, unpack — and the
	 * launcher swaps it in after this process exits, so the flow here is
	 * Download update → Restart to update, with Discard and Cancel beside them.
	 * Where the launcher cannot apply one (a bare start, Docker, Android, an
	 * installer-managed copy) the section says why in one line and links to
	 * the releases page instead. Hidden from the section list on a pre-release.
	 *
	 * Every reply is the whole `Sockets.Updates.State`; `updates:progress` is
	 * the push while a download runs.
	 */
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getAdminInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { docsHref } from "$lib/shared/utils/docsHref"

	type State = Sockets.Updates.State

	const socket = useTypedSocket()
	// `updates:` is RESTRICTED interest; the admin context declares it.
	const interest = getAdminInterestContext()

	let st = $state<State | null>(null)
	let busy = $state(false)
	/** Set once the server has gone away and come back with this page open. */
	let restartNote = $state<string | null>(null)

	function take(next: State) {
		st = next
		busy = false
		if (next.phase === "applying") waitForRestart()
	}

	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		toaster.error({ title: res.error })
	}

	const ERROR_EVENTS = [
		"updates:get:error",
		"updates:download:error",
		"updates:cancel:error",
		"updates:discard:error",
		"updates:apply:error"
	] as const
	for (const e of ERROR_EVENTS) interest.useInterest<"updates:get:error">(e, handleError)

	interest.useInterest<"updates:download">("updates:download", take)
	interest.useInterest<"updates:cancel">("updates:cancel", take)
	interest.useInterest<"updates:discard">("updates:discard", take)
	interest.useInterest<"updates:apply">("updates:apply", take)
	interest.useInterest<"updates:progress">("updates:progress", take)

	$effect(() => interest.requestWithInterest("updates:get", {}, take))

	function download() {
		busy = true
		socket.emit("updates:download", {})
	}

	function cancel() {
		busy = true
		socket.emit("updates:cancel", {})
	}

	function discard() {
		if (!confirm("Discard the downloaded update? You can download it again later.")) return
		busy = true
		socket.emit("updates:discard", {})
	}

	function apply() {
		const tag = st?.staged?.tag ?? "the new version"
		if (
			!confirm(
				`Restart Serene Pub to update to ${tag}?\n\n` +
					"Everyone using this pub is disconnected for a minute or two. " +
					"If the new version does not start, the launcher puts this one back."
			)
		)
			return
		busy = true
		socket.emit("updates:apply", {})
	}

	let waiting = false
	/**
	 * After Restart to update: wait for the server to go away, then for it to
	 * answer again, then reload — the page that comes back is the new version
	 * (or this one, if the launcher rolled back).
	 */
	async function waitForRestart() {
		if (waiting) return
		waiting = true
		let sawDown = false
		const started = Date.now()
		while (Date.now() - started < 15 * 60_000) {
			await new Promise((r) => setTimeout(r, 2000))
			let up = false
			try {
				const res = await fetch("/", {
					method: "HEAD",
					cache: "no-store",
					signal: AbortSignal.timeout(4000)
				})
				up = res.ok
			} catch {
				up = false
			}
			if (!up) sawDown = true
			else if (sawDown) {
				location.reload()
				return
			}
		}
		restartNote =
			"Serene Pub is taking longer than expected to come back. Reload this page in a minute; if it still does not answer, open Serene Pub from its launcher."
	}

	const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`

	let percent = $derived(
		st && st.total ? Math.min(100, Math.round((st.received / st.total) * 100)) : null
	)
	let newer = $derived(st?.latestTag ?? null)
</script>

<div class="mx-auto flex w-full max-w-[820px] flex-col">
	<AdminPageHeader
		title="Updates"
		purpose="Which version this pub runs, and getting the next one."
		doc={docsHref("updating")}
	>
		{#snippet actions()}
			{#if st?.inApp.allowed && st.staged && st.phase === "ready"}
				<button
					type="button"
					class="btn preset-filled-primary-500"
					disabled={busy}
					onclick={apply}
				>
					<Icons.RotateCw size={16} aria-hidden="true" />
					Restart to update
				</button>
			{:else if st?.inApp.allowed && newer && (st.phase === "idle" || st.phase === "error")}
				<button
					type="button"
					class="btn preset-filled-primary-500"
					disabled={busy}
					onclick={download}
				>
					<Icons.Download size={16} aria-hidden="true" />
					Download update
				</button>
			{/if}
		{/snippet}
	</AdminPageHeader>

	<div class="flex flex-col gap-4">
		{#if !st}
			<p class="text-surface-600-400 flex items-center gap-2 text-sm">
				<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
				Checking…
			</p>
		{:else}
			<section class="panel-card flex flex-col gap-3" aria-labelledby="updates-version-heading">
				<h2 id="updates-version-heading" class="text-sm font-medium">This version</h2>
				<p class="flex items-start gap-2 text-sm">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full {newer
							? 'bg-primary-500'
							: 'bg-success-500'}"
						aria-hidden="true"
					></span>
					<span>
						Serene Pub {st.currentVersion}
						{#if newer}
							· {newer} is available
						{:else}
							· no newer release found
						{/if}
					</span>
				</p>
				{#if !st.inApp.allowed}
					<p class="text-surface-600-400 text-sm">{st.inApp.message}</p>
					{#if newer}
						<a
							href={st.releasesUrl}
							target="_blank"
							rel="noopener"
							class="btn preset-tonal self-start"
						>
							<Icons.ExternalLink size={16} aria-hidden="true" />
							Get {newer} from the releases page
						</a>
					{/if}
				{/if}
			</section>

			{#if st.inApp.allowed}
				<section
					class="panel-card flex flex-col gap-3"
					aria-labelledby="updates-progress-heading"
					aria-live="polite"
				>
					<h2 id="updates-progress-heading" class="text-sm font-medium">Update</h2>

					{#if st.phase === "downloading"}
						<p class="text-sm">
							Downloading {st.tag}{percent !== null ? ` — ${percent}%` : "…"}
						</p>
						<div
							class="bg-surface-200-800 h-1.5 overflow-hidden rounded-full"
							role="progressbar"
							aria-label="Download progress"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={percent ?? undefined}
						>
							<div
								class="bg-primary-500 h-full rounded-full transition-[width]"
								style="width: {percent ?? 0}%"
							></div>
						</div>
						<p class="text-surface-600-400 text-xs">
							{mb(st.received)}{st.total ? ` of ${mb(st.total)}` : ""}. Checked against its published checksum before anything is unpacked.
						</p>
						<button
							type="button"
							class="btn preset-tonal self-start"
							disabled={busy}
							onclick={cancel}
						>
							Cancel
						</button>
					{:else if st.phase === "extracting"}
						<p class="flex items-center gap-2 text-sm">
							<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
							Checksum matched. Unpacking {st.tag}…
						</p>
					{:else if st.phase === "applying"}
						<p class="flex items-center gap-2 text-sm">
							<Icons.Loader2 size={16} class="animate-spin" aria-hidden="true" />
							Restarting to update to {st.tag}. This page reloads when Serene Pub is back.
						</p>
						{#if restartNote}
							<p class="text-surface-600-400 text-sm">{restartNote}</p>
						{/if}
					{:else if st.staged}
						<p class="flex items-start gap-2 text-sm">
							<span class="bg-primary-500 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
							<span>
								{st.staged.tag} is downloaded and verified. Restart to update when nobody is in the
								middle of something.
							</span>
						</p>
						<button
							type="button"
							class="btn preset-tonal self-start"
							disabled={busy}
							onclick={discard}
						>
							Discard
						</button>
					{:else if st.phase === "error"}
						<p class="flex items-start gap-2 text-sm" role="alert">
							<span class="bg-error-500 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
							<span>{st.error ?? "The update could not be prepared."}</span>
						</p>
						{#if newer}
							<p class="text-surface-600-400 text-xs">
								Nothing was changed. Download update tries again from the start.
							</p>
						{/if}
					{:else if newer}
						<p class="text-sm">
							Download update fetches {newer}, checks it against its published checksum and
							unpacks it beside this version. Nothing changes until you restart.
						</p>
					{:else}
						<p class="flex items-start gap-2 text-sm">
							<span class="bg-success-500 mt-1.5 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
							<span>You are on the newest release. Serene Pub checks once a day.</span>
						</p>
					{/if}
				</section>

				<section class="panel-card flex flex-col gap-2" aria-labelledby="updates-safety-heading">
					<h2 id="updates-safety-heading" class="text-sm font-medium">If something goes wrong</h2>
					<p class="text-surface-600-400 text-sm">
						The launcher keeps this version until the new one has started properly. If it does
						not start, the launcher puts this version back and tells you. Your data is not part
						of the update, and a backup is taken before the new version changes it;
						<a class="anchor" href="/admin/data">Data and backups</a> lists every backup.
					</p>
				</section>
			{/if}
		{/if}
	</div>
</div>
