/**
 * Plugin settings — the schema an extension declares, and the four things core does
 * with it (12 §6).
 *
 * 12 §6 promises "the same schema strategy as node config and review steps — one
 * renderer, three uses." That promise is only real if it is literally the same
 * declaration, so `FieldDecl` here is the same shape node `params` use, plus the two
 * fields that only mean something for plugin settings (`scope`, `side`). An extension
 * author who has written a node's `params` schema already knows this one.
 *
 * One declaration, four uses:
 *
 *   1. **The form** core renders in plugin settings — no UI work by the author.
 *   2. **Validation** of stored values, on save and on update.
 *   3. **The manifest entry**, extracted statically by the compiler — never by running
 *      the author's code (F6, 03 §3).
 *   4. **Typed access** from the extension's own hooks: `settings.values` is inferred,
 *      so `apiKey` is a `SecretValue` and a mistyped key does not compile.
 *
 * ## The `secret` field, and why it is typed
 *
 * The ruling that produced this reads backwards at first. "SP declines custody of plugin
 * secrets" sounds safer than storing them — but an extension keeping credentials in its
 * own data directory has no key and no crypto facility, so the realistic outcome is
 * plaintext on the user's disk, unencrypted *and* unauditable. Declining custody produced
 * the worse result (13 §6).
 *
 * What makes accepting it defensible is that the field is **typed**, which is what lets
 * core mechanically redact it from receipts (F16), exclude it from export (12 §7) and
 * keep it write-only in the UI. A free-form column cannot tell a key from a note.
 */
export const secret = (value) => ({ $secret: true, value });
export const isSecret = (v) => !!v && typeof v === 'object' && v.$secret === true;
// ── Declaration-time checks ─────────────────────────────────────────────────
/** Mistakes that would otherwise become silent leaks or dead form fields. */
export function checkSchema(schema) {
    const f = [];
    for (const [key, d] of Object.entries(schema)) {
        if (d.type === 'secret') {
            if (d.side === 'component') {
                f.push({
                    field: key,
                    severity: 'error',
                    message: `'${key}' is a secret declared component-side`,
                    fix: 'a component runs in the browser, so the value would be delivered to the client — declare it extension-side',
                });
            }
            if (d.default !== undefined) {
                f.push({
                    field: key,
                    severity: 'error',
                    message: `'${key}' is a secret with a default`,
                    fix: 'remove it — a shipped default credential is not a credential',
                });
            }
        }
        if (d.type === 'enum' && !d.of?.length && !d.from) {
            f.push({
                field: key,
                severity: 'error',
                message: `'${key}' is an enum with no options`,
                fix: "declare `of: ['a','b'] as const`, or source them from the connection with `from`",
            });
        }
        if (d.required && d.default !== undefined) {
            f.push({
                field: key,
                severity: 'warning',
                message: `'${key}' is required and has a default, so it can never be unset`,
                fix: 'drop `required`, or drop the default if the admin genuinely has to choose',
            });
        }
        if (d.showIf && !schema[d.showIf.field]) {
            f.push({
                field: key,
                severity: 'error',
                message: `'${key}' is shown conditionally on '${d.showIf.field}', which is not a field`,
                fix: `name a field this schema declares (${Object.keys(schema).join(', ')})`,
            });
        }
    }
    return f;
}
// ── Value validation ────────────────────────────────────────────────────────
export function checkValues(schema, values) {
    const f = [];
    for (const [key, d] of Object.entries(schema)) {
        const v = values[key];
        if (v === undefined || v === null) {
            if (d.required && d.default === undefined) {
                f.push({
                    field: key,
                    severity: 'error',
                    message: `'${key}' is required and not set`,
                    fix: `set it in plugin settings — the plugin stays installed and listed until then, it is not broken`,
                });
            }
            continue;
        }
        const bad = (why, fix) => f.push({ field: key, severity: 'error', message: `'${key}' ${why}`, fix });
        switch (d.type) {
            case 'secret':
                if (!isSecret(v))
                    bad('is not a secret value', 'write it through the settings form; secrets are never set as plain strings');
                break;
            case 'boolean':
                if (typeof v !== 'boolean')
                    bad(`should be a boolean, got ${typeof v}`, 'store true or false');
                break;
            case 'integer':
            case 'number': {
                if (typeof v !== 'number' || Number.isNaN(v)) {
                    bad(`should be a number, got ${typeof v}`, 'store a number');
                    break;
                }
                if (d.type === 'integer' && !Number.isInteger(v))
                    bad('should be a whole number', 'round it, or declare the field as `number`');
                if (d.min !== undefined && v < d.min)
                    bad(`is below the minimum ${d.min}`, `use a value ≥ ${d.min}`);
                if (d.max !== undefined && v > d.max)
                    bad(`is above the maximum ${d.max}`, `use a value ≤ ${d.max}`);
                break;
            }
            case 'enum':
                if (d.of && !d.of.includes(v))
                    bad(`is not one of ${d.of.join(', ')}`, `use one of: ${d.of.join(', ')}`);
                break;
            case 'string[]':
                if (!Array.isArray(v))
                    bad('should be a list of strings', 'store an array');
                break;
            default:
                if (typeof v !== 'string')
                    bad(`should be a string, got ${typeof v}`, 'store a string');
        }
    }
    return f;
}
/**
 * What an update does to values that already exist.
 *
 * The rule is the one 12 §5 already applies to a node swap's orphaned slots: **unmigrated
 * values land in diagnostics rather than disappearing.** An author who renames a field
 * and an admin who then downgrades should both get their data back; silently dropping it
 * makes the update irreversible in the one direction that matters.
 */
