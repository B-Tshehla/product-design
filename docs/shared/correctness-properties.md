# Correctness Properties — Payment Gateway Platform

| Field            | Value                                      |
|------------------|--------------------------------------------|
| **Version**      | 1.0                                        |
| **Date**         | 2026-03-25                                 |
| **Status**       | Draft                                      |
| **Scope**        | Both Payment Service and Billing Service   |

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Payment Service Invariants](#2-payment-service-invariants)
3. [Billing Service Invariants](#3-billing-service-invariants)
4. [Cross-Service Invariants](#4-cross-service-invariants)
5. [Property-Based Testing](#5-property-based-testing)
6. [Formal Specifications for Key Functions](#6-formal-specifications-for-key-functions)

---

## 1. Purpose

This document defines the **formal correctness properties** that the Payment Gateway Platform must satisfy at all times. These properties serve as:

- **Design contracts** — Developers must preserve these invariants when modifying code
- **Test oracles** — Property-based tests verify these properties hold for arbitrary inputs
- **Audit criteria** — Security and compliance reviews check that these guarantees are intact
- **Incident analysis** — Violations of these properties indicate bugs or security issues

Each property is stated in semi-formal notation and mapped to the verification mechanism that enforces it.

### Notation

| Symbol | Meaning |
|--------|---------|
| `∀` | For all |
| `∃` | There exists |
| `∃!` | There exists exactly one |
| `⟹` | Implies |
| `∧` | Logical AND |
| `∨` | Logical OR |
| `∩` | Intersection |
| `∅` | Empty set |
| `\|S\|` | Cardinality (count) of set S |

---

## 2. Payment Service Invariants

### P1: Payment Idempotency

**Statement:**
```
∀ p1, p2 ∈ Payments:
  (p1.idempotencyKey = p2.idempotencyKey ∧
   p1.tenantId = p2.tenantId ∧
   params(p1) = params(p2)) ⟹
  result(p1) = result(p2) ∧ sideEffectsCount = 1
```

For any two payment requests with the same idempotency key, tenant, and parameters, the result is identical and the payment is created exactly once.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | UNIQUE constraint on `(tenant_id, key)` in `idempotency_keys` table |
| Application | `IdempotencyService` checks cache before processing; stores response on first execution |
| Test | Property-based test: submit same request twice, assert same response and single DB record |

---

### P2: Tenant Isolation

**Statement:**
```
∀ tenant1, tenant2 ∈ Tenants, tenant1.id ≠ tenant2.id:
  data(operation, tenant1) ∩ data(operation, tenant2) = ∅
```

No operation on behalf of one tenant can read, modify, or produce data belonging to another tenant.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | PostgreSQL Row-Level Security: `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)` |
| Application | `TenantContext` (ThreadLocal) set by `ApiKeyAuthFilter`; `SET LOCAL` on every connection |
| Test | Integration test: create data as tenant A, query as tenant B, assert empty results |

---

### P3: Payment Status Transitions

**Statement:**
```
∀ payment ∈ Payments:
  validTransition(payment.previousStatus, payment.currentStatus)

Valid transitions:
  pending     → {processing, canceled}
  processing  → {succeeded, failed, requires_action}
  requires_action → {processing, canceled}
  succeeded   → {} (terminal)
  failed      → {} (terminal)
  canceled    → {} (terminal)
```

Payment status changes follow a well-defined state machine. No invalid transition is allowed.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `PaymentStatus.canTransitionTo(newStatus)` method validates before update |
| DB | `CHECK` constraint on status column + application-level validation |
| Test | Unit test: enumerate all status pairs, assert only valid transitions succeed |

---

### P4: Refund Amount Constraint

**Statement:**
```
∀ payment ∈ Payments:
  SUM(refunds.WHERE(paymentId = payment.id ∧ status ∈ {'processing', 'succeeded'}).amount) ≤ payment.amount
```

The total refunded amount (including in-flight refunds) never exceeds the original payment amount.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `RefundService.calculateRefundableAmount()` checks before creating refund |
| DB | Validated within transaction (SELECT SUM + INSERT atomically) |
| Test | Property-based test: for random payment amounts and refund sequences, assert invariant holds |

---

### P5: Webhook Delivery Guarantee

**Statement:**
```
∀ payment ∈ Payments:
  (payment.status ∈ {succeeded, failed, canceled}) ⟹
  ∃ webhookLog ∈ WebhookLogs: webhookLog.paymentId = payment.id
```

For every payment that reaches a terminal state, at least one webhook delivery attempt is enqueued.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | Status update and outbox event INSERT occur within the same database transaction |
| Outbox | `OutboxPoller` reads unpublished events and enqueues webhook delivery; guarantees at-least-once even if the message broker is temporarily down |
| Test | Integration test: complete payment, assert `outbox_events` and `webhook_logs` entries exist |

---

### P6: Provider Payment ID Uniqueness

**Statement:**
```
∀ p1, p2 ∈ Payments:
  (p1.provider = p2.provider ∧
   p1.providerPaymentId = p2.providerPaymentId ∧
   p1.providerPaymentId IS NOT NULL) ⟹
  p1.id = p2.id
```

Provider-assigned payment identifiers are unique within a given provider. No two distinct payment records reference the same provider transaction.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | UNIQUE index on `(provider, provider_payment_id)` WHERE `provider_payment_id IS NOT NULL` |
| Application | Webhook deduplication by `provider_payment_id + event_type` |
| Test | Integration test: attempt duplicate insert, assert constraint violation |

---

### P7: Payment Method Ownership

**Statement:**
```
∀ pm ∈ PaymentMethods:
  ∃! tenant ∈ Tenants: pm.tenantId = tenant.id
```

Every payment method belongs to exactly one tenant. No orphaned or shared payment methods exist.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `NOT NULL` foreign key `tenant_id → tenants(id)` + RLS |
| Test | Constraint test: attempt insert with invalid tenant_id, assert FK violation |

---

### P8: Webhook Retry Exponential Backoff

**Statement:**
```
∀ delivery ∈ WebhookDeliveries:
  (delivery.attemptNumber > 1) ⟹
  delivery.nextRetryAt ≥ delivery.attemptedAt + baseDelay × 2^(attemptNumber - 2)
```

Webhook retry delays follow exponential backoff. Each retry waits at least twice as long as the previous.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `WebhookWorker` calculates `nextRetryAt` using configurable backoff multiplier |
| Test | Unit test: verify delay sequence for attempts 1..N |

---

### P9: Idempotency Key Expiration

**Statement:**
```
∀ key ∈ IdempotencyKeys:
  (NOW() - key.createdAt > 24 hours) ⟹
  key.expires_at < NOW() ∧ key is deletable
```

Idempotency keys expire after 24 hours, after which the same key may be reused for a new request.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `expires_at` column with default `NOW() + INTERVAL '24 hours'` |
| Application | `CleanupJob` deletes expired keys daily |
| Test | Integration test: create key, advance time 25h, assert key no longer blocks new request |

---

### P10: Monetary Precision

**Statement:**
```
∀ payment ∈ Payments:
  payment.amount is DECIMAL(19,4) ∧
  payment.amount > 0

∀ refund ∈ Refunds:
  refund.amount is DECIMAL(19,4) ∧
  refund.amount > 0
```

All monetary amounts in the Payment Service use `DECIMAL(19,4)` (major units — Rands) with exact arithmetic. Floating-point types (`float`, `double`) are never used for monetary calculations.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `DECIMAL(19,4)` column type with `CHECK (amount > 0)` |
| Application | `BigDecimal` used for all monetary operations with explicit `RoundingMode` |
| Test | Property-based test: random arithmetic operations, assert no precision loss |

---

### P11: Payment Creation Atomicity

**Statement:**
```
∀ createPayment(request):
  EITHER (payment record created ∧ provider called ∧ status updated ∧ outbox event persisted)
  OR (no payment record created ∧ no side effects)
```

Payment creation is atomic — it either fully succeeds (record, provider call, status, outbox event in same transaction) or fully rolls back. The outbox event is later published to the message broker by the `OutboxPoller` (see P13).

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `@Transactional` on `createPayment()` method; outbox INSERT in same transaction |
| DB | PostgreSQL transaction guarantees |
| Test | Integration test: simulate provider failure mid-transaction, assert no orphaned records or outbox events |

---

### P12: Webhook Signature Integrity

**Statement:**
```
∀ payload p, signature s, secret k:
  verify(s, p, k) = true ⟹ p was signed by holder of k ∧ p was not modified
  verify(s, modified(p), k) = false
```

Webhook signatures are cryptographically verified using HMAC-SHA256 with constant-time comparison, preventing both tampering and timing attacks.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `MessageDigest.isEqual()` for constant-time comparison |
| SPI | `WebhookVerifier` interface — each provider implements its own verification |
| Test | Unit test: verify valid signature → true, tampered payload → false, wrong secret → false |

---

### P13: Transactional Outbox Guarantee

**Statement:**
```
∀ domainStateChange d ∈ {Payment, Refund, Subscription, Invoice, ...}:
  d.committed ⟹
  ∃ outboxEvent o ∈ OutboxEvents:
    o.transaction = d.transaction ∧
    o.entity_id = d.entity.id ∧
    o.event_type = d.eventType

∀ outboxEvent o ∈ OutboxEvents:
  eventually(o.published_to_broker = true)
```

For every domain state change, an outbox event is persisted within the same database transaction. The `OutboxPoller` guarantees at-least-once publishing to the message broker — no event is lost even if the broker is temporarily unavailable.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `outbox_events` table with `published_at IS NULL` filter for pending events |
| Application | Domain service persists outbox event in same `@Transactional` method as the state change |
| OutboxPoller | Scheduled job reads unpublished events, publishes to the message broker, marks `published_at` |
| Test | Integration test: commit domain change with the message broker down, assert outbox event persisted, start the broker, assert event eventually published |

---

## 3. Billing Service Invariants

### B1: Tenant Isolation (Billing)

**Statement:**
```
∀ tenant1, tenant2 ∈ ServiceTenants, tenant1.id ≠ tenant2.id:
  ∀ resource ∈ {Subscriptions, Invoices, Plans, Coupons, ApiKeys}:
    resource.service_tenant_id = tenant1.id ⟹
    resource NOT accessible via tenant2's API key
```

Identical guarantee to P2, enforced via `app.current_service_tenant_id` RLS variable on the Billing Service database.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | RLS on 9 tables using `current_setting('app.current_service_tenant_id')::uuid` |
| Application | `TenantContext` set by `ApiKeyAuthenticationFilter` |
| Test | Integration test: create subscription as tenant A, query as tenant B, assert 404 |

---

### B2: Subscription Uniqueness

**Statement:**
```
∀ tenant ∈ ServiceTenants:
  ∀ customerId ∈ ExternalCustomerIds:
    |{ s ∈ Subscriptions |
       s.service_tenant_id = tenant.id ∧
       s.external_customer_id = customerId ∧
       s.status ∈ {'active', 'trialing', 'past_due', 'paused'} }| ≤ 1
```

Each customer has at most one active-family subscription per tenant. This prevents duplicate billing.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | Partial unique index: `CREATE UNIQUE INDEX ... ON subscriptions (service_tenant_id, external_customer_id) WHERE status NOT IN ('canceled', 'incomplete_expired')` — allows re-subscription after terminal states |
| Application | `SubscriptionService` checks for existing active subscription before creation |
| Test | Integration test: attempt second subscription for same customer, assert 409 `CUSTOMER_ALREADY_SUBSCRIBED`; cancel first, create new, assert success |

---

### B3: Coupon Discount Bounds

**Statement:**
```
∀ coupon c, plan p:
  IF c.discount_type = 'percent' THEN
    discount(c, p) = p.price_cents × c.discount_value / 100
    0 ≤ discount(c, p) ≤ p.price_cents
  ELSE IF c.discount_type = 'fixed' THEN
    discount(c, p) = MIN(c.discount_value, p.price_cents)
    0 ≤ discount(c, p) ≤ p.price_cents
```

A coupon discount never exceeds the plan price (no negative invoices) and is always non-negative.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `CHECK (discount_value > 0)`, `CHECK (discount_value BETWEEN 1 AND 100)` for percent type |
| Application | `InvoiceService.calculateDiscount()` clamps result to `[0, price_cents]` |
| Test | Property-based test: for random `(discountValue, priceCents)` pairs, assert `0 ≤ discount ≤ priceCents` |

---

### B4: Subscription Status Transitions

**Statement:**
```
∀ subscription ∈ Subscriptions:
  validTransition(subscription.previousStatus, subscription.currentStatus)

Valid transitions:
  trialing          → {active, incomplete, canceled}
  incomplete        → {active, incomplete_expired}
  active            → {past_due, canceled, paused}
  past_due          → {active, canceled, unpaid}
  paused            → {active}
  unpaid            → {active, canceled}
  canceled          → {active}  (reactivation before period end only)
  incomplete_expired → {} (terminal)
```

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `SubscriptionStatus.canTransitionTo(newStatus)` validates before update |
| Test | Unit test: enumerate all status pairs, assert only valid transitions succeed |

---

### B5: Invoice Amount Invariants

**Statement:**
```
∀ invoice ∈ Invoices:
  invoice.amount_cents ≥ 0 ∧
  invoice.amount_due_cents ≥ 0 ∧
  invoice.amount_paid_cents ≥ 0 ∧
  invoice.amount_paid_cents ≤ invoice.amount_cents ∧
  invoice.amount_due_cents = invoice.amount_cents - invoice.amount_paid_cents
```

Invoice amounts are always non-negative, paid amount never exceeds total, and due amount is correctly derived.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | `CHECK (amount_cents >= 0)`, `CHECK (amount_due_cents >= 0)`, `CHECK (amount_paid_cents >= 0)` |
| Application | `InvoiceService` recalculates `amount_due_cents` on every payment update |
| Test | Property-based test: for random invoice/payment sequences, assert invariant holds |

---

### B6: API Key Security

**Statement:**
```
∀ apiKey k:
  k.plaintext shown exactly once (at creation or rotation) ∧
  storedHash = BCrypt(k.plaintext, cost ≥ 12) ∧
  BCrypt.verify(k.plaintext, storedHash) = true ∧
  ∀ other ≠ k.plaintext: BCrypt.verify(other, storedHash) = false
```

API keys are delivered exactly once as plaintext, then stored only as a BCrypt hash. The hash is computationally irreversible.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `ClientService.registerClient()` / `rotateApiKey()` returns plaintext once; stores hash only |
| DB | `key_hash` column — no plaintext column exists |
| Test | Unit test: generate key, verify BCrypt cost ≥ 12, verify original → true, random → false |

---

### B7: Payment Consistency (Invoice ↔ Payment)

**Statement:**
```
∀ invoice ∈ Invoices:
  invoice.status = 'paid' ⟹
  ∃ payment ∈ PaymentService:
    payment.id = invoice.payment_service_payment_id ∧
    payment.status = 'succeeded'
```

An invoice is marked `paid` only when a corresponding payment in the Payment Service has succeeded.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `InvoiceService.markPaid()` only called from Payment Service webhook handler (`payment.succeeded`) |
| Integration | Billing Service verifies payment status via Payment Service API before marking paid |
| Test | Integration test: mock Payment Service failure, assert invoice remains `open` |

---

### B8: Webhook Retry Bounds

**Statement:**
```
∀ delivery ∈ WebhookDeliveries:
  delivery.attempt_count ≤ MAX_RETRIES + 1 ∧
  (delivery.attempt_count > MAX_RETRIES ⟹ delivery.status ∈ {'failed', 'delivered'})
```

Webhook deliveries never exceed the maximum retry count. After exhausting retries, the delivery is terminal.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `WebhookWorker` checks `attemptCount > MAX_RETRIES` before scheduling retry |
| Test | Unit test: simulate MAX_RETRIES failures, assert status = `failed` and no further retries scheduled |

---

### B9: Proration Correctness

**Statement:**
```
∀ planChange(subscription, oldPlan, newPlan, changeDate):
  LET totalDays = daysBetween(periodStart, periodEnd)
  LET remainingDays = daysBetween(changeDate, periodEnd)
  LET credit = (oldPlan.priceCents / totalDays) × remainingDays
  LET charge = (newPlan.priceCents / totalDays) × remainingDays

  credit ≥ 0 ∧ charge ≥ 0 ∧
  (newPlan.priceCents > oldPlan.priceCents ⟹ charge - credit > 0) ∧
  (newPlan.priceCents < oldPlan.priceCents ⟹ charge - credit < 0) ∧
  (newPlan.priceCents = oldPlan.priceCents ⟹ charge - credit = 0)
```

Proration calculations produce correct directional results: upgrades charge more, downgrades credit, same-price changes net zero.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `ProrationCalculator.calculate()` with `BigDecimal` arithmetic and `HALF_UP` rounding |
| Test | Property-based test: for random (oldPrice, newPrice, totalDays, remainingDays), assert directional correctness |

---

### B10: Idempotency (Billing)

**Statement:**
```
∀ request r with idempotency_key k:
  LET response1 = process(r, k)
  LET response2 = process(r, k)
  response1 = response2 ∧ sideEffectsCount = 1
```

Same guarantee as P1, applied to Billing Service operations. Uses `app.current_service_tenant_id` scoping.

| Enforcement | Mechanism |
|-------------|-----------|
| DB | Composite primary key `(service_tenant_id, key)` in `idempotency_keys` table (tenant-scoped, not relying on RLS alone) |
| Application | `IdempotencyService` checks before processing |
| Test | Property-based test: submit same billing request twice, assert same response |

---

## 4. Cross-Service Invariants

### X1: Payment Amount Unit Consistency

**Statement:**
```
∀ interaction between Billing Service and Payment Service:
  Billing Service stores amounts as INTEGER (cents)
  Payment Service stores amounts as DECIMAL(19,4) (Rands)

  amountRands = amountCents / 100.0
  amountCents = ROUND(amountRands × 100)

  Conversions are performed at the Billing Service boundary (PaymentServiceClient)
```

The two services intentionally use different amount representations. Conversion must happen at the integration boundary with explicit rounding.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `PaymentServiceClientImpl` converts `cents → Rands` before calling Payment Service |
| Test | Property-based test: for random cent amounts, assert `cents == ROUND(cents/100 × 100)` (round-trip) |

---

### X2: Cross-Service Tenant Mapping

**Statement:**
```
∀ billingTenant ∈ ServiceTenants WHERE billingTenant.paymentServiceTenantId IS NOT NULL:
  ∃ paymentTenant ∈ Tenants:
    paymentTenant.id = billingTenant.paymentServiceTenantId ∧
    paymentTenant.is_active = true
```

Every Billing Service tenant that references a Payment Service tenant must map to a valid, active Payment Service tenant.

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `ClientService.registerClient()` validates Payment Service tenant exists (via API call) |
| Test | Integration test: register billing tenant with invalid payment tenant ID, assert rejection |

---

### X3: Invoice-Payment Linkage

**Statement:**
```
∀ invoice ∈ Invoices WHERE invoice.payment_service_payment_id IS NOT NULL:
  ∃ payment ∈ PaymentService.Payments:
    payment.id = invoice.payment_service_payment_id ∧
    payment.tenantId = billingTenant.paymentServiceTenantId ∧
    payment.amount = invoice.amount_due_cents / 100
```

Invoice-to-payment references are valid and amounts match (after unit conversion).

| Enforcement | Mechanism |
|-------------|-----------|
| Application | `InvoiceService.processPayment()` stores the payment ID returned by Payment Service |
| Event | Payment Service `payment.succeeded` webhook confirms the payment ID and amount |
| Test | E2E test: create subscription, verify invoice amount matches payment amount (after conversion) |

---

### X4: Webhook Delivery Guarantee (Cross-Service)

**Statement:**
```
∀ billingEvent e dispatched to Payment Service:
  Billing Service uses circuit breaker + retry (Resilience4j)
  At-least-once delivery guaranteed via message broker + HTTP webhooks

∀ paymentEvent e consumed by Billing Service:
  Billing Service consumer uses manual commit
  Failed events routed to payment.events.billing.dlq
  At-least-once processing guaranteed
```

Events between the two services are delivered at least once. Consumer-side idempotency handles duplicates.

| Enforcement | Mechanism |
|-------------|-----------|
| Broker | `acks=all`, manual commit, DLQ for failures |
| HTTP | Circuit breaker (Resilience4j), exponential retry |
| Test | Integration test: simulate consumer failure, verify DLQ receives event, reprocess successfully |

---

## 5. Property-Based Testing

All invariants above should be verified with property-based testing using **jqwik** (Java QuickCheck). Property-based tests generate random inputs to find edge cases that manual tests miss.

### 5.1 Payment Service Properties

```java
@Property
void paymentAmountAlwaysPositive(@ForAll @BigRange(min = "0.01", max = "999999.99") BigDecimal amount) {
    // P10: All monetary amounts are positive
    assertThat(amount).isPositive();
    CreatePaymentRequest request = new CreatePaymentRequest(amount, "ZAR", "CARD", ...);
    // Service should accept without validation error
}

@Property
void refundNeverExceedsPaymentAmount(
        @ForAll @BigRange(min = "0.01", max = "9999.99") BigDecimal paymentAmount,
        @ForAll @BigRange(min = "0.01", max = "9999.99") BigDecimal refundAmount) {
    // P4: Refund amount constraint
    if (refundAmount.compareTo(paymentAmount) > 0) {
        assertThrows(RefundExceedsAmountException.class, () ->
            refundService.createRefund(paymentId, refundAmount));
    }
}

@Property
void idempotencyKeyReturnsConsistentResults(
        @ForAll("validPaymentRequests") CreatePaymentRequest request) {
    // P1: Payment idempotency
    PaymentResponse r1 = paymentService.createPayment(tenantId, request);
    PaymentResponse r2 = paymentService.createPayment(tenantId, request);
    assertThat(r1.getId()).isEqualTo(r2.getId());
    assertThat(r1.getStatus()).isEqualTo(r2.getStatus());
}
```

### 5.2 Billing Service Properties

```java
@Property
void couponDiscountNeverExceedsPlanPrice(
        @ForAll @IntRange(min = 1, max = 100) int discountPercent,
        @ForAll @IntRange(min = 1, max = 999999) int priceCents) {
    // B3: Coupon discount bounds
    int discount = priceCents * discountPercent / 100;
    assertThat(discount).isBetween(0, priceCents);
}

@Property
void fixedDiscountNeverExceedsPlanPrice(
        @ForAll @IntRange(min = 1, max = 999999) int discountValue,
        @ForAll @IntRange(min = 1, max = 999999) int priceCents) {
    // B3: Fixed discount bounds
    int discount = Math.min(discountValue, priceCents);
    assertThat(discount).isBetween(0, priceCents);
}

@Property
void prorationDirectionallyCorrect(
        @ForAll @IntRange(min = 100, max = 99999) int oldPrice,
        @ForAll @IntRange(min = 100, max = 99999) int newPrice,
        @ForAll @IntRange(min = 1, max = 365) int totalDays,
        @ForAll @IntRange(min = 1) int remainingDays) {
    // B9: Proration correctness
    Assume.that(remainingDays <= totalDays);

    ProrationResult result = ProrationCalculator.calculate(
        oldPrice, newPrice, totalDays, remainingDays);

    if (newPrice > oldPrice) {
        assertThat(result.netCharge()).isPositive();
    } else if (newPrice < oldPrice) {
        assertThat(result.netCharge()).isNegative();
    } else {
        assertThat(result.netCharge()).isZero();
    }
}

@Property
void invoiceAmountsAlwaysConsistent(
        @ForAll @IntRange(min = 0, max = 999999) int amountCents,
        @ForAll @IntRange(min = 0) int amountPaidCents) {
    // B5: Invoice amount invariants
    Assume.that(amountPaidCents <= amountCents);

    int amountDueCents = amountCents - amountPaidCents;
    assertThat(amountDueCents).isGreaterThanOrEqualTo(0);
    assertThat(amountPaidCents).isLessThanOrEqualTo(amountCents);
}

@Property
void subscriptionUniquePerCustomerPerTenant(
        @ForAll UUID tenantId,
        @ForAll String customerId) {
    // B2: Subscription uniqueness — test via DB constraint
    // First subscription succeeds
    Subscription s1 = subscriptionService.create(tenantId, customerId, planId);
    assertThat(s1).isNotNull();

    // Second subscription for same customer fails
    assertThrows(CustomerAlreadySubscribedException.class, () ->
        subscriptionService.create(tenantId, customerId, planId));
}
```

### 5.3 Cross-Service Properties

```java
@Property
void centToRandRoundTrip(@ForAll @IntRange(min = 1, max = 99999999) int cents) {
    // X1: Amount unit conversion round-trip
    BigDecimal rands = BigDecimal.valueOf(cents)
        .divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
    int backToCents = rands.multiply(BigDecimal.valueOf(100))
        .setScale(0, RoundingMode.HALF_UP)
        .intValueExact();
    assertThat(backToCents).isEqualTo(cents);
}
```

---

## 6. Formal Specifications for Key Functions

### 6.1 createPayment (Payment Service)

```
FUNCTION createPayment(tenantId: UUID, request: CreatePaymentRequest) → PaymentResponse

PRECONDITIONS:
  - tenantId is a valid UUID of an active tenant
  - request.amount > 0
  - request.currency = 'ZAR' (or supported currency)
  - request.paymentMethod ∈ supported payment methods
  - request.idempotencyKey is non-empty
  - request.returnUrl is a valid HTTPS URL

POSTCONDITIONS:
  - IF idempotency key already exists with same params:
      RETURN cached response (no new side effects)
  - IF idempotency key exists with different params:
      THROW IdempotencyConflictException
  - ELSE:
      Payment record created with status ∈ {pending, pending_redirect}
      Provider called via SPI (PaymentProvider.initiatePayment())
      payment_events record created (payment.created)
      Outbox event persisted — published to message broker by OutboxPoller
      Idempotency key stored with response (TTL: 24h)
      RETURN PaymentResponse with redirectUrl (if applicable)
  - ON FAILURE:
      No payment record created (transaction rolled back)
      No outbox events persisted
```

### 6.2 createSubscription (Billing Service)

```
FUNCTION createSubscription(tenantId: UUID, request: CreateSubscriptionRequest) → Subscription

PRECONDITIONS:
  - tenantId is a valid UUID of an active service tenant
  - request.externalCustomerId is non-empty
  - request.planId is a valid UUID of an active plan belonging to tenantId
  - IF request.couponCode provided: coupon must be valid and applicable to plan
  - No active subscription exists for (tenantId, externalCustomerId)

POSTCONDITIONS:
  - Subscription record created with:
      status = 'trialing' (if plan.trialDays > 0)
      status = 'incomplete' (if plan.trialDays = 0)
  - Payment Service customer created (via PaymentServiceClient)
  - payment_service_customer_id stored on subscription
  - IF coupon applied: coupon_id set, redemption_count incremented
  - Usage counter subscriptions_created incremented
  - audit_logs entry created (subscription.created)
  - Outbox event persisted (subscription.created) — published to message broker by OutboxPoller
  - RETURN subscription with paymentSetupUrl

  - ON FAILURE:
      No subscription record (transaction rolled back)
      No coupon redemption count change
      No outbox events persisted
```

### 6.3 processPaymentServiceWebhook (Billing Service)

```
FUNCTION processPaymentServiceWebhook(signature: String, payload: String) → void

PRECONDITIONS:
  - signature is a valid HMAC-SHA256 signature header
  - payload is raw request body
  - PAYMENT_SERVICE_WEBHOOK_SECRET is configured

POSTCONDITIONS:
  - IF signature invalid: THROW WebhookSignatureException (HTTP 401)
  - IF event type not handled: RETURN (no side effects)
  - IF payment.succeeded:
      Invoice status updated to 'paid'
      Subscription period advanced (if renewal)
      Outbox event persisted (invoice.paid) — published to message broker by OutboxPoller
      Usage counter payments_processed incremented
  - IF payment.failed:
      Invoice status updated (remains 'open')
      Subscription status set to 'past_due'
      Outbox event persisted (invoice.payment_failed) — published to message broker by OutboxPoller
      Usage counter payments_failed incremented
  - IF payment_method.attached:
      Subscription status updated (incomplete → active if applicable)
      Outbox event persisted (subscription.updated) — published to message broker by OutboxPoller
  - All operations atomic (single transaction)
```

### 6.4 validateCoupon (Billing Service)

```
FUNCTION validateCoupon(tenantId: UUID, code: String, planId: UUID?) → CouponValidation

PRECONDITIONS:
  - tenantId is a valid UUID
  - code is non-empty

POSTCONDITIONS:
  - IF coupon not found:         {valid: false, errorCode: 'COUPON_NOT_FOUND'}
  - IF coupon.status = expired:  {valid: false, errorCode: 'COUPON_EXPIRED'}
  - IF coupon.status = archived: {valid: false, errorCode: 'COUPON_ARCHIVED'}
  - IF coupon.valid_until < NOW: {valid: false, errorCode: 'COUPON_EXPIRED'}
  - IF redemption_count >= max:  {valid: false, errorCode: 'COUPON_EXHAUSTED'}
  - IF planId provided AND applies_to_plans NOT EMPTY AND planId NOT IN applies_to_plans:
                                 {valid: false, errorCode: 'COUPON_NOT_APPLICABLE'}
  - ELSE:                        {valid: true, coupon: <details>, discountAmount: <calculated>}
  - No side effects (read-only operation)
```

---

## Related Documents

- [Payment Service Architecture](../payment-service/architecture-design.md) — State machines, SPI contract
- [Payment Service Database Schema](../payment-service/database-schema-design.md) — CHECK constraints, UNIQUE indexes
- [Billing Service Architecture](../billing-service/architecture-design.md) — Proration logic, coupon validation
- [Billing Service Database Schema](../billing-service/database-schema-design.md) — CHECK constraints, RLS policies
- [System Architecture](./system-architecture.md) — Cross-service integration patterns
