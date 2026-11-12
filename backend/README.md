# Mamladibe backend

This is the initial Node.js, Express, and TypeScript backend scaffold. The
application is kept separate from its local HTTP server so it can be connected
to a Vercel deployment entry point later.

## Requirements

- Node.js 22 or newer
- npm

## Local setup

1. Install the dependencies with `npm install`.
2. Keep local credentials in `backend/.env`; never put real values in
   `.env.example`.
3. Start the development server with `npm run dev`.

The server reads `NODE_ENV` and `PORT`. They default to `development` and
`5000`; invalid values stop startup with an error. The other example variables
are reserved for future work and are not used by this scaffold.

## Commands

- `npm run dev` starts the server with automatic restarts.
- `npm run typecheck` checks the TypeScript source without writing files.
- `npm run build` compiles source into `dist/`.
- `npm start` starts the compiled server.
- `npm test` runs tests with Node's built-in test runner.

There are no tests or linter configured yet. No linting dependency was added.

## Structure

- `src/config/` loads and validates runtime settings.
- `src/constants/` is for shared constant values.
- `src/controllers/` is for HTTP request handlers.
- `src/lib/` is for shared integrations and low-level helpers.
- `src/middleware/` is for Express middleware.
- `src/models/` is reserved for future data models.
- `src/routes/` is reserved for future API route definitions.
- `src/scripts/` is for backend maintenance scripts.
- `src/services/` is for application operations.
- `src/types/` is for shared TypeScript types.
- `src/utils/` is for general-purpose helpers.
- `src/validators/` is for request and data validation.
- `tests/unit/` and `tests/integration/` hold their respective tests.

MongoDB connection code, models, API endpoints, authentication, and third-party
integrations have intentionally not been implemented.
