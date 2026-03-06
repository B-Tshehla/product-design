# Technical Design Document: Payment Service

## Overview

The Payment Service is a standalone, multi-tenant payment processing platform designed to handle payment operations for multiple client projects. It provides a unified interface for payment processing (one-time and recurring), payment method management, refunds, disputes, and webhook notifications. The service is built with Spring Boot/Java and PostgreSQL, with Stripe as the primary payment processor and an extensible architecture to support additional processors (PayPal, Square, etc.).

The service operates independently from other services and exposes RESTful APIs for client integration. It maintains tenant isolation, ensuring secure multi-tenant operations with proper data segregation. The Billing Service and other client projects will consume this service for all payment-related operations.

Key design principles include: processor abstraction (strategy pattern), idempotent operations, comprehensive audit logging, webhook reliability with retry mechanisms, and horizontal scalability.

### Why Spring Boot/Java?

- **Financial Transaction Integrity**: BigDecimal for exact decimal arithmetic, eliminating floating-point errors
- **Type Safety**: Compile-time type checking prevents runtime type coercion vulnerabilities
- **Transaction Management**: Robust @Transactional support for complex payment operations
- **Security**: Spring Security is battle-tested in financial institutions for 15+ years
- **Long-Term Stability**: Java LTS support (Java 17 until 2029, Java 21 until 2031)
- **Industry Standard**: Used by Stripe, Square, PayPal, Adyen for payment processing
- **PCI DSS Compliance**: Mature audit logging and security frameworks

### Key Design Principles

1. **Multi-Tenant Architecture**: Complete data isolation between client projects using tenant_id on all tables
2. **Processor Abstraction**: Strategy pattern enables support for multiple payment processors
3. **Idempotent Operations**: All payment operations support idempotency keys for safe retries
4. **Event-Driven Webhooks**: Asynchronous notification of payment events to client applications
5. **API-Key Authentication**: Secure client authentication with tenant isolation
6. **Financial Accuracy**: BigDecimal for all monetary calculations

### Interface-Based Architecture

The Payment Service follows interface-based design principles for maximum testability, flexibility, and adherence to SOLID principles.

**Naming Convention:**
- **Interface**: `ServiceName` (e.g., `PaymentService`, `StripeProcessor`)
- **Implementation**: `ServiceNameImpl` (e.g., `PaymentServiceImpl`, `StripeProcessorImpl`)

**Package Structure:**
- **Interfaces**: Located in parent package (e.g., `com.payment.service`)
- **Implementations**: Located in `impl/` subpackage (e.g., `com.payment.service.impl`)


## Architecture

### High-Level System Architecture

```mermaid
graph TB
    subgraph "Client Applications"
        BILLING[Billing Service]
        APP1[Client App 1]
        APP2[Client App 2]
    end
    
    subgraph "Payment Service"
        GW[API Gateway]
        AUTH[Auth Middleware]
        CORE[Core Service]
        WEBHOOK[Webhook Processor]
        SCHEDULER[Job Scheduler]
        PROC_LAYER[Processor Abstraction]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL)]
        REDIS[(Redis Cache)]
    end
    
    subgraph "External Processors"
        STRIPE[Stripe API]
        PAYPAL[PayPal API]
        SQUARE[Square API]
    end
    
    subgraph "Message Queue"
        KAFKA[Kafka / SQS]
        DLQ[Dead Letter Queue]
    end
    
    BILLING --> GW
    APP1 --> GW
    APP2 --> GW
    
    GW --> AUTH
    AUTH --> CORE
    CORE --> PG
    CORE --> REDIS
    CORE --> PROC_LAYER
    CORE --> KAFKA
    
    PROC_LAYER --> STRIPE
    PROC_LAYER --> PAYPAL
    PROC_LAYER --> SQUARE
    
    STRIPE -.->|Webhooks| WEBHOOK
    PAYPAL -.->|Webhooks| WEBHOOK
    WEBHOOK --> CORE
    WEBHOOK --> KAFKA
    
    KAFKA --> SCHEDULER
    SCHEDULER --> BILLING
    SCHEDULER --> APP1
    SCHEDULER --> APP2
    KAFKA --> DLQ
```

### Component Architecture

```mermaid
graph TB
    subgraph "API Layer"
        REST[REST Controllers]
        VALID[Request Validators]
        RATE[Rate Limiter]
    end
    
    subgraph "Service Layer"
        TENANT[Tenant Service]
        PAY[Payment Service]
        PM[Payment Method Service]
        REF[Refund Service]
        WH[Webhook Service]
    end
    
    subgraph "Processor Layer"
        PF[Processor Factory]
        STRIPE_P[Stripe Processor]
        PAYPAL_P[PayPal Processor]
        SQUARE_P[Square Processor]
    end
    
    subgraph "Integration Layer"
        WH_DISP[Webhook Dispatcher]
        EVENT[Event Publisher]
    end
    
    subgraph "Data Access Layer"
        REPO[Repositories]
        CACHE[Cache Manager]
    end
    
    REST --> VALID
    VALID --> RATE
    RATE --> TENANT
    RATE --> PAY
    RATE --> PM
    RATE --> REF
    
    PAY --> PF
    PM --> PF
    REF --> PF
    
    PF --> STRIPE_P
    PF --> PAYPAL_P
    PF --> SQUARE_P
    
    PAY --> EVENT
    REF --> EVENT
    EVENT --> WH_DISP
    
    PAY --> REPO
    PM --> REPO
    REF --> REPO
    WH --> REPO
    
    REPO --> CACHE
```

### Deployment Architecture

```mermaid
graph TB
    subgraph "Availability Zone 1"
        LB1[Load Balancer]
        APP1[App Server 1]
        APP2[App Server 2]
        PG_PRIMARY[(PostgreSQL Primary)]
    end
    
    subgraph "Availability Zone 2"
        LB2[Load Balancer]
        APP3[App Server 3]
        APP4[App Server 4]
        PG_REPLICA[(PostgreSQL Replica)]
    end
    
    subgraph "Shared Infrastructure"
        REDIS_CLUSTER[Redis Cluster]
        KAFKA_CLUSTER[Kafka Cluster]
    end
    
    CDN[CloudFront / ALB] --> LB1
    CDN --> LB2
    
    LB1 --> APP1
    LB1 --> APP2
    LB2 --> APP3
    LB2 --> APP4
    
    APP1 --> PG_PRIMARY
    APP2 --> PG_PRIMARY
    APP3 --> PG_PRIMARY
    APP4 --> PG_PRIMARY
    
    PG_PRIMARY -.->|Streaming Replication| PG_REPLICA
    
    APP1 --> REDIS_CLUSTER
    APP2 --> REDIS_CLUSTER
    APP3 --> REDIS_CLUSTER
    APP4 --> REDIS_CLUSTER
    
    APP1 --> KAFKA_CLUSTER
    APP2 --> KAFKA_CLUSTER
    APP3 --> KAFKA_CLUSTER
    APP4 --> KAFKA_CLUSTER
```


## Project Structure

```
payment-service/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── payment/
│   │   │           ├── PaymentServiceApplication.java
│   │   │           ├── controller/
│   │   │           │   ├── PaymentController.java
│   │   │           │   ├── PaymentMethodController.java
│   │   │           │   ├── RefundController.java
│   │   │           │   ├── TenantController.java
│   │   │           │   └── WebhookController.java
│   │   │           ├── service/
│   │   │           │   ├── PaymentService.java (interface)
│   │   │           │   ├── PaymentMethodService.java (interface)
│   │   │           │   ├── RefundService.java (interface)
│   │   │           │   ├── WebhookService.java (interface)
│   │   │           │   ├── TenantService.java (interface)
│   │   │           │   └── impl/
│   │   │           │       ├── PaymentServiceImpl.java
│   │   │           │       ├── PaymentMethodServiceImpl.java
│   │   │           │       ├── RefundServiceImpl.java
│   │   │           │       ├── WebhookServiceImpl.java
│   │   │           │       └── TenantServiceImpl.java
│   │   │           ├── processor/
│   │   │           │   ├── PaymentProcessor.java (interface)
│   │   │           │   ├── ProcessorFactory.java
│   │   │           │   └── impl/
│   │   │           │       ├── StripeProcessor.java
│   │   │           │       ├── PayPalProcessor.java
│   │   │           │       └── SquareProcessor.java
│   │   │           ├── repository/
│   │   │           │   ├── PaymentRepository.java (interface)
│   │   │           │   ├── PaymentMethodRepository.java (interface)
│   │   │           │   ├── RefundRepository.java (interface)
│   │   │           │   ├── WebhookLogRepository.java (interface)
│   │   │           │   ├── WebhookDeliveryRepository.java (interface)
│   │   │           │   ├── TenantRepository.java (interface)
│   │   │           │   └── IdempotencyKeyRepository.java (interface)
│   │   │           ├── entity/
│   │   │           │   ├── Payment.java
│   │   │           │   ├── PaymentMethod.java
│   │   │           │   ├── Refund.java
│   │   │           │   ├── PaymentEvent.java
│   │   │           │   ├── WebhookLog.java
│   │   │           │   ├── WebhookDelivery.java
│   │   │           │   ├── WebhookConfig.java
│   │   │           │   ├── Tenant.java
│   │   │           │   └── IdempotencyKey.java
│   │   │           ├── dto/
│   │   │           │   ├── request/
│   │   │           │   │   ├── CreatePaymentRequest.java
│   │   │           │   │   ├── CreatePaymentMethodRequest.java
│   │   │           │   │   ├── CreateRefundRequest.java
│   │   │           │   │   ├── UpdatePaymentMethodRequest.java
│   │   │           │   │   └── CreateWebhookConfigRequest.java
│   │   │           │   └── response/
│   │   │           │       ├── PaymentResponse.java
│   │   │           │       ├── PaymentMethodResponse.java
│   │   │           │       ├── RefundResponse.java
│   │   │           │       ├── WebhookConfigResponse.java
│   │   │           │       ├── PaginatedResponse.java
│   │   │           │       └── ErrorResponse.java
│   │   │           ├── integration/
│   │   │           │   ├── stripe/
│   │   │           │   │   ├── StripeWebhookHandler.java (interface)
│   │   │           │   │   ├── StripeMapper.java
│   │   │           │   │   └── impl/
│   │   │           │   │       └── StripeWebhookHandlerImpl.java
│   │   │           │   ├── paypal/
│   │   │           │   │   ├── PayPalWebhookHandler.java (interface)
│   │   │           │   │   ├── PayPalMapper.java
│   │   │           │   │   └── impl/
│   │   │           │   │       └── PayPalWebhookHandlerImpl.java
│   │   │           │   └── webhook/
│   │   │           │       ├── WebhookDispatcher.java (interface)
│   │   │           │       ├── WebhookSigner.java
│   │   │           │       └── impl/
│   │   │           │           └── WebhookDispatcherImpl.java
│   │   │           ├── event/
│   │   │           │   ├── EventPublisher.java (interface)
│   │   │           │   ├── EventConsumer.java
│   │   │           │   ├── PaymentEvent.java
│   │   │           │   └── impl/
│   │   │           │       └── EventPublisherImpl.java
│   │   │           ├── security/
│   │   │           │   ├── ApiKeyAuthenticationFilter.java
│   │   │           │   ├── TenantContext.java
│   │   │           │   └── SecurityConfig.java
│   │   │           ├── config/
│   │   │           │   ├── DatabaseConfig.java
│   │   │           │   ├── RedisConfig.java
│   │   │           │   ├── KafkaConfig.java
│   │   │           │   ├── StripeConfig.java
│   │   │           │   ├── PayPalConfig.java
│   │   │           │   └── WebClientConfig.java
│   │   │           ├── exception/
│   │   │           │   ├── GlobalExceptionHandler.java
│   │   │           │   ├── PaymentException.java
│   │   │           │   ├── TenantNotFoundException.java
│   │   │           │   ├── PaymentNotFoundException.java
│   │   │           │   ├── InvalidPaymentMethodException.java
│   │   │           │   └── ProcessorException.java
│   │   │           ├── mapper/
│   │   │           │   ├── PaymentMapper.java
│   │   │           │   ├── PaymentMethodMapper.java
│   │   │           │   ├── RefundMapper.java
│   │   │           │   └── TenantMapper.java
│   │   │           ├── validation/
│   │   │           │   ├── ValidCurrency.java
│   │   │           │   ├── ValidAmount.java
│   │   │           │   └── ValidPaymentStatus.java
│   │   │           └── util/
│   │   │               ├── IdempotencyUtil.java
│   │   │               ├── CryptoUtil.java
│   │   │               ├── WebhookSignatureUtil.java
│   │   │               └── RetryUtil.java
│   │   └── resources/
│   │       ├── application.yml
│   │       ├── application-dev.yml
│   │       ├── application-prod.yml
│   │       ├── db/
│   │       │   └── migration/
│   │       │       ├── V001__create_tenants.sql
│   │       │       ├── V002__create_payments.sql
│   │       │       ├── V003__create_payment_methods.sql
│   │       │       ├── V004__create_refunds.sql
│   │       │       ├── V005__create_payment_events.sql
│   │       │       ├── V006__create_webhook_configs.sql
│   │       │       ├── V007__create_webhook_logs.sql
│   │       │       └── V008__create_idempotency_keys.sql
│   │       └── logback-spring.xml
│   └── test/
│       ├── java/
│       │   └── com/
│       │       └── payment/
│       │           ├── unit/
│       │           │   ├── service/
│       │           │   │   └── impl/
│       │           │   ├── processor/
│       │           │   │   └── impl/
│       │           │   └── util/
│       │           ├── integration/
│       │           │   ├── controller/
│       │           │   └── repository/
│       │           └── e2e/
│       └── resources/
│           ├── application-test.yml
│           └── test-data.sql
├── docs/
│   ├── api/
│   │   └── openapi.yaml
│   └── architecture/
├── pom.xml (or build.gradle)
├── Dockerfile
├── docker-compose.yml
└── README.md
```


