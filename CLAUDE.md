# CLAUDE.md

Follow the instructions in AGENTS.md.

## Project

Medscale is a Next.js app using TypeScript, React, Supabase, Vitest, Sentry, PostHog, Tailwind, and related UI libraries.

## Commands

- Install dependencies: `npm install`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm test`
- Coverage: `npm run test:coverage`

## Important Notes

- This project uses Next.js 16.3.1. Before changing Next.js-specific code, read the relevant docs under `node_modules/next/dist/docs/`.
- Do not commit secrets from `.env.local`.
- Prefer existing project patterns over introducing new abstractions.
- Add or update focused tests for behavior changes.