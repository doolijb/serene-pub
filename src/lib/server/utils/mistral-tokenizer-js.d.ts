// `mistral-tokenizer-js` ships no type declarations and has no published
// @types package, so TypeScript can't resolve it (see the error this file
// fixes: "Could not find a declaration file for module
// 'mistral-tokenizer-js'"). This declares the minimal surface actually used
// in this codebase (see TokenCounterManager.ts).
declare module "mistral-tokenizer-js" {
	interface MistralTokenizer {
		encode(text: string): number[]
		decode(tokens: number[]): string
	}
	const mistralTokenizer: MistralTokenizer
	export default mistralTokenizer
}
