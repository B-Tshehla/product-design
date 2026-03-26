# Billing Service — Database Schema Design

## 1. Overview

The Billing Service uses a dedicated PostgreSQL 16+ database (`billing_service_db`) with **13 tables**. All tenant-scoped tables enforce Row-Level Security (RLS) policies.

### Schema Summary

| Table | Purpose | RLS |
|-------|---------|-----|
| `service_tenants` | Client project registration and configuration | No (admin-only) |
| `api_keys` | API key lifecycle management | Yes |
| `subscription_plans` | Plan definitions (CRUD, versioning via archiving) | Yes |
| `subscriptions` | Active subscription records | Yes |
| `invoices` | Invoice records (generated, paid, voided) | Yes |
| `invoice_line_items` | Individual line items on invoices (SA tax compliance) | Yes |
| `coupons` | Coupon/discount definitions | Yes |
| `coupon_plan_assignments` | Join table: coupon ↔ plan associations | Yes |
| `webhook_configs` | Outgoing webhook endpoint configuration | Yes |
| `webhook_deliveries` | Per-attempt webhook delivery tracking | No (FK to webhook_configs) |
| `billing_usage` | Aggregate usage metrics per tenant per period | Yes |
| `audit_logs` | Immutable audit trail | Yes |
| `idempotency_keys` | Idempotency key cache | Yes |

### Conventions

- All primary keys are `UUID` using `gen_random_uuid()`
- All timestamps are `TIMESTAMP WITH TIME ZONE` defaulting to `NOW()`
- Monetary amounts use `INTEGER` in smallest currency unit (cents) with descriptive column names (`*_cents`)
- Currency codes are `VARCHAR(3)` (ISO 4217), defaulting to `'ZAR'`
- Status columns are `VARCHAR(50)` with `CHECK` constraints
- Soft deletes use status = `archived` / `deleted` (not boolean flags)
- FK relationships on operational/config tables use `ON DELETE CASCADE`
- FK relationships on financial/audit tables use `ON DELETE RESTRICT` (7-year retention requirement)

---

## 2. Entity Relationship Diagram

