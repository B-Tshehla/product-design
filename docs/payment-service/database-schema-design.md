# Payment Service — Database Schema Design

## 1. Overview

The Payment Service uses a dedicated PostgreSQL 16+ database (`payment_service_db`) with **9 tables**. All tenant-scoped tables enforce Row-Level Security (RLS) policies.

### Schema Summary

| Table | Purpose | RLS |
|-------|---------|-----|
| `tenants` | Tenant registration and configuration | No (admin-only) |
| `payments` | Payment records | Yes |
| `payment_methods` | Tokenised payment methods | Yes |
| `refunds` | Refund records | Yes |
| `payment_events` | Immutable event log (audit trail) | Yes |
| `webhook_configs` | Outgoing webhook endpoint configuration | Yes |
| `webhook_logs` | Outgoing webhook event records | Yes |
| `webhook_deliveries` | Per-attempt delivery tracking | No (FK to webhook_logs) |
| `idempotency_keys` | Idempotency key cache | Yes |

### Conventions

- All primary keys are `UUID` using `gen_random_uuid()`
- All timestamps are `TIMESTAMP WITH TIME ZONE` defaulting to `NOW()`
- Monetary amounts use `DECIMAL(19,4)` with `CHECK (amount > 0)`
- Currency codes are `VARCHAR(3)` (ISO 4217), defaulting to `'ZAR'`
- Status columns are `VARCHAR(50)` with `CHECK` constraints for valid values
- Provider identifiers are `VARCHAR(50)` (not enums) for extensibility
- Soft deletes use `is_active BOOLEAN` flags
- FK relationships on operational/config tables use `ON DELETE CASCADE`
- FK relationships on financial/audit tables use `ON DELETE RESTRICT` (7-year retention requirement)

---

## 2. Entity Relationship Diagram

```mermaid
erDiagram
    tenants ||--o{ payments : "has"
    tenants ||--o{ payment_methods : "has"
    tenants ||--o{ refunds : "has"
    tenants ||--o{ payment_events : "has"
    tenants ||--o{ webhook_configs : "has"
    tenants ||--o{ webhook_logs : "has"
    tenants ||--o{ idempotency_keys : "has"

    payments ||--o{ refunds : "has"
    payments ||--o{ payment_events : "references"
    payments ||--o{ webhook_logs : "references"
    payment_methods ||--o{ payments : "used by"
    payment_methods ||--o{ payment_events : "references"

    webhook_logs ||--o{ webhook_deliveries : "has"

    refunds ||--o{ payment_events : "references"
    refunds ||--o{ webhook_logs : "references"

    tenants {
        uuid id PK
        varchar name
        varchar api_key UK
        varchar api_secret_hash
        jsonb processor_config
        integer rate_limit_per_minute
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    payments {
        uuid id PK
        uuid tenant_id FK
        uuid payment_method_id FK
        varchar idempotency_key UK
        varchar provider
        varchar provider_payment_id
        decimal amount
        varchar currency
        varchar status
        varchar payment_type
        jsonb metadata
        text description
        varchar customer_id
        varchar customer_email
        varchar customer_name
        timestamp processed_at
        timestamp created_at
        timestamp updated_at
    }

    payment_methods {
        uuid id PK
        uuid tenant_id FK
        varchar customer_id
        varchar provider
        varchar provider_method_id
        varchar method_type
        jsonb card_details
        jsonb bank_details
        boolean is_default
        boolean is_active
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }

    refunds {
        uuid id PK
        uuid payment_id FK
        uuid tenant_id FK
        varchar idempotency_key UK
        varchar provider_refund_id
        decimal amount
        varchar currency
        varchar status
        text reason
        jsonb metadata
        timestamp processed_at
        timestamp created_at
        timestamp updated_at
    }

    payment_events {
        uuid id PK
        uuid tenant_id FK
        uuid payment_id FK
        uuid refund_id FK
        uuid payment_method_id FK
        varchar event_type
        varchar status
        jsonb payload
        timestamp created_at
    }

    webhook_configs {
        uuid id PK
        uuid tenant_id FK
        varchar url
        varchar secret
        jsonb events
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    webhook_logs {
        uuid id PK
        uuid tenant_id FK
        uuid payment_id FK
        uuid refund_id FK
        varchar event_type
        varchar status
        jsonb payload
        timestamp created_at
    }

    webhook_deliveries {
        uuid id PK
        uuid webhook_log_id FK
        varchar url
        integer attempt_number
        integer response_status
        text response_body
        text error_message
        timestamp attempted_at
        timestamp next_retry_at
    }

    idempotency_keys {
        uuid tenant_id PK_FK
        varchar key PK
        varchar request_path
        varchar request_hash
        integer response_status
        jsonb response_body
        timestamp expires_at
        timestamp created_at
    }
```

