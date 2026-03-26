---
title: Payment Service Architecture
description: Internal architecture of the Payment Service covering the four-layer design, provider SPI pattern, transactional outbox, circuit breaker configuration, and webhook dispatch.
outline: deep
---

# Payment Service Architecture

The Payment Service is the lower-level abstraction in the Payment Gateway Platform. It provides a provider-agnostic REST API for payment creation, refunds, payment method tokenisation, and outgoing webhook dispatch. All provider-specific logic is isolated behind a Service Provider Interface (SPI) boundary.

## At a Glance

| Attribute | Detail |
|---|---|
| **Port** | `:8080` |
| **Package Root** | `com.enviro.payment` |
| **Architecture** | Modular monolith (hexagonal / ports-and-adapters) |
| **Database** | `payment_service_db` (PostgreSQL 16+) |
| **Tables** | 9 (RLS on 7 of 9) |
| **Auth Model** | HMAC-SHA256 (4 headers) |
| **Amount Format** | `DECIMAL(19,4)` Rands |
| **Event Topics** | `payment.events`, `refund.events`, `payment-method.events` |
| **DLQ** | `payment.events.dlq` |
| **Provider Pattern** | Strategy + Factory with Spring auto-discovery |
| **Circuit Breaker** | Resilience4j (50% threshold, 30s open, 5 half-open calls) |

(docs/payment-service/architecture-design.md:1-22)

---

## Four-Layer Architecture

The Payment Service is organised into four distinct layers. Each layer has a single responsibility and communicates only with its immediate neighbours.

```mermaid
graph TB
    subgraph "Layer 1: API"
        PC["PaymentController"]
        PMC["PaymentMethodController"]
        RC["RefundController"]
        TC["TenantController"]
        WHC["WebhookConfigController"]
        PWH["ProviderWebhookController"]
        RV["Request Validators"]
        RL["Rate Limiter"]
    end

    subgraph "Layer 2: Service"
        PS["PaymentService"]
        PMS["PaymentMethodService"]
        RS["RefundService"]
        TS["TenantService"]
        WHS["WebhookService"]
        IDS["IdempotencyService"]
    end

    subgraph "Layer 3: Provider SPI"
        PF["ProviderFactory"]
        PP["PaymentProvider interface"]
        WV["WebhookVerifier interface"]
        PA1["CardProviderAdapter"]
        PA2["EFTProviderAdapter"]
        PA3["FutureProviderAdapter"]
    end

    subgraph "Layer 4: Integration"
        EP["EventPublisher"]
        OP["OutboxPoller"]
        CB["CircuitBreaker"]
        WD["WebhookDispatcher"]
        WW["WebhookWorker"]
    end

    PC & PMC & RC & TC & WHC --> RV --> RL
    PC --> PS
    PMC --> PMS
    RC --> RS
    TC --> TS
    WHC --> WHS
    PWH --> WV
    PS & PMS & RS --> PF --> PP
    PP --> CB
    CB --> PA1 & PA2 & PA3
    PS & RS --> EP
    EP --> OP
    EP --> WD --> WW

    style PC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PMC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style RC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style TC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WHC fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PWH fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style RV fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style RL fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PMS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style RS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style TS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WHS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style IDS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PF fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PP fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WV fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PA1 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PA2 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PA3 fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style EP fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style OP fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style CB fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WD fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WW fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
```

<!-- Sources: docs/payment-service/architecture-design.md:30-104, docs/payment-service/architecture-design.md:106-184 -->

### Layer Responsibilities

| Layer | Packages | Responsibility |
|---|---|---|
| **API** | `api.controller`, `api.dto`, `api.mapper`, `api.validation` | REST endpoints, request validation, rate limiting, DTO mapping |
| **Service** | `service`, `service.impl` | Business logic, idempotency enforcement, transactional guarantees |
| **Provider SPI** | `provider`, `provider.adapter.*` | Provider abstraction, capability-based routing, adapter implementations |
| **Integration** | `integration.messaging`, `integration.outbox`, `integration.circuitbreaker`, `integration.webhook` | Event publishing, outbox polling, circuit breakers, webhook dispatch |

