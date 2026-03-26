---
title: Data Flows Overview
description: End-to-end data flow maps for all primary payment and billing operations, covering one-time card payments, EFT transactions, subscription creation, recurring billing, provider webhook processing, and outgoing webhook dispatch.
outline: deep
---

# Data Flows Overview

This page maps the six primary data flows through the Payment Gateway Platform, showing how requests propagate from product applications through the Billing Service and Payment Service to external providers and back.

## At a Glance

| Flow | Initiator | Services Involved | Provider | Sync/Async | Key Boundary |
|------|-----------|-------------------|----------|------------|--------------|
| One-time card payment | Product | PS | Card (e.g. Peach Payments) | Redirect + async webhook | Rands to cents at PS API |
| EFT payment via Ozow | Product | PS | EFT (e.g. Ozow) | Redirect + async webhook | Rands to cents at PS API |
| Subscription creation | Product | BS, PS | Card (tokenisation) | Sync REST | BS delegates to PS |
| Recurring billing | Quartz RenewalJob | BS, PS | Card (token charge) | Sync REST | Cents to Rands at BS PaymentServiceClient |
| Provider webhook processing | Provider | PS | N/A (inbound) | Async POST | Provider format to domain model |
| Outgoing webhook dispatch | OutboxPoller | PS or BS | N/A (outbound) | Async POST | Domain event to webhook payload |

---

## Flow 1: One-Time Card Payment

A product application initiates a card payment. The Payment Service resolves the card provider via `ProviderFactory`, creates a payment record, and returns a redirect URL for 3D Secure authentication. The provider notifies completion asynchronously via webhook.

```mermaid
sequenceDiagram
    autonumber
    participant Product as Product Application
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Redis
    participant Provider as Card Provider
    participant Customer as Customer Browser

    Product->>PS: POST /api/v1/payments
    Note over Product,PS: X-API-Key, X-Tenant-ID,<br>Idempotency-Key, amount in Rands

    PS->>PS: ApiKeyAuthFilter validates key
    PS->>Redis: Check idempotency key
    PS->>DB: SET LOCAL app.current_tenant_id
    PS->>PS: ProviderFactory.getProvider CARD
    PS->>DB: INSERT payment status=pending
    PS->>Provider: provider.createPayment
    Provider-->>PS: Checkout URL + provider_payment_id
    PS->>DB: UPDATE payment status=processing
    PS->>Redis: Store idempotency response TTL 24h
    PS->>DB: INSERT outbox_event payment.created
    PS-->>Product: 201 Created with redirectUrl

    Product->>Customer: Redirect to provider checkout
    Customer->>Provider: Complete 3DS authentication
    Provider->>Customer: Redirect to returnUrl

    Provider->>PS: POST /api/v1/webhooks/peach_payments
    PS->>PS: WebhookVerifier.verifySignature HMAC-SHA256
    PS->>DB: UPDATE payment status=succeeded
    PS->>DB: INSERT outbox_event payment.succeeded
```

<!-- Sources: docs/payment-service/payment-flow-diagrams.md (lines 34-90), docs/payment-service/architecture-design.md (lines 264-296), docs/shared/integration-guide.md (lines 259-309) -->

**Key details:**

- The `amount` field in the API request is a `DECIMAL` in **Rands** (e.g. `299.99`) (`docs/shared/integration-guide.md:272`)
- Internally the Payment Service stores amounts as `DECIMAL` on the `payments` table (`docs/payment-service/architecture-design.md:672`)
- The `ProviderFactory` resolves the correct adapter via `getProvider(paymentMethod=CARD)` (`docs/payment-service/architecture-design.md:278`)
- Idempotency is enforced via Redis + PostgreSQL dual-layer caching with 24h TTL (`docs/payment-service/architecture-design.md:413-419`)
- All outbox events are written in the same transaction as the domain change (`docs/payment-service/architecture-design.md:320`)

---

## Flow 2: EFT Payment via Ozow

EFT payments follow a similar redirect pattern but route through the EFT provider. The customer selects their bank, authenticates via online banking, and the provider confirms asynchronously. Ozow uses SHA-512 hash verification instead of HMAC-SHA256.

