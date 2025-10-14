# Repository Guidelines

## Project Structure & Module Organization
- `server.ts` boots Fastify; stage shared helpers under `src/` and import them back here.
- `dist/` stores `tsc` output after `npm run build`; never hand-edit compiled files.
- `Postgres-schema.sql` owns the `scans` table definition; run it before local development.
- `.env.example` is the template; copy to `.env` and provide `DATABASE_URL` and `API_KEY`.

## Build, Test, and Development Commands
- `npm install` restores dependencies; rerun after pulling lockfile or Node upgrades.
- `npm run dev` starts `tsx watch` for hot reloads during endpoint work.
- `npm run build` runs `tsc`, emitting JavaScript into `dist/` for releases.
- `npm run start` executes `dist/server.js`; run it only after a clean build.

## Coding Style & Naming Conventions
- Use TypeScript with 2-space indentation, trailing commas, and `async/await` over callbacks.
- Keep `camelCase` for values, `PascalCase` for types, and env vars in `SCREAMING_SNAKE_CASE`.
- Split heavy handlers into helpers (e.g. `src/services/attendance.ts`) to preserve clarity.

## Testing Guidelines
- `npm test` is a stub; add Vitest or Jest before merging covered features.
- Store fast specs beside sources as `*.spec.ts`; keep integration flows in `tests/integration/`.
- Target roughly 80% branch coverage and include regression checks for each bug fix.

## Commit & Pull Request Guidelines
- Write Conventional Commit subjects (`feat:`, `fix:`, `chore:`) in imperative form.
- Pull requests must describe changes, list verification (`npm run dev`, sample curl), and link tickets.
- Update `.env.example` and mention schema changes whenever SQL or config shifts occur.

## Environment & Security Tips
- Load secrets from `.env`; required keys are `DATABASE_URL`, `API_KEY`, optional `PORT`.
- Reuse the pooled client and release it in `finally` blocks to prevent leaks.
- Apply `Postgres-schema.sql` before hitting APIs and rotate API keys in shared environments.