---

## 3. Table Definitions (DDL)

### 3.1 `tenants`

Stores registered client projects (e.g., eTalente, CV Analyser) and their per-provider configuration.

```sql
-- V001__create_tenants.sql
CREATE TABLE tenants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,
    api_key               VARCHAR(255) NOT NULL UNIQUE,
    api_secret_hash       VARCHAR(255) NOT NULL,
    processor_config      JSONB NOT NULL DEFAULT '{}',
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_api_key ON tenants (api_key);
CREATE INDEX idx_tenants_is_active ON tenants (is_active);

COMMENT ON TABLE tenants IS 'Registered client projects that use the Payment Service';
COMMENT ON COLUMN tenants.api_key IS 'Public API key for authentication (unique per tenant)';
COMMENT ON COLUMN tenants.api_secret_hash IS 'BCrypt hash (cost 12+) of the API secret';
COMMENT ON COLUMN tenants.processor_config IS 'Per-tenant provider credentials: {"peach_payments": {...}, "ozow": {...}}';
```

**`processor_config` JSONB structure:**
```json
{
  "peach_payments": {
    "entity_id": "8ac7a4c...",
    "access_token": "OGFjN2...",
    "webhook_secret": "whsec_..."
  },
  "ozow": {
    "site_code": "ENT-001",
    "private_key": "pk_...",
    "api_key": "ak_..."
  }
}
```

> **Note:** Provider keys in `processor_config` are encrypted at rest using AES-256-GCM before storage. The JSONB column stores ciphertext. Decryption happens in the application layer via `CryptoUtil`.

---

### 3.3 `payments`

Core payment records. Each payment is associated with exactly one tenant and optionally one payment method.

