/**
 * 🚧 `models:hubCard` — one Hugging Face repo's card facts and file sizes for
 * the finder model page. Admin only (members never touch model plumbing).
 * Asked only when the page opens; the card is cached a day. Failures arrive
 * on the reply's own `error`, as `models:machineHardware` does.
 */
import type { Handler } from "$lib/shared/events"
import {
	fetchHfRepoCard,
	hfRepoReadCached
} from "$lib/server/connections/hfGgufQuants"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"

const REPO_RE = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/
const LIMIT_KEY = "models:hubCard"
const NO_ANSWER = "Hugging Face would not answer for that repo."

export const modelsHubCard: Handler<
	Sockets.Models.HubCard.Params,
	Sockets.Models.HubCard.Response
> = {
	event: "models:hubCard",
	handler: async (socket, params, emitToUser) => {
		const repo = typeof params?.repo === "string" ? params.repo.trim() : ""
		const res = await answer(socket.user!.isAdmin, repo)
		emitToUser("models:hubCard", res)
		return res
	}
}

async function answer(
	isAdmin: boolean,
	repo: string
): Promise<Sockets.Models.HubCard.Response> {
	if (!isAdmin)
		return {
			repo,
			error: "Access denied. Only admin users can read Hugging Face model cards."
		}
	if (repo.length > 200 || repo.includes("..") || !REPO_RE.test(repo))
		return { repo, error: "That is not a Hugging Face repo id." }
	try {
		if (!hfRepoReadCached(repo)) {
			if (loginRateLimit.isRateLimited(LIMIT_KEY))
				return {
					repo,
					error: "Rate limited. Please wait a moment and try again."
				}
			loginRateLimit.recordFailedAttempt(LIMIT_KEY)
		}
		const { card, siblings } = await fetchHfRepoCard(repo)
		if (!card && !siblings) return { repo, error: NO_ANSWER }
		const res: Sockets.Models.HubCard.Response = { repo }
		if (card) res.card = card
		if (siblings)
			res.files = siblings
				.filter((s) => s.rfilename.endsWith(".gguf"))
				.map((s) =>
					typeof s.size === "number"
						? { rfilename: s.rfilename, size: s.size }
						: { rfilename: s.rfilename }
				)
		return res
	} catch (error: any) {
		console.error("Hub card error:", error)
		return { repo, error: NO_ANSWER }
	}
}

export function registerModelHubCardHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, modelsHubCard, emitToUser)
}
