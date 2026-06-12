CREATE TABLE certificates (
                              id UUID PRIMARY KEY,

                              common_name VARCHAR(255) NOT NULL,
                              subject TEXT NOT NULL,
                              issuer TEXT NOT NULL,
                              serial_number VARCHAR(128),

                              status VARCHAR(32) NOT NULL DEFAULT 'active',
                              certificate_pem TEXT,
                              fingerprint_sha256 VARCHAR(128),

                              not_before TIMESTAMPTZ,
                              expiration TIMESTAMPTZ NOT NULL,

                              san_entries TEXT[] NOT NULL DEFAULT '{}',

                              issued_by VARCHAR(255),
                              owner_service VARCHAR(255),
                              environment VARCHAR(64),

                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_certificates_common_name
    ON certificates(common_name);

CREATE INDEX idx_certificates_expiration
    ON certificates(expiration);

CREATE INDEX idx_certificates_status
    ON certificates(status);

CREATE INDEX idx_certificates_owner_service
    ON certificates(owner_service);

CREATE INDEX idx_certificates_environment
    ON certificates(environment);

CREATE INDEX idx_certificates_san_entries
    ON certificates USING GIN(san_entries);