```mermaid
sequenceDiagram
    autonumber
    participant Product as Product Application
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Provider as EFT Provider
    participant Customer as Customer Browser
    participant Bank as Customer Bank

    Product->>PS: POST /api/v1/payments paymentMethod=EFT
    PS->>PS: Validate API key and tenant
    PS->>PS: ProviderFactory.getProvider EFT
    PS->>DB: INSERT payment status=pending
    PS->>Provider: provider.createPayment
    Provider-->>PS: Redirect URL for payment page
    PS->>DB: UPDATE payment status=processing
    PS->>DB: INSERT outbox_event payment.created
    PS-->>Product: 201 Created with redirectUrl

    Product->>Customer: Redirect to provider page
    Customer->>Provider: Select bank
    Provider->>Customer: Redirect to bank login
    Customer->>Bank: Authenticate and approve
    Bank-->>Provider: Payment confirmed
    Provider->>Customer: Redirect to successUrl

    Provider->>PS: POST /api/v1/webhooks/ozow
    PS->>PS: SHA-512 hash verification
    PS->>Provider: GET /GetTransaction to double-check
    Provider-->>PS: Transaction status confirmed
    PS->>DB: UPDATE payment status=succeeded
    PS->>DB: INSERT outbox_event payment.succeeded
```

<!-- Sources: docs/payment-service/payment-flow-diagrams.md (lines 100-156), docs/payment-service/payment-flow-diagrams.md (lines 377-424) -->

**EFT-specific safeguards:**

- Ozow webhooks arrive as `application/x-www-form-urlencoded` rather than JSON (`docs/payment-service/payment-flow-diagrams.md:389`)
- The Payment Service performs a secondary API verification (`GET /GetTransaction`) to prevent spoofed callbacks (`docs/payment-service/payment-flow-diagrams.md:144-146`)
- EFT providers do not support tokenisation or recurring payments (`docs/shared/integration-guide.md:335`)

---

## Flow 3: Subscription Creation

The Billing Service orchestrates subscription creation. It creates a customer record in the Payment Service, persists the subscription, and returns a `paymentSetupUrl` for the customer to attach a payment method.

```mermaid
sequenceDiagram
    autonumber
    participant Product as Product Client
    participant BS as Billing Service
    participant DB as PostgreSQL BS
    participant PS as Payment Service

    Product->>BS: POST /api/v1/subscriptions
    Note over Product,BS: X-API-Key, planId, customerId,<br>customerEmail, couponCode

    BS->>BS: ApiKeyAuthFilter validate BCrypt key
    BS->>DB: SELECT subscription_plan WHERE status=active
    BS->>DB: Check no existing active subscription

    opt Coupon code provided
        BS->>DB: SELECT coupon WHERE code=?
        BS->>BS: Validate coupon eligibility
    end

    BS->>PS: POST /api/v1/customers
    PS-->>BS: customerId + paymentSetupUrl

    BS->>DB: INSERT subscription status=trialing
    Note over BS,DB: trial_start=NOW<br>trial_end=NOW+trial_days<br>payment_service_customer_id stored

    opt Coupon applied
        BS->>DB: UPDATE coupon redemption_count
    end

    BS->>DB: INSERT outbox_event subscription.created
    BS-->>Product: 201 Created with paymentSetupUrl
```

<!-- Sources: docs/billing-service/billing-flow-diagrams.md (lines 36-90), docs/billing-service/architecture-design.md (lines 286-296), docs/billing-service/database-schema-design.md (lines 430-483) -->

**Subscription creation notes:**

- A partial unique index enforces one active subscription per customer per tenant (`docs/billing-service/database-schema-design.md:458-460`)
- The `payment_service_customer_id` links the BS subscription to the PS customer record (`docs/billing-service/database-schema-design.md:464-465`)
- Plans with `trial_days > 0` start as `trialing`; plans with `trial_days = 0` start as `incomplete` (`docs/billing-service/billing-flow-diagrams.md:33,96`)
- Coupon validation checks: active status, expiry, redemption limit, and plan-scope (`docs/billing-service/architecture-design.md:376-383`)

---

## Flow 4: Recurring Billing / Renewal

The `RenewalJob` (Quartz, hourly) finds active subscriptions past their `current_period_end`. It delegates to `InvoiceService` for invoice generation, which calls the Payment Service via `PaymentServiceClient` using the stored token.

