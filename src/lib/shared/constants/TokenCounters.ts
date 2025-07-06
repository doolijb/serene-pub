export class TokenCounterOptions {
    static readonly ESTIMATE = "estimate";
    static readonly OPENAI_GPT2 = "openai-gpt2";
    static readonly OPENAI_GPT35 = "openai-gpt3.5";
    static readonly OPENAI_GPT4 = "openai-gpt4";
    static readonly OPENAI_GPT4O = "openai-gpt4o";
    static readonly LLAMA = "llama";
    static readonly LLAMA3 = "llama3";
    static readonly MISTRAL = "mistral";
    static readonly ANTHROPIC_CLAUDE = "anthropic-claude";
    static readonly COHERE = "cohere";
    static readonly GEMINI = "gemini";
    static readonly GEMMA = "gemma";

    static readonly keys = [
        TokenCounterOptions.ESTIMATE,
        TokenCounterOptions.OPENAI_GPT2,
        TokenCounterOptions.OPENAI_GPT35,
        TokenCounterOptions.OPENAI_GPT4,
        TokenCounterOptions.OPENAI_GPT4O,
        TokenCounterOptions.LLAMA,
        TokenCounterOptions.LLAMA3,
        TokenCounterOptions.MISTRAL,
        TokenCounterOptions.ANTHROPIC_CLAUDE,
        TokenCounterOptions.COHERE,
        TokenCounterOptions.GEMINI,
        TokenCounterOptions.GEMMA
    ];

    static readonly options = [
        { value: TokenCounterOptions.ESTIMATE, label: "Estimate" },
        { value: TokenCounterOptions.OPENAI_GPT2, label: "OpenAI GPT-2/3" },
        { value: TokenCounterOptions.OPENAI_GPT35, label: "OpenAI GPT-3.5 Turbo" },
        { value: TokenCounterOptions.OPENAI_GPT4, label: "OpenAI GPT-4" },
        { value: TokenCounterOptions.OPENAI_GPT4O, label: "OpenAI GPT-4o" },
        { value: TokenCounterOptions.LLAMA, label: "Llama" },
        { value: TokenCounterOptions.LLAMA3, label: "Llama 3" },
        { value: TokenCounterOptions.MISTRAL, label: "Mistral/Mixtral" },
        { value: TokenCounterOptions.ANTHROPIC_CLAUDE, label: "Anthropic Claude" },
        { value: TokenCounterOptions.COHERE, label: "Cohere" },
        { value: TokenCounterOptions.GEMINI, label: "Google Gemini/PaLM" },
        { value: TokenCounterOptions.GEMMA, label: "Google Gemma" },
    ];
}