```mermaid
erDiagram
    service_tenants ||--o{ api_keys : "has"
    service_tenants ||--o{ subscription_plans : "has"
    service_tenants ||--o{ subscriptions : "has"
    service_tenants ||--o{ invoices : "has"
    service_tenants ||--o{ coupons : "has"
    service_tenants ||--o{ webhook_configs : "has"
    service_tenants ||--o{ billing_usage : "has"
    service_tenants ||--o{ audit_logs : "has"
    service_tenants ||--o{ idempotency_keys : "has"

    subscription_plans ||--o{ subscriptions : "used by"
    subscriptions ||--o{ invoices : "generates"
    coupons ||--o{ subscriptions : "applied to"
    coupons ||--o{ coupon_plan_assignments : "scoped to"
    subscription_plans ||--o{ coupon_plan_assignments : "scoped by"
    invoices ||--o{ invoice_line_items : "has"
    webhook_configs ||--o{ webhook_deliveries : "has"

    service_tenants {
        uuid id PK
        varchar project_name
        varchar contact_email
        varchar payment_service_tenant_id
        varchar status
        integer rate_limit_per_minute
        jsonb settings
        timestamp created_at
        timestamp updated_at
    }

    api_keys {
        uuid id PK
        uuid service_tenant_id FK
        varchar key_hash
        varchar key_prefix
        varchar name
        varchar status
        timestamp expires_at
        timestamp last_used_at
        timestamp created_at
        timestamp revoked_at
    }

    subscription_plans {
        uuid id PK
        uuid service_tenant_id FK
        varchar name
        text description
        varchar billing_cycle
        integer price_cents
        varchar currency
        jsonb features
        jsonb limits
        integer trial_days
        varchar status
        integer sort_order
        timestamp created_at
        timestamp updated_at
    }

    subscriptions {
        uuid id PK
        uuid service_tenant_id FK
        varchar external_customer_id
        varchar external_customer_email
        uuid plan_id FK
        uuid coupon_id FK
        varchar payment_service_customer_id
        varchar status
        timestamp current_period_start
        timestamp current_period_end
        boolean cancel_at_period_end
        timestamp canceled_at
        varchar cancellation_reason
        text cancellation_feedback
        timestamp ended_at
        timestamp trial_start
        timestamp trial_end
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }

    invoices {
        uuid id PK
        uuid service_tenant_id FK
        uuid subscription_id FK
        varchar invoice_number
        integer subtotal_cents
        integer discount_cents
        decimal tax_rate
        integer tax_amount_cents
        integer amount_cents
        integer amount_due_cents
        integer amount_paid_cents
        varchar currency
        varchar status
        varchar payment_service_payment_id
        integer retry_count
        text invoice_pdf_url
        text hosted_invoice_url
        timestamp period_start
        timestamp period_end
        timestamp due_date
        timestamp paid_at
        timestamp voided_at
        timestamp created_at
        timestamp updated_at
    }

    coupons {
        uuid id PK
        uuid service_tenant_id FK
        varchar code
        varchar name
        varchar discount_type
        integer discount_value
        varchar currency
        varchar duration
        integer duration_months
        integer max_redemptions
        integer redemption_count
        timestamp valid_from
        timestamp valid_until
        varchar status
        timestamp created_at
    }

    coupon_plan_assignments {
        uuid id PK
        uuid service_tenant_id FK
        uuid coupon_id FK
        uuid plan_id FK
        timestamp created_at
    }

    invoice_line_items {
        uuid id PK
        uuid service_tenant_id FK
        uuid invoice_id FK
        varchar description
        integer quantity
        integer unit_amount_cents
        integer amount_cents
        decimal tax_rate
        integer tax_amount_cents
        timestamp period_start
        timestamp period_end
        boolean proration
        jsonb metadata
        timestamp created_at
    }

    webhook_configs {
        uuid id PK
        uuid service_tenant_id FK
        varchar url
        jsonb events
        varchar secret_hash
        varchar status
        integer failure_count
        timestamp last_success_at
        timestamp last_failure_at
        text last_failure_reason
        timestamp created_at
        timestamp updated_at
    }

    webhook_deliveries {
        uuid id PK
        uuid webhook_config_id FK
        varchar event_type
        jsonb payload
        integer response_status
        text response_body
        integer attempt_count
        varchar status
        timestamp next_retry_at
        timestamp delivered_at
        timestamp created_at
    }

    billing_usage {
        uuid id PK
        uuid service_tenant_id FK
        date period_start
        date period_end
        integer subscriptions_created
        integer subscriptions_canceled
        integer payments_processed
        integer payments_failed
        bigint total_payment_volume_cents
        integer invoices_generated
        integer webhook_calls
        integer api_calls
    }

    audit_logs {
        uuid id PK
        uuid service_tenant_id FK
        varchar actor_type
        varchar actor_id
        varchar action
        varchar resource_type
        uuid resource_id
        jsonb before_state
        jsonb after_state
        inet ip_address
        text user_agent
        varchar correlation_id
        timestamp created_at
    }

    idempotency_keys {
        uuid service_tenant_id PK_FK
        varchar key PK
        varchar request_path
        varchar request_hash
        integer response_status
        jsonb response_body
        timestamp created_at
        timestamp expires_at
    }
```

---

## 3. Table Definitions (DDL)

### 3.1 `service_tenants`

Registered client projects. Each tenant maps to a corresponding tenant in the Payment Service via `payment_service_tenant_id`.

