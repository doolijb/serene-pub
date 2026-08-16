/**
 * GBNF grammar constraining generation to a single JSON object.
 *
 * Verbatim from llama.cpp's shipped `grammars/json.gbnf`, with the root
 * narrowed from `value` to `object` — we always want an object, never a bare
 * string or number at the top level.
 *
 * Source: https://github.com/ggerganov/llama.cpp — grammars/json.gbnf
 *
 * DO NOT hand-author a replacement. A GBNF with unbounded whitespace or an
 * unterminated string rule lets a model emit legal-but-infinite output, and the
 * symptom is a hung generation rather than a parse error — strictly worse than
 * the unconstrained prose this exists to prevent. `max_tokens` is the only
 * backstop either way, so start from the grammar that does not need one. The
 * `ws` rule below is bounded on purpose (at most one newline plus limited
 * indent) for that reason.
 *
 * That rule covers generated grammars too, and `jsonSchemaToGbnf` next door is
 * the proof: a schema→GBNF compiler is a hand-authored grammar with extra
 * steps. It reused these primitives verbatim and still hung KoboldCPP, because
 * the *structure* it wrapped them in emitted `ws` after values that already
 * owned one — ambiguous whitespace, exploding parse state, a pegged core that
 * reads as a dead subprocess. Copying the primitives is not the safeguard;
 * matching this grammar's whitespace discipline is. See the WHITESPACE
 * OWNERSHIP block there.
 *
 * Used by the adapters whose providers accept GBNF — KoboldCPP and llama.cpp.
 * Providers with a native JSON mode (Ollama's `format`, OpenAI's
 * `response_format`) use that instead and never see this string.
 */
export const JSON_OBJECT_GBNF = `root   ::= object
value  ::= object | array | string | number | ("true" | "false" | "null") ws

object ::=
  "{" ws (
            string ":" ws value
    ("," ws string ":" ws value)*
  )? "}" ws

array  ::=
  "[" ws (
            value
    ("," ws value)*
  )? "]" ws

string ::=
  "\\"" (
    [^"\\\\\\x7F\\x00-\\x1F] |
    "\\\\" (["\\\\bfnrt] | "u" [0-9a-fA-F]{4}) # escapes
  )* "\\"" ws

number ::= ("-"? ([0-9] | [1-9] [0-9]{0,15})) ("." [0-9]+)? ([eE] [-+]? [0-9]{1,3})? ws

# Optional space: by convention, applied in this grammar after literal chars when allowed
ws ::= | " " | "\\n" [ \\t]{0,20}
`