## Data Models

### Entity Relationship Diagram

```mermaid
erDiagram
    TENANT ||--o{ PAYMENT : has
    TENANT ||--o{ PAYMENT_METHOD : has
    TENANT ||--o{ WEBHOOK_CONFIG : has
    TENANT {
        uuid id PK
        string name
        string api_key
        string api_secret_hash
        jsonb processor_config
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }
    
    PAYMENT ||--o{ REFUND : has
    PAYMENT ||--o{ PAYMENT_EVENT : has
    PAYMENT }o--|| PAYMENT_METHOD : uses
    PAYMENT {
        uuid id PK
        uuid tenant_id FK
        uuid payment_method_id FK
        string idempotency_key UK
        string processor_type
        string processor_payment_id
        decimal amount
        string currency
        string status
        string payment_type
        jsonb metadata
        string description
        string customer_email
        string customer_name
        timestamp processed_at
        timestamp created_at
        timestamp updated_at
    }
    
    PAYMENT_METHOD ||--o{ PAYMENT_EVENT : has
    PAYMENT_METHOD {
        uuid id PK
        uuid tenant_id FK
        string customer_id
        string processor_type
        string processor_method_id
        string method_type
        jsonb card_details
        jsonb bank_details
        boolean is_default
        boolean is_active
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }
    
    REFUND ||--o{ PAYMENT_EVENT : has
    REFUND {
        uuid id PK
        uuid payment_id FK
        uuid tenant_id FK
        string idempotency_key UK
        string processor_refund_id
        decimal amount
        string currency
        string status
        string reason
        jsonb metadata
        timestamp processed_at
        timestamp created_at
        timestamp updated_at
    }
    
    PAYMENT_EVENT {
        uuid id PK
        uuid tenant_id FK
        uuid payment_id FK
        uuid refund_id FK
        uuid payment_method_id FK
        string event_type
        string status
        jsonb payload
        timestamp created_at
    }
    
    WEBHOOK_CONFIG {
        uuid id PK
        uuid tenant_id FK
        string url
        string secret
        jsonb events
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }
    
    WEBHOOK_LOG ||--o{ WEBHOOK_DELIVERY : has
    WEBHOOK_LOG {
        uuid id PK
        uuid tenant_id FK
        uuid payment_id FK
        uuid refund_id FK
        string event_type
        jsonb payload
        timestamp created_at
    }
    
    WEBHOOK_DELIVERY {
        uuid id PK
        uuid webhook_log_id FK
        string url
        int attempt_number
        int response_status
        string response_body
        string error_message
        timestamp attempted_at
        timestamp next_retry_at
    }
    
    IDEMPOTENCY_KEY {
        string key PK
        uuid tenant_id FK
        string request_path
        string request_hash
        int response_status
        jsonb response_body
        timestamp expires_at
        timestamp created_at
    }
```


### Core Entity Classes

```java
// Tenant Entity
@Entity
@Table(name = "tenants")
public class Tenant {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @Column(nullable = false)
    private String name;
    
    @Column(nullable = false, unique = true)
    private String apiKey;
    
    @Column(nullable = false)
    private String apiSecretHash;
    
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private ProcessorConfig processorConfig;
    
    @Column(nullable = false)
    private Boolean isActive = true;
    
    @CreatedDate
    private Instant createdAt;
    
    @LastModifiedDate
    private Instant updatedAt;
}

// Payment Entity
@Entity
@Table(name = "payments")
public class Payment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "payment_method_id")
    private PaymentMethod paymentMethod;
    
    @Column(nullable = false, unique = true)
    private String idempotencyKey;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProcessorType processorType;
    
    private String processorPaymentId;
    
    @Column(nullable = false, precision = 19, scale = 4)
    private BigDecimal amount;
    
    @Column(nullable = false, length = 3)
    private String currency;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentStatus status;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentType paymentType;
    
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;
    
    private String description;
    
    @Column(nullable = false)
    private String customerEmail;
    
    @Column(nullable = false)
    private String customerName;
    
    private Instant processedAt;
    
    @CreatedDate
    private Instant createdAt;
    
    @LastModifiedDate
    private Instant updatedAt;
}

// Payment Method Entity
@Entity
@Table(name = "payment_methods")
public class PaymentMethod {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;
    
    @Column(nullable = false)
    private String customerId;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProcessorType processorType;
    
    @Column(nullable = false)
    private String processorMethodId;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentMethodType methodType;
    
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private CardDetails cardDetails;
    
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private BankDetails bankDetails;
    
    @Column(nullable = false)
    private Boolean isDefault = false;
    
    @Column(nullable = false)
    private Boolean isActive = true;
    
    private Instant expiresAt;
    
    @CreatedDate
    private Instant createdAt;
    
    @LastModifiedDate
    private Instant updatedAt;
}

// Refund Entity
@Entity
@Table(name = "refunds")
public class Refund {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "payment_id", nullable = false)
    private Payment payment;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;
    
    @Column(nullable = false, unique = true)
    private String idempotencyKey;
    
    private String processorRefundId;
    
    @Column(nullable = false, precision = 19, scale = 4)
    private BigDecimal amount;
    
    @Column(nullable = false, length = 3)
    private String currency;
    
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RefundStatus status;
    
    private String reason;
    
    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;
    
    private Instant processedAt;
    
    @CreatedDate
    private Instant createdAt;
    
    @LastModifiedDate
    private Instant updatedAt;
}

// Enums
public enum ProcessorType {
    STRIPE, PAYPAL, SQUARE
}

public enum PaymentStatus {
    PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELED, REQUIRES_ACTION
}

public enum PaymentType {
    ONE_TIME, RECURRING
}

public enum RefundStatus {
    PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELED
}

public enum PaymentMethodType {
    CARD, BANK_ACCOUNT, DIGITAL_WALLET
}

// Supporting Types
public record CardDetails(
    String brand,
    String last4,
    Integer expMonth,
    Integer expYear,
    String fingerprint
) {}

public record BankDetails(
    String bankName,
    String accountType,
    String last4,
    String routingNumber
) {}

public record ProcessorConfig(
    StripeConfig stripe,
    PayPalConfig paypal,
    SquareConfig square
) {}

public record StripeConfig(
    String secretKey,
    String webhookSecret,
    String accountId
) {}
```


### Database Schema