```sql
-- V001__create_service_tenants.sql
CREATE TABLE service_tenants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name                VARCHAR(255) NOT NULL,
    contact_email               VARCHAR(255) NOT NULL,
    payment_service_tenant_id   VARCHAR(255),
    status                      VARCHAR(50) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'active', 'suspended', 'deleted')),
    rate_limit_per_minute       INTEGER NOT NULL DEFAULT 500,
    settings                    JSONB NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_tenants_status ON service_tenants (status);
CREATE INDEX idx_service_tenants_payment_tenant ON service_tenants (payment_service_tenant_id)
    WHERE payment_service_tenant_id IS NOT NULL;

COMMENT ON TABLE service_tenants IS 'Client projects registered with the Billing Service';
COMMENT ON COLUMN service_tenants.payment_service_tenant_id IS 'Corresponding tenant UUID in the Payment Service';
COMMENT ON COLUMN service_tenants.settings IS 'Per-tenant config: webhook retry policy, invoice settings, currency, timezone';
```

**`settings` JSONB structure:**
```json
{
  "defaultCurrency": "ZAR",
  "timezone": "Africa/Johannesburg",
  "webhookRetryPolicy": {
    "maxRetries": 6,
    "backoffMultiplier": 2
  },
  "invoiceSettings": {
    "daysUntilDue": 7,
    "footer": "Thank you for your business"
  },
  "featureFlags": {
    "usageBasedBilling": true,
    "autoRetryFailedPayments": true
  }
}
```

---

### 3.2 `api_keys`

API keys for tenant authentication. Supports multiple keys per tenant with rotation and revocation.

```sql
-- V002__create_api_keys.sql
CREATE TABLE api_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    key_hash            VARCHAR(255) NOT NULL,
    key_prefix          VARCHAR(10) NOT NULL,
    name                VARCHAR(255),
    status              VARCHAR(50) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'revoked', 'expired')),
    expires_at          TIMESTAMP WITH TIME ZONE,
    last_used_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_api_keys_tenant ON api_keys (service_tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX idx_api_keys_status ON api_keys (status);

-- Row-Level Security
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_keys ON api_keys
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN api_keys.key_hash IS 'BCrypt hash (cost 12+) of the full API key';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 8-10 chars of key for identification in logs (e.g., bk_abc123)';
COMMENT ON COLUMN api_keys.expires_at IS 'Set during rotation — old key expires 24h after new key is generated';
```

---

### 3.3 `subscription_plans`

Plan definitions. Price and billing cycle are immutable after creation; to change pricing, archive the old plan and create a new one.

```sql
-- V003__create_subscription_plans.sql
CREATE TABLE subscription_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    billing_cycle       VARCHAR(50) NOT NULL DEFAULT 'monthly'
                        CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
    price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    features            JSONB NOT NULL DEFAULT '{}',
    limits              JSONB NOT NULL DEFAULT '{}',
    trial_days          INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(50) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'archived')),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_plans_tenant_name UNIQUE (service_tenant_id, name)
);

CREATE INDEX idx_plans_tenant ON subscription_plans (service_tenant_id);
CREATE INDEX idx_plans_status ON subscription_plans (status);

-- Row-Level Security
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_plans ON subscription_plans
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_plans_insert ON subscription_plans
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN subscription_plans.price_cents IS 'Price in smallest currency unit (e.g., cents). Immutable after creation.';
COMMENT ON COLUMN subscription_plans.features IS 'Plan features: {"max_users": 10, "storage_gb": 50}';
COMMENT ON COLUMN subscription_plans.limits IS 'Plan limits: {"api_calls_per_day": 1000}';
```

**`features` JSONB example:**
```json
{
  "max_users": 10,
  "storage_gb": 50,
  "priority_support": true,
  "custom_branding": false
}
```

**`limits` JSONB example:**
```json
{
  "api_calls_per_day": 1000,
  "assessments_per_month": 500,
  "cv_analyses_per_month": 100
}
```

---

### 3.4 `subscriptions`

Active subscription records. One active subscription per customer per tenant.

