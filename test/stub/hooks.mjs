// Module resolve hook: maps "@github/copilot-sdk/extension" to the test stub.
export async function resolve(specifier, context, next) {
  if (specifier === "@github/copilot-sdk/extension") {
    return { url: new URL("./sdk-extension.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