export function reconcile(schema, stored) {
    const values = {};
    const orphaned = [];
    for (const [key, d] of Object.entries(schema)) {
        values[key] = key in stored ? stored[key] : d.default;
    }
    for (const [key, value] of Object.entries(stored)) {
        if (key in schema)
            continue;
        orphaned.push({
            field: key,
            value: isSecret(value) ? '[secret]' : value,
            reason: 'the updated schema no longer declares this field',
        });
    }
    return { values, orphaned, findings: checkValues(schema, values) };
}
// ── The three audiences ─────────────────────────────────────────────────────
/** What the settings form sends back. A secret reports only whether it is set. */
export function forClient(schema, values) {
    const out = {};
    for (const [key, d] of Object.entries(schema)) {
        out[key] = d.type === 'secret' ? { $secretSet: isSecret(values[key]) } : values[key];
    }
    return out;
}
/** What an export carries. Secrets never leave, on the same footing as credentials. */
export function forExport(schema, values) {
    const out = {};
    for (const [key, d] of Object.entries(schema)) {
        if (d.type === 'secret')
            continue;
        out[key] = values[key];
    }
    return out;
}
/**
 * What the declaring extension's own hook receives — the only place plaintext appears,
 * and only for the extension that owns the field. Same shape as F18's per-call injection
 * of connection material.
 */
export function forOwningHook(schema, values, decrypt) {
    const out = {};
    for (const [key, d] of Object.entries(schema)) {
        const v = values[key];
        out[key] = d.type === 'secret' && isSecret(v) ? decrypt(v.value) : v;
    }
    return out;
}
/** What a component receives at render — extension-side fields never reach the browser. */
export function forComponent(schema, values) {
    const out = {};
    for (const [key, d] of Object.entries(schema)) {
        if (d.side !== 'component')
            continue;
        out[key] = values[key];
    }
    return out;
}
export function configState(schema, values) {
    const missing = Object.entries(schema)
        .filter(([k, d]) => d.required && d.default === undefined && (values[k] === undefined || values[k] === null))
        .map(([k]) => k);
    if (!missing.length)
        return { state: 'ready' };
    return {
        state: 'needs-configuration',
        missing,
        message: `waiting on ${missing.join(', ')} in plugin settings`,
    };
}
/** Declaration order within a group; group order is first appearance. */
export function formLayout(schema) {
    const groups = [];
    for (const [key, decl] of Object.entries(schema)) {
        const name = decl.group ?? 'General';
        let g = groups.find((x) => x.group === name);
        if (!g)
            groups.push((g = { group: name, fields: [] }));
        g.fields.push({ key, decl });
    }
    return groups;
}
/** Is this field currently shown, given the values? One level of `showIf`, no rules engine. */
export const isVisible = (decl, values) => !decl.showIf || values[decl.showIf.field] === decl.showIf.equals;
export class SettingsError extends Error {
}
/**
 * Declare a plugin's settings. The compiler extracts this statically into the manifest,
 * so it must be a literal — a schema assembled at runtime cannot be read without running
 * the author's code, which the packager never does (F6, 03 §3).
 */
export function defineSettings(schema) {
    const errs = checkSchema(schema).filter((x) => x.severity === 'error');
    if (errs.length) {
        throw new SettingsError('invalid settings schema:\n' + errs.map((e) => `  ${e.message}\n    → ${e.fix}`).join('\n'));
    }
    return {
        schema,
        defaults: () => Object.fromEntries(Object.entries(schema)
            .filter(([, d]) => d.default !== undefined)
            .map(([k, d]) => [k, d.default])),
        layout: () => formLayout(schema),
        check: (v) => checkValues(schema, v),
        reconcile: (v) => reconcile(schema, v),
        state: (v) => configState(schema, v),
        forClient: (v) => forClient(schema, v),
        forExport: (v) => forExport(schema, v),
        forComponent: (v) => forComponent(schema, v),
        forOwningHook: (v, d) => forOwningHook(schema, v, d),
    };
}
/** Back-compat alias for the earlier name. */
export const validateSettingsSchema = (s) => checkSchema(s).map((f) => f.message);
//# sourceMappingURL=settings.js.map