```sql
-- V004__create_subscriptions.sql
CREATE TABLE subscriptions (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id               UUID NOT NULL REFERENCES service_tenants(id) ON DELETE RESTRICT,
    external_customer_id            VARCHAR(255) NOT NULL,
    external_customer_email         VARCHAR(255),
    plan_id                         UUID NOT NULL REFERENCES subscription_plans(id),
    coupon_id                       UUID REFERENCES coupons(id),
    payment_service_customer_id     VARCHAR(255),
    status                          VARCHAR(50) NOT NULL DEFAULT 'incomplete'
                                    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled',
                                                      'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
    current_period_start            TIMESTAMP WITH TIME ZONE,
    current_period_end              TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end            BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at                     TIMESTAMP WITH TIME ZONE,
    cancellation_reason             VARCHAR(255),
    cancellation_feedback           TEXT,
    ended_at                        TIMESTAMP WITH TIME ZONE,
    trial_start                     TIMESTAMP WITH TIME ZONE,
    trial_end                       TIMESTAMP WITH TIME ZONE,
    metadata                        JSONB NOT NULL DEFAULT '{}',
    created_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Partial unique index: only one non-terminal subscription per customer per tenant
-- Allows re-subscription after cancellation/expiry (#6)
CREATE UNIQUE INDEX uq_subscriptions_active_customer
    ON subscriptions (service_tenant_id, external_customer_id)
    WHERE status NOT IN ('canceled', 'incomplete_expired');

CREATE INDEX idx_subscriptions_tenant ON subscriptions (service_tenant_id);
CREATE INDEX idx_subscriptions_customer ON subscriptions (external_customer_id);
CREATE INDEX idx_subscriptions_payment_customer ON subscriptions (payment_service_customer_id)
    WHERE payment_service_customer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_status ON subscriptions (status);
CREATE INDEX idx_subscriptions_period_end ON subscriptions (current_period_end);
CREATE INDEX idx_subscriptions_trial_end ON subscriptions (trial_end)
    WHERE trial_end IS NOT NULL AND status = 'trialing';

-- Row-Level Security
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_subscriptions ON subscriptions
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_subscriptions_insert ON subscriptions
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN subscriptions.external_customer_id IS 'Customer ID from the client project (e.g., eTalente user ID)';
COMMENT ON COLUMN subscriptions.payment_service_customer_id IS 'Customer ID in the Payment Service';
```

**Status state machine:**

| From | To |
|------|----|
| `trialing` | `active`, `incomplete`, `canceled` |
| `incomplete` | `active`, `incomplete_expired` |
| `active` | `past_due`, `canceled`, `paused` |
| `past_due` | `active`, `canceled`, `unpaid` |
| `paused` | `active` |
| `unpaid` | `active`, `canceled` |
| `canceled` | `active` (reactivation before period end) |

---

### 3.5 `invoices`

Invoice records. Linked to subscriptions and optionally to a Payment Service payment.

