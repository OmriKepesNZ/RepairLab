# RepairLab Agent Guide

## Project shape
- This is a static browser app using vanilla JavaScript modules. `index.html` loads `config.js`, the Supabase JS v2 CDN client, and `js/main.js`.
- `js/data.js` owns Supabase client setup, auth-backed database calls, and the app's data mapping. Keep UI modules using its exported functions rather than adding their own database calls.
- Database changes belong in `supabase/migrations/`; Edge Functions belong in `supabase/functions/` and run on Deno. Check existing row-level security and role checks when changing data access.

## Supabase access and safety
- You can edit and validate the local migrations, Edge Functions, and client code in this repository. This does not by itself connect you to the hosted Supabase project.
- Before any hosted database, auth-user, function deployment, or secret-setting operation, verify that an explicitly configured Supabase MCP integration or an already-authenticated local Supabase CLI is available and authorized. If neither is available, say so, make the local code or SQL change, and give the exact hosted step the user must perform; never imply it was applied.
- Never ask for credentials or service-role keys in chat. Do not put privileged keys in browser code or commit them. The browser's publishable key in `config.js` is not a service-role key; privileged operations must stay server-side and enforce authorization.
- Treat hosted data changes as consequential: inspect the target and impact first, preserve RLS, and get explicit user approval before destructive or broad production changes.

## Validation
- There is no package manifest or configured test suite. For changed browser JavaScript, run `node --check` on each touched `.js` file.
- For changed Edge Function TypeScript, run `deno check` on the touched entry point when Deno is available. Do not assume the function is deployed merely because it checks locally.
- SQL migrations have no repository-configured automated validation or deployment command; review them for correctness and report when hosted application remains outstanding.