```sql
-- ============================================================================
-- TENANTS TABLE
-- Purpose: Stores client projects that use the Payment Service. Each tenant
--          represents a separate client application (e.g., Billing Service,
--          eTalente) with complete data isolation and independent payment
--          processor configurations.
-- ============================================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this tenant
    name VARCHAR(255) NOT NULL,                                       -- Display name of the client project
    api_key VARCHAR(255) NOT NULL UNIQUE,                             -- API key for authentication (indexed for fast lookup)
    api_secret_hash VARCHAR(255) NOT NULL,                            -- Bcrypt hash of API secret for secure credential verification
    processor_config JSONB DEFAULT '{}',                              -- Payment processor credentials and settings (Stripe keys, PayPal credentials, etc.)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,                          -- Whether tenant can make API calls (false = suspended)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp when tenant was registered
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()                 -- Timestamp of last tenant configuration update
);

CREATE INDEX idx_tenants_api_key ON tenants(api_key);
CREATE INDEX idx_tenants_is_active ON tenants(is_active);

-- ============================================================================
-- PAYMENTS TABLE
-- Purpose: Records all payment transactions (one-time and recurring) processed
--          through the service. Links to payment processors (Stripe, PayPal)
--          and tracks payment lifecycle from pending to succeeded/failed.
-- ============================================================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this payment
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant that initiated this payment (for multi-tenant isolation)
    payment_method_id UUID REFERENCES payment_methods(id),            -- Optional payment method used (null if customer provides method at payment time)
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,                     -- Client-provided key to prevent duplicate charges from retried requests
    processor_type VARCHAR(50) NOT NULL,                              -- Payment processor used: stripe, paypal, or square
    processor_payment_id VARCHAR(255),                                -- Payment ID from the external processor (e.g., Stripe charge ID)
    amount DECIMAL(19,4) NOT NULL,                                    -- Payment amount with 4 decimal precision for accurate currency handling
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',                       -- ISO 4217 currency code (USD, EUR, GBP, etc.)
    status VARCHAR(50) NOT NULL,                                      -- Payment status: pending (created), processing (sent to processor), succeeded (completed), failed (declined/error), canceled (voided), requires_action (needs customer action like 3DS)
    payment_type VARCHAR(50) NOT NULL,                                -- Payment classification: one_time (single charge) or recurring (subscription payment)
    metadata JSONB DEFAULT '{}',                                      -- Additional custom data from client (e.g., order ID, invoice ID, customer notes)
    description TEXT,                                                 -- Human-readable payment description shown to customer
    customer_email VARCHAR(255) NOT NULL,                             -- Customer email for receipts and notifications
    customer_name VARCHAR(255) NOT NULL,                              -- Customer name for receipts and payment records
    processed_at TIMESTAMP WITH TIME ZONE,                            -- Timestamp when payment reached terminal status (succeeded/failed)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp when payment was initiated
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp of last payment status update
    CONSTRAINT valid_payment_status CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'requires_action')),
    CONSTRAINT valid_payment_type CHECK (payment_type IN ('one_time', 'recurring')),
    CONSTRAINT valid_processor_type CHECK (processor_type IN ('stripe', 'paypal', 'square')),
    CONSTRAINT positive_amount CHECK (amount > 0)                     -- Ensures payment amounts are always positive
);

CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX idx_payments_processor_id ON payments(processor_payment_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_customer_email ON payments(customer_email);
CREATE INDEX idx_payments_created ON payments(created_at);

-- ============================================================================
-- PAYMENT_METHODS TABLE
-- Purpose: Stores saved payment methods (credit cards, bank accounts) for
--          customers. Enables recurring payments without re-entering payment
--          details. Tokenized through payment processors for PCI compliance.
-- ============================================================================
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this payment method
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant that owns this payment method (for multi-tenant isolation)
    customer_id VARCHAR(255) NOT NULL,                                -- Customer identifier from client system (e.g., user ID from Billing Service)
    processor_type VARCHAR(50) NOT NULL,                              -- Payment processor managing this method: stripe, paypal, or square
    processor_method_id VARCHAR(255) NOT NULL,                        -- Payment method ID from processor (e.g., Stripe payment method ID, PayPal billing agreement ID)
    method_type VARCHAR(50) NOT NULL,                                 -- Type of payment method: card (credit/debit card), bank_account (ACH/SEPA), digital_wallet (Apple Pay, Google Pay)
    card_details JSONB,                                               -- Card metadata (brand, last4, exp_month, exp_year, fingerprint) - never stores full card number
    bank_details JSONB,                                               -- Bank account metadata (bank_name, account_type, last4, routing_number) - never stores full account number
    is_default BOOLEAN NOT NULL DEFAULT FALSE,                        -- Whether this is the customer's default payment method for automatic charges
    is_active BOOLEAN NOT NULL DEFAULT TRUE,                          -- Whether this payment method can be used (false = expired or removed)
    expires_at TIMESTAMP WITH TIME ZONE,                              -- Expiration date for cards (null for non-expiring methods like bank accounts)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp when payment method was added
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp of last payment method update
    CONSTRAINT valid_method_type CHECK (method_type IN ('card', 'bank_account', 'digital_wallet')),
    CONSTRAINT valid_processor_type CHECK (processor_type IN ('stripe', 'paypal', 'square'))
);

CREATE INDEX idx_payment_methods_tenant ON payment_methods(tenant_id);
CREATE INDEX idx_payment_methods_customer ON payment_methods(customer_id);
CREATE INDEX idx_payment_methods_processor_id ON payment_methods(processor_method_id);
CREATE INDEX idx_payment_methods_is_active ON payment_methods(is_active);

-- ============================================================================
-- REFUNDS TABLE
-- Purpose: Tracks refund transactions for payments. Supports full and partial
--          refunds with reason tracking for accounting and dispute resolution.
--          Links to original payment and processor refund records.
-- ============================================================================
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this refund
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,  -- Original payment being refunded
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant that initiated this refund (for multi-tenant isolation)
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,                     -- Client-provided key to prevent duplicate refunds from retried requests
    processor_refund_id VARCHAR(255),                                 -- Refund ID from the external processor (e.g., Stripe refund ID)
    amount DECIMAL(19,4) NOT NULL,                                    -- Refund amount (can be less than original payment for partial refunds)
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',                       -- ISO 4217 currency code (must match original payment currency)
    status VARCHAR(50) NOT NULL,                                      -- Refund status: pending (initiated), processing (sent to processor), succeeded (completed), failed (processor error), canceled (voided before processing)
    reason TEXT,                                                      -- Reason for refund (e.g., "duplicate charge", "customer request", "fraudulent transaction")
    metadata JSONB DEFAULT '{}',                                      -- Additional custom data from client (e.g., support ticket ID, refund policy reference)
    processed_at TIMESTAMP WITH TIME ZONE,                            -- Timestamp when refund reached terminal status (succeeded/failed)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp when refund was initiated
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp of last refund status update
    CONSTRAINT valid_refund_status CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT positive_amount CHECK (amount > 0)                     -- Ensures refund amounts are always positive
);

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
CREATE INDEX idx_refunds_tenant ON refunds(tenant_id);
CREATE INDEX idx_refunds_idempotency ON refunds(idempotency_key);
CREATE INDEX idx_refunds_processor_id ON refunds(processor_refund_id);
CREATE INDEX idx_refunds_status ON refunds(status);

-- ============================================================================
-- PAYMENT_EVENTS TABLE
-- Purpose: Immutable event log of all payment-related state changes. Provides
--          complete audit trail for debugging, analytics, and event sourcing.
--          Used to trigger webhooks and track payment lifecycle.
-- ============================================================================
CREATE TABLE payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this event
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant context for this event (for multi-tenant isolation)
    payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,        -- Payment this event relates to (null for non-payment events)
    refund_id UUID REFERENCES refunds(id) ON DELETE CASCADE,          -- Refund this event relates to (null for non-refund events)
    payment_method_id UUID REFERENCES payment_methods(id) ON DELETE CASCADE,  -- Payment method this event relates to (null for non-method events)
    event_type VARCHAR(100) NOT NULL,                                 -- Event type (e.g., "payment.succeeded", "refund.failed", "payment_method.attached")
    status VARCHAR(50),                                               -- Status value at time of event (e.g., "succeeded", "failed")
    payload JSONB NOT NULL,                                           -- Full event data snapshot for event replay and debugging
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()                 -- Timestamp when event occurred (immutable, never updated)
);

CREATE INDEX idx_payment_events_tenant ON payment_events(tenant_id);
CREATE INDEX idx_payment_events_payment ON payment_events(payment_id);
CREATE INDEX idx_payment_events_refund ON payment_events(refund_id);
CREATE INDEX idx_payment_events_type ON payment_events(event_type);
CREATE INDEX idx_payment_events_created ON payment_events(created_at);

-- ============================================================================
-- WEBHOOK_CONFIGS TABLE
-- Purpose: Stores webhook endpoint configurations for each tenant to receive
--          real-time notifications about payment events. Tenants subscribe to
--          specific event types and provide HTTPS endpoints for delivery.
-- ============================================================================
CREATE TABLE webhook_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this webhook configuration
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant that owns this webhook endpoint
    url VARCHAR(500) NOT NULL,                                        -- HTTPS endpoint URL where webhook events will be delivered
    secret VARCHAR(255) NOT NULL,                                     -- Shared secret for HMAC signature generation (tenant uses this to verify webhook authenticity)
    events JSONB NOT NULL DEFAULT '[]',                               -- Array of event types to subscribe to (e.g., ["payment.succeeded", "refund.failed"])
    is_active BOOLEAN NOT NULL DEFAULT TRUE,                          -- Whether webhook deliveries are enabled (false = paused)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),                -- Timestamp when webhook was configured
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()                 -- Timestamp of last configuration update
);

CREATE INDEX idx_webhook_configs_tenant ON webhook_configs(tenant_id);
CREATE INDEX idx_webhook_configs_is_active ON webhook_configs(is_active);

-- ============================================================================
-- WEBHOOK_LOGS TABLE
-- Purpose: Immutable log of all webhook events generated by the system.
--          Provides audit trail of what events were triggered and when,
--          independent of delivery success. Used for event replay and debugging.
-- ============================================================================
CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this webhook event
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant this event belongs to (for multi-tenant isolation)
    payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,        -- Payment this event relates to (null for non-payment events)
    refund_id UUID REFERENCES refunds(id) ON DELETE CASCADE,          -- Refund this event relates to (null for non-refund events)
    event_type VARCHAR(100) NOT NULL,                                 -- Event type (e.g., "payment.succeeded", "refund.failed", "payment_method.attached")
    payload JSONB NOT NULL,                                           -- Full event data sent to webhook endpoints
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()                 -- Timestamp when event was generated (immutable)
);

CREATE INDEX idx_webhook_logs_tenant ON webhook_logs(tenant_id);
CREATE INDEX idx_webhook_logs_payment ON webhook_logs(payment_id);
CREATE INDEX idx_webhook_logs_refund ON webhook_logs(refund_id);
CREATE INDEX idx_webhook_logs_event_type ON webhook_logs(event_type);
CREATE INDEX idx_webhook_logs_created ON webhook_logs(created_at);

-- ============================================================================
-- WEBHOOK_DELIVERIES TABLE
-- Purpose: Tracks individual webhook delivery attempts with retry logic.
--          Implements exponential backoff for failed deliveries and provides
--          detailed debugging information for delivery failures.
-- ============================================================================
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),                    -- Unique identifier for this delivery attempt
    webhook_log_id UUID NOT NULL REFERENCES webhook_logs(id) ON DELETE CASCADE,  -- The webhook event being delivered
    url VARCHAR(500) NOT NULL,                                        -- Target endpoint URL for this delivery attempt
    attempt_number INTEGER NOT NULL DEFAULT 1,                        -- Delivery attempt number (1 = first attempt, increments on retries)
    response_status INTEGER,                                          -- HTTP status code from webhook endpoint (e.g., 200, 500, null if network error)
    response_body TEXT,                                               -- Response body from webhook endpoint for debugging
    error_message TEXT,                                               -- Error message if delivery failed (network error, timeout, etc.)
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),              -- Timestamp when this delivery attempt was made
    next_retry_at TIMESTAMP WITH TIME ZONE                            -- Timestamp for next retry attempt (null if succeeded or retries exhausted)
);

CREATE INDEX idx_webhook_deliveries_log ON webhook_deliveries(webhook_log_id);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- ============================================================================
-- IDEMPOTENCY_KEYS TABLE
-- Purpose: Prevents duplicate operations from repeated API requests. Stores
--          request fingerprints and cached responses to ensure exactly-once
--          semantics for critical operations like payment processing.
-- ============================================================================
CREATE TABLE idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,                                     -- Client-provided idempotency key (unique identifier for this operation)
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant that made this request (for multi-tenant isolation)
    request_path VARCHAR(255) NOT NULL,                               -- API endpoint path (e.g., "/api/v1/payments") for request matching
    request_hash VARCHAR(64) NOT NULL,                                -- SHA-256 hash of request body to detect parameter changes with same idempotency key
    response_status INTEGER,                                          -- HTTP status code of cached response (e.g., 200, 201, 400)
    response_body JSONB,                                              -- Cached response body to return for duplicate requests
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours',  -- Expiration timestamp (keys auto-expire after 24 hours)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()                 -- Timestamp when this idempotency key was first used
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX idx_idempotency_tenant ON idempotency_keys(tenant_id);
```


