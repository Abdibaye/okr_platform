# tRPC, version 1

Add when a typed server/client API is useful; this does not require a database. Run `pnpm add @trpc/server@11.18.0 @trpc/client@11.18.0 zod@4.5.4`. Copy the `.example` files to the same project-relative paths without the suffix, merging existing modules instead of replacing them.

In a client component call `trpc.greeting.query({ name: "Ada" })`; TypeScript knows the input and `{ message: string }` output. `pnpm check` must reject `{ name: 123 }`. Requests stay on `/api/trpc`, so neither build-time origin variables nor CORS are needed. Verify a real HTTP call returns the greeting and invalid input is rejected. When adding authentication, put the server session in `createContext` and add authenticated procedure middleware before exposing private records. This example exposes only a public greeting.

Source: [tRPC Fetch adapter](https://trpc.io/docs/server/adapters/fetch). This is one Next route handler, with no separate API service.
