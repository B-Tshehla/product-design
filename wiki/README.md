# Payment Gateway Platform — Wiki

Internal technical documentation for Enviro's centralised payment processing and subscription billing platform, built with [VitePress](https://vitepress.dev/).

> **Status:** Design Phase — no source code exists yet. This wiki is the canonical reference for implementation.

## Overview

| Attribute | Value |
|:----------|:------|
| **Services** | Payment Service (:8080) + Billing Service (:8081) |
| **Target Market** | South Africa (ZAR default) |
| **Compliance** | PCI DSS SAQ-A, POPIA, 3D Secure, SARB |
| **Providers** | Peach Payments (card, BNPL, wallet, QR), Ozow (EFT) |
| **Architecture** | Hexagonal / Ports-and-Adapters per service |
| **Runtime** | Java 21 (virtual threads), Spring Boot 3.x |
| **Database** | PostgreSQL 16+ with Row-Level Security |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
npm install
npm run dev       # local dev server with hot reload
npm run build     # build static site
npm run preview   # preview production build
```

The dev server starts at `http://localhost:5173` by default.

## Documentation Structure

```
wiki/
├── index.md                        # Home page
├── onboarding/                     # Audience-tailored onboarding guides
│   ├── contributor.md
│   ├── staff-engineer.md
│   ├── executive.md
│   └── product-manager.md
├── 01-getting-started/             # Platform overview, quickstart, env setup
│   ├── platform-overview.md
│   ├── integration-quickstart.md
│   └── environment-setup.md
├── 02-architecture/                # Service internals, schemas, API references
│   ├── payment-service/            # Payment Service (port 8080)
│   ├── billing-service/            # Billing Service (port 8081)
│   ├── inter-service-communication.md
│   └── event-system.md
├── 03-deep-dive/                   # Provider integrations, security, data flows
│   ├── provider-integrations.md
│   ├── security-compliance/
│   ├── data-flows/
│   ├── correctness-invariants.md
│   └── observability.md
└── 04-reviews/                     # Tech stack and API quality assessments
    ├── tech-stack-review.md
    └── api-review.md
```

## Tech Stack

| Technology | Version | Purpose |
|:-----------|:--------|:--------|
| VitePress | 1.x | Static site generator |
| vitepress-plugin-mermaid | 2.x | Mermaid diagram rendering |
| vitepress-plugin-group-icons | 1.x | Grouped code block icons |
| Mermaid | 11.x | Architecture diagrams |

## Key Design Decisions

- **Hexagonal Architecture** — each service uses ports-and-adapters to keep domain logic independent of providers and infrastructure.
- **Transactional Outbox** — events are written atomically with business data before being published to the message broker.
- **Multi-Tenant Isolation** — PostgreSQL Row-Level Security enforces tenant boundaries at the database level.
- **Provider Abstraction** — a provider SPI allows Peach Payments and Ozow to be swapped or extended without touching core payment logic.