## Service Layer Interfaces

### Payment Service

```java
// Interface
package com.payment.service;

public interface PaymentService {
    PaymentResponse createPayment(UUID tenantId, CreatePaymentRequest request);
    PaymentResponse getPayment(UUID paymentId, UUID tenantId);
    Page<PaymentResponse> listPayments(PaymentFilters filters, UUID tenantId, Pageable pageable);
    PaymentResponse cancelPayment(UUID paymentId, UUID tenantId);
    PaymentResponse updatePaymentStatus(UUID paymentId, PaymentStatus status, Map<String, Object> metadata);
}

// Implementation
package com.payment.service.impl;

import com.payment.service.PaymentService;
import com.payment.processor.ProcessorFactory;
import com.payment.processor.PaymentProcessor;

@Service
@Transactional
public class PaymentServiceImpl implements PaymentService {
    private final PaymentRepository paymentRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final ProcessorFactory processorFactory;
    private final EventPublisher eventPublisher;
    private final IdempotencyUtil idempotencyUtil;
    
    @Autowired
    public PaymentServiceImpl(
            PaymentRepository paymentRepository,
            PaymentMethodRepository paymentMethodRepository,
            ProcessorFactory processorFactory,
            EventPublisher eventPublisher,
            IdempotencyUtil idempotencyUtil) {
        this.paymentRepository = paymentRepository;
        this.paymentMethodRepository = paymentMethodRepository;
        this.processorFactory = processorFactory;
        this.eventPublisher = eventPublisher;
        this.idempotencyUtil = idempotencyUtil;
    }
    
    @Override
    public PaymentResponse createPayment(UUID tenantId, CreatePaymentRequest request) {
        // Check idempotency
        Optional<Payment> existingPayment = idempotencyUtil.checkIdempotency(
            request.getIdempotencyKey(), 
            tenantId
        );
        
        if (existingPayment.isPresent()) {
            if (idempotencyUtil.requestParamsMatch(existingPayment.get(), request)) {
                return paymentMapper.toResponse(existingPayment.get());
            } else {
                throw new IdempotencyConflictException("Idempotency key conflict");
            }
        }
        
        // Validate payment method if provided
        if (request.getPaymentMethodId() != null) {
            PaymentMethod paymentMethod = paymentMethodRepository
                .findByIdAndTenantId(request.getPaymentMethodId(), tenantId)
                .orElseThrow(() -> new InvalidPaymentMethodException("Payment method not found"));
            
            if (!paymentMethod.getIsActive()) {
                throw new InvalidPaymentMethodException("Payment method is not active");
            }
        }
        
        // Create pending payment record
        Payment payment = Payment.builder()
            .tenantId(tenantId)
            .idempotencyKey(request.getIdempotencyKey())
            .amount(request.getAmount())
            .currency(request.getCurrency())
            .status(PaymentStatus.PENDING)
            .paymentType(request.getPaymentType())
            .paymentMethodId(request.getPaymentMethodId())
            .customerEmail(request.getCustomerEmail())
            .customerName(request.getCustomerName())
            .description(request.getDescription())
            .metadata(request.getMetadata())
            .processorType(request.getProcessorType())
            .build();
        
        payment = paymentRepository.save(payment);
        
        try {
            // Get processor instance
            PaymentProcessor processor = processorFactory.getProcessor(
                payment.getProcessorType(),
                tenantId
            );
            
            // Process payment with processor
            ProcessorResponse processorResponse = processor.processPayment(
                ProcessPaymentRequest.builder()
                    .amount(request.getAmount())
                    .currency(request.getCurrency())
                    .paymentMethodId(request.getPaymentMethodId())
                    .customerId(request.getCustomerId())
                    .customerEmail(request.getCustomerEmail())
                    .description(request.getDescription())
                    .metadata(Map.of("paymentId", payment.getId().toString()))
                    .build()
            );
            
            // Update payment with processor response
            payment.setProcessorPaymentId(processorResponse.getProcessorId());
            payment.setStatus(processorResponse.getStatus());
            
            if (processorResponse.getStatus() == PaymentStatus.SUCCEEDED) {
                payment.setProcessedAt(Instant.now());
            }
            
            payment = paymentRepository.save(payment);
            
            // Publish event if terminal state
            if (isTerminalStatus(payment.getStatus())) {
                eventPublisher.publish(PaymentEvent.builder()
                    .tenantId(tenantId)
                    .eventType(payment.getStatus() == PaymentStatus.SUCCEEDED 
                        ? "payment.succeeded" 
                        : "payment.failed")
                    .paymentId(payment.getId())
                    .payload(paymentMapper.toResponse(payment))
                    .build());
            }
            
            return paymentMapper.toResponse(payment);
            
        } catch (ProcessorException e) {
            // Handle processor errors
            payment.setStatus(PaymentStatus.FAILED);
            payment = paymentRepository.save(payment);
            
            eventPublisher.publish(PaymentEvent.builder()
                .tenantId(tenantId)
                .eventType("payment.failed")
                .paymentId(payment.getId())
                .payload(paymentMapper.toResponse(payment))
                .build());
            
            throw new PaymentProcessingException("Payment processing failed: " + e.getMessage(), e);
        }
    }
    
    private boolean isTerminalStatus(PaymentStatus status) {
        return status == PaymentStatus.SUCCEEDED || 
               status == PaymentStatus.FAILED || 
               status == PaymentStatus.CANCELED;
    }
}
```

### Refund Service

```java
// Interface
package com.payment.service;

public interface RefundService {
    RefundResponse createRefund(UUID tenantId, CreateRefundRequest request);
    RefundResponse getRefund(UUID refundId, UUID tenantId);
    Page<RefundResponse> listRefunds(RefundFilters filters, UUID tenantId, Pageable pageable);
    BigDecimal calculateRefundableAmount(UUID paymentId);
}

// Implementation
package com.payment.service.impl;

import com.payment.service.RefundService;

@Service
@Transactional
public class RefundServiceImpl implements RefundService {
    private final RefundRepository refundRepository;
    private final PaymentRepository paymentRepository;
    private final ProcessorFactory processorFactory;
    private final EventPublisher eventPublisher;
    private final IdempotencyUtil idempotencyUtil;
    
    @Autowired
    public RefundServiceImpl(
            RefundRepository refundRepository,
            PaymentRepository paymentRepository,
            ProcessorFactory processorFactory,
            EventPublisher eventPublisher,
            IdempotencyUtil idempotencyUtil) {
        this.refundRepository = refundRepository;
        this.paymentRepository = paymentRepository;
        this.processorFactory = processorFactory;
        this.eventPublisher = eventPublisher;
        this.idempotencyUtil = idempotencyUtil;
    }
    
    @Override
    public RefundResponse createRefund(UUID tenantId, CreateRefundRequest request) {
        // Check idempotency
        Optional<Refund> existingRefund = refundRepository
            .findByIdempotencyKeyAndTenantId(request.getIdempotencyKey(), tenantId);
        
        if (existingRefund.isPresent()) {
            if (idempotencyUtil.requestParamsMatch(existingRefund.get(), request)) {
                return refundMapper.toResponse(existingRefund.get());
            } else {
                throw new IdempotencyConflictException("Idempotency key conflict");
            }
        }
        
        // Get and validate payment
        Payment payment = paymentRepository
            .findByIdAndTenantId(request.getPaymentId(), tenantId)
            .orElseThrow(() -> new PaymentNotFoundException("Payment not found"));
        
        if (payment.getStatus() != PaymentStatus.SUCCEEDED) {
            throw new InvalidRefundException("Payment must be succeeded to refund");
        }
        
        // Calculate refundable amount
        BigDecimal refundableAmount = calculateRefundableAmount(payment.getId());
        BigDecimal refundAmount = request.getAmount() != null 
            ? request.getAmount() 
            : payment.getAmount();
        
        if (refundAmount.compareTo(refundableAmount) > 0) {
            throw new InvalidRefundException(
                String.format("Refund amount %s exceeds refundable amount %s", 
                    refundAmount, refundableAmount)
            );
        }
        
        // Create pending refund record
        Refund refund = Refund.builder()
            .paymentId(payment.getId())
            .tenantId(tenantId)
            .idempotencyKey(request.getIdempotencyKey())
            .amount(refundAmount)
            .currency(payment.getCurrency())
            .status(RefundStatus.PENDING)
            .reason(request.getReason())
            .metadata(request.getMetadata())
            .build();
        
        refund = refundRepository.save(refund);
        
        try {
            // Get processor instance
            PaymentProcessor processor = processorFactory.getProcessor(
                payment.getProcessorType(),
                tenantId
            );
            
            // Process refund with processor
            ProcessorResponse processorResponse = processor.processRefund(
                ProcessRefundRequest.builder()
                    .processorPaymentId(payment.getProcessorPaymentId())
                    .amount(refundAmount)
                    .reason(request.getReason())
                    .metadata(Map.of("refundId", refund.getId().toString()))
                    .build()
            );
            
            // Update refund with processor response
            refund.setProcessorRefundId(processorResponse.getProcessorId());
            refund.setStatus((RefundStatus) processorResponse.getStatus());
            refund.setProcessedAt(Instant.now());
            refund = refundRepository.save(refund);
            
            // Publish event
            eventPublisher.publish(PaymentEvent.builder()
                .tenantId(tenantId)
                .eventType(refund.getStatus() == RefundStatus.SUCCEEDED 
                    ? "refund.succeeded" 
                    : "refund.failed")
                .refundId(refund.getId())
                .paymentId(payment.getId())
                .payload(refundMapper.toResponse(refund))
                .build());
            
            return refundMapper.toResponse(refund);
            
        } catch (ProcessorException e) {
            // Handle processor errors
            refund.setStatus(RefundStatus.FAILED);
            refund = refundRepository.save(refund);
            
            eventPublisher.publish(PaymentEvent.builder()
                .tenantId(tenantId)
                .eventType("refund.failed")
                .refundId(refund.getId())
                .paymentId(payment.getId())
                .payload(refundMapper.toResponse(refund))
                .build());
            
            throw new RefundProcessingException("Refund processing failed: " + e.getMessage(), e);
        }
    }
    
    @Override
    public BigDecimal calculateRefundableAmount(UUID paymentId) {
        Payment payment = paymentRepository.findById(paymentId)
            .orElseThrow(() -> new PaymentNotFoundException("Payment not found"));
        
        List<Refund> successfulRefunds = refundRepository
            .findByPaymentIdAndStatus(paymentId, RefundStatus.SUCCEEDED);
        
        BigDecimal totalRefunded = successfulRefunds.stream()
            .map(Refund::getAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        
        return payment.getAmount().subtract(totalRefunded);
    }
}
```


