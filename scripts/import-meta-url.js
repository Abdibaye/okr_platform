import { fileURLToPath, pathToFileURL } from "node:url";

export function resolve(specifier, context, next) {
  if (specifier === "next/server" || specifier === "next/headers") return next(`${specifier}.js`, context, next);
  if (context.parentURL?.startsWith("file:") && /^[./]/.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
    return next(`${pathToFileURL(fileURLToPath(new URL(specifier, context.parentURL))).href}.ts`, context, next);
  }
  return next(specifier, context, next);
}