```mermaid
sequenceDiagram
    autonumber
    participant QZ as Quartz Scheduler
    participant RJ as RenewalJob
    participant IS as InvoiceService
    participant DB as PostgreSQL BS
    participant PSC as PaymentServiceClient
    participant PS as Payment Service

    QZ->>RJ: Trigger hourly
    RJ->>DB: SELECT subscriptions WHERE status=active AND current_period_end < NOW

    loop Each due subscription
        RJ->>IS: generateInvoice subscription
        IS->>DB: SELECT subscription_plan for price_cents

        opt Active coupon on subscription
            IS->>DB: SELECT coupon and validate duration
            IS->>IS: Apply discount to price_cents
        end

        IS->>DB: INSERT invoice status=open amount_due_cents
        IS->>DB: INSERT outbox_event invoice.created

        IS->>PSC: createPayment amount in Rands
        Note over IS,PSC: amount = amount_due_cents / 100<br>Idempotency-Key invoice-invoiceId

        PSC->>PS: POST /api/v1/payments

        alt Payment succeeded
            PS-->>PSC: status=succeeded
            IS->>DB: UPDATE invoice status=paid paid_at=NOW
            RJ->>DB: UPDATE subscription advance period
            IS->>DB: INSERT outbox_event invoice.paid
        else Payment failed
            PS-->>PSC: status=failed
            IS->>DB: UPDATE subscription status=past_due
            IS->>DB: INSERT outbox_event invoice.payment_failed
        end
    end
```

<!-- Sources: docs/billing-service/billing-flow-diagrams.md (lines 154-210), docs/billing-service/architecture-design.md (lines 466-498), docs/billing-service/database-schema-design.md (lines 505-559) -->

**Currency conversion boundary:**

The Billing Service stores all monetary amounts in **cents** (`INTEGER`) internally. When calling the Payment Service, the `PaymentServiceClient` converts cents to Rands (`amount_due_cents / 100`) because the Payment Service API accepts `DECIMAL` amounts in Rands (`docs/billing-service/billing-flow-diagrams.md:189`, `docs/billing-service/architecture-design.md:484`).

---

## Flow 5: Provider Webhook Processing

External providers POST webhook notifications to `ProviderWebhookController`. The controller resolves the correct `WebhookVerifier` via `ProviderFactory`, validates the signature, maps the provider payload to a domain event, and updates the payment status.

```mermaid
sequenceDiagram
    autonumber
    participant Provider as Payment Provider
    participant PS as Payment Service
    participant DB as PostgreSQL

    Provider->>PS: POST /api/v1/webhooks/providerCode
    PS->>PS: ProviderFactory.getVerifier providerCode

    alt Unknown provider code
        PS-->>Provider: 404 Not Found
    end

    PS->>PS: verifier.verifySignature payload headers

    alt Signature invalid
        PS->>DB: INSERT payment_event webhook.signature_failed
        PS-->>Provider: 401 Unauthorized
    end

    PS->>DB: Check duplicate by provider_payment_id + event_type

    alt Duplicate detected
        PS-->>Provider: 200 OK acknowledge
    end

    PS->>PS: verifier.parseEvent maps to ProviderWebhookEvent
    PS->>DB: Lookup payment by provider_payment_id
    PS->>DB: UPDATE payment status
    PS->>DB: INSERT payment_event status change
    PS->>DB: INSERT outbox_event domain event
    PS->>PS: WebhookDispatcher.dispatch event
    PS-->>Provider: 200 OK
```

<!-- Sources: docs/payment-service/payment-flow-diagrams.md (lines 276-318), docs/payment-service/architecture-design.md (lines 246-258), docs/payment-service/payment-flow-diagrams.md (lines 322-373) -->

**Provider-specific verification:**

| Provider | Verification Method | Reference |
|----------|-------------------|-----------|
| Peach Payments (card) | HMAC-SHA256 with `X-Signature` header | `docs/payment-service/payment-flow-diagrams.md:336-337` |
| Ozow (EFT) | SHA-512 hash of concatenated fields + private key | `docs/payment-service/payment-flow-diagrams.md:392-393` |

---

## Flow 6: Outgoing Webhook Dispatch

