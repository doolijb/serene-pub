/**
 * Turning a stored session row's text into the text a model sees.
 *
 * Two transforms, both applied on the way *out* of the database and never on
 * the way in: macro interpolation ({{char}}, {{user}}) against the speaking
 * character, and swipe selection — a message row carries every swipe, and only
 * the active one is rendered. The stored row is left alone so a swipe can be
 * re-picked and a macro re-resolved against a renamed character.
 *
 * Used by `messages.ts` for the session transcript and by `postHistory.ts` for the
 * block that follows it, which is why it lives apart from either.
 */
import type { InterpolationContext } from "$lib/server/utils/interpolation/InterpolationEngine"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import { envoySlugOfRef, i18nText } from "@serene-pub/sdk"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"

/** An envoy as the cast read carries it — a seat joined to its declaration. */
interface CastEnvoy {
	slug: string
	name?: unknown
	fallback?: boolean
}

/**
 * A person's own line's last-resort name, when no persona and no member names
 * it — the word the host's `session_messages` read already gives such a row
 * (`host.ts`, `senderName`). Never an empty name (lair pass B11).
 */
const USER_LINE_NAME = "User"

/** A declared name (plain string or locale map) as prompt text. */
const envoyText = (name: unknown): string =>
	(i18nText(name as any, "en") ?? "").trim()

// Define processed session message format
export interface ProcessedSessionMessage {
	id: number
	role: "assistant" | "user"
	name: string
	message: string | undefined
}

/**
 * Base interface for content processors that handle specific content types
 */
export interface ContentProcessor<TInput, TOutput = TInput> {
	/**
	 * Process an individual content item
	 */
	processItem(
		item: TInput,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): TOutput | null

	/**
	 * Check if an item should be included based on priority and other criteria
	 */
	shouldInclude(item: TInput, priority: number): boolean
}

/**
 * Processes session messages with interpolation and role/name assignment
 */
