# Gaia

Gaia is the SaaS platform that hosts Stratum (Meridia renderer) and Kronum (Pneuma renderer) as first-class apps.

## Architecture

- **Platform**: Next.js 15 App Router
- **Auth**: Clerk (org + user management)
- **Database**: Supabase Postgres (RLS multi-tenancy, org_id on all tables)
- **Apps**: Stratum (infrastructure diagrams) | Kronum (timeline diagrams)
- **AI Copilot**: Pluggable LLM provider (Anthropic Claude default; BYO API key)
- **Deployment**: Vercel

## Spaces

Each space in Gaia is configured to use one app — Stratum or Kronum.

## Status

Pre-release scaffold. See `docs/` for architecture details.

## Related

- **[Meridia](https://github.com/joshdavisind/meridia)** — infrastructure diagram standard
- **[Pneuma](https://github.com/joshdavisind/pneuma)** — timeline diagram standard
- **[Stratum](https://github.com/joshdavisind/stratum)** — OSS renderer for Meridia
- **[Kronum](https://github.com/joshdavisind/kronum)** — OSS renderer for Pneuma
