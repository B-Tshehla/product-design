# Payment Service — Flow Diagrams

| Field       | Value              |
|-------------|--------------------|
| **Version** | 1.0                |
| **Date**    | 2026-03-25         |
| **Status**  | Draft              |

---

## Table of Contents

1. [One-Time Card Payment (Redirect Flow)](#1-one-time-card-payment-redirect-flow)
2. [One-Time EFT Payment (Bank Redirect Flow)](#2-one-time-eft-payment-bank-redirect-flow)
3. [Recurring Token Charge](#3-recurring-token-charge)
4. [Refund Processing](#4-refund-processing)
5. [Provider Webhook Handling (Generic)](#5-provider-webhook-handling-generic)
6. [Card Provider Webhook (HMAC Signature)](#6-card-provider-webhook-hmac-signature)
7. [EFT Provider Webhook (Hash Verification)](#7-eft-provider-webhook-hash-verification)
8. [Outgoing Webhook Dispatch](#8-outgoing-webhook-dispatch)
9. [Idempotency Flow](#9-idempotency-flow)
10. [Payment Method CRUD](#10-payment-method-crud)
11. [Payment Status State Machine](#11-payment-status-state-machine)
12. [Refund Status State Machine](#12-refund-status-state-machine)

---

## 1. One-Time Card Payment (Redirect Flow)

Standard card payment where the customer is redirected to complete 3D Secure authentication via the resolved card provider.

> **Reference implementation:** The example uses Peach Payments as the card provider. Any provider implementing the `PaymentProvider` SPI follows the same sequence.

```mermaid
sequenceDiagram
    participant Tenant as Tenant (Billing Service / Product)
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Redis
    participant Provider as Card Provider API<br/>(e.g. Peach Payments)
    participant Broker as Message Broker
    participant Customer as Customer Browser

    Tenant->>PS: POST /api/v1/payments
    Note over Tenant,PS: Headers: X-API-Key, X-Tenant-ID,<br/>Idempotency-Key

    PS->>PS: ApiKeyAuthFilter: validate key, set TenantContext
    PS->>Redis: Check idempotency key
    alt Idempotency hit (same body)
        Redis-->>PS: Cached response
        PS-->>Tenant: Return cached response
    end

    PS->>DB: SET LOCAL app.current_tenant_id = ?
    PS->>PS: ProviderFactory.getProvider(paymentMethod=CARD)
    PS->>DB: INSERT payment (status=pending)

    PS->>Provider: provider.createPayment(request)
    Note over PS,Provider: Amount, currency=ZAR, returnUrl,<br/>customerEmail, metadata

    Provider-->>PS: Checkout URL + provider_payment_id

    PS->>DB: UPDATE payment (status=processing, provider_payment_id)
    PS->>Redis: Store idempotency key + response (TTL 24h)
    PS->>DB: INSERT payment_event (payment.created)
    PS->>DB: INSERT outbox_event (payment.created)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS-->>Tenant: 201 Created
    Note over PS,Tenant: {id, status=processing, redirectUrl}

    Tenant->>Customer: Redirect to redirectUrl
    Customer->>Provider: Complete 3DS / card details
    Provider->>Customer: Redirect to returnUrl

    Note over Provider,PS: Asynchronous provider webhook
    Provider->>PS: POST /api/v1/webhooks/{providerCode}
    Note over Provider,PS: Payment result notification

    PS->>PS: WebhookVerifier.verifySignature(payload, headers)
    PS->>DB: INSERT payment_event (webhook received)
    PS->>DB: UPDATE payment (status=succeeded)
    PS->>DB: INSERT payment_event (payment.succeeded)
    PS->>DB: INSERT outbox_event (payment.succeeded)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS->>PS: WebhookDispatcher.dispatch(payment.succeeded)
    PS-->>Provider: 200 OK

    Note over Broker,Tenant: Tenant consumes event
    Broker-->>Tenant: payment.succeeded
```

---

## 2. One-Time EFT Payment (Bank Redirect Flow)

Instant EFT payment where the customer is redirected to their bank's online banking portal via the resolved EFT provider.

> **Reference implementation:** The example uses Ozow as the EFT provider. Any provider implementing the `PaymentProvider` SPI follows the same sequence.

```mermaid
sequenceDiagram
    participant Tenant as Tenant
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Redis
    participant Provider as EFT Provider API<br/>(e.g. Ozow)
    participant Broker as Message Broker
    participant Customer as Customer Browser
    participant Bank as Customer's Bank

    Tenant->>PS: POST /api/v1/payments
    Note over Tenant,PS: paymentMethod=EFT

    PS->>PS: Validate API key, check tenant active
    PS->>Redis: Check idempotency key
    PS->>DB: SET LOCAL app.current_tenant_id = ?
    PS->>PS: ProviderFactory.getProvider(paymentMethod=EFT)
    PS->>DB: INSERT payment (status=pending)

    PS->>Provider: provider.createPayment(request)
    Note over PS,Provider: Amount, currency=ZAR, bankRef,<br/>notifyUrl, successUrl, cancelUrl

    Provider-->>PS: Redirect URL (payment page)
    PS->>DB: UPDATE payment (status=processing)
    PS->>Redis: Store idempotency key + response
    PS->>DB: INSERT outbox_event (payment.created)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS-->>Tenant: 201 Created
    Note over PS,Tenant: {id, status=processing, redirectUrl}

    Tenant->>Customer: Redirect to provider payment page
    Customer->>Provider: Select bank
    Provider->>Customer: Redirect to bank login
    Customer->>Bank: Authenticate & approve payment
    Bank-->>Provider: Payment confirmed
    Provider->>Customer: Redirect to successUrl

    Note over Provider,PS: Notification callback (async)
    Provider->>PS: POST /api/v1/webhooks/{providerCode}

    PS->>PS: WebhookVerifier.verifySignature(payload, headers)
    PS->>DB: INSERT payment_event (webhook received)

    PS->>Provider: provider.getPaymentStatus(externalId)
    Note over PS,Provider: Double-check payment status<br/>to prevent spoofed callbacks
    Provider-->>PS: Transaction status confirmed

    PS->>DB: UPDATE payment (status=succeeded)
    PS->>DB: INSERT payment_event (payment.succeeded)
    PS->>DB: INSERT outbox_event (payment.succeeded)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS->>PS: WebhookDispatcher.dispatch(payment.succeeded)
    PS-->>Provider: 200 OK

    Broker-->>Tenant: payment.succeeded
```

---

## 3. Recurring Token Charge

Server-to-server charge using a stored payment method token. Initiated by the Billing Service (or any tenant) for subscription renewals.

```mermaid
sequenceDiagram
    participant Tenant as Billing Service
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Redis
    participant Provider as Card Provider API<br/>(e.g. Peach Payments)

    Tenant->>PS: POST /api/v1/payments
    Note over Tenant,PS: paymentMethodId=pm_xyz,<br/>paymentType=RECURRING,<br/>Idempotency-Key: "invoice-{invoiceId}"

    PS->>PS: Validate API key
    PS->>Redis: Check idempotency key
    PS->>DB: SET LOCAL app.current_tenant_id = ?
    PS->>DB: SELECT payment_method WHERE id=pm_xyz AND is_active=true
    Note over PS,DB: Decrypt provider_method_id (AES-256-GCM)

    PS->>PS: ProviderFactory.getProvider(payment_method.provider)
    PS->>DB: INSERT payment (status=pending, payment_method_id=pm_xyz)

    PS->>Provider: provider.createPayment(request)
    Note over PS,Provider: Token-based charge:<br/>provider_method_id, amount,<br/>currency=ZAR, recurringType=REPEATED

    alt Payment succeeds (synchronous response)
        Provider-->>PS: Success result
        PS->>DB: UPDATE payment (status=succeeded, processed_at=NOW())
        PS->>DB: INSERT payment_event (payment.succeeded)
        PS->>Redis: Store idempotency key + response
        PS->>DB: INSERT outbox_event (payment.succeeded)
        Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
        PS->>PS: WebhookDispatcher.dispatch(payment.succeeded)
        PS-->>Tenant: 201 Created {status=succeeded}

    else Payment fails
        Provider-->>PS: Failure result
        PS->>DB: UPDATE payment (status=failed)
        PS->>DB: INSERT payment_event (payment.failed)
        PS->>Redis: Store idempotency key + response
        PS->>DB: INSERT outbox_event (payment.failed)
        Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
        PS->>PS: WebhookDispatcher.dispatch(payment.failed)
        PS-->>Tenant: 201 Created {status=failed}

    else Provider error / timeout
        Provider-->>PS: Error / timeout
        PS->>DB: UPDATE payment (status=failed)
        PS->>DB: INSERT outbox_event (payment.failed)
        Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
        PS-->>Tenant: 502 Provider Error
    end
```

---

## 4. Refund Processing

Full and partial refunds routed to the same provider that processed the original payment.

```mermaid
sequenceDiagram
    participant Tenant as Tenant
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Provider as Payment Provider<br/>(resolved via SPI)

    Tenant->>PS: POST /api/v1/payments/{paymentId}/refunds
    Note over Tenant,PS: {amount: 150.00, reason: "..."}

    PS->>PS: Validate API key
    PS->>DB: SET LOCAL app.current_tenant_id = ?
    PS->>DB: SELECT payment WHERE id={paymentId}

    PS->>PS: Validate refund
    Note over PS: - Payment status = succeeded?<br/>- SUM(succeeded refunds) + amount <= payment.amount?<br/>- Provider supports refunds?

    alt Validation fails
        PS-->>Tenant: 422 Unprocessable Entity
    end

    PS->>DB: INSERT refund (status=pending)
    PS->>DB: INSERT payment_event (refund.created)

    PS->>PS: ProviderFactory.getProvider(payment.provider)
    PS->>Provider: provider.createRefund(request)
    Note over PS,Provider: provider_payment_id, amount, reason

    alt Refund succeeds
        Provider-->>PS: Success
        PS->>DB: UPDATE refund (status=succeeded, processed_at)
        PS->>DB: INSERT payment_event (refund.succeeded)
        PS->>DB: INSERT outbox_event (refund.succeeded)
        Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
        PS->>PS: WebhookDispatcher.dispatch(refund.succeeded)
        PS-->>Tenant: 201 Created {status=succeeded}

    else Refund fails
        Provider-->>PS: Error
        PS->>DB: UPDATE refund (status=failed)
        PS->>DB: INSERT payment_event (refund.failed)
        PS->>DB: INSERT outbox_event (refund.failed)
        Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
        PS-->>Tenant: 422 Unprocessable Entity
    end
```

---

## 5. Provider Webhook Handling (Generic)

All provider webhooks follow the same generic flow through the `ProviderWebhookController`, dispatched to the correct adapter via the `providerCode` path parameter.

```mermaid
sequenceDiagram
    participant Provider as Payment Provider
    participant PS as Payment Service
    participant DB as PostgreSQL

    Provider->>PS: POST /api/v1/webhooks/{providerCode}
    Note over Provider,PS: Provider-specific payload<br/>(JSON or form-encoded)

    PS->>PS: ProviderFactory.getVerifier(providerCode)

    alt Unknown provider code
        PS-->>Provider: 404 Not Found
    end

    PS->>PS: verifier.verifySignature(payload, headers)

    alt Signature invalid
        PS->>DB: INSERT payment_event (webhook.signature_failed)
        PS-->>Provider: 401 Unauthorized
    end

    PS->>DB: Check for duplicate webhook
    Note over PS,DB: By provider_payment_id + event_type

    alt Duplicate detected
        PS->>DB: INSERT payment_event (webhook.duplicate)
        PS-->>Provider: 200 OK (acknowledge)
    end

    PS->>DB: INSERT payment_event (webhook.received)

    PS->>PS: verifier.parseEvent(payload, headers)
    Note over PS: Maps provider fields to<br/>ProviderWebhookEvent

    PS->>DB: Lookup related entity (payment/refund)
    PS->>DB: UPDATE entity status
    PS->>DB: INSERT payment_event (status change)
    PS->>DB: INSERT outbox_event (domain event)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS->>PS: WebhookDispatcher.dispatch(event)
    PS->>DB: UPDATE payment_event (webhook.processed)
    PS-->>Provider: 200 OK
```

---

## 6. Card Provider Webhook (HMAC Signature)

Detailed webhook processing for a provider using HMAC-SHA256 signature verification (e.g., Peach Payments).

```mermaid
sequenceDiagram
    participant Provider as Card Provider<br/>(e.g. Peach Payments)
    participant PS as Payment Service
    participant DB as PostgreSQL

    Provider->>PS: POST /api/v1/webhooks/peach_payments
    Note over Provider,PS: Headers: X-Signature<br/>Body: JSON payload

    PS->>PS: Extract signature from X-Signature header
    PS->>PS: Compute HMAC-SHA256(webhook_secret, raw_body)
    PS->>PS: Constant-time comparison

    alt Signature mismatch
        PS->>DB: Log failed verification
        PS-->>Provider: 401 Unauthorized
    end

    PS->>DB: Check duplicate by provider_payment_id + event_type
    PS->>DB: INSERT payment_event (webhook.received)

    PS->>PS: Parse event type from payload
    PS->>PS: Map provider fields to domain model

    alt Payment event
        PS->>DB: Lookup payment by provider_payment_id
        PS->>PS: Map result code to unified status
        Note over PS: 000.000.000 → succeeded<br/>800.* / 900.* → failed
        PS->>DB: UPDATE payment status
        PS->>DB: INSERT payment_event
        PS->>DB: INSERT outbox_event (payment event)

    else Chargeback event
        PS->>DB: Lookup payment
        PS->>DB: INSERT payment_event (payment.disputed)
        PS->>DB: INSERT outbox_event (payment.disputed)

    else Refund event
        PS->>DB: Lookup refund by provider_refund_id
        PS->>DB: UPDATE refund status
        PS->>DB: INSERT payment_event
        PS->>DB: INSERT outbox_event (refund event)
    end

    Note over PS,DB: All outbox events polled & published to message broker by OutboxPoller
    PS->>PS: WebhookDispatcher.dispatch(event)
    PS-->>Provider: 200 OK
```

---

## 7. EFT Provider Webhook (Hash Verification)

Detailed webhook processing for a provider using SHA512 hash verification (e.g., Ozow).

```mermaid
sequenceDiagram
    participant Provider as EFT Provider<br/>(e.g. Ozow)
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant ProviderAPI as Provider Status API

    Provider->>PS: POST /api/v1/webhooks/ozow
    Note over Provider,PS: Content-Type: application/x-www-form-urlencoded<br/>Fields: SiteCode, TransactionId, Amount, Status, Hash, ...

    PS->>PS: Parse form-encoded body
    PS->>PS: Generate verification hash
    Note over PS: 1. Concatenate fields in Ozow-defined order<br/>2. Append private key (lowercase)<br/>3. SHA512 hash<br/>4. Compare with received Hash

    alt Hash invalid
        PS->>DB: Log failed verification
        PS-->>Provider: 401 Unauthorized
    end

    PS->>DB: INSERT payment_event (webhook.received)

    Note over PS,ProviderAPI: Recommended: verify via API
    PS->>ProviderAPI: GET /GetTransaction?transactionId=...
    ProviderAPI-->>PS: Transaction details

    PS->>PS: Compare API response with notification
    Note over PS: Verify: amount, status,<br/>reference match

    alt Verification mismatch
        PS->>DB: Log discrepancy
        PS-->>Provider: 200 OK (acknowledge but flag)
    end

    PS->>DB: Lookup payment by TransactionReference
    PS->>PS: Map provider status to unified status
    Note over PS: Complete → succeeded<br/>Cancelled → canceled<br/>Error → failed

    PS->>DB: UPDATE payment status
    PS->>DB: INSERT payment_event
    PS->>DB: INSERT outbox_event (payment event)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS->>PS: WebhookDispatcher.dispatch(event)
    PS-->>Provider: 200 OK
```

---

## 8. Outgoing Webhook Dispatch

The Payment Service dispatches events to registered tenant webhook endpoints. This flow runs after any domain event is published.

```mermaid
sequenceDiagram
    participant Service as PaymentService / RefundService
    participant EP as EventPublisher
    participant DB as PostgreSQL (incl. outbox_events)
    participant WD as WebhookDispatcher
    participant WW as WebhookWorker
    participant Tenant as Tenant Endpoint

    Service->>EP: publishEvent(event)
    EP->>DB: INSERT outbox_event (persisted in same transaction as domain change)
    Note over EP,DB: OutboxPoller publishes to the message broker asynchronously
    EP->>WD: dispatch(event)

    WD->>DB: SELECT webhook_configs WHERE tenant_id=? AND is_active=true
    WD->>WD: Filter configs by subscribed events

    loop Each matching webhook config
        WD->>DB: INSERT webhook_log (event_type, payload)
        WD->>WW: enqueue(webhook_log_id, config)
    end

    WW->>WW: Sign payload with HMAC-SHA256(config.secret, body)
    WW->>Tenant: POST config.url
    Note over WW,Tenant: Headers: X-Webhook-Signature,<br/>X-Webhook-ID, X-Webhook-Timestamp

    alt Success (2xx)
        Tenant-->>WW: 200 OK
        WW->>DB: INSERT webhook_delivery (response_status=200)
        WW->>DB: UPDATE webhook_log (status=delivered)

    else Failure (non-2xx or timeout)
        Tenant-->>WW: 500 / timeout
        WW->>DB: INSERT webhook_delivery (response_status, error_message)

        alt Retries remaining (max 5)
            WW->>DB: UPDATE webhook_delivery (next_retry_at)
            Note over WW: Exponential backoff:<br/>30s, 2min, 15min, 1h, 4h
        else Max retries exhausted
            WW->>DB: UPDATE webhook_log (status=failed)
        end
    end
```

---

## 9. Idempotency Flow

How duplicate requests are detected and handled using Redis + PostgreSQL.

```mermaid
sequenceDiagram
    participant Tenant as Tenant
    participant PS as Payment Service
    participant Redis
    participant DB as PostgreSQL

    Note over Tenant,PS: Request with Idempotency-Key: "abc123"

    Tenant->>PS: POST /api/v1/payments
    Note over Tenant,PS: Idempotency-Key: abc123

    PS->>Redis: GET idempotency:tenant_id:abc123
    alt Redis hit (cache)
        Redis-->>PS: {request_hash, response_status, response_body}
        PS->>PS: Compare SHA-256(current_body) with stored request_hash
        alt Hash matches
            PS-->>Tenant: Return cached response (same status + body)
        else Hash differs
            PS-->>Tenant: 409 Conflict (IDEMPOTENCY_CONFLICT)
        end
    else Redis miss
        PS->>DB: SELECT FROM idempotency_keys WHERE key='abc123' AND tenant_id=?
        alt DB hit (cache miss but key exists)
            DB-->>PS: {request_hash, response_status, response_body}
            PS->>Redis: SET (backfill cache, TTL 24h)
            PS->>PS: Compare hashes (same logic as above)
        else Not found anywhere
            PS->>PS: Process request normally
            PS->>DB: INSERT idempotency_key (key, tenant_id, request_hash, response_*, expires_at)
            PS->>Redis: SET idempotency:tenant_id:abc123 (TTL 24h)
            PS-->>Tenant: 201 Created
        end
    end
```

---

## 10. Payment Method CRUD

Payment method management lifecycle (tokenise, list, update, delete).

### 10.1 Create (Tokenise) Payment Method

```mermaid
sequenceDiagram
    participant Tenant
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Provider as Card Provider API

    Tenant->>PS: POST /api/v1/payment-methods
    Note over Tenant,PS: {customerId, provider, returnUrl, paymentMethodType=CARD}

    PS->>PS: Validate API key
    PS->>DB: SET LOCAL app.current_tenant_id = ?
    PS->>PS: ProviderFactory.getProvider(provider)

    PS->>Provider: provider.createPaymentMethod(request)
    Note over PS,Provider: Tokenise request with<br/>createRegistration=true

    Provider-->>PS: Token + card metadata
    Note over Provider,PS: provider_method_id, brand, last4,<br/>exp_month, exp_year, fingerprint

    PS->>PS: Encrypt provider_method_id (AES-256-GCM)
    PS->>DB: INSERT payment_method
    Note over PS,DB: customer_id, provider, encrypted token,<br/>card_details JSONB, is_default, is_active

    PS->>DB: INSERT payment_event (payment_method.attached)
    PS->>DB: INSERT outbox_event (payment_method.attached)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS-->>Tenant: 201 Created
```

### 10.2 Delete Payment Method

```mermaid
sequenceDiagram
    participant Tenant
    participant PS as Payment Service
    participant DB as PostgreSQL
    participant Provider as Card Provider API

    Tenant->>PS: DELETE /api/v1/payment-methods/{id}

    PS->>DB: SELECT payment_method WHERE id=? AND tenant_id=?
    PS->>PS: Decrypt provider_method_id

    PS->>Provider: provider.deletePaymentMethod(provider_method_id)
    Provider-->>PS: 200 OK

    PS->>DB: UPDATE payment_method (is_active=false)
    PS->>DB: INSERT payment_event (payment_method.detached)
    PS->>DB: INSERT outbox_event (payment_method.detached)
    Note over PS,DB: Outbox: polled & published to message broker by OutboxPoller
    PS-->>Tenant: 204 No Content
```

---

## 11. Payment Status State Machine

```mermaid
stateDiagram-v2
    [*] --> pending : Payment created

    pending --> processing : Provider acknowledged
    pending --> requires_action : 3DS / redirect required
    pending --> canceled : Canceled before processing
    pending --> failed : Immediate rejection

    requires_action --> processing : Action completed (3DS success)
    requires_action --> canceled : Action abandoned
    requires_action --> failed : Action failed (3DS failure)

    processing --> succeeded : Provider confirmed
    processing --> failed : Provider rejected

    succeeded --> [*]
    failed --> [*]
    canceled --> [*]
```

**Valid transitions:**

| From | To |
|------|----|
| `pending` | `processing`, `requires_action`, `canceled`, `failed` |
| `requires_action` | `processing`, `canceled`, `failed` |
| `processing` | `succeeded`, `failed` |
| `succeeded` | Terminal (no further transitions) |
| `failed` | Terminal |
| `canceled` | Terminal |

---

## 12. Refund Status State Machine

```mermaid
stateDiagram-v2
    [*] --> pending : Refund created

    pending --> processing : Provider acknowledged
    pending --> failed : Immediate rejection
    pending --> canceled : Canceled

    processing --> succeeded : Provider confirmed
    processing --> failed : Provider rejected

    succeeded --> [*]
    failed --> [*]
    canceled --> [*]
```

**Refund constraints:**
- `SUM(succeeded refunds for a payment) <= payment.amount` — enforced in `RefundService`
- Refund currency must match original payment currency
- Only `succeeded` payments can be refunded
- Refunds route to the same provider that processed the original payment

---

## Related Documents

- [Architecture Design](./architecture-design.md) — SPI contract, service components, ER diagram
- [Database Schema Design](./database-schema-design.md) — Table definitions, RLS policies
- [API Specification](./api-specification.yaml) — OpenAPI 3.0 spec
- [Provider Integration Guide](./provider-integration-guide.md) — SPI contract, reference implementations
- [Compliance & Security Guide](./compliance-security-guide.md) — PCI DSS, 3DS, POPIA
