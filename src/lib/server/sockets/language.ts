/**
 * The UI language catalog (R5, phase 1b).
 *
 * One handler, because the client only ever asks one question: *"what do these
 * English strings say in my language?"* Which language that is never travels in
 * the request — it is resolved server-side from the caller's own settings, so a
 * client cannot ask for a catalog in a language its user did not choose, and
 * cannot get a different answer than the one the app is drawn in.
 */
import type { Handler } from "$lib/shared/events"
import type { AuthenticatedSocket } from "./auth"
import { resolveUserLanguage } from "$lib/server/i18n"
import { translateUiStrings } from "$lib/server/i18n/translate"
import { isSupportedLanguage } from "$lib/shared/i18n/languages"

/**
 * How many sources one request may name.
 *
 * Larger than the engine-call cap in `server/i18n/translate.ts` on purpose: cache *hits* are one
 * indexed query however many there are, so a screen with two hundred already
 * translated strings should get them all in one round trip. It is only the
 * misses — the ones that cost an outbound HTTP call each — that are capped
 * tighter, downstream.
 */
export const MAX_SOURCES_PER_REQUEST = 500

export const languageCatalog: Handler<
	Sockets.Language.Catalog.Params,
	Sockets.Language.Catalog.Response
> = {
	event: "language:catalog",
	handler: async (socket: AuthenticatedSocket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			if (!userId) throw new Error("User not authenticated")

			const { code } = await resolveUserLanguage(userId)
			const sources = Array.isArray(params?.sources)
				? params.sources.slice(0, MAX_SOURCES_PER_REQUEST)
				: []

			const { entries } = await translateUiStrings(code, sources)

			const res: Sockets.Language.Catalog.Response = {
				language: code,
				entries
			}
			emitToUser("language:catalog", res)
			return res
		} catch (error: any) {
			console.error("Error building language catalog:", error)
			// Answers with the caller's language and an empty catalog rather
			// than an `:error` event. There is nothing for a client to do about
			// this that differs from what it already does with a string it has
			// no translation for — show the English — and an error here would
			// turn a degraded screen into a broken one.
			const res: Sockets.Language.Catalog.Response = {
				language: "en",
				entries: {}
			}
			emitToUser("language:catalog", res)
			return res
		}
	}
}

/**
 * Guard shared by the two writers.
 *
 * Refusing an unknown code rather than storing it is what keeps
 * `resolveUserLanguage`'s "unknown resolves to English" a *downgrade* path
 * rather than the normal one — a code that got in here would silently render
 * the whole instance in English with a setting that says otherwise.
 */
export function assertSupportedLanguage(language: unknown): string {
	if (typeof language !== "string" || !isSupportedLanguage(language)) {
		throw new Error(`Unsupported language: ${String(language)}`)
	}
	return language
}

export function registerLanguageHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, languageCatalog, emitToUser)
}