## API Endpoints

### Payment Endpoints

```java
@RestController
@RequestMapping("/api/v1/payments")
public class PaymentController {
    private final PaymentService paymentService;
    
    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }
    
    // POST /api/v1/payments - Create a new payment
    @PostMapping
    public ResponseEntity<PaymentResponse> createPayment(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreatePaymentRequest request) {
        request.setIdempotencyKey(idempotencyKey);
        PaymentResponse response = paymentService.createPayment(tenantId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    // GET /api/v1/payments/{id} - Get payment by ID
    @GetMapping("/{id}")
    public ResponseEntity<PaymentResponse> getPayment(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        PaymentResponse response = paymentService.getPayment(id, tenantId);
        return ResponseEntity.ok(response);
    }
    
    // GET /api/v1/payments - List payments with filters
    @GetMapping
    public ResponseEntity<Page<PaymentResponse>> listPayments(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @RequestParam(required = false) String customerEmail,
            @RequestParam(required = false) PaymentStatus status,
            @RequestParam(required = false) PaymentType paymentType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        PaymentFilters filters = PaymentFilters.builder()
            .customerEmail(customerEmail)
            .status(status)
            .paymentType(paymentType)
            .build();
        Page<PaymentResponse> response = paymentService.listPayments(
            filters, tenantId, PageRequest.of(page, size));
        return ResponseEntity.ok(response);
    }
    
    // POST /api/v1/payments/{id}/cancel - Cancel a payment
    @PostMapping("/{id}/cancel")
    public ResponseEntity<PaymentResponse> cancelPayment(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        PaymentResponse response = paymentService.cancelPayment(id, tenantId);
        return ResponseEntity.ok(response);
    }
}
```

### Payment Method Endpoints

```java
@RestController
@RequestMapping("/api/v1/payment-methods")
public class PaymentMethodController {
    private final PaymentMethodService paymentMethodService;
    
    public PaymentMethodController(PaymentMethodService paymentMethodService) {
        this.paymentMethodService = paymentMethodService;
    }
    
    // POST /api/v1/payment-methods - Create a new payment method
    @PostMapping
    public ResponseEntity<PaymentMethodResponse> createPaymentMethod(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @Valid @RequestBody CreatePaymentMethodRequest request) {
        PaymentMethodResponse response = paymentMethodService.create(tenantId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    // GET /api/v1/payment-methods/{id} - Get payment method by ID
    @GetMapping("/{id}")
    public ResponseEntity<PaymentMethodResponse> getPaymentMethod(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        PaymentMethodResponse response = paymentMethodService.get(id, tenantId);
        return ResponseEntity.ok(response);
    }
    
    // GET /api/v1/payment-methods - List payment methods for a customer
    @GetMapping
    public ResponseEntity<List<PaymentMethodResponse>> listPaymentMethods(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @RequestParam String customerId) {
        List<PaymentMethodResponse> response = paymentMethodService.listByCustomer(customerId, tenantId);
        return ResponseEntity.ok(response);
    }
    
    // PUT /api/v1/payment-methods/{id} - Update payment method
    @PutMapping("/{id}")
    public ResponseEntity<PaymentMethodResponse> updatePaymentMethod(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id,
            @Valid @RequestBody UpdatePaymentMethodRequest request) {
        PaymentMethodResponse response = paymentMethodService.update(id, tenantId, request);
        return ResponseEntity.ok(response);
    }
    
    // DELETE /api/v1/payment-methods/{id} - Delete payment method
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deletePaymentMethod(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        paymentMethodService.delete(id, tenantId);
        return ResponseEntity.noContent().build();
    }
    
    // POST /api/v1/payment-methods/{id}/set-default - Set as default payment method
    @PostMapping("/{id}/set-default")
    public ResponseEntity<PaymentMethodResponse> setDefaultPaymentMethod(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id,
            @RequestParam String customerId) {
        PaymentMethodResponse response = paymentMethodService.setDefault(id, customerId, tenantId);
        return ResponseEntity.ok(response);
    }
}
```

### Refund Endpoints

```java
@RestController
@RequestMapping("/api/v1/refunds")
public class RefundController {
    private final RefundService refundService;
    
    public RefundController(RefundService refundService) {
        this.refundService = refundService;
    }
    
    // POST /api/v1/refunds - Create a new refund
    @PostMapping
    public ResponseEntity<RefundResponse> createRefund(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateRefundRequest request) {
        request.setIdempotencyKey(idempotencyKey);
        RefundResponse response = refundService.createRefund(tenantId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    // GET /api/v1/refunds/{id} - Get refund by ID
    @GetMapping("/{id}")
    public ResponseEntity<RefundResponse> getRefund(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        RefundResponse response = refundService.getRefund(id, tenantId);
        return ResponseEntity.ok(response);
    }
    
    // GET /api/v1/refunds - List refunds with filters
    @GetMapping
    public ResponseEntity<Page<RefundResponse>> listRefunds(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @RequestParam(required = false) UUID paymentId,
            @RequestParam(required = false) RefundStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        RefundFilters filters = RefundFilters.builder()
            .paymentId(paymentId)
            .status(status)
            .build();
        Page<RefundResponse> response = refundService.listRefunds(
            filters, tenantId, PageRequest.of(page, size));
        return ResponseEntity.ok(response);
    }
}
```

### Tenant Management Endpoints

```java
@RestController
@RequestMapping("/api/v1/tenants")
public class TenantController {
    private final TenantService tenantService;
    
    public TenantController(TenantService tenantService) {
        this.tenantService = tenantService;
    }
    
    // POST /api/v1/tenants - Register a new tenant
    @PostMapping
    public ResponseEntity<TenantResponse> registerTenant(
            @Valid @RequestBody RegisterTenantRequest request) {
        TenantResponse response = tenantService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    // GET /api/v1/tenants/{id} - Get tenant by ID
    @GetMapping("/{id}")
    public ResponseEntity<TenantResponse> getTenant(@PathVariable UUID id) {
        TenantResponse response = tenantService.get(id);
        return ResponseEntity.ok(response);
    }
    
    // PUT /api/v1/tenants/{id} - Update tenant configuration
    @PutMapping("/{id}")
    public ResponseEntity<TenantResponse> updateTenant(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateTenantRequest request) {
        TenantResponse response = tenantService.update(id, request);
        return ResponseEntity.ok(response);
    }
    
    // POST /api/v1/tenants/{id}/rotate-api-key - Rotate API key
    @PostMapping("/{id}/rotate-api-key")
    public ResponseEntity<ApiKeyResponse> rotateApiKey(@PathVariable UUID id) {
        ApiKeyResponse response = tenantService.rotateApiKey(id);
        return ResponseEntity.ok(response);
    }
}
```

### Webhook Configuration Endpoints

```java
@RestController
@RequestMapping("/api/v1/webhooks")
public class WebhookController {
    private final WebhookService webhookService;
    
    public WebhookController(WebhookService webhookService) {
        this.webhookService = webhookService;
    }
    
    // POST /api/v1/webhooks - Create webhook configuration
    @PostMapping
    public ResponseEntity<WebhookConfigResponse> createWebhook(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @Valid @RequestBody CreateWebhookConfigRequest request) {
        WebhookConfigResponse response = webhookService.create(tenantId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
    
    // GET /api/v1/webhooks - List webhook configurations
    @GetMapping
    public ResponseEntity<List<WebhookConfigResponse>> listWebhooks(
            @RequestHeader("X-Tenant-ID") UUID tenantId) {
        List<WebhookConfigResponse> response = webhookService.list(tenantId);
        return ResponseEntity.ok(response);
    }
    
    // PUT /api/v1/webhooks/{id} - Update webhook configuration
    @PutMapping("/{id}")
    public ResponseEntity<WebhookConfigResponse> updateWebhook(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateWebhookConfigRequest request) {
        WebhookConfigResponse response = webhookService.update(id, tenantId, request);
        return ResponseEntity.ok(response);
    }
    
    // DELETE /api/v1/webhooks/{id} - Delete webhook configuration
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteWebhook(
            @RequestHeader("X-Tenant-ID") UUID tenantId,
            @PathVariable UUID id) {
        webhookService.delete(id, tenantId);
        return ResponseEntity.noContent().build();
    }
    
    // POST /webhooks/stripe - Stripe webhook receiver (public endpoint)
    @PostMapping("/stripe")
    public ResponseEntity<Void> handleStripeWebhook(
            @RequestBody String payload,
            @RequestHeader("Stripe-Signature") String signature) {
        webhookService.handleStripeWebhook(payload, signature);
        return ResponseEntity.ok().build();
    }
    
    // POST /webhooks/paypal - PayPal webhook receiver (public endpoint)
    @PostMapping("/paypal")
    public ResponseEntity<Void> handlePayPalWebhook(
            @RequestBody String payload,
            @RequestHeader("PAYPAL-TRANSMISSION-SIG") String signature) {
        webhookService.handlePayPalWebhook(payload, signature);
        return ResponseEntity.ok().build();
    }
}
```