```sql
-- V003__create_payments.sql
CREATE TABLE payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payment_method_id     UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    idempotency_key       VARCHAR(255) NOT NULL,
    provider              VARCHAR(50) NOT NULL,
    provider_payment_id   VARCHAR(255),
    amount                DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
    currency              VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    status                VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'requires_action')),
    payment_type          VARCHAR(50) NOT NULL
                          CHECK (payment_type IN ('one_time', 'recurring')),
    metadata              JSONB NOT NULL DEFAULT '{}',
    description           TEXT,
    customer_id           VARCHAR(255),
    customer_email        VARCHAR(255) NOT NULL,
    customer_name         VARCHAR(255) NOT NULL,
    processed_at          TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payments_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_payments_tenant ON payments (tenant_id);
CREATE INDEX idx_payments_idempotency ON payments (idempotency_key);
CREATE INDEX idx_payments_provider_id ON payments (provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_customer_email ON payments (customer_email);
CREATE INDEX idx_payments_customer_id ON payments (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_payments_created ON payments (created_at DESC);
CREATE INDEX idx_payments_metadata ON payments USING GIN (metadata);

-- Row-Level Security
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payments ON payments
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_payments_insert ON payments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

**Status state machine:**

| From | To |
|------|----|
| `pending` | `processing`, `requires_action`, `canceled`, `failed` |
| `requires_action` | `processing`, `canceled`, `failed` |
| `processing` | `succeeded`, `failed` |

---

### 3.2 `payment_methods`

Tokenised payment methods. Stores metadata only — full card/account details are stored by the provider.

```sql
-- V002__create_payment_methods.sql
CREATE TABLE payment_methods (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    customer_id           VARCHAR(255) NOT NULL,
    provider              VARCHAR(50) NOT NULL,
    provider_method_id    VARCHAR(255) NOT NULL,
    method_type           VARCHAR(50) NOT NULL
                          CHECK (method_type IN ('card', 'bank_account', 'digital_wallet')),
    card_details          JSONB,
    bank_details          JSONB,
    is_default            BOOLEAN NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at            TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_tenant ON payment_methods (tenant_id);
CREATE INDEX idx_payment_methods_customer ON payment_methods (customer_id);
CREATE INDEX idx_payment_methods_provider_id ON payment_methods (provider_method_id);
CREATE INDEX idx_payment_methods_is_active ON payment_methods (is_active) WHERE is_active = TRUE;

-- Row-Level Security
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payment_methods ON payment_methods
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_payment_methods_insert ON payment_methods
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

**`card_details` JSONB structure:**
```json
{
  "brand": "visa",
  "last4": "4242",
  "exp_month": 12,
  "exp_year": 2028,
  "fingerprint": "fp_abc123"
}
```

**`bank_details` JSONB structure:**
```json
{
  "bank_name": "FNB",
  "account_type": "cheque",
  "last4": "7890",
  "branch_code": "250655"
}
```

---

### 3.4 `refunds`

Refund records linked to their parent payment. Total refunded amount is enforced in the service layer.

```sql
-- V004__create_refunds.sql
CREATE TABLE refunds (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id            UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    idempotency_key       VARCHAR(255) NOT NULL,
    provider_refund_id    VARCHAR(255),
    amount                DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
    currency              VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    status                VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
    reason                TEXT,
    metadata              JSONB NOT NULL DEFAULT '{}',
    processed_at          TIMESTAMP WITH TIME ZONE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_refunds_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX idx_refunds_payment ON refunds (payment_id);
CREATE INDEX idx_refunds_tenant ON refunds (tenant_id);
CREATE INDEX idx_refunds_idempotency ON refunds (idempotency_key);
CREATE INDEX idx_refunds_provider_id ON refunds (provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE INDEX idx_refunds_status ON refunds (status);
CREATE INDEX idx_refunds_payment_status ON refunds (payment_id, status);

-- Row-Level Security
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_refunds ON refunds
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_refunds_insert ON refunds
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

**Refund constraint (service-layer):**
```sql
-- Checked before creating a refund:
SELECT COALESCE(SUM(amount), 0) AS total_refunded
FROM refunds
WHERE payment_id = :paymentId AND status = 'succeeded';

-- Invariant: total_refunded + new_refund_amount <= payment.amount
```

---

### 3.5 `payment_events`

Immutable event log for all payment-related state changes. Used for auditing, debugging, and event replay.

```sql
-- V005__create_payment_events.sql
CREATE TABLE payment_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payment_id            UUID REFERENCES payments(id) ON DELETE RESTRICT,
    refund_id             UUID REFERENCES refunds(id) ON DELETE RESTRICT,
    payment_method_id     UUID REFERENCES payment_methods(id) ON DELETE SET NULL,
    event_type            VARCHAR(100) NOT NULL,
    status                VARCHAR(50),
    payload               JSONB NOT NULL,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_events_tenant ON payment_events (tenant_id);
CREATE INDEX idx_payment_events_payment ON payment_events (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_payment_events_refund ON payment_events (refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX idx_payment_events_type ON payment_events (event_type);
CREATE INDEX idx_payment_events_created ON payment_events (created_at DESC);

-- Row-Level Security
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payment_events ON payment_events
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_payment_events_insert ON payment_events
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON TABLE payment_events IS 'Immutable event log — rows are never updated or deleted (except by retention policy)';
```

**Event types:**
`payment.created`, `payment.processing`, `payment.succeeded`, `payment.failed`, `payment.canceled`, `payment.requires_action`, `refund.created`, `refund.processing`, `refund.succeeded`, `refund.failed`, `payment_method.attached`, `payment_method.detached`, `payment_method.updated`, `payment_method.expired`

---

### 3.6 `webhook_configs`

Outgoing webhook endpoint configurations per tenant. Tenants register URLs and select which event types they want to receive.

```sql
-- V006__create_webhook_configs.sql
CREATE TABLE webhook_configs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url                   VARCHAR(500) NOT NULL,
    secret                VARCHAR(255) NOT NULL,
    events                JSONB NOT NULL DEFAULT '[]',
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_configs_tenant ON webhook_configs (tenant_id);
CREATE INDEX idx_webhook_configs_is_active ON webhook_configs (is_active) WHERE is_active = TRUE;

-- Row-Level Security
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhook_configs ON webhook_configs
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_webhook_configs_insert ON webhook_configs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON COLUMN webhook_configs.url IS 'HTTPS endpoint URL to receive webhook POST requests';
COMMENT ON COLUMN webhook_configs.secret IS 'HMAC-SHA256 shared secret for signing payloads (encrypted at rest)';
COMMENT ON COLUMN webhook_configs.events IS 'JSON array of subscribed event types, e.g. ["payment.succeeded", "refund.succeeded"]';
```

---

### 3.7 `webhook_logs`

Immutable record of every outgoing webhook event generated. One row per event, regardless of how many endpoints it's delivered to.

```sql
-- V007__create_webhook_logs.sql
CREATE TABLE webhook_logs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payment_id            UUID REFERENCES payments(id) ON DELETE RESTRICT,
    refund_id             UUID REFERENCES refunds(id) ON DELETE RESTRICT,
    event_type            VARCHAR(100) NOT NULL,
    status                VARCHAR(50) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted')),
    payload               JSONB NOT NULL,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_tenant ON webhook_logs (tenant_id);
CREATE INDEX idx_webhook_logs_payment ON webhook_logs (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_webhook_logs_refund ON webhook_logs (refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX idx_webhook_logs_event_type ON webhook_logs (event_type);
CREATE INDEX idx_webhook_logs_created ON webhook_logs (created_at DESC);

-- Row-Level Security
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhook_logs ON webhook_logs
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_webhook_logs_insert ON webhook_logs
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON TABLE webhook_logs IS 'Immutable log of all outgoing webhook events — used for audit and replay';
COMMENT ON COLUMN webhook_logs.status IS 'Delivery status: pending (not yet attempted), delivered (2xx received), failed (retrying), exhausted (retries exceeded)';
```

---

### 3.8 `webhook_deliveries`

Per-attempt delivery tracking. Each delivery attempt to each registered endpoint creates a new row.

```sql
-- V007b__create_webhook_deliveries.sql
CREATE TABLE webhook_deliveries (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_log_id        UUID NOT NULL REFERENCES webhook_logs(id) ON DELETE CASCADE,
    url                   VARCHAR(500) NOT NULL,
    attempt_number        INTEGER NOT NULL DEFAULT 1,
    response_status       INTEGER,
    response_body         TEXT,
    error_message         TEXT,
    attempted_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    next_retry_at         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_webhook_deliveries_log ON webhook_deliveries (webhook_log_id);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries (next_retry_at)
    WHERE next_retry_at IS NOT NULL;

COMMENT ON COLUMN webhook_deliveries.response_status IS 'HTTP status code from client endpoint (null if network error)';
COMMENT ON COLUMN webhook_deliveries.next_retry_at IS 'Scheduled next retry time (null if succeeded or retries exhausted)';
```

---

### 3.9 `idempotency_keys`

Caches responses for idempotent operations. Keys expire after 24 hours.

```sql
-- V008__create_idempotency_keys.sql
CREATE TABLE idempotency_keys (
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key                   VARCHAR(255) NOT NULL,
    request_path          VARCHAR(255) NOT NULL,
    request_hash          VARCHAR(64) NOT NULL,
    response_status       INTEGER,
    response_body         JSONB,
    expires_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
CREATE INDEX idx_idempotency_tenant ON idempotency_keys (tenant_id);

-- Row-Level Security
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_idempotency ON idempotency_keys
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_idempotency_insert ON idempotency_keys
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

COMMENT ON COLUMN idempotency_keys.request_hash IS 'SHA-256 hash of request body — used to detect conflicting reuse of keys';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'Keys expire after 24 hours and can be safely cleaned up';
```

**Cleanup job (scheduled):**
```sql
DELETE FROM idempotency_keys WHERE expires_at < NOW();
```

---

## 4. Row-Level Security Summary

| Table | RLS Enabled | Policy |
|-------|-------------|--------|
| `tenants` | No | Admin-only table; no tenant scoping |
| `payments` | Yes | `tenant_id = current_setting('app.current_tenant_id')::uuid` |
| `payment_methods` | Yes | Same |
| `refunds` | Yes | Same |
| `payment_events` | Yes | Same |
| `webhook_configs` | Yes | Same |
| `webhook_logs` | Yes | Same |
| `webhook_deliveries` | No | Accessed via `webhook_log_id` FK; log is already RLS-protected |
| `idempotency_keys` | Yes | Same |

**Application setup (per request):**
```sql
SET LOCAL app.current_tenant_id = '<tenant_uuid>';
```

This is executed by `ApiKeyAuthenticationFilter` after resolving the tenant from the API key. The `SET LOCAL` scoping ensures the setting is automatically cleared at transaction end.

---

## 5. Flyway Migration Order

| Version | File | Description |
|---------|------|-------------|
| V001 | `V001__create_tenants.sql` | Tenants table |
| V002 | `V002__create_payment_methods.sql` | Payment methods table + RLS |
| V003 | `V003__create_payments.sql` | Payments table + RLS |
| V004 | `V004__create_refunds.sql` | Refunds table + RLS |
| V005 | `V005__create_payment_events.sql` | Payment events table + RLS |
| V006 | `V006__create_webhook_configs.sql` | Webhook configs table + RLS |
| V007 | `V007__create_webhook_logs.sql` | Webhook logs table + RLS |
| V007b | `V007b__create_webhook_deliveries.sql` | Webhook deliveries table |
| V008 | `V008__create_idempotency_keys.sql` | Idempotency keys table + RLS |

---

## 6. JSONB Column Schemas

### `tenants.processor_config`

```json
{
  "<provider_id>": {
    "<credential_key>": "<encrypted_value>",
    ...
  }
}
```

Example:
```json
{
  "peach_payments": {
    "entity_id": "enc:AES256:...",
    "access_token": "enc:AES256:...",
    "webhook_secret": "enc:AES256:..."
  },
  "ozow": {
    "site_code": "enc:AES256:...",
    "private_key": "enc:AES256:...",
    "api_key": "enc:AES256:..."
  }
}
```

### `payments.metadata`

Arbitrary key-value pairs provided by the calling application:
```json
{
  "order_id": "ORD-12345",
  "product_line": "etalente",
  "customer_tier": "premium"
}
```

### `payment_events.payload`

Full snapshot of the entity at the time of the event:
```json
{
  "payment_id": "pay_...",
  "amount": 15000,
  "currency": "ZAR",
  "status": "succeeded",
  "provider": "peach_payments",
  "provider_payment_id": "pp_...",
  "customer_email": "user@example.co.za",
  "processed_at": "2026-03-25T10:30:00Z"
}
```

### `webhook_configs.events`

Array of event types this endpoint is subscribed to:
```json
["payment.succeeded", "payment.failed", "refund.succeeded"]
```

---

## 7. Data Retention

| Table | Retention | Rationale |
|-------|-----------|-----------|
| `tenants` | Indefinite | Active configuration |
| `payments` | 7 years | Financial records (SA tax law) |
| `payment_methods` | Until deactivated + 90 days | PCI compliance — minimise stored data |
| `refunds` | 7 years | Financial records |
| `payment_events` | 2 years | Audit trail |
| `webhook_configs` | Until deleted | Active configuration |
| `webhook_logs` | 90 days | Debugging and replay |
| `webhook_deliveries` | 90 days | Debugging |
| `idempotency_keys` | 24 hours (auto-expire) | Short-lived cache |

**Automated cleanup:**
```sql
-- Run daily via Quartz scheduled job
DELETE FROM idempotency_keys WHERE expires_at < NOW();
DELETE FROM webhook_deliveries WHERE attempted_at < NOW() - INTERVAL '90 days';
DELETE FROM webhook_logs WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM payment_events WHERE created_at < NOW() - INTERVAL '2 years';
```

---

## 8. Index Strategy

### Query Patterns and Supporting Indexes

| Query Pattern | Table | Index |
|--------------|-------|-------|
| Authenticate by API key | `tenants` | `idx_tenants_api_key (api_key)` |
| List payments by tenant | `payments` | `idx_payments_tenant (tenant_id)` |
| Find payment by idempotency key | `payments` | `idx_payments_idempotency (idempotency_key)` |
| Find payment by provider ID | `payments` | `idx_payments_provider_id` (partial, WHERE NOT NULL) |
| Filter payments by status | `payments` | `idx_payments_status (status)` |
| Search payments by customer | `payments` | `idx_payments_customer_email (customer_email)` |
| Find payments by customer ID | `payments` | `idx_payments_customer_id` (partial, WHERE NOT NULL) |
| Recent payments | `payments` | `idx_payments_created (created_at DESC)` |
| Filter payments by metadata | `payments` | `idx_payments_metadata` (GIN) |
| List methods by customer | `payment_methods` | `idx_payment_methods_customer (customer_id)` |
| Active methods only | `payment_methods` | `idx_payment_methods_is_active` (partial) |
| Refunds for a payment | `refunds` | `idx_refunds_payment (payment_id)` |
| Refunds by payment + status | `refunds` | `idx_refunds_payment_status (payment_id, status)` |
| Events for a payment | `payment_events` | `idx_payment_events_payment` (partial) |
| Pending webhook retries | `webhook_deliveries` | `idx_webhook_deliveries_retry` (partial, WHERE next_retry_at NOT NULL) |
| Expired idempotency keys | `idempotency_keys` | `idx_idempotency_expires (expires_at)` |

---

## 9. Amount Handling

All monetary values use `DECIMAL(19,4)` in the database and `BigDecimal` in Java.

**Rules:**
1. Never use `double` or `float` for money
2. Internal storage: full precision (4 decimal places)
3. Provider conversion: some providers use smallest currency unit (e.g., cents). Conversion happens in the provider adapter layer:
   - **Peach Payments:** Expects amount in major units with 2 decimal places (e.g., `150.00` for R150)
   - **Ozow:** Expects amount in major units with 2 decimal places
4. Rounding: `RoundingMode.HALF_UP` for display, `RoundingMode.UNNECESSARY` for exact calculations
5. ZAR amounts are always stored in major units (Rands), not cents

**Formal property:**
```
∀ amount ∈ payments ∪ refunds:
    amount instanceof BigDecimal ∧ amount.scale() >= 2 ∧ amount > 0
```