```sql
-- V005__create_invoices.sql
CREATE TABLE invoices (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id               UUID NOT NULL REFERENCES service_tenants(id) ON DELETE RESTRICT,
    subscription_id                 UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    invoice_number                  VARCHAR(100),
    subtotal_cents                  INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    discount_cents                  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    tax_rate                        DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
    tax_amount_cents                INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
    amount_cents                    INTEGER NOT NULL CHECK (amount_cents >= 0),
    amount_due_cents                INTEGER NOT NULL CHECK (amount_due_cents >= 0),
    amount_paid_cents               INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
    currency                        VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    status                          VARCHAR(50) NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
    payment_service_payment_id      VARCHAR(255),
    retry_count                     INTEGER NOT NULL DEFAULT 0,
    invoice_pdf_url                 TEXT,
    hosted_invoice_url              TEXT,
    period_start                    TIMESTAMP WITH TIME ZONE,
    period_end                      TIMESTAMP WITH TIME ZONE,
    due_date                        TIMESTAMP WITH TIME ZONE,
    paid_at                         TIMESTAMP WITH TIME ZONE,
    voided_at                       TIMESTAMP WITH TIME ZONE,
    created_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant ON invoices (service_tenant_id);
CREATE INDEX idx_invoices_subscription ON invoices (subscription_id);
CREATE INDEX idx_invoices_payment ON invoices (payment_service_payment_id)
    WHERE payment_service_payment_id IS NOT NULL;
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_due_date ON invoices (due_date);

-- Row-Level Security
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_invoices ON invoices
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_invoices_insert ON invoices
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN invoices.subtotal_cents IS 'Pre-discount, pre-tax amount in smallest currency unit';
COMMENT ON COLUMN invoices.discount_cents IS 'Coupon/discount amount applied to this invoice';
COMMENT ON COLUMN invoices.tax_rate IS 'Tax rate applied (0.15 = 15% SA VAT)';
COMMENT ON COLUMN invoices.tax_amount_cents IS 'Calculated tax: (subtotal_cents - discount_cents) * tax_rate';
COMMENT ON COLUMN invoices.amount_cents IS 'Total invoice amount: subtotal_cents - discount_cents + tax_amount_cents';
COMMENT ON COLUMN invoices.amount_due_cents IS 'Remaining amount owed (amount_cents - amount_paid_cents)';
COMMENT ON COLUMN invoices.retry_count IS 'Number of payment collection attempts (used by dunning flow)';
COMMENT ON COLUMN invoices.invoice_pdf_url IS 'URL to downloadable PDF version of the invoice';
COMMENT ON COLUMN invoices.hosted_invoice_url IS 'URL to hosted payment page where customer can pay';
COMMENT ON COLUMN invoices.invoice_number IS 'Sequential invoice number per tenant (SARS requirement for tax invoices)';
```

> **SA Tax Compliance Note:** South African tax invoices (SARS) must show VAT separately. The `subtotal_cents`, `tax_rate`, `tax_amount_cents`, and `amount_cents` columns support this. Invoice numbers must be sequential per tenant as required by SARS. The `invoice_line_items` table provides the required line-item detail.

**Status lifecycle:**
- `draft` → `open` → `paid` | `void` | `uncollectible`

---

### 3.6 `invoice_line_items`

Individual line items on invoices. Required for SA tax invoice compliance (SARS) — each item must show description, quantity, unit price, and VAT.

```sql
-- V005b__create_invoice_line_items.sql
CREATE TABLE invoice_line_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID NOT NULL REFERENCES service_tenants(id) ON DELETE RESTRICT,
    invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    description         VARCHAR(500) NOT NULL,
    quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_amount_cents   INTEGER NOT NULL CHECK (unit_amount_cents >= 0),
    amount_cents        INTEGER NOT NULL CHECK (amount_cents >= 0),
    tax_rate            DECIMAL(5, 4) NOT NULL DEFAULT 0.15,
    tax_amount_cents    INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
    period_start        TIMESTAMP WITH TIME ZONE,
    period_end          TIMESTAMP WITH TIME ZONE,
    proration           BOOLEAN NOT NULL DEFAULT FALSE,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items (invoice_id);
CREATE INDEX idx_invoice_line_items_tenant ON invoice_line_items (service_tenant_id);

-- Row-Level Security
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_invoice_line_items ON invoice_line_items
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_invoice_line_items_insert ON invoice_line_items
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON TABLE invoice_line_items IS 'Line items on invoices — required for SARS tax invoice compliance';
COMMENT ON COLUMN invoice_line_items.amount_cents IS 'quantity * unit_amount_cents';
COMMENT ON COLUMN invoice_line_items.proration IS 'TRUE if this line item is a proration credit/charge from a plan change';
```

---

### 3.7 `coupons`

Discount coupon definitions. Supports percent and fixed-amount discounts with duration and scoping.

