import { fileURLToPath } from 'node:url';

const visitedPaths = new Set();

async function resolveWithExtensions(specifier, context, nextResolve) {
    return Promise.any([
        nextResolve(`${specifier}.js`, context),
        nextResolve(`${specifier}.mjs`, context),
        nextResolve(`${specifier}.cjs`, context),
    ]);
}

export async function resolve(specifier, context, nextResolve) {
    let resolved;
    try {
        resolved = await nextResolve(specifier, context);
    } catch (error) {
        if (typeof specifier !== 'string' || error.code !== 'ERR_MODULE_NOT_FOUND') {
            throw error;
        }
        if (!/.*\.(m|c)js/.test(specifier)) {
            resolved = await resolveWithExtensions(specifier, context, nextResolve);
        }
    }
    if (context.parentURL !== undefined) {
        visitedPaths.add(resolved.url);
    }
    return resolved;
}

export async function load(url, context, nextLoad) {
    const source = await nextLoad(url);
    if (!visitedPaths.has(url) || context.format !== 'module') {
        return source;
    }
    source.source = `
        import { watch } from 'node:fs';
        import * as value from 'data:text/javascript,${encodeURIComponent(source.source.toString())}';

        const overrides = {};
        const proxy = new Proxy(value, {
            get(target, prop) {
                return Reflect.get(overrides, prop) ?? Reflect.get(target, prop);
            },
            set(target, prop, value) {
                return Reflect.set(overrides, prop, value);
            }
        });

        watch('${fileURLToPath(url)}', (event, filename) => {
            if (event !== 'change') return;
            import('${fileURLToPath(url)}?${Date.now()}').then(val => Object.assign(proxy, val.default)).catch(console.error);
        }).unref();

        export default proxy;
    `;
    return source;
}
