# Gaia — Architecture Decisions

This document records key architecture decisions for the Gaia platform.

---

## Multi-Tenancy

**Decision:** Row-level security (RLS) via `org_id` column. No schema-per-tenant in v1.

**Rationale:** Schema-per-tenant (Postgres schemas) adds operational complexity — migrations must run N times, connection pooling is harder, and observability tooling breaks. RLS with `org_id` gives strong isolation with a single schema, simpler migrations, and standard tooling.

**Implementation:**
- All data tables include `org_id uuid NOT NULL`
- Supabase RLS policies enforce `org_id = auth.jwt() ->> 'org_id'`
- No cross-org queries are possible at the database level
- Service role (used only in server-side API routes) bypasses RLS where needed

**Tables:** `diagrams`, `diagram_versions`, `templates`, `shares`, `spaces` — all org-scoped.

---

## Auth

**Decision:** Clerk for org management, user management, and SSO.

**Rationale:** Clerk provides org-aware JWTs, SSO (SAML/OIDC for Enterprise tier), invitation flows, and a pre-built UI. Building this from scratch would consume weeks without differentiating value.

**Implementation:**
- `ClerkProvider` wraps the app
- `auth()` in server components; `useAuth()` / `useOrganization()` in client components
- JWT claims include `org_id` — forwarded to Supabase via `Authorization` header
- SSO available on Enterprise pricing tier only

---

## Data Model

Core tables (all org-scoped):

| Table | Description |
|-------|-------------|
| `diagrams` | One row per diagram. References space and org. Stores current `model_json`. |
| `diagram_versions` | Append-only version history. Each save creates a row with `model_json` and `created_at`. |
| `templates` | Org-scoped reusable starting points. `is_public` flag for global templates. |
| `shares` | Share links with optional expiry, access level (`view` | `comment` | `edit`), and optional password. |
| `spaces` | Workspace containers. Each space has `app_type` (`stratum` | `kronum`). |

---

## AI Copilot

**Decision:** Pluggable LLM provider abstraction. Anthropic Claude as default.

**Implementation:**
- `/api/copilot` endpoint: accepts a `prompt` and `modelJson` context, returns a streaming response
- `LLMProvider` interface with `.complete(messages) → AsyncIterable<string>`
- Default: `AnthropicProvider` using Claude (Haiku for fast completions, Sonnet for complex edits)
- BYO API key: users can supply their own Anthropic or OpenAI key in org settings — stored encrypted in Supabase, used server-side only
- Provider abstraction allows future support for Gemini, local Ollama, etc.

**Capabilities (planned):**
- Natural language → diagram JSON generation
- Diagram edit suggestions ("add a load balancer between X and Y")
- Summary generation for diagram views
- Relationship suggestions based on node types

---

## Renderer Loading

**Decision:** Each space has an `app_type` field (`'stratum' | 'kronum'`). Renderer loaded as a dynamic import.

**Implementation:**
```ts
const renderer = await import(
  space.app_type === 'stratum'
    ? '@gordian/stratum'
    : '@gordian/kronum'
);
```

- Renderers are optional peer dependencies — not bundled into the Gaia core build
- This keeps the core bundle lean; renderers ship as separate npm packages
- Dynamic import ensures renderer code is only loaded for the relevant space type

---

## Pricing Tiers

| Tier | Seats | Diagrams | Features |
|------|-------|----------|---------|
| **Free** | 1 | 5 | Core diagram editing, Stratum + Kronum, share links |
| **Team** | Up to 25 | Unlimited | Version history, templates, comments, AI copilot |
| **Enterprise** | Unlimited | Unlimited | SSO (SAML/OIDC), audit log, self-hosted option, SLA, custom AI provider |

**Enforcement:** `org.plan` claim in Clerk JWT. Plan-gated features checked server-side in middleware and API routes — never client-only.

---

## Deployment

- **Platform:** Vercel (Next.js App Router, edge-ready)
- **Database:** Supabase (managed Postgres + RLS + realtime)
- **Auth:** Clerk (hosted, no self-managed auth infra)
- **CDN:** Vercel Edge Network
- **Self-hosted (Enterprise):** Docker Compose stack with Supabase self-hosted, Clerk Enterprise, and a Next.js container

---

## Open Questions (v1)

- Realtime collaboration: will use Supabase realtime channels in v1.1 — out of scope for v1
- Offline support: not planned for v1
- Export formats: SVG export planned for v1; PNG and PDF in v1.1
