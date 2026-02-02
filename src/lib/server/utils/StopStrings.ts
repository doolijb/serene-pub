import { PromptFormats } from "$lib/shared/constants/PromptFormats"

export class StopStrings {
	static get({
		format,
		characters,
		personas,
		currentCharacterId
	}: {
		format: (typeof PromptFormats.keys)[0]
		characters: SelectCharacter[]
		personas: SelectPersona[]
		currentCharacterId?: number
	}): string[] {
		let stopStrings: string[] = []

		switch (format) {
			case PromptFormats.CHATML:
				stopStrings = ["<|im_start|>", "<|im_end|>"]
				break
			case PromptFormats.BASIC:
				stopStrings = [
					"system:",
					"System:",
					"user:",
					"User:",
					"assistant:",
					"Assistant:"
				]
				break
			case PromptFormats.VICUNA:
				stopStrings = [
					"</s>",
					"system:",
					"System:",
					"user:",
					"User:",
					"assistant:",
					"Assistant:"
				]
				break
			case PromptFormats.OPENAI:
				stopStrings = [
					"system:",
					"System:",
					"user:",
					"User:",
					"assistant:",
					"Assistant:"
				]
				break
			case PromptFormats.LLAMA2_INST:
				stopStrings = ["</s>", "User:", "Assistant:", "System:"]
				break
			default:
				stopStrings = [
					"system:",
					"System:",
					"user:",
					"User:",
					"assistant:",
					"Assistant:"
				]
		}

		// Iterate through characters and personas to add their names
		characters.forEach((character) => {
			if (character.id === currentCharacterId) {
				// Skip the current character to avoid premature stops
				return
			}
			if (character.name) {
				const charStop = `${character.name}:`
				stopStrings.push(charStop)
			}
			if (character.nickname) {
				const charStop = `${character.nickname}:`
				stopStrings.push(charStop)
			}
		})
		personas.forEach((persona) => {
			if (persona.name) {
				const userStop = `${persona.name}:`
				stopStrings.push(userStop)
			}
		})

		return stopStrings
	}
}
