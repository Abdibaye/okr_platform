# Deployment contract

The starter owns a complete `.neander/compose.yaml`, Dockerfile, literal-secret entrypoint and public `/api/health` route. Keep them current as features are added. Publish statically validates this recipe and sends valid source to Cloud Run Compose without a separate recipe sandbox build. The production build, application probes and public URL verification still run. A recipe-attributable failure may trigger one bounded repair; application errors and provider outages are not repaired by repeatedly rewriting deployment files.

## Adding persistence or auth

Use the block's complete `.neander/compose.yaml.example` as the maintained declaration. Merge it rather than inventing environment metadata or replacing application-specific settings. Install the block's dependencies, lockfile changes, runtime files and migrations together. Production builds must work without database credentials. Migrations run explicitly before rollout, never during image build or application startup. A private application must protect each data API and scope records by the authenticated user.

Each environment requirement includes an explicit provider: `Neon` for provisioned `DATABASE_URL`, `Neander` with `binding: public_origin` for a provisioned application origin, and `null` for user or generated values. Generated secrets use `generator: opaque-random`. Keep runtime variables server-side; do not embed secrets in frontend bundles or Docker build arguments. Preserve the literal-secret entrypoint; never source/eval its input.

## Database ownership and connectivity

Application database code consumes the injected PostgreSQL `DATABASE_URL` and honors its TLS settings. The Publish declaration selects the managed Neon provider. Do not infer the deployment environment from `NODE_ENV`, a hostname suffix, or whether the database uses a loopback address: local Docker validation and managed production have different endpoints. Do not replace provider-issued TLS settings with `sslmode=disable` or disable certificate verification.

The shipped database blocks work with local PostgreSQL for development/validation and separately provisioned Neon for production. Keep local URLs in ignored `.env.local`; never copy local credentials into deployment settings. An application with additional restrictions requiring Neon-only/TLS connections in every nonlocal environment needs a compatible validation database; do not silently remove those restrictions or invent a bypass flag to pass validation.

## Before handing the app back

- Keep `root_probe` on a public, unauthenticated route. Auth examples use `/api/health` so protecting `/` does not break readiness.
- Run the production build with no application credentials, and check the declared HTTP routes.
- Verify database CRUD and login independently when installed; creating a schema is not proof that an owner can sign in.
- Commit recipe, migration and lockfile changes with the implementation. Do not rewrite valid recipes merely because Publish can repair them.
- Keep local Docker commands scoped with an explicit unique `-p` and explicit `-f`; preserve existing volumes.

Run `python3 scripts/test_deployment_contract.py` (test dependency: PyYAML 6.0.3). This checks the starter examples for common declaration drift. Neander's publisher remains the authoritative validator; these checks do not prove managed connectivity or a successful deployment.