```sql
-- V006__create_coupons.sql
CREATE TABLE coupons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    code                VARCHAR(50) NOT NULL,
    name                VARCHAR(255),
    discount_type       VARCHAR(50) NOT NULL
                        CHECK (discount_type IN ('percent', 'fixed')),
    discount_value      INTEGER NOT NULL CHECK (discount_value > 0),
    currency            VARCHAR(3) DEFAULT 'ZAR',
    duration            VARCHAR(50) NOT NULL DEFAULT 'once'
                        CHECK (duration IN ('once', 'repeating', 'forever')),
    duration_months     INTEGER,
    max_redemptions     INTEGER,
    redemption_count    INTEGER NOT NULL DEFAULT 0,
    valid_from          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    valid_until         TIMESTAMP WITH TIME ZONE,
    status              VARCHAR(50) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'expired', 'archived')),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_coupons_tenant_code UNIQUE (service_tenant_id, code),
    CONSTRAINT chk_duration_months CHECK (
        (duration = 'repeating' AND duration_months IS NOT NULL AND duration_months > 0)
        OR (duration != 'repeating')
    ),
    CONSTRAINT chk_percent_range CHECK (
        (discount_type = 'percent' AND discount_value BETWEEN 1 AND 100)
        OR (discount_type != 'percent')
    )
);

CREATE INDEX idx_coupons_tenant ON coupons (service_tenant_id);
CREATE INDEX idx_coupons_code ON coupons (code);
CREATE INDEX idx_coupons_status ON coupons (status);

-- Row-Level Security
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_coupons ON coupons
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_coupons_insert ON coupons
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN coupons.discount_value IS 'Percent (1-100) for percent type, or amount in cents for fixed type';
COMMENT ON COLUMN coupons.duration IS 'once = first invoice only, repeating = N months, forever = all invoices';
```

> **Note:** Plan-scoping for coupons is managed via the `coupon_plan_assignments` join table (see 3.8) rather than a UUID[] array, ensuring referential integrity.

---

### 3.8 `coupon_plan_assignments`

Join table linking coupons to the plans they apply to. If a coupon has no rows here, it applies to all plans.

```sql
-- V006b__create_coupon_plan_assignments.sql
CREATE TABLE coupon_plan_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    coupon_id           UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    plan_id             UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_coupon_plan UNIQUE (coupon_id, plan_id)
);

CREATE INDEX idx_coupon_plans_coupon ON coupon_plan_assignments (coupon_id);
CREATE INDEX idx_coupon_plans_plan ON coupon_plan_assignments (plan_id);

-- Row-Level Security
ALTER TABLE coupon_plan_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_plan_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_coupon_plans ON coupon_plan_assignments
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON TABLE coupon_plan_assignments IS 'Join table: which plans a coupon applies to. No rows = all plans.';
```

---

### 3.9 `webhook_configs`

Outgoing webhook endpoint configurations. Tracks delivery health per endpoint.

```sql
-- V007__create_webhook_configs.sql
CREATE TABLE webhook_configs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id       UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    url                     VARCHAR(500) NOT NULL,
    events                  JSONB NOT NULL DEFAULT '[]',
    secret_hash             VARCHAR(255) NOT NULL,
    status                  VARCHAR(50) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'disabled', 'failing')),
    failure_count           INTEGER NOT NULL DEFAULT 0,
    last_success_at         TIMESTAMP WITH TIME ZONE,
    last_failure_at         TIMESTAMP WITH TIME ZONE,
    last_failure_reason     TEXT,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_configs_tenant ON webhook_configs (service_tenant_id);
CREATE INDEX idx_webhook_configs_status ON webhook_configs (status);

-- Row-Level Security
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhook_configs ON webhook_configs
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

CREATE POLICY tenant_isolation_webhook_configs_insert ON webhook_configs
    FOR INSERT WITH CHECK (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON COLUMN webhook_configs.failure_count IS 'Consecutive failures — resets to 0 on success';
COMMENT ON COLUMN webhook_configs.status IS 'active = delivering, disabled = paused by tenant, failing = auto-disabled after consecutive failures';
```

---

### 3.10 `webhook_deliveries`

Per-attempt webhook delivery tracking.