export class SessionMessageProcessor
	implements ContentProcessor<SelectSessionMessage, ProcessedSessionMessage>
{
	constructor(
		private session: any, // BasePromptSession type
		private interpolationEngine: any, // InterpolationEngine type
		private options: {
			/** The session's narrator name — the unclaimed line's second fallback. */
			narratorName?: string | null
		} = {}
	) {}

	/** Every envoy the cast knows of: seated ones, then declared-only ones. */
	private envoys(): CastEnvoy[] {
		return [
			...((this.session?.envoys as CastEnvoy[] | undefined) ?? []),
			...((this.session?.declaredEnvoys as CastEnvoy[] | undefined) ?? [])
		]
	}

	/**
	 * An envoy's line's name: its declared name, else its slug — the same
	 * rule the session view renders it under (`messageSpeaker.ts`). Never the
	 * turn's speaker: a Referee's ruling labelled as Alice's is read as hers.
	 */
	private envoyName(slug: string): string {
		const envoy = this.envoys().find((e) => e.slug === slug)
		return (envoy && envoyText(envoy.name)) || slug
	}

	/**
	 * The name a line nobody claims renders under (ruled 2026-09-26:
	 * "everyone should have names") — the pipeline's own voice, named by
	 * the one rule the page reads too (`ownVoiceName`, lair re-plan R5): the
	 * genre's fallback envoy, the session's narrator name, then the SDK's
	 * `UNCLAIMED_LINE_NAME`. Never "Unknown", and never this turn's speaker.
	 */
	private unclaimedName(): string {
		return ownVoiceName({
			envoys: this.envoys(),
			narratorName: this.options.narratorName
		})
	}

	/**
	 * The name a person's own line takes when no persona names it: the
	 * member's display name (the cast read's `memberNames`, display name else
	 * username — the view's `getMessageCharacter` rule), else `USER_LINE_NAME`.
	 */
	private memberName(userId: number | null | undefined): string {
		const names = this.session?.memberNames as
			| Record<number, string>
			| undefined
		return (
			(userId != null && names?.[userId]?.trim()) || USER_LINE_NAME
		)
	}

	/**
	 * What the genre calls a person's persona-less line (lair re-plan R4):
	 * the cast read's `playerLabel` — the session's override, else the
	 * genre's `GenreDecl.playerLabel`, already resolved by the host. Absent
	 * for every genre that declares none, which is what keeps their prompts
	 * byte-identical.
	 */
	private playerLabel(): string | undefined {
		const label = this.session?.playerLabel
		return typeof label === "string" && label.trim() ? label.trim() : undefined
	}

	processItem(
		message: SelectSessionMessage,
		context: {
			interpolationContext: InterpolationContext
			charName: string
			personaName: string
			priority: number
		}
	): ProcessedSessionMessage | null {
		const { interpolationContext, charName, personaName } = context

		// Create message-specific interpolation context
		let msgInterpolationContext = { ...interpolationContext }
		let assistantName = charName
		let userName = personaName

		// Narrator response messages have no characterId/personaId of their own
		// to resolve a name from — without this, they fall through to
		// whichever name this call's default happens to be (the *current*
		// speaking character, or the joined cast list in no-perspective
		// mode), mislabeling every past narration line in history with the
		// wrong speaker. Use the name snapshotted on the message itself
		// (set once at trigger time, matching how it's displayed) instead.
		const envoySlug = envoySlugOfRef((message.metadata as any)?.speaker)
		if ((message as any).isNarratorResponse) {
			const narratorName =
				(message.metadata as any)?.narratorName || "Narrator"
			assistantName = narratorName
			msgInterpolationContext = {
				...msgInterpolationContext,
				char: narratorName,
				character: narratorName
			}
		}
		// An envoy's line (U5g): named by reference, no character row. Its
		// declared name labels it and is `{{char}}` inside it, as the
		// narrator's is above.
		else if (envoySlug) {
			const name = this.envoyName(envoySlug)
			if (message.role === "assistant") assistantName = name
			msgInterpolationContext = {
				...msgInterpolationContext,
				char: name,
				character: name
			}
		}
		// Handle character-specific context
		else if (message.characterId) {
			// Active participants first; a removed participant's row won't
			// be in this.session.sessionCharacters (getPromptSessionFromDb filters it
			// out for every "who's active" consumer), but their past
			// messages still need to resolve a name — fall back to the
			// separately-supplied removed list, then to the removedAt-time
			// name snapshot if the entity itself has since been deleted
			// globally too.
			const foundChar = this.session.sessionCharacters?.find(
				(cc: any) => cc.character.id === message.characterId
			)?.character
			let foundName: string | undefined
			if (foundChar) {
				foundName = resolveCharacterName(foundChar)
			} else {
				const removedCC = this.session.removedSessionCharacters?.find(
					(cc: any) => cc.characterId === message.characterId
				)
				if (removedCC) {
					foundName = resolveCharacterName(
						removedCC.character,
						removedCC.removedName || this.unclaimedName()
					)
				}
			}
			// A speaker the cast cannot name is still not this turn's.
			if (message.role === "assistant") {
				assistantName = foundName || this.unclaimedName()
			}
			const name = foundName || this.unclaimedName()
			msgInterpolationContext = {
				...msgInterpolationContext,
				char: name,
				character: name
			}
		}
		// A line nobody claims — no character, persona, envoy or narration.
		// Rows written before the host stamped the fallback envoy at the
		// write are these; they are the unclaimed name's, not this turn's
		// speaker's. A player's own line keeps the persona name below.
		else if (!message.personaId && message.role === "assistant") {
			assistantName = this.unclaimedName()
		}

		// Handle persona-specific context
		if (message.personaId) {
			const foundPersona = this.session.sessionPersonas?.find(
				(cp: any) => cp.persona.id === message.personaId
			)?.persona
			let foundName: string | undefined
			if (foundPersona) {
				foundName = resolvePersonaName(foundPersona)
			} else {
				const removedCP = this.session.removedSessionPersonas?.find(
					(cp: any) => cp.personaId === message.personaId
				)
				if (removedCP) {
					foundName = resolvePersonaName(
						removedCP.persona,
						removedCP.removedName || this.unclaimedName()
					)
				}
			}
			if (foundName) {
				userName = foundName
				msgInterpolationContext = {
					...msgInterpolationContext,
					user: userName,
					persona: userName
				}
			}
		}

		// A person speaking as themselves (lair pass B11): a genre with no
		// persona system leaves `{{user}}` empty, and an empty name prompts
		// as `": …"`. Named as the session view names the line — the member
		// it belongs to — and never empty. Only when nothing above named it,
		// so a persona genre's prompt is byte-for-byte what it was.
		//
		// The genre's `playerLabel` comes first (R4): the Lair's person is
		// the "Dungeon Master" in every transcript, whoever is typing. On a
		// `user` row only — the label names a person's line, not a system one.
		if (message.role !== "assistant" && !userName?.trim())
			userName =
				(message.role === "user" && this.playerLabel()) ||
				this.memberName(message.userId)

		return {
			id: message.id,
			role:
				message.role === "user" || message.role === "assistant"
					? message.role
					: "assistant",
			name: message.role === "assistant" ? assistantName : userName,
			message: this.interpolationEngine.interpolateString(
				message.content,
				msgInterpolationContext
			)
		}
	}

	shouldInclude(message: SelectSessionMessage, priority: number): boolean {
		// Messages can be included at any priority
		return true
	}
}