(docs/payment-service/architecture-design.md:106-184)

---

## Provider SPI Pattern

The provider layer uses a **Strategy + Factory** pattern with Spring auto-discovery. New providers are added by implementing `PaymentProvider` and `WebhookVerifier`, annotating with `@Component`, and restarting the service. No factory code changes are needed.

```mermaid
classDiagram
    class PaymentProvider {
        <<interface>>
        +getProviderId() String
        +getCapabilities() Set~ProviderCapability~
        +createPayment(request) ProviderPaymentResponse
        +getPaymentStatus(id) ProviderPaymentStatus
        +cancelPayment(id) ProviderCancelResponse
        +createRefund(request) ProviderRefundResponse
        +getRefundStatus(id) ProviderRefundStatus
        +createPaymentMethod(request) ProviderPaymentMethod
        +getPaymentMethod(id) ProviderPaymentMethod
        +deletePaymentMethod(id) void
    }

    class WebhookVerifier {
        <<interface>>
        +getProviderId() String
        +verifySignature(payload, headers) boolean
        +parseEvent(payload, headers) ProviderWebhookEvent
    }

    class ProviderFactory {
        -providers Map~String PaymentProvider~
        -verifiers Map~String WebhookVerifier~
        +getProvider(providerId) PaymentProvider
        +getVerifier(providerId) WebhookVerifier
        +getAvailableProviders() Set~String~
        +supportsCapability(id, cap) boolean
    }

    class PeachPaymentProvider {
        +getProviderId() String
        +getCapabilities() Set~ProviderCapability~
    }

    class OzowPaymentProvider {
        +getProviderId() String
        +getCapabilities() Set~ProviderCapability~
    }

    PaymentProvider <|.. PeachPaymentProvider
    PaymentProvider <|.. OzowPaymentProvider
    ProviderFactory --> PaymentProvider
    ProviderFactory --> WebhookVerifier

    style PaymentProvider fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WebhookVerifier fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style ProviderFactory fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style PeachPaymentProvider fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style OzowPaymentProvider fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
```

<!-- Sources: docs/payment-service/architecture-design.md:188-296 -->

### Provider Capabilities

| Capability | Description |
|---|---|
| `ONE_TIME_PAYMENT` | Single payments |
| `RECURRING_PAYMENT` | Token-based recurring charges |
| `REFUND_FULL` | Full refunds |
| `REFUND_PARTIAL` | Partial refunds |
| `TOKENIZE_CARD` | Card tokenisation |
| `TOKENIZE_BANK_ACCOUNT` | Bank account tokenisation |
| `THREE_D_SECURE` | 3DS authentication |
| `REDIRECT_FLOW` | Redirect-based payment (hosted checkout) |
| `WEBHOOK_NOTIFICATIONS` | Provider sends webhooks |
| `DIGITAL_WALLET` | Apple Pay, Google Pay, Samsung Pay |
| `BNPL` | Buy Now Pay Later |

(docs/payment-service/architecture-design.md:229-243)

### Adding a New Provider

1. Implement `PaymentProvider` and `WebhookVerifier` interfaces
2. Annotate both classes with `@Component`
3. Spring auto-discovers them via constructor injection into `ProviderFactory`
4. No factory code changes needed

(docs/payment-service/architecture-design.md:298-303)

---

