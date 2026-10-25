/**
 * 🚧 Whether a review screen's save into a lorebook would be refused because
 * writes from sessions are Off (plan A22) — what summarize, compile and graph
 * build read to say so before any work.
 *
 * Off at either level counts (owner ruling 2026-10-21, "Personal > Lorebook >
 * Session"): the person's own mode, resolved here from the two settings rows
 * the shell already holds by the shared rule (`effectiveLoreWriteMode`) —
 * never from a copy the server resolved once — and, given the book, the
 * book's own mode, read off its row (`lorebooks:get`, scoped to it). `by`
 * says which level is Off, so the notice opens the right place. The person
 * is the book's owner on every screen that asks: those screens are
 * owner-only.
 *
 * Call during component setup (it reads context and declares interest).
 */

import { getContext } from "svelte"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
import { interestKey } from "$lib/shared/sockets/interest"
import {
	effectiveLoreWriteMode,
	isLoreWriteMode,
	loreWriteLimit,
	type LoreWriteMode
} from "$lib/shared/lorebooks/loreWriteMode"

export function useLoreWritesOff(lorebookId?: () => number | null | undefined): {
	readonly off: boolean
	/** Which level is Off: the person's own setting first, else the book's. */
	readonly by: "personal" | "lorebook" | null
} {
	const user = getContext<UserSettingsCtx | undefined>("userSettingsCtx")
	const pub = getContext<SystemSettingsCtx | undefined>("systemSettingsCtx")
	let bookMode = $state<LoreWriteMode | null>(null)

	if (lorebookId) {
		const socket = useTypedSocket()
		$effect(() => {
			const id = lorebookId()
			bookMode = null
			if (id == null) return
			const release = declareInterest<"lorebooks:get">(
				interestKey("lorebooks:get", id),
				(msg) => {
					if (msg.lorebookId !== id) return
					const mode = (msg.lorebook as { loreWriteMode?: unknown } | null)?.loreWriteMode
					bookMode = isLoreWriteMode(mode) ? mode : null
				}
			)
			socket.emit("lorebooks:get", { id })
			return release
		})
	}

	const personal = () =>
		effectiveLoreWriteMode(user?.settings?.loreWriteMode, pub?.settings?.loreWriteModeDefault)

	return {
		get off() {
			return loreWriteLimit({ personal: personal(), book: bookMode }).mode === "off"
		},
		get by() {
			if (personal() === "off") return "personal"
			return bookMode === "off" ? "lorebook" : null
		}
	}
}
