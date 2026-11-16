/**
 * 🚧 The question for a clock moved back past the session's dated writes
 * (2026-11-14 ★12: it follows **On revision**; 2026-11-13: the choice is
 * asked, never made silently). The session page and the settings form ask
 * the same question in the same words; this is the one place the words and
 * the page's dialog live.
 */
import { goto } from "$app/navigation"
import { mount, unmount } from "svelte"
import ActionConfirm from "./ActionConfirm.svelte"
import { sessionAddress } from "./deleteReply"

type Notice = Sockets.Sessions.StoryClock.ClockMoveBackNotice

/** 🚧 The question for a clock moved back, as `ActionConfirm` asks it. Pure. */
export function clockMoveBackAsking(notice: Notice): {
	question: string
	description: string
	confirmLabel: string
} {
	const branch = notice.mode === "branch"
	return {
		question: "Move the story back?",
		description: `${notice.sentence} On revision: ${branch ? "Branch" : "Overwrite"}.`,
		confirmLabel: branch ? "Branch and move back" : "Move back"
	}
}

/** The ask now open, answered false by a newer one. */
let open: { answer: (yes: boolean) => void } | null = null

/**
 * Ask on the session page: mounts `ActionConfirm` into `document.body`,
 * resolves true on its confirm and false on Cancel or Escape, then unmounts
 * it. A second ask while one is open answers the first false.
 */
export function askClockMoveBack(notice: Notice): Promise<boolean> {
	open?.answer(false)
	return new Promise<boolean>((resolve) => {
		let dialog: ReturnType<typeof mount> | null = null
		// The question is about the page it was asked on: leaving that page answers no.
		const askedAt = location.pathname
		const leave = () => {
			if (location.pathname !== askedAt) me.answer(false)
		}
		const me = {
			answer(yes: boolean) {
				if (open === me) open = null
				window.removeEventListener("popstate", leave)
				clearInterval(watch)
				if (dialog) unmount(dialog)
				dialog = null
				resolve(yes)
			}
		}
		window.addEventListener("popstate", leave)
		const watch = setInterval(leave, 500)
		open = me
		dialog = mount(ActionConfirm, {
			target: document.body,
			props: {
				asking: clockMoveBackAsking(notice),
				onConfirm: () => me.answer(true),
				onCancel: () => me.answer(false)
			}
		})
	})
}

/** Take the person to the branch a confirmed move made. */
export function openBranchedSession(sessionId: number): void {
	void goto(sessionAddress(sessionId))
}
