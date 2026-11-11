# AGENTS.md

Instructions for AI coding agents working in this repository.

- Start with `CLAUDE.md` (architecture, commands, the AcreLedger response contract that must not break).
- API reference for integrators: `AI_INTEGRATION.md`. System blueprint (including the Rain API contract in section 7): `blueprint.md`.
- Before finishing any change: `npm run typecheck` and `npm test` must both pass.
- Never commit `.env*` files or tokens. Do not run `clear_zeros.ts`, `backfill_rain.ts` or `check_rain.ts` without the owner's go-ahead; they write to or delete from the production database.
- Keep rolling-window response keys (`rain.12h/24h/72h/168h`, `rain.total` for ranges, `sourceStatus`) stable: AcreLedger depends on them.