## Webhook System

### Webhook Architecture

The Payment Service implements a robust webhook system for notifying client applications (like Billing Service) about payment events in real-time. The system handles both incoming webhooks from payment processors (Stripe, PayPal) and outgoing webhooks to client applications.

```mermaid
graph TB
    subgraph "External Processors"
        STRIPE[Stripe]
        PAYPAL[PayPal]
    end
    
    subgraph "Payment Service"
        PROC_WH[Processor Webhook Receiver]
        EVENT_BUS[Event Bus]
        WH_DISPATCHER[Webhook Dispatcher]
        WH_QUEUE[Webhook Queue]
        WH_WORKER[Webhook Worker]
        RETRY[Retry Scheduler]
    end
    
    subgraph "Client Applications"
        BILLING[Billing Service]
        APP1[Client App 1]
    end
    
    STRIPE -.->|POST /webhooks/stripe| PROC_WH
    PAYPAL -.->|POST /webhooks/paypal| PROC_WH
    
    PROC_WH --> EVENT_BUS
    EVENT_BUS --> WH_DISPATCHER
    WH_DISPATCHER --> WH_QUEUE
    WH_QUEUE --> WH_WORKER
    WH_WORKER -.->|HTTPS POST| BILLING
    WH_WORKER -.->|HTTPS POST| APP1
    WH_WORKER -->|Failed| RETRY
    RETRY -->|Exponential Backoff| WH_QUEUE
```

### Incoming Webhook Flow (From Processors)

```mermaid
sequenceDiagram
    participant Stripe as Stripe/PayPal
    participant Receiver as Webhook Receiver
    participant Verifier as Signature Verifier
    participant Handler as Event Handler
    participant DB as Database
    participant EventBus as Event Bus
    
    Stripe->>Receiver: POST /webhooks/stripe
    Note over Stripe,Receiver: Headers: Stripe-Signature
    
    Receiver->>Verifier: Verify signature
    alt Invalid Signature
        Verifier-->>Receiver: Signature invalid
        Receiver-->>Stripe: 401 Unauthorized
    else Valid Signature
        Verifier-->>Receiver: Signature valid
        Receiver->>Handler: Parse event
        Handler->>DB: Update payment/refund status
        Handler->>EventBus: Publish internal event
        EventBus->>EventBus: Trigger outgoing webhooks
        Handler-->>Receiver: Event processed
        Receiver-->>Stripe: 200 OK
    end
```

### Outgoing Webhook Flow (To Clients)

```mermaid
sequenceDiagram
    participant Service as Payment Service
    participant EventBus as Event Bus
    participant Dispatcher as Webhook Dispatcher
    participant Queue as Webhook Queue
    participant Worker as Webhook Worker
    participant Client as Client Application
    participant Retry as Retry Scheduler
    
    Service->>EventBus: Publish event (payment.succeeded)
    EventBus->>Dispatcher: Route event
    Dispatcher->>Dispatcher: Find subscribed webhooks
    Dispatcher->>Queue: Enqueue webhook delivery
    
    Queue->>Worker: Dequeue delivery task
    Worker->>Worker: Sign payload (HMAC-SHA256)
    Worker->>Client: POST webhook URL
    Note over Worker,Client: Headers: X-Webhook-Signature, X-Event-Type
    
    alt Success (2xx response)
        Client-->>Worker: 200 OK
        Worker->>Queue: Mark delivered
    else Failure (5xx or timeout)
        Client-->>Worker: 500 Error
        Worker->>Retry: Schedule retry
        Note over Retry: Exponential backoff: 1m, 5m, 30m, 2h, 6h
        Retry->>Queue: Re-enqueue after delay
    else Permanent Failure (4xx)
        Client-->>Worker: 400 Bad Request
        Worker->>Queue: Mark failed (no retry)
    end
```

### Webhook Event Types

**Payment Events:**
- `payment.created` - Payment initiated
- `payment.processing` - Payment sent to processor
- `payment.succeeded` - Payment completed successfully
- `payment.failed` - Payment declined or error
- `payment.canceled` - Payment voided
- `payment.requires_action` - Customer action needed (3DS, etc.)

**Refund Events:**
- `refund.created` - Refund initiated
- `refund.processing` - Refund sent to processor
- `refund.succeeded` - Refund completed successfully
- `refund.failed` - Refund error

**Payment Method Events:**
- `payment_method.attached` - Payment method added to customer
- `payment_method.detached` - Payment method removed
- `payment_method.updated` - Payment method details changed
- `payment_method.expired` - Card expired

### Webhook Payload Structure

```json
{
  "id": "evt_1234567890",
  "type": "payment.succeeded",
  "created": 1678901234,
  "data": {
    "id": "pay_abc123",
    "tenant_id": "tenant_xyz",
    "amount": 5000,
    "currency": "usd",
    "status": "succeeded",
    "payment_type": "recurring",
    "customer_email": "customer@example.com",
    "customer_name": "John Doe",
    "processor_type": "stripe",
    "processor_payment_id": "pi_stripe123",
    "metadata": {
      "invoice_id": "inv_456",
      "subscription_id": "sub_789"
    },
    "processed_at": "2024-03-15T10:30:00Z",
    "created_at": "2024-03-15T10:29:45Z"
  }
}
```

### Webhook Signature Verification

Clients must verify webhook signatures to ensure authenticity:

```java
// Client-side verification example
public boolean verifyWebhookSignature(String payload, String signature, String secret) {
    try {
        Mac hmac = Mac.getInstance("HmacSHA256");
        SecretKeySpec secretKey = new SecretKeySpec(secret.getBytes(), "HmacSHA256");
        hmac.init(secretKey);
        
        byte[] hash = hmac.doFinal(payload.getBytes());
        String computed = "sha256=" + Hex.encodeHexString(hash);
        
        return MessageDigest.isEqual(
            computed.getBytes(),
            signature.getBytes()
        );
    } catch (Exception e) {
        return false;
    }
}
```

### Webhook Retry Strategy

**Retry Schedule:**
- Attempt 1: Immediate
- Attempt 2: 1 minute later
- Attempt 3: 5 minutes later
- Attempt 4: 30 minutes later
- Attempt 5: 2 hours later
- Attempt 6: 6 hours later
- After 6 failures: Mark as permanently failed

**Retry Conditions:**
- Retry on: 5xx errors, network timeouts, connection errors
- No retry on: 4xx errors (except 408, 429), invalid URLs
- Max retries: 6 attempts over 24 hours

**Implementation:**

```java
@Component
public class WebhookRetryScheduler {
    private static final int[] RETRY_DELAYS_MINUTES = {1, 5, 30, 120, 360};
    private static final int MAX_RETRIES = 6;
    
    public Instant calculateNextRetry(int attemptNumber) {
        if (attemptNumber >= MAX_RETRIES) {
            return null;  // No more retries
        }
        
        int delayMinutes = attemptNumber < RETRY_DELAYS_MINUTES.length
            ? RETRY_DELAYS_MINUTES[attemptNumber - 1]
            : RETRY_DELAYS_MINUTES[RETRY_DELAYS_MINUTES.length - 1];
        
        return Instant.now().plus(Duration.ofMinutes(delayMinutes));
    }
    
    public boolean shouldRetry(int statusCode, int attemptNumber) {
        if (attemptNumber >= MAX_RETRIES) {
            return false;
        }
        
        // Retry on server errors and specific client errors
        return statusCode >= 500 || statusCode == 408 || statusCode == 429;
    }
}
```


## Processor Abstraction Layer

### Processor Interface

```java
// Processor Interface
package com.payment.processor;

public interface PaymentProcessor {
    // Payment Operations
    ProcessorResponse processPayment(ProcessPaymentRequest request);
    ProcessorPaymentDetails getPayment(String processorPaymentId);
    ProcessorResponse cancelPayment(String processorPaymentId);
    
    // Payment Method Operations
    ProcessorPaymentMethod createPaymentMethod(CreatePaymentMethodRequest request);
    ProcessorPaymentMethod getPaymentMethod(String processorMethodId);
    void deletePaymentMethod(String processorMethodId);
    
    // Refund Operations
    ProcessorResponse processRefund(ProcessRefundRequest request);
    ProcessorRefundDetails getRefund(String processorRefundId);
    
    // Webhook Operations
    boolean verifyWebhookSignature(String payload, String signature, String secret);
    ProcessorWebhookEvent parseWebhookEvent(String payload);
}

// Processor Factory
package com.payment.processor;

@Component
public class ProcessorFactory {
    private final Map<ProcessorType, PaymentProcessor> processors;
    private final TenantRepository tenantRepository;
    
    @Autowired
    public ProcessorFactory(
            List<PaymentProcessor> processorList,
            TenantRepository tenantRepository) {
        this.processors = new HashMap<>();
        this.tenantRepository = tenantRepository;
        
        // Register processors (injected by Spring)
        for (PaymentProcessor processor : processorList) {
            if (processor instanceof StripeProcessor) {
                processors.put(ProcessorType.STRIPE, processor);
            } else if (processor instanceof PayPalProcessor) {
                processors.put(ProcessorType.PAYPAL, processor);
            } else if (processor instanceof SquareProcessor) {
                processors.put(ProcessorType.SQUARE, processor);
            }
        }
    }
    
    public PaymentProcessor getProcessor(ProcessorType type, UUID tenantId) {
        PaymentProcessor processor = processors.get(type);
        if (processor == null) {
            throw new ProcessorNotFoundException("Processor " + type + " not registered");
        }
        
        // Get tenant-specific configuration
        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new TenantNotFoundException("Tenant not found"));
        
        // Configure processor with tenant config (if needed)
        // This could be done via a configure() method on the processor
        
        return processor;
    }
}

// Request/Response Types
public record ProcessPaymentRequest(
    BigDecimal amount,
    String currency,
    String paymentMethodId,
    String customerId,
    String customerEmail,
    String description,
    Map<String, Object> metadata
) {}

public record ProcessorResponse(
    boolean success,
    String processorId,
    Object status,  // PaymentStatus or RefundStatus
    String errorCode,
    String errorMessage,
    Map<String, Object> metadata
) {}

public record ProcessorPaymentDetails(
    String processorPaymentId,
    PaymentStatus status,
    BigDecimal amount,
    String currency,
    boolean requiresAction,
    String clientSecret,
    Map<String, Object> nextAction,
    Map<String, Object> metadata
) {}

public record CreatePaymentMethodRequest(
    String customerId,
    PaymentMethodType type,
    CardInput card,
    BankAccountInput bankAccount
) {}

public record ProcessorPaymentMethod(
    String processorMethodId,
    PaymentMethodType type,
    CardDetails cardDetails,
    BankDetails bankDetails,
    Instant expiresAt
) {}

public record ProcessRefundRequest(
    String processorPaymentId,
    BigDecimal amount,
    String reason,
    Map<String, Object> metadata
) {}

public record ProcessorRefundDetails(
    String processorRefundId,
    RefundStatus status,
    BigDecimal amount,
    String currency,
    Map<String, Object> metadata
) {}

public record ProcessorWebhookEvent(
    String eventType,
    String processorPaymentId,
    String processorRefundId,
    String processorMethodId,
    Object status,
    Map<String, Object> data
) {}
```

