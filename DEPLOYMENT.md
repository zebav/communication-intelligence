# Deployment

## Local

Copy `.env.example` to `.env.local`, add test Supabase values, install dependencies, and run `pnpm dev`.

## Preview

Vercel creates a preview per pull request. Preview uses dedicated test integrations and synthetic data. Production data must never be copied wholesale into preview.

## Production

Deploy the Next.js application from GitHub to Vercel. Use a Supabase EU-region project and encrypted Vercel environment variables. Place Cloudflare Access in front of the private application domain. The isolated public hooks domain is introduced only when official provider webhooks are implemented.