```sql
-- V007b__create_webhook_deliveries.sql
CREATE TABLE webhook_deliveries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_config_id   UUID NOT NULL REFERENCES webhook_configs(id) ON DELETE CASCADE,
    event_type          VARCHAR(100) NOT NULL,
    payload             JSONB NOT NULL,
    response_status     INTEGER,
    response_body       TEXT,
    attempt_count       INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(50) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'delivered', 'failed', 'retrying')),
    next_retry_at       TIMESTAMP WITH TIME ZONE,
    delivered_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_config ON webhook_deliveries (webhook_config_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries (status);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries (next_retry_at)
    WHERE status = 'retrying';

COMMENT ON COLUMN webhook_deliveries.status IS 'pending = not yet attempted, delivered = success, failed = exhausted retries, retrying = awaiting next attempt';
```

---

### 3.11 `billing_usage`

Aggregate usage metrics per tenant per period. One row per tenant per period.

```sql
-- V008__create_billing_usage.sql
CREATE TABLE billing_usage (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id               UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    period_start                    DATE NOT NULL,
    period_end                      DATE NOT NULL,
    subscriptions_created           INTEGER NOT NULL DEFAULT 0,
    subscriptions_canceled          INTEGER NOT NULL DEFAULT 0,
    payments_processed              INTEGER NOT NULL DEFAULT 0,
    payments_failed                 INTEGER NOT NULL DEFAULT 0,
    total_payment_volume_cents      BIGINT NOT NULL DEFAULT 0,
    invoices_generated              INTEGER NOT NULL DEFAULT 0,
    webhook_calls                   INTEGER NOT NULL DEFAULT 0,
    api_calls                       INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT uq_billing_usage_tenant_period UNIQUE (service_tenant_id, period_start)
);

CREATE INDEX idx_billing_usage_tenant ON billing_usage (service_tenant_id);
CREATE INDEX idx_billing_usage_period ON billing_usage (period_start, period_end);

-- Row-Level Security
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_usage ON billing_usage
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);

COMMENT ON TABLE billing_usage IS 'Aggregate billing metrics per tenant per period — updated incrementally via counter operations';
```

---

### 3.12 `audit_logs`

Immutable audit trail for all significant actions.

```sql
-- V009__create_audit_logs.sql
CREATE TABLE audit_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_tenant_id   UUID REFERENCES service_tenants(id) ON DELETE RESTRICT,
    actor_type          VARCHAR(50) NOT NULL,
    actor_id            VARCHAR(255),
    action              VARCHAR(100) NOT NULL,
    resource_type       VARCHAR(100) NOT NULL,
    resource_id         UUID,
    before_state        JSONB,
    after_state         JSONB,
    ip_address          INET,
    user_agent          TEXT,
    correlation_id      VARCHAR(255),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs (service_tenant_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC);

-- Row-Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_logs ON audit_logs
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid
           OR service_tenant_id IS NULL);

COMMENT ON TABLE audit_logs IS 'Immutable audit log — rows are never updated or deleted (except by retention policy)';
COMMENT ON COLUMN audit_logs.actor_type IS 'user, system, api_key';
COMMENT ON COLUMN audit_logs.before_state IS 'Entity state before the change (null for create actions)';
COMMENT ON COLUMN audit_logs.after_state IS 'Entity state after the change (null for delete actions)';
COMMENT ON COLUMN audit_logs.correlation_id IS 'Distributed tracing ID for cross-service correlation';
```

**Audited actions:**
- `subscription.created`, `subscription.canceled`, `subscription.reactivated`, `subscription.plan_changed`
- `invoice.created`, `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`
- `plan.created`, `plan.updated`, `plan.archived`
- `coupon.created`, `coupon.archived`
- `api_key.created`, `api_key.rotated`, `api_key.revoked`
- `tenant.created`, `tenant.suspended`, `tenant.activated`

---

### 3.13 `idempotency_keys`

Caches responses for idempotent operations. Keys expire after 24 hours.

