<script lang="ts">
	/** 🚧 Keep spoken audio (speech S8): how long the pub keeps generated line audio. */
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import SettingCard from "$lib/client/components/settingsTabs/SettingCard.svelte"

	type Keep = "forever" | "archived" | number

	let saved = $state<Keep | null>(null)
	let mode = $state<"forever" | "archived" | "days">("forever")
	let days = $state<number | null>(30)
	let error = $state("")
	let busy = $state(false)

	function adopt(keep: Keep) {
		saved = keep
		if (typeof keep === "number") {
			mode = "days"
			days = keep
		} else mode = keep
	}

	useInterest<"media:spokenSummary">("media:spokenSummary", (res) => {
		if (res.sessionId === null) adopt(res.keep)
	})
	useInterest<"media:setKeepSpokenAudio">("media:setKeepSpokenAudio", (res) => {
		busy = false
		error = ""
		adopt(res.keep)
	})
	useInterest<"media:setKeepSpokenAudio:error">(
		"media:setKeepSpokenAudio:error",
		(res) => {
			busy = false
			error = res.error
		}
	)

	$effect(() => {
		requestWithInterest("media:spokenSummary", {}, () => {})()
	})

	const daysValid = $derived(
		typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 3650
	)
	const daysDirty = $derived(!(typeof saved === "number" && saved === days))

	function save(keep: Keep) {
		busy = true
		error = ""
		requestWithInterest("media:setKeepSpokenAudio", { keep }, () => {})()
	}
	function choose(next: "forever" | "archived" | "days") {
		mode = next
		if (next !== "days") save(next)
	}
</script>

<SettingCard
	title="Keep spoken audio"
	titleId="keep-spoken-heading"
	headingLevel={2}
	helpId="keep-spoken-note"
	help="How long the audio made for spoken lines stays on disk. It is reproducible, so removing it only means a line is spoken again when asked."
	layout="stack"
>
	<fieldset class="flex flex-col gap-2" aria-describedby="keep-spoken-note" disabled={busy}>
		<legend class="sr-only">Keep spoken audio</legend>
		<label class="flex flex-col gap-0.5">
			<span class="flex items-center gap-2 text-sm">
				<input
					type="radio"
					class="radio"
					name="keep-spoken"
					checked={mode === "forever"}
					onchange={() => choose("forever")}
				/>
				Forever
			</span>
			<span class="text-surface-600-400 ps-6 text-xs">
				Nothing is removed unless you use Clear.
			</span>
		</label>
		<label class="flex flex-col gap-0.5">
			<span class="flex items-center gap-2 text-sm">
				<input
					type="radio"
					class="radio"
					name="keep-spoken"
					checked={mode === "archived"}
					onchange={() => choose("archived")}
				/>
				Until the session is archived
			</span>
			<span class="text-surface-600-400 ps-6 text-xs">
				A session's audio is removed when that session is archived.
			</span>
		</label>
		<div class="flex flex-col gap-0.5">
			<label class="flex items-center gap-2 text-sm">
				<input
					type="radio"
					class="radio"
					name="keep-spoken"
					checked={mode === "days"}
					onchange={() => choose("days")}
				/>
				For
				<input
					type="number"
					class="input w-24"
					min="1"
					max="3650"
					step="1"
					bind:value={days}
					disabled={mode !== "days"}
					aria-label="Days to keep spoken audio"
				/>
				days
			</label>
			<span class="text-surface-600-400 ps-6 text-xs">
				Audio older than that many days is removed; the sweep runs every hour.
			</span>
			{#if mode === "days"}
				<div class="ps-6">
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						disabled={busy || !daysValid || !daysDirty}
						onclick={() => days !== null && save(days)}
					>
						Save
					</button>
					{#if !daysValid}
						<span class="text-surface-600-400 text-xs">
							Enter a whole number from 1 to 3650.
						</span>
					{/if}
				</div>
			{/if}
		</div>
	</fieldset>
	{#if error}
		<p class="text-error-600-400 text-xs" role="alert">{error}</p>
	{/if}
</SettingCard>
