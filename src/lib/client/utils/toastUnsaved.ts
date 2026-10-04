import { toaster } from "$lib/client/utils/toaster"
import { isReplyTimeout } from "./awaitReply"

/**
 * A save `awaitReply` rejected, said once, as the asking surface's own toast.
 *
 * For a request whose `:error` Layout's catch-all leaves to the surface that
 * asked (`HANDLED_ERROR_EVENTS`): the server's own sentence under the action's
 * title — or, when nothing answered, that the draft is still here. A request
 * Layout still toasts says only its silence (`isReplyTimeout`), or the
 * refusal would be said twice.
 */
export function toastUnsaved(
	err: unknown,
	title: string,
	kept = "Your changes are still here."
): void {
	toaster.error({
		title,
		description: isReplyTimeout(err)
			? `The server did not answer in time. ${kept}`
			: err instanceof Error && err.message
				? err.message
				: undefined
	})
}