```sql
-- V010__create_idempotency_keys.sql
CREATE TABLE idempotency_keys (
    service_tenant_id       UUID NOT NULL REFERENCES service_tenants(id) ON DELETE CASCADE,
    key                     VARCHAR(255) NOT NULL,
    request_path            VARCHAR(255) NOT NULL,
    request_hash            VARCHAR(64) NOT NULL,
    response_status         INTEGER,
    response_body           JSONB,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

    PRIMARY KEY (service_tenant_id, key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);

-- Row-Level Security
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_idempotency ON idempotency_keys
    USING (service_tenant_id = current_setting('app.current_service_tenant_id')::uuid);
```

---

## 4. Row-Level Security Summary

| Table | RLS | Policy Variable |
|-------|-----|-----------------|
| `service_tenants` | No | Admin-only |
| `api_keys` | Yes | `app.current_service_tenant_id` |
| `subscription_plans` | Yes | `app.current_service_tenant_id` |
| `subscriptions` | Yes | `app.current_service_tenant_id` |
| `invoices` | Yes | `app.current_service_tenant_id` |
| `invoice_line_items` | Yes | `app.current_service_tenant_id` |
| `coupons` | Yes | `app.current_service_tenant_id` |
| `coupon_plan_assignments` | Yes | `app.current_service_tenant_id` |
| `webhook_configs` | Yes | `app.current_service_tenant_id` |
| `webhook_deliveries` | No | Accessed via webhook_config FK |
| `billing_usage` | Yes | `app.current_service_tenant_id` |
| `audit_logs` | Yes | `app.current_service_tenant_id` (or NULL for system) |
| `idempotency_keys` | Yes | `app.current_service_tenant_id` |

---

## 5. Flyway Migration Order

| Version | File | Description |
|---------|------|-------------|
| V001 | `V001__create_service_tenants.sql` | Service tenants table |
| V002 | `V002__create_api_keys.sql` | API keys table + RLS |
| V003 | `V003__create_subscription_plans.sql` | Subscription plans table + RLS |
| V004 | `V004__create_subscriptions.sql` | Subscriptions table + RLS |
| V005 | `V005__create_invoices.sql` | Invoices table + RLS |
| V005b | `V005b__create_invoice_line_items.sql` | Invoice line items table + RLS |
| V006 | `V006__create_coupons.sql` | Coupons table + RLS |
| V006b | `V006b__create_coupon_plan_assignments.sql` | Coupon-plan join table + RLS |
| V007 | `V007__create_webhook_configs.sql` | Webhook configs table + RLS |
| V007b | `V007b__create_webhook_deliveries.sql` | Webhook deliveries table |
| V008 | `V008__create_billing_usage.sql` | Billing usage table + RLS |
| V009 | `V009__create_audit_logs.sql` | Audit logs table + RLS |
| V010 | `V010__create_idempotency_keys.sql` | Idempotency keys table + RLS |

---

## 6. Data Retention

| Table | Retention | Rationale |
|-------|-----------|-----------|
| `service_tenants` | Indefinite | Active configuration |
| `api_keys` | Until revoked + 90 days | Security audit trail |
| `subscription_plans` | Indefinite (archived, not deleted) | Referenced by historical subscriptions |
| `subscriptions` | 7 years after end | Financial records (SA tax law) |
| `invoices` | 7 years | Financial records |
| `invoice_line_items` | 7 years | Financial records (part of invoice) |
| `coupons` | Indefinite (archived, not deleted) | Referenced by historical subscriptions |
| `coupon_plan_assignments` | Lifetime of coupon | Cascade-deleted with coupon |
| `webhook_configs` | Until deleted | Active configuration |
| `webhook_deliveries` | 90 days | Debugging |
| `billing_usage` | 2 years | Analytics and reporting |
| `audit_logs` | 2 years | Regulatory compliance (POPIA) |
| `idempotency_keys` | 24 hours (auto-expire) | Short-lived cache |

**Automated cleanup:**
```sql
-- Run daily via Quartz scheduled job (CleanupJob)
DELETE FROM idempotency_keys WHERE expires_at < NOW();
DELETE FROM webhook_deliveries WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '2 years';
DELETE FROM billing_usage WHERE period_end < (CURRENT_DATE - INTERVAL '2 years');
```