After any domain event is persisted, the `EventPublisher` writes an `outbox_event` in the same transaction. The `OutboxPoller` publishes events to the message broker. The `WebhookDispatcher` finds matching webhook configurations and enqueues deliveries to the `WebhookWorker`, which signs and POSTs to tenant endpoints with exponential backoff.

```mermaid
sequenceDiagram
    autonumber
    participant Service as Domain Service
    participant EP as EventPublisher
    participant DB as PostgreSQL outbox_events
    participant OP as OutboxPoller
    participant Broker as Message Broker
    participant WD as WebhookDispatcher
    participant WW as WebhookWorker
    participant Tenant as Tenant Endpoint

    Service->>EP: publishEvent domain event
    EP->>DB: INSERT outbox_event same transaction

    OP->>DB: SELECT unpublished outbox_events
    OP->>Broker: Publish to topic
    OP->>DB: UPDATE outbox_event published_at=NOW

    EP->>WD: dispatch event
    WD->>DB: SELECT webhook_configs WHERE tenant AND active
    WD->>WD: Filter by subscribed events

    loop Each matching config
        WD->>DB: INSERT webhook_log
        WD->>WW: enqueue delivery

        WW->>WW: HMAC-SHA256 sign payload
        WW->>Tenant: POST config.url
        Note over WW,Tenant: X-Webhook-Signature<br>X-Webhook-ID

        alt Success 2xx
            Tenant-->>WW: 200 OK
            WW->>DB: UPDATE webhook_log delivered
        else Failure
            Tenant-->>WW: 500 or timeout
            WW->>DB: Schedule retry exponential backoff
            Note over WW: 30s, 2min, 15min, 1h, 4h
        end
    end
```

<!-- Sources: docs/payment-service/payment-flow-diagrams.md (lines 432-474), docs/shared/system-architecture.md (lines 256-330), docs/billing-service/architecture-design.md (lines 692-708) -->

**Retry schedule:**

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 | 30 seconds | 30s |
| 2 | 2 minutes | ~2.5 min |
| 3 | 15 minutes | ~17.5 min |
| 4 | 1 hour | ~1h 17min |
| 5 | 4 hours | ~5h 17min |
| After 5 | Permanently failed | ~5.5 h total |

After 10 consecutive failures across deliveries, the webhook config is auto-disabled (`status=failing`) (`docs/billing-service/billing-flow-diagrams.md:741-744`).

---

## Data Transformation Boundary Map

Monetary amounts cross a critical transformation boundary between the Billing Service (which stores cents as `INTEGER`) and the Payment Service API (which accepts Rands as `DECIMAL`). The diagram below maps where conversions occur.

```mermaid
flowchart LR
    subgraph "Billing Service - cents INTEGER"
        direction TB
        PLAN["subscription_plans.price_cents"]
        INV["invoices.amount_due_cents"]
        COUP["coupons.discount_value cents"]
        PRORATE["ProrationCalculator cents"]
    end

    subgraph "Conversion Boundary"
        direction TB
        PSC["PaymentServiceClient<br>cents / 100 = Rands"]
    end

    subgraph "Payment Service - Rands DECIMAL"
        direction TB
        API["POST /api/v1/payments<br>amount: 299.99"]
        PAY["payments.amount DECIMAL"]
    end

    subgraph "Provider APIs"
        direction TB
        PEACH["Peach Payments<br>amount in Rands string"]
        OZOW["Ozow<br>amount in Rands string"]
    end

    PLAN --> INV
    COUP --> INV
    PRORATE --> INV
    INV --> PSC
    PSC --> API
    API --> PAY
    PAY --> PEACH
    PAY --> OZOW

    style PLAN fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style INV fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style COUP fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PRORATE fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PSC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style API fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PAY fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PEACH fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style OZOW fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
```

<!-- Sources: docs/billing-service/database-schema-design.md (lines 29, 510-514), docs/billing-service/architecture-design.md (lines 484-494), docs/payment-service/architecture-design.md (lines 672) -->

**Conversion rules:**

| Direction | From | To | Formula | Location |
|-----------|------|----|---------|----------|
| BS to PS | `amount_due_cents` (INTEGER) | `amount` (DECIMAL Rands) | `cents / 100` | `PaymentServiceClient.createPayment` |
| PS to Provider | `amount` (DECIMAL Rands) | Provider-specific string | Provider adapter formats | `PeachMapper` / `OzowMapper` |
| Webhook payload | `amount` stored value | JSON field | Cents in BS webhooks, Rands in PS webhooks | `WebhookWorker` |

