import Handlebars from "handlebars"

/**
 * Context for template interpolation containing character and persona information
 */
export interface InterpolationContext {
	/** Current character name (primary assistant) */
	char: string
	/** Alias for char - current character name */
	character: string
	/** Current user/persona name */
	user: string
	/** Alias for user - current persona name */
	persona: string
	/** Any additional context variables */
	[key: string]: any
}

/**
 * Character data structure for interpolation
 */
export interface CharacterData {
	name: string
	nickname?: string
	description: string
	personality?: string
	[key: string]: any
}

/**
 * Persona data structure for interpolation
 */
export interface PersonaData {
	name: string
	description: string
	[key: string]: any
}

/**
 * A standalone interpolation engine for handling character/persona/user/char variable substitution
 * in templates throughout the application.
 */
export class InterpolationEngine {
	private handlebars: typeof Handlebars

	constructor(handlebarsInstance?: typeof Handlebars) {
		this.handlebars = handlebarsInstance || Handlebars.create()
	}

	/**
	 * Creates an interpolation context from character and persona information
	 */
	createInterpolationContext({
		currentCharacterName,
		currentPersonaName,
		additionalContext = {}
	}: {
		currentCharacterName: string
		currentPersonaName?: string
		additionalContext?: Record<string, any>
	}): InterpolationContext {
		const personaName = currentPersonaName || "user"
		
		return {
			char: currentCharacterName,
			character: currentCharacterName,
			user: personaName,
			persona: personaName,
			...additionalContext
		}
	}

	/**
	 * Interpolates a single string template with the given context
	 */
	interpolateString(
		template: string | undefined,
		context: InterpolationContext
	): string | undefined {
		if (!template) return template
		
		try {
			return this.handlebars.compile(template)(context)
		} catch (error) {
			console.warn("Template interpolation failed:", error)
			return template
		}
	}

	/**
	 * Interpolates multiple strings at once
	 */
	interpolateStrings(
		templates: Record<string, string | undefined>,
		context: InterpolationContext
	): Record<string, string | undefined> {
		const result: Record<string, string | undefined> = {}
		
		for (const [key, template] of Object.entries(templates)) {
			result[key] = this.interpolateString(template, context)
		}
		
		return result
	}

	/**
	 * Interpolates character data, applying context to name, nickname, description, and personality
	 */
	interpolateCharacterData(
		character: CharacterData,
		context: InterpolationContext
	): CharacterData {
		return {
			...character,
			name: this.interpolateString(character.name, context) || character.name,
			nickname: this.interpolateString(character.nickname, context),
			description: this.interpolateString(character.description, context) || character.description,
			personality: this.interpolateString(character.personality, context)
		}
	}

	/**
	 * Interpolates multiple characters at once
	 */
	interpolateCharacters(
		characters: CharacterData[],
		context: InterpolationContext
	): CharacterData[] {
		return characters.map(char => this.interpolateCharacterData(char, context))
	}

	/**
	 * Interpolates persona data, applying context to name and description
	 */
	interpolatePersonaData(
		persona: PersonaData,
		context: InterpolationContext
	): PersonaData {
		return {
			...persona,
			name: this.interpolateString(persona.name, context) || persona.name,
			description: this.interpolateString(persona.description, context) || persona.description
		}
	}

	/**
	 * Interpolates multiple personas at once
	 */
	interpolatePersonas(
		personas: PersonaData[],
		context: InterpolationContext
	): PersonaData[] {
		return personas.map(persona => this.interpolatePersonaData(persona, context))
	}

	/**
	 * Interpolates an object by applying context to all string values recursively
	 */
	interpolateObject<T extends Record<string, any>>(
		obj: T,
		context: InterpolationContext,
		stringFields?: (keyof T)[]
	): T {
		const result: Record<string, any> = { ...obj }
		
		// If specific string fields are provided, only interpolate those
		if (stringFields) {
			for (const field of stringFields) {
				if (typeof result[field as string] === 'string') {
					const interpolated = this.interpolateString(result[field as string] as string, context)
					result[field as string] = interpolated || result[field as string]
				}
			}
		} else {
			// Otherwise, interpolate all string values
			for (const [key, value] of Object.entries(result)) {
				if (typeof value === 'string') {
					const interpolated = this.interpolateString(value, context)
					result[key] = interpolated || value
				}
			}
		}
		
		return result as T
	}

	/**
	 * Creates a message-specific interpolation context that can override the main context
	 * for individual messages (useful when different characters/personas are speaking)
	 */
	createMessageContext(
		baseContext: InterpolationContext,
		overrides: Partial<InterpolationContext>
	): InterpolationContext {
		return {
			...baseContext,
			...overrides
		}
	}
}

/**
 * Creates a new InterpolationEngine instance
 */
export function createInterpolationEngine(handlebarsInstance?: typeof Handlebars): InterpolationEngine {
	return new InterpolationEngine(handlebarsInstance)
}

/**
 * Convenience function for simple string interpolation
 */
export function interpolateTemplate(
	template: string | undefined,
	context: InterpolationContext,
	handlebarsInstance?: typeof Handlebars
): string | undefined {
	const engine = new InterpolationEngine(handlebarsInstance)
	return engine.interpolateString(template, context)
}

/**
 * Convenience function to create basic interpolation context
 */
export function createBasicContext(
	characterName: string,
	personaName?: string
): InterpolationContext {
	const engine = new InterpolationEngine()
	return engine.createInterpolationContext({
		currentCharacterName: characterName,
		currentPersonaName: personaName
	})
}