## Payment Creation Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Enviro Product
    participant Filter as ApiKeyAuthFilter
    participant PS as PaymentService
    participant IDS as IdempotencyService
    participant PF as ProviderFactory
    participant Provider as PaymentProvider
    participant EP as EventPublisher
    participant DB as PostgreSQL

    Client->>Filter: POST /api/v1/payments
    Filter->>Filter: HMAC-SHA256 verify
    Filter->>DB: SET LOCAL app.current_tenant_id
    Filter->>PS: Create payment request
    PS->>IDS: Check idempotency key
    alt Key exists with same hash
        IDS-->>PS: Return cached response
        PS-->>Client: HTTP 200 (cached)
    else Key exists with different hash
        IDS-->>PS: IdempotencyConflictException
        PS-->>Client: HTTP 409
    else Key not found
        PS->>PF: getProvider(tenantConfig.provider)
        PF->>Provider: createPayment(request)
        Provider-->>PF: ProviderPaymentResponse
        PS->>DB: INSERT payment + outbox_event
        PS->>IDS: Store key + response
        PS->>EP: Publish payment.created
        PS-->>Client: HTTP 201
    end
```

<!-- Sources: docs/payment-service/architecture-design.md:308-321, docs/payment-service/architecture-design.md:409-419 -->

All mutating operations in the Payment Service use `@Transactional`. The payment record and outbox event are written in the same database transaction, guaranteeing atomicity. The `OutboxPoller` relays events to the message broker asynchronously.

(docs/payment-service/architecture-design.md:317-321)

---

## Transactional Outbox Pattern

Events are never published directly to the message broker from within a business transaction. Instead, an `outbox_events` row is inserted in the same transaction as the domain change. The `OutboxPoller` picks up unpublished events and forwards them to the broker.

```mermaid
graph LR
    subgraph "Same DB Transaction"
        BIZ["Domain Change<br>e.g. INSERT payment"]
        OBX["INSERT outbox_event"]
    end

    BIZ --> OBX
    OBX --> POLL["OutboxPoller<br>Polls unpublished"]
    POLL --> BROKER["Message Broker"]
    POLL --> MARK["Mark published_at"]
    BROKER --> CONS["Billing Service<br>Consumer"]
    BROKER --> WH["WebhookDispatcher"]

    style BIZ fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style OBX fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style POLL fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style BROKER fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style MARK fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style CONS fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
    style WH fill:#2d333b,stroke:#FF5A4F,color:#e6edf3
```

<!-- Sources: docs/payment-service/architecture-design.md:317-321, docs/billing-service/architecture-design.md:692-708 -->

**Guarantee:** At-least-once delivery. If the broker is unavailable, events remain in the outbox and are retried on the next poll cycle. Consumers must be idempotent.

---

## Circuit Breaker Configuration

All outbound calls to payment providers are wrapped in a Resilience4j circuit breaker to prevent cascading failures.

| Parameter | Value |
|---|---|
| **Failure rate threshold** | 50% |
| **Slow call duration threshold** | 5 seconds |
| **Slow call rate threshold** | 80% |
| **Minimum number of calls** | 10 |
| **Wait duration in open state** | 30 seconds |
| **Permitted calls in half-open** | 5 |

(docs/payment-service/architecture-design.md:347-365)

```mermaid
stateDiagram-v2
    [*] --> Closed : Circuit starts closed

    Closed --> Open : Failure rate exceeds 50%
    Open --> HalfOpen : After 30 seconds
    HalfOpen --> Closed : 5 permitted calls succeed
    HalfOpen --> Open : Any permitted call fails

    Closed --> Closed : Calls succeed
    Open --> Open : Calls rejected immediately