**Invariant:** No floating-point arithmetic is used for monetary calculations. The Billing Service operates exclusively in integer cents. The Payment Service stores amounts as `DECIMAL` (arbitrary precision). Conversion to Rands happens only at the `PaymentServiceClient` boundary (`docs/billing-service/architecture-design.md:484`).

---

## Event Flow Topology

All six flows converge on a shared event infrastructure. This diagram shows the complete event topology across both services.

```mermaid
flowchart TB
    subgraph "Payment Service"
        direction TB
        PS_PAY["PaymentService"]
        PS_REF["RefundService"]
        PS_PM["PaymentMethodService"]
        PS_OUT["outbox_events"]
        PS_WD["WebhookDispatcher"]
    end

    subgraph "Message Broker Topics"
        direction TB
        T1["payment.events"]
        T2["refund.events"]
        T3["payment-method.events"]
        T4["subscription.events"]
        T5["invoice.events"]
        DLQ1["payment.events.dlq"]
        DLQ2["billing.events.dlq"]
    end

    subgraph "Billing Service"
        direction TB
        BS_SS["SubscriptionService"]
        BS_IS["InvoiceService"]
        BS_OUT["outbox_events"]
        BS_WD["WebhookDispatcher"]
        BS_PEC["PaymentEventConsumer"]
        BS_PSWH["PaymentServiceWebhookController"]
    end

    subgraph "Product Endpoints"
        direction TB
        PROD["Product Webhook Endpoints"]
        CONS["Product Event Consumers"]
    end

    PS_PAY --> PS_OUT --> T1
    PS_REF --> PS_OUT --> T2
    PS_PM --> PS_OUT --> T3
    PS_OUT --> PS_WD --> PROD

    T1 --> BS_PEC --> BS_IS
    T1 --> BS_PSWH --> BS_SS

    BS_SS --> BS_OUT --> T4
    BS_IS --> BS_OUT --> T5
    BS_OUT --> BS_WD --> PROD

    T1 & T4 & T5 --> CONS
    T1 -.->|"Failed after 3 retries"| DLQ1
    T4 -.->|"Failed after 3 retries"| DLQ2

    style PS_PAY fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PS_REF fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PS_PM fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PS_OUT fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PS_WD fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_SS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_IS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_OUT fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_WD fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_PEC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BS_PSWH fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PROD fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style CONS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style T1 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style T2 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style T3 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style T4 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style T5 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style DLQ1 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style DLQ2 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
```

<!-- Sources: docs/shared/system-architecture.md (lines 104-106, 169-192), docs/payment-service/architecture-design.md (lines 427-433), docs/billing-service/architecture-design.md (lines 711-720) -->

**Dual-path deduplication:** The Billing Service receives Payment Service events through both the message broker (`PaymentEventConsumer`) and HTTP webhook (`PaymentServiceWebhookController`). Deduplication uses the composite key `(payment_service_payment_id, event_type)` -- whichever path delivers first processes; the second is a no-op (`docs/billing-service/architecture-design.md:560-571`).

---

## Related Pages

| Page | Description |
|------|-------------|
| [Integration Quickstart](../../01-getting-started/integration-quickstart) | Step-by-step onboarding for product teams |
| [Payment Service Architecture](../../02-architecture/payment-service/) | Internal architecture, SPI contract, ER diagram |
| [Billing Service Architecture](../../02-architecture/billing-service/) | Service components, proration, scheduled jobs |
| [Inter-Service Communication](../../02-architecture/inter-service-communication) | REST contracts, circuit breaker, retry policies |
| [Event System](../../02-architecture/event-system) | Topics, CloudEvents schema, DLQ handling |
| [Subscription Lifecycle](./subscription-lifecycle) | Deep dive into subscription states, dunning, proration |
| [Provider Integrations](../provider-integrations) | Peach Payments and Ozow adapter details |
| [Authentication](../security-compliance/authentication) | API key models, HMAC signing, RLS |
| [Correctness Invariants](../correctness-invariants) | Formal properties and data integrity rules |
| [Observability](../observability) | Metrics, tracing, alerting rules |
