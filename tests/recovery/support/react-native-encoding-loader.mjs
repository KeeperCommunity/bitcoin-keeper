// Node's conditional `node` encoding branch assumes its native TextDecoder.
// Select the package's actual default JS files for this absent-globals lane;
// the separate real Metro proof checks the same mobile-resolution boundary.
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@exodus/bytes/')) {
    return nextResolve(specifier, {
      ...context,
      conditions: context.conditions.filter((condition) => condition !== 'node'),
    });
  }
  return nextResolve(specifier, context);
}