```

<!-- Sources: docs/payment-service/architecture-design.md:347-365 -->

**Fallback behaviour:** When the circuit is open, requests return `PROVIDER_TIMEOUT` (504) immediately. Each provider has an independent circuit (e.g., `peach_payments` and `ozow` have separate breakers). Metrics are exposed via `/actuator/circuitbreakerevents`.

---

## Webhook Dispatch

When a payment-related event occurs, the `WebhookDispatcher` finds all matching webhook configurations for the tenant and enqueues delivery attempts.

```mermaid
sequenceDiagram
    autonumber
    participant EP as EventPublisher
    participant WD as WebhookDispatcher
    participant DB as PostgreSQL
    participant WW as WebhookWorker
    participant Client as Tenant Endpoint

    EP->>WD: Event occurred
    WD->>DB: Find webhook_configs for tenant + event_type
    DB-->>WD: Matching configs
    loop Each config
        WD->>DB: INSERT webhook_log
        WD->>WW: Enqueue delivery
        WW->>WW: Sign payload (HMAC-SHA256)
        WW->>Client: POST to webhook URL
        alt HTTP 2xx
            Client-->>WW: Success
            WW->>DB: Mark delivered
        else HTTP error or timeout
            Client-->>WW: Failure
            WW->>DB: Record attempt, schedule retry
            Note over WW: Backoff: 30s, 2min, 15min, 1h, 4h
        end
    end
```

<!-- Sources: docs/payment-service/architecture-design.md:396-408, docs/shared/integration-guide.md:640-680 -->

### Webhook Signature Format

All outgoing webhooks are signed with the tenant's shared secret using HMAC-SHA256:

```
X-Webhook-Signature: t=<timestamp>,v1=<signature>
```

The signature is computed over `<timestamp>.<payload_body>`. Tenants verify by recomputing the HMAC and comparing with the `v1` value.

(docs/shared/integration-guide.md:640-680)

### Retry Schedule

| Attempt | Delay |
|---|---|
| 1 | 30 seconds |
| 2 | 2 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 | 4 hours |

After 5 failed attempts, the webhook log status is set to `exhausted` and no further retries are scheduled.

---

## Payment State Machine

```mermaid
stateDiagram-v2
    [*] --> pending : Payment created

    pending --> processing : Provider acknowledged
    pending --> requires_action : 3DS / redirect required
    pending --> canceled : Canceled before processing
    pending --> failed : Immediate rejection

    requires_action --> processing : Action completed
    requires_action --> canceled : Action abandoned
    requires_action --> failed : Action failed

    processing --> succeeded : Provider confirmed
    processing --> failed : Provider rejected

    succeeded --> [*]
    failed --> [*]
    canceled --> [*]
```

<!-- Sources: docs/payment-service/architecture-design.md:780-801 -->

### Valid Transitions

| From | To |
|---|---|
| `pending` | `processing`, `requires_action`, `canceled`, `failed` |
| `requires_action` | `processing`, `canceled`, `failed` |
| `processing` | `succeeded`, `failed` |

(docs/payment-service/architecture-design.md:803-809)

---

## Service Component Summary

| Component | Key Responsibility |
|---|---|
| **PaymentService** | Create payments, query status, cancel, handle provider callbacks |
| **PaymentMethodService** | CRUD for tokenised payment methods (PCI-compliant, metadata only) |
| **RefundService** | Create refunds with amount constraint: `SUM(succeeded refunds) <= payment.amount` |
| **TenantService** | Register tenants, rotate API keys, manage provider config |
| **WebhookService** | Manage endpoint configs, dispatch events to subscribers |
| **IdempotencyService** | Prevent duplicate processing via Redis + PostgreSQL dual-layer cache |

(docs/payment-service/architecture-design.md:306-419)

---

## Related Pages

| Page | Description |
|---|---|
| [Payment Service Schema](./schema) | Database tables, RLS policies, indexes, and Flyway migrations |
| [Payment Service API](./api) | Full API reference with endpoints, auth, and error codes |
| [Billing Service Architecture](../billing-service/) | Billing Service internal architecture and scheduling |
| [Inter-Service Communication](../inter-service-communication) | Sync REST calls and async event propagation between services |
| [Event System](../event-system) | Transactional outbox, topics, webhooks, and DLQ monitoring |
| [Platform Overview](../../01-getting-started/platform-overview) | High-level two-service architecture and deployment topology |
| [Security and Compliance](../../03-deep-dive/security-compliance/) | PCI DSS, POPIA, encryption, and tenant isolation |