### Stripe Processor Implementation

```java
package com.payment.processor.impl;

import com.payment.processor.PaymentProcessor;
import com.stripe.Stripe;
import com.stripe.model.*;
import com.stripe.param.*;

@Component
public class StripeProcessor implements PaymentProcessor {
    private final StripeConfig config;
    
    @Autowired
    public StripeProcessor(StripeConfig config) {
        this.config = config;
        Stripe.apiKey = config.getSecretKey();
    }
    
    @Override
    public ProcessorResponse processPayment(ProcessPaymentRequest request) {
        try {
            // Create or retrieve customer
            String customerId = request.customerId();
            if (customerId == null && request.customerEmail() != null) {
                CustomerCreateParams customerParams = CustomerCreateParams.builder()
                    .setEmail(request.customerEmail())
                    .putAllMetadata(request.metadata())
                    .build();
                Customer customer = Customer.create(customerParams);
                customerId = customer.getId();
            }
            
            // Create payment intent
            PaymentIntentCreateParams params = PaymentIntentCreateParams.builder()
                .setAmount(request.amount().multiply(new BigDecimal("100")).longValue())
                .setCurrency(request.currency().toLowerCase())
                .setCustomer(customerId)
                .setPaymentMethod(request.paymentMethodId())
                .setDescription(request.description())
                .putAllMetadata(request.metadata())
                .setConfirm(request.paymentMethodId() != null)
                .build();
            
            PaymentIntent paymentIntent = PaymentIntent.create(params);
            
            // Map Stripe status to internal status
            PaymentStatus status = mapStripeStatus(paymentIntent.getStatus());
            
            return new ProcessorResponse(
                status == PaymentStatus.SUCCEEDED,
                paymentIntent.getId(),
                status,
                null,
                null,
                Map.of(
                    "clientSecret", paymentIntent.getClientSecret(),
                    "requiresAction", "requires_action".equals(paymentIntent.getStatus()),
                    "nextAction", paymentIntent.getNextAction()
                )
            );
            
        } catch (StripeException e) {
            return handleStripeError(e);
        }
    }
    
    @Override
    public ProcessorResponse processRefund(ProcessRefundRequest request) {
        try {
            RefundCreateParams params = RefundCreateParams.builder()
                .setPaymentIntent(request.processorPaymentId())
                .setAmount(request.amount() != null 
                    ? request.amount().multiply(new BigDecimal("100")).longValue() 
                    : null)
                .setReason(mapRefundReason(request.reason()))
                .putAllMetadata(request.metadata())
                .build();
            
            Refund refund = Refund.create(params);
            
            RefundStatus status = mapStripeRefundStatus(refund.getStatus());
            
            return new ProcessorResponse(
                status == RefundStatus.SUCCEEDED,
                refund.getId(),
                status,
                null,
                null,
                Map.of()
            );
            
        } catch (StripeException e) {
            return handleStripeError(e);
        }
    }
    
    @Override
    public ProcessorPaymentMethod createPaymentMethod(CreatePaymentMethodRequest request) {
        try {
            PaymentMethodCreateParams.Builder paramsBuilder = PaymentMethodCreateParams.builder()
                .setType(mapPaymentMethodType(request.type()));
            
            if (request.card() != null) {
                paramsBuilder.setCard(PaymentMethodCreateParams.Card.builder()
                    .setNumber(request.card().number())
                    .setExpMonth(request.card().expMonth().longValue())
                    .setExpYear(request.card().expYear().longValue())
                    .setCvc(request.card().cvc())
                    .build());
            }
            
            PaymentMethod paymentMethod = PaymentMethod.create(paramsBuilder.build());
            
            // Attach to customer
            if (request.customerId() != null) {
                PaymentMethodAttachParams attachParams = PaymentMethodAttachParams.builder()
                    .setCustomer(request.customerId())
                    .build();
                paymentMethod.attach(attachParams);
            }
            
            return mapStripePaymentMethod(paymentMethod);
            
        } catch (StripeException e) {
            throw new ProcessorException("Failed to create payment method: " + e.getMessage(), e);
        }
    }
    
    @Override
    public boolean verifyWebhookSignature(String payload, String signature, String secret) {
        try {
            Event event = Webhook.constructEvent(payload, signature, secret);
            return true;
        } catch (SignatureVerificationException e) {
            return false;
        }
    }
    
    @Override
    public ProcessorWebhookEvent parseWebhookEvent(String payload) {
        try {
            Event event = Event.GSON.fromJson(payload, Event.class);
            
            return switch (event.getType()) {
                case "payment_intent.succeeded" -> {
                    PaymentIntent pi = (PaymentIntent) event.getDataObjectDeserializer()
                        .getObject().orElseThrow();
                    yield new ProcessorWebhookEvent(
                        "payment.succeeded",
                        pi.getId(),
                        null,
                        null,
                        PaymentStatus.SUCCEEDED,
                        Map.of("paymentIntent", pi)
                    );
                }
                case "payment_intent.payment_failed" -> {
                    PaymentIntent pi = (PaymentIntent) event.getDataObjectDeserializer()
                        .getObject().orElseThrow();
                    yield new ProcessorWebhookEvent(
                        "payment.failed",
                        pi.getId(),
                        null,
                        null,
                        PaymentStatus.FAILED,
                        Map.of("paymentIntent", pi)
                    );
                }
                case "charge.refunded" -> {
                    Charge charge = (Charge) event.getDataObjectDeserializer()
                        .getObject().orElseThrow();
                    yield new ProcessorWebhookEvent(
                        "refund.succeeded",
                        charge.getPaymentIntent(),
                        charge.getRefunds().getData().get(0).getId(),
                        null,
                        RefundStatus.SUCCEEDED,
                        Map.of("charge", charge)
                    );
                }
                default -> new ProcessorWebhookEvent(
                    event.getType(),
                    null,
                    null,
                    null,
                    null,
                    Map.of("event", event)
                );
            };
            
        } catch (Exception e) {
            throw new ProcessorException("Failed to parse webhook event: " + e.getMessage(), e);
        }
    }
    
    private PaymentStatus mapStripeStatus(String stripeStatus) {
        return switch (stripeStatus) {
            case "requires_payment_method", "requires_confirmation" -> PaymentStatus.PENDING;
            case "requires_action" -> PaymentStatus.REQUIRES_ACTION;
            case "processing" -> PaymentStatus.PROCESSING;
            case "succeeded" -> PaymentStatus.SUCCEEDED;
            case "canceled" -> PaymentStatus.CANCELED;
            default -> PaymentStatus.FAILED;
        };
    }
    
    private RefundStatus mapStripeRefundStatus(String stripeStatus) {
        return switch (stripeStatus) {
            case "pending" -> RefundStatus.PENDING;
            case "succeeded" -> RefundStatus.SUCCEEDED;
            case "failed" -> RefundStatus.FAILED;
            case "canceled" -> RefundStatus.CANCELED;
            default -> RefundStatus.FAILED;
        };
    }
    
    private ProcessorResponse handleStripeError(StripeException e) {
        return new ProcessorResponse(
            false,
            null,
            PaymentStatus.FAILED,
            e.getCode(),
            e.getMessage(),
            Map.of()
        );
    }
    
    private ProcessorPaymentMethod mapStripePaymentMethod(PaymentMethod pm) {
        CardDetails cardDetails = null;
        if (pm.getCard() != null) {
            cardDetails = new CardDetails(
                pm.getCard().getBrand(),
                pm.getCard().getLast4(),
                pm.getCard().getExpMonth().intValue(),
                pm.getCard().getExpYear().intValue(),
                pm.getCard().getFingerprint()
            );
        }
        
        return new ProcessorPaymentMethod(
            pm.getId(),
            PaymentMethodType.CARD,
            cardDetails,
            null,
            null
        );
    }
    
    private PaymentMethodCreateParams.Type mapPaymentMethodType(PaymentMethodType type) {
        return switch (type) {
            case CARD -> PaymentMethodCreateParams.Type.CARD;
            case BANK_ACCOUNT -> PaymentMethodCreateParams.Type.US_BANK_ACCOUNT;
            default -> throw new IllegalArgumentException("Unsupported payment method type: " + type);
        };
    }
    
    private RefundCreateParams.Reason mapRefundReason(String reason) {
        if (reason == null) return null;
        return switch (reason.toLowerCase()) {
            case "duplicate" -> RefundCreateParams.Reason.DUPLICATE;
            case "fraudulent" -> RefundCreateParams.Reason.FRAUDULENT;
            case "requested_by_customer" -> RefundCreateParams.Reason.REQUESTED_BY_CUSTOMER;
            default -> null;
        };
    }
}
```


## Configuration

### Application Configuration

