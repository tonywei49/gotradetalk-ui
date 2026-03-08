# Plugin Platform Plan

## Goal

Build a plugin architecture that keeps customer-installed local services stable while allowing the app frontend and platform backend to evolve.

Core principles:

- Freeze customer local services as much as possible:
  - `continuwuity`
  - `notebook`
  - `agent`
- Keep most future upgrades in:
  - frontend app
  - platform backend
- Manage plugin enablement, configuration, entitlement, token issuance, quota, and expiration in the platform backend
- Support two plugin types:
  - internal plugins: rendered inside the app UI
  - external plugins: run outside the app through platform APIs and webhooks

## Architecture

### 1. Customer Local Services

Customer-side services remain the stable base layer:

- `continuwuity`
- `notebook`
- `agent`

Rules:

- Do not use these services as the primary extension surface for new features
- Only change them for critical bugs or security issues
- Do not let plugins bind directly to private implementation details in these services

### 2. Platform Backend

The platform backend is the control plane for plugins.

Responsibilities:

- plugin catalog
- plugin entitlement
- per-company enable/disable
- per-company plugin configuration
- plugin token issuance
- plugin usage logs
- quota and expiration
- external plugin APIs and webhooks

### 3. Frontend App

The frontend acts as the plugin host.

Responsibilities:

- load plugin metadata
- render plugin entry points
- provide plugin UI slots
- provide controlled plugin context
- request plugin-scoped tokens from platform backend

### 4. Plugin Layer

Two plugin types:

- internal plugins
  - live inside the app
  - use UI slots
  - are bundled with the frontend in phase 1
- external plugins
  - live outside the app
  - use platform API / webhook integration

## Plugin Types

### Internal Plugins

Examples:

- chat composer tools
- message action extensions
- notebook helper panels
- custom settings sections
- new app pages or navigation entries

Phase 1 decision:

- support bundled internal plugins only
- do not load remote third-party JavaScript

### External Plugins

Examples:

- CRM sync
- external search/indexing
- audit export
- analytics/reporting integrations

Rules:

- external plugins call platform APIs
- external plugins must not directly call customer local private services

## Security Model

Plugins must not share a universal token.

Each plugin should receive its own short-lived token with scoped claims:

- `plugin_id`
- `company_id`
- `user_id`
- `scope`
- `expire_at`

Rules:

- plugin A token cannot be used for plugin B
- plugin tokens must be revocable
- plugin usage must be logged
- plugin tokens must not expose customer local service secrets

## Platform Backend Scope

### Data Model

Suggested entities:

- `plugins`
- `plugin_entitlements`
- `plugin_configs`
- `plugin_usage_logs`

### Required Platform APIs

- `GET /platform/plugins/catalog`
- `GET /platform/plugins/my-plugins`
- `GET /platform/plugins/:id/config`
- `POST /platform/plugins/:id/token`
- `POST /platform/plugins/:id/usage`

### Admin UI

Platform admin should manage:

- plugin catalog
- global/internal/external plugin definition
- company entitlement
- enable/disable
- quota
- expiration
- free/paid strategy
- plugin-specific configuration

## Frontend Scope

### Plugin Host

The frontend should expose:

- plugin registry
- plugin context
- plugin slots

### Initial UI Slots

Phase 1 slots:

- app navigation
- chat composer toolbar
- message actions
- notebook tools
- settings sections

### Frontend Rules

- plugins do not directly own core auth/session logic
- plugins consume controlled host context
- existing chat/notebook flows must remain stable

## Delivery Phases

### Phase 1: Foundation

Deliverables:

- platform-side plugin model and APIs
- frontend plugin registry/context/slots
- bundled internal plugin support

### Phase 2: Internal Plugins

Deliverables:

- chat toolbar extension slot
- message action slot
- notebook tool slot
- settings slot
- first bundled sample plugins

### Phase 3: External Plugins

Deliverables:

- external plugin API access
- webhook/event model
- external plugin token issuance
- logs, limits, expiry controls

### Phase 4: Commercialization

Deliverables:

- free plugins
- paid plugins
- company-specific plugins
- expiration and quota controls
- usage reporting

## Hard Boundaries

Do not do these in phase 1:

- remote execution of arbitrary third-party JavaScript
- direct plugin access to customer local private services
- a single shared universal plugin token
- frequent feature-driven changes to `continuwuity`, `notebook`, or `agent`

## Implementation Decision For This Repo

This repo only implements the frontend host skeleton for now.

Phase 1 frontend work in `gotradetalk-ui`:

- add plugin type definitions
- add plugin registry
- add plugin host context/provider
- add initial slot resolution helpers
- wire the host into the app root
- add first host integration point without changing existing business behavior

