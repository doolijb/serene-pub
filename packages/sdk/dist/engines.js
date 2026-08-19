/**
 * Template engines are a registry, not a hardcoded choice (F2 — types are open
 * registries, ids namespaced, `core:` reserved).
 *
 * `SlotDecl.engine` used to be the literal `'jinja2'`, which quietly said "there is one
 * template language and core owns it." An extension shipping its own compiler had nowhere
 * to register it, and a template slot had no way to say what it was written in. Now the
 * engine is a versioned id like everything else, and it travels **on the template value**
 * — so two slots in one spec may use different engines.
 *
 * That is safe for a reason worth stating: source templates render *before* Assemble
 * (16 §3b, enforced by port shapes), so only text crosses into allocation. Mixing engines
 * cannot confuse the budget, because the budget never sees a template — it sees rendered
 * blocks and a cost profile.
 *
 * ## The cost profile is why this interface has four members instead of one
 *
 * The budget guarantee (16 §7) is that Assemble's estimate is a **ceiling**: literals are
 * counted exactly, per-iteration literals are counted once and multiplied, conditionals
 * take their largest branch. That is a static analysis of the template, so it can only be
 * done by whoever understands the syntax — the engine.
 *
 * An engine that cannot analyse itself is still legal. It reports `exact: false`, Assemble
 * widens its safety margin, and the receipt records that the estimate was approximate. So
 * a sloppy engine costs its users context headroom rather than correctness — a pressure
 * gradient rather than a ban.
 */
import { render as renderJinja, extractRefs, checkTemplate } from "./template.js";
const engines = new Map();
export function defineEngine(e) {
    if (engines.has(e.id))
        throw new Error(`duplicate template engine id: ${e.id}`);
    engines.set(e.id, e);
    return e;
}
export const getEngine = (id) => engines.get(id);
export const allEngines = () => [...engines.values()];
export function _clearEngines() {
    engines.clear();
}
/** Resolve and render, with an error that names the engine rather than failing obscurely. */
export function renderWith(value, scope) {
    const e = engines.get(value.engine);
    if (!e) {
        throw new Error(`no template engine registered for '${value.engine}'. ` +
            `Available: ${allEngines()
                .map((x) => x.id)
                .join(", ") || "none"}. ` +
            `An engine ships with the plugin that declares it — this usually means the plugin is disabled.`);
    }
    return e.render(value.source, scope);
}
// ── Core engines ────────────────────────────────────────────────────────────
/**
 * Split a source into literal text and the structural tags around it. Deliberately
 * crude — it is the toy engine's profiler, and its job here is to demonstrate the
 * contract, not to be a Jinja parser.
 */
function jinjaCost(source, count) {
    const loops = [
        ...source.matchAll(/\{%\s*for\s+\w+\s+in\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g)
    ];
    const perIteration = {};
    let body = source;
    for (const m of loops) {
        // Literal text inside the loop, minus expansions: counted once, charged per item.
        const literal = m[2].replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "");
        perIteration[m[1]] = (perIteration[m[1]] ?? 0) + count(literal);
        body = body.replace(m[0], "");
    }
    const fixedLiteral = body.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "");
    return { fixed: count(fixedLiteral), perIteration, exact: true };
}
export const jinja2 = defineEngine({
    id: "core:template/jinja2@1",
    label: "Jinja2",
    render: renderJinja,
    extract: (s) => [...new Set(extractRefs(s).map((r) => r.path.join(".")))],
    check: checkTemplate,
    costProfile: jinjaCost
});
/**
 * No substitution at all. Useful on its own — a fixed system preamble is a template with
 * no variables — and useful as the reference implementation of an exact cost profile.
 */
export const plain = defineEngine({
    id: "core:template/plain@1",
    label: "Plain text",
    render: (s) => s,
    extract: () => [],
    check: () => [],
    costProfile: (s, count) => ({
        fixed: count(s),
        perIteration: {},
        exact: true
    })
});
/**
 * Handlebars — **the engine Serene Pub's context templates are actually written in.**
 *
 * Registered as a declaration rather than an implementation: a template's engine is a
 * datapoint on the slot (12 §2a), and the host supplies the renderer. The SDK ships no
 * Handlebars dependency, so `render` here refuses rather than silently producing
 * something that is not what core would produce — a near-miss renderer is worse than an
 * absent one, because parity would fail in a way that looks like a template bug.
 *
 * The correction this represents is worth stating: the draft assumed Jinja throughout,
 * and every core template in SP is Handlebars with a registered helper set. The
 * template-engine registry is exactly the mechanism that makes that a one-line change
 * rather than a redesign, which is the argument for having built it.
 */
export const handlebars = defineEngine({
    id: "core:template/handlebars@1",
    label: "Handlebars",
    render: () => {
        throw new Error("the Handlebars engine is host-supplied: core renders with its own registered " +
            "helper set, and a second implementation here would differ in ways that read " +
            "as template bugs");
    },
    // `{{a.b}}`, `{{#each xs}}`, `{{#if x}}` — enough to answer "what does this template
    // reference", which is what variable-awareness needs (16 §4).
    // Two patterns, not one: a single pattern with an optional keyword backtracks on
    // `{{/each}}` and reports `each` as a variable, and a diagnostics list with helper
    // names in it teaches a user to distrust the panel.
    // One pass, in source order. The lookahead skips closing tags outright —
    // without it, `{{/each}}` backtracks into reporting `each` as a variable.
    extract: (s) => {
        const found = new Set();
        for (const m of s.matchAll(/\{\{(?!\/)#?\s*(?:each|if|unless|with)?\s*([\w.]+)/g))
            if (m[1] && m[1] !== "this")
                found.add(m[1]);
        return [...found];
    },
    check: () => [],
    // Not exact: the helper set can expand a reference into arbitrary text, so a
    // character count is an estimate and says so (16 §7a).
    costProfile: (s, count) => ({
        fixed: count(s),
        perIteration: {},
        exact: false
    })
});
/** Sugar so a spec reads `template: jinja(SOURCE)` rather than repeating the id. */
export const templateOf = (engine) => (source) => ({ engine: engine.id, source });
export const jinja = templateOf(jinja2);
export const text = templateOf(plain);
//# sourceMappingURL=engines.js.map