```yaml
# application.yml
spring:
  application:
    name: payment-service
  
  datasource:
    url: ${DATABASE_URL:jdbc:postgresql://localhost:5432/payment}
    username: ${DATABASE_USER:payment}
    password: ${DATABASE_PASSWORD:secret}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 30000
  
  jpa:
    hibernate:
      ddl-auto: validate
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        jdbc:
          time_zone: UTC
  
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}
      timeout: 2000ms
  
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}
    consumer:
      group-id: payment-service
      auto-offset-reset: earliest
    producer:
      acks: all
      retries: 3

# Processor Configurations
payment:
  processors:
    stripe:
      secret-key: ${STRIPE_SECRET_KEY}
      webhook-secret: ${STRIPE_WEBHOOK_SECRET}
      api-version: "2023-10-16"
    paypal:
      client-id: ${PAYPAL_CLIENT_ID}
      client-secret: ${PAYPAL_CLIENT_SECRET}
      mode: ${PAYPAL_MODE:sandbox}
    square:
      access-token: ${SQUARE_ACCESS_TOKEN}
      environment: ${SQUARE_ENVIRONMENT:sandbox}

server:
  port: 8080
  compression:
    enabled: true

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true

logging:
  level:
    com.payment: INFO
    org.springframework.web: INFO
    org.hibernate.SQL: DEBUG
```

### Processor Configuration Classes

```java
@Configuration
@ConfigurationProperties(prefix = "payment.processors.stripe")
@Data
public class StripeConfig {
    private String secretKey;
    private String webhookSecret;
    private String apiVersion;
}

@Configuration
@ConfigurationProperties(prefix = "payment.processors.paypal")
@Data
public class PayPalConfig {
    private String clientId;
    private String clientSecret;
    private String mode;
}

@Configuration
@ConfigurationProperties(prefix = "payment.processors.square")
@Data
public class SquareConfig {
    private String accessToken;
    private String environment;
}
```

## Correctness Properties

### Universal Invariants

```java
// Property 1: Payment Idempotency
// For all payments p1, p2 with same idempotency key and tenant:
// If params(p1) == params(p2), then result(p1) == result(p2)
∀ p1, p2 ∈ Payments:
  (p1.idempotencyKey === p2.idempotencyKey ∧ 
   p1.tenantId === p2.tenantId ∧
   params(p1) === params(p2)) ⟹ 
  result(p1) === result(p2)

// Property 2: Tenant Isolation
// For all operations, data is scoped to tenant:
∀ operation, tenant1, tenant2:
  (tenant1 ≠ tenant2) ⟹ 
  data(operation, tenant1) ∩ data(operation, tenant2) = ∅

// Property 3: Payment Status Transitions
// Payment status follows valid state machine:
∀ payment ∈ Payments:
  validTransition(payment.previousStatus, payment.currentStatus)

// Valid transitions:
// pending → processing → succeeded
// pending → processing → failed
// pending → requires_action → processing → succeeded
// pending → canceled
// requires_action → canceled

// Property 4: Refund Amount Constraint
// Total refunded amount never exceeds payment amount:
∀ payment ∈ Payments:
  sum(refunds.where(status === 'succeeded').amount) ≤ payment.amount

// Property 5: Webhook Delivery Guarantee
// For all terminal payment states, webhook is enqueued:
∀ payment ∈ Payments:
  (payment.status ∈ {succeeded, failed, canceled}) ⟹
  ∃ webhook ∈ WebhookLogs: webhook.paymentId === payment.id

// Property 6: Processor ID Uniqueness
// Processor payment IDs are unique within processor type:
∀ p1, p2 ∈ Payments:
  (p1.processorType === p2.processorType ∧
   p1.processorPaymentId === p2.processorPaymentId ∧
   p1.processorPaymentId ≠ null) ⟹
  p1.id === p2.id

// Property 7: Payment Method Ownership
// Payment methods belong to exactly one tenant:
∀ pm ∈ PaymentMethods:
  ∃! tenant ∈ Tenants: pm.tenantId === tenant.id

// Property 8: Webhook Retry Exponential Backoff
// Retry delays follow exponential backoff pattern:
∀ delivery ∈ WebhookDeliveries:
  (delivery.attemptNumber > 1) ⟹
  delivery.nextRetryAt > delivery.attemptedAt + backoff(delivery.attemptNumber)

// Property 9: Idempotency Key Expiration
// Idempotency keys expire after 24 hours:
∀ payment ∈ Payments:
  (now() - payment.createdAt > 24 hours) ⟹
  canReuseIdempotencyKey(payment.idempotencyKey)

// Property 10: BigDecimal Precision
// All monetary amounts use BigDecimal with exact precision:
∀ payment ∈ Payments:
  payment.amount instanceof BigDecimal ∧
  payment.amount.scale() >= 2
```

### Functional Properties

```java
// Property 11: Payment Creation Atomicity
// Payment creation is atomic - either fully succeeds or fully fails
@Transactional
public PaymentResponse createPayment(UUID tenantId, CreatePaymentRequest request) {
    // Either:
    // 1. Payment record created AND processor called AND status updated
    // OR
    // 2. No payment record created (rollback on error)
    
    // Never: Payment record created but processor not called
}

// Property 12: Refund Calculation Correctness
// Refundable amount is always accurate
public BigDecimal calculateRefundableAmount(UUID paymentId) {
    Payment payment = getPayment(paymentId);
    List<Refund> successfulRefunds = getRefunds(paymentId)
        .stream()
        .filter(r -> r.getStatus() == RefundStatus.SUCCEEDED)
        .toList();
    
    BigDecimal totalRefunded = successfulRefunds.stream()
        .map(Refund::getAmount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    
    BigDecimal refundable = payment.getAmount().subtract(totalRefunded);
    
    // Invariant: refundable >= 0
    assert refundable.compareTo(BigDecimal.ZERO) >= 0;
    
    return refundable;
}

// Property 13: Webhook Signature Verification
// All webhook signatures are cryptographically verified
public boolean verifyWebhookSignature(String payload, String signature, String secret) {
    String expectedSignature = generateHmacSha256(payload, secret);
    return MessageDigest.isEqual(
        signature.getBytes(StandardCharsets.UTF_8),
        expectedSignature.getBytes(StandardCharsets.UTF_8)
    );
}

// Property 14: No Floating-Point Errors
// All monetary calculations use BigDecimal
public BigDecimal calculateTotal(List<BigDecimal> amounts) {
    return amounts.stream()
        .reduce(BigDecimal.ZERO, BigDecimal::add);
    
    // Never use: double total = amounts.stream().mapToDouble(a -> a).sum();
}
```

## Testing Strategy

### Unit Testing

```java
@ExtendWith(MockitoExtension.class)
class PaymentServiceImplTest {
    @Mock
    private PaymentRepository paymentRepository;
    
    @Mock
    private ProcessorFactory processorFactory;
    
    @Mock
    private EventPublisher eventPublisher;
    
    @InjectMocks
    private PaymentServiceImpl paymentService;
    
    @Test
    void shouldCreatePaymentSuccessfully() {
        // Given
        UUID tenantId = UUID.randomUUID();
        CreatePaymentRequest request = CreatePaymentRequest.builder()
            .idempotencyKey("test-key")
            .amount(new BigDecimal("100.00"))
            .currency("USD")
            .customerEmail("test@example.com")
            .customerName("Test User")
            .build();
        
        Payment payment = new Payment();
        payment.setId(UUID.randomUUID());
        payment.setStatus(PaymentStatus.SUCCEEDED);
        
        when(paymentRepository.save(any(Payment.class))).thenReturn(payment);
        
        // When
        PaymentResponse response = paymentService.createPayment(tenantId, request);
        
        // Then
        assertNotNull(response);
        assertEquals(PaymentStatus.SUCCEEDED, response.getStatus());
        verify(eventPublisher).publish(any(PaymentEvent.class));
    }
}
```

### Property-Based Testing

```java
@Property
void paymentAmountAlwaysPositive(@ForAll @Positive BigDecimal amount) {
    // Property: Payment amounts must always be positive
    CreatePaymentRequest request = CreatePaymentRequest.builder()
        .amount(amount)
        .currency("USD")
        .build();
    
    assertTrue(request.getAmount().compareTo(BigDecimal.ZERO) > 0);
}

@Property
void refundNeverExceedsPaymentAmount(
        @ForAll @Positive BigDecimal paymentAmount,
        @ForAll @Positive BigDecimal refundAmount) {
    
    // Property: Refund amount cannot exceed payment amount
    if (refundAmount.compareTo(paymentAmount) > 0) {
        assertThrows(InvalidRefundException.class, () -> {
            refundService.createRefund(tenantId, CreateRefundRequest.builder()
                .paymentId(paymentId)
                .amount(refundAmount)
                .build());
        });
    }
}

@Property
void idempotencyKeyReturnsConsistentResults(
        @ForAll("validPaymentRequests") CreatePaymentRequest request) {
    
    // Property: Same idempotency key returns same result
    PaymentResponse response1 = paymentService.createPayment(tenantId, request);
    PaymentResponse response2 = paymentService.createPayment(tenantId, request);
    
    assertEquals(response1.getId(), response2.getId());
    assertEquals(response1.getStatus(), response2.getStatus());
}
```

### Integration Testing

```java
@SpringBootTest
@Testcontainers
class PaymentIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:15");
    
    @Autowired
    private PaymentService paymentService;
    
    @Test
    void shouldProcessPaymentEndToEnd() {
        // Test complete payment flow with real database
        UUID tenantId = createTestTenant();
        
        CreatePaymentRequest request = CreatePaymentRequest.builder()
            .idempotencyKey(UUID.randomUUID().toString())
            .amount(new BigDecimal("50.00"))
            .currency("USD")
            .customerEmail("integration@test.com")
            .customerName("Integration Test")
            .build();
        
        PaymentResponse response = paymentService.createPayment(tenantId, request);
        
        assertNotNull(response.getId());
        assertEquals(PaymentStatus.SUCCEEDED, response.getStatus());
    }
}
```

## Deployment Considerations

### Docker Configuration

```dockerfile
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

COPY target/payment-service-*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      containers:
      - name: payment-service
        image: payment-service:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: payment-secrets
              key: database-url
        - name: STRIPE_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: payment-secrets
              key: stripe-secret-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 20
          periodSeconds: 5
```

## Summary

The Payment Service is designed as a secure, scalable, multi-tenant payment processing platform built with Spring Boot/Java. Key design decisions include:

1. **Spring Boot/Java**: Chosen for financial transaction integrity, type safety, and long-term stability
2. **BigDecimal**: All monetary amounts use BigDecimal for exact decimal arithmetic
3. **Interface-Based Architecture**: Clear separation between interfaces and implementations
4. **Processor Abstraction**: Strategy pattern enables support for multiple payment processors
5. **Idempotent Operations**: All payment operations support safe retries
6. **Event-Driven Webhooks**: Asynchronous notification system with retry logic
7. **Multi-Tenant Isolation**: Complete data isolation between client projects
8. **Comprehensive Testing**: Unit, property-based, and integration tests

The service is production-ready and designed to operate reliably for 10+ years with minimal maintenance.
