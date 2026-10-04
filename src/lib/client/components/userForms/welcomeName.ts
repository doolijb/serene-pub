import { displayNameSchema } from "$lib/shared/validation/displayName"

/** The one call the welcome screen's name field needs from a socket. */
interface EmitsDisplayName {
	emit(
		event: "users:current:updateDisplayName",
		payload: { displayName: string }
	): unknown
}

/**
 * Save what the welcome screen's "What should we call you?" field holds, as
 * the person's display name. Optional: an empty field (or one that would not
 * pass the display-name rule) sends nothing, and the wizard moves on either
 * way. Returns whether a save was sent.
 */
export function saveWelcomeName(
	socket: EmitsDisplayName,
	value: string
): boolean {
	const parsed = displayNameSchema.safeParse(value)
	if (!parsed.success || parsed.data === null) return false
	socket.emit("users:current:updateDisplayName", { displayName: parsed.data })
	return true
}

/**
 * The welcome screen's save, and what it says if the server refuses it.
 *
 * The wizard moves on without waiting, so a refusal arrives after the field is
 * gone; and `users:current:updateDisplayName:error` is a handled event (Layout
 * leaves it to the surface that asked), so nothing else would say it. Only a
 * refusal of a save sent from here is said, once — a rename refused in
 * Settings › User is that tab's to say.
 */
export function welcomeNameSaver(
	socket: EmitsDisplayName,
	toast: (t: { title: string; description?: string }) => void
) {
	let pending = false
	return {
		/** `saveWelcomeName`, remembering that a save is in flight. */
		save(value: string): boolean {
			const sent = saveWelcomeName(socket, value)
			if (sent) pending = true
			return sent
		},
		/** The save landed. */
		saved() {
			pending = false
		},
		/** The server refused a display name. */
		refused(message: { error?: string }) {
			if (!pending) return
			pending = false
			toast({
				title: "Your name wasn't saved",
				description: `${message.error || "The server refused it."} You can set it in Settings › User.`
			})
		}
	}
}
