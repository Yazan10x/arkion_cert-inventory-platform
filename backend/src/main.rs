use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use rcgen::generate_simple_self_signed;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, FromRow)]
struct Certificate {
    id: Uuid,
    common_name: String,
    subject: String,
    issuer: String,
    serial_number: Option<String>,
    status: String,
    certificate_pem: Option<String>,
    fingerprint_sha256: Option<String>,
    not_before: Option<DateTime<Utc>>,
    expiration: DateTime<Utc>,
    san_entries: Vec<String>,
    issued_by: Option<String>,
    owner_service: Option<String>,
    environment: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct CreateCertificateRequest {
    common_name: String,
    subject: String,
    issuer: String,
    expiration: DateTime<Utc>,
    san_entries: Vec<String>,
    owner_service: Option<String>,
    environment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueCertificateRequest {
    common_name: String,
    san_entries: Vec<String>,
    owner_service: Option<String>,
    environment: Option<String>,
    validity_days: Option<i64>,
}

#[derive(Debug, Serialize)]
struct DashboardStats {
    total_certificates: i64,
    expiring_soon_30_days: i64,
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "cert-inventory-backend"
    }))
}

async fn create_certificate(
    State(pool): State<PgPool>,
    Json(body): Json<CreateCertificateRequest>,
) -> impl IntoResponse {
    let id = Uuid::new_v4();

    let cert = sqlx::query_as::<_, Certificate>(
        r#"
        INSERT INTO certificates (
            id, common_name, subject, issuer, expiration,
            san_entries, owner_service, environment
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        "#,
    )
        .bind(id)
        .bind(&body.common_name)
        .bind(&body.subject)
        .bind(&body.issuer)
        .bind(body.expiration)
        .bind(&body.san_entries)
        .bind(&body.owner_service)
        .bind(&body.environment)
        .fetch_one(&pool)
        .await;

    match cert {
        Ok(cert) => (StatusCode::CREATED, Json(cert)).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    }
}

async fn issue_certificate(
    State(pool): State<PgPool>,
    Json(body): Json<IssueCertificateRequest>,
) -> impl IntoResponse {
    let id = Uuid::new_v4();
    let now = Utc::now();
    let expiration = now + Duration::days(body.validity_days.unwrap_or(365));

    let mut san_entries = body.san_entries.clone();
    if !san_entries.contains(&body.common_name) {
        san_entries.push(body.common_name.clone());
    }

    let generated = generate_simple_self_signed(san_entries.clone());

    let cert_pem = match generated {
        Ok(certified_key) => certified_key.cert.pem(),
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    };

    let fingerprint_sha256 = hex::encode(Sha256::digest(cert_pem.as_bytes()));
    let serial_number = id.to_string();

    let subject = format!("CN={}", body.common_name);
    let issuer = "Arkion Demo Internal CA".to_string();

    let cert = sqlx::query_as::<_, Certificate>(r#"
        INSERT INTO certificates (
            id,
            common_name,
            subject,
            issuer,
            serial_number,
            status,
            certificate_pem,
            fingerprint_sha256,
            not_before,
            expiration,
            san_entries,
            issued_by,
            owner_service,
            environment
        )
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
        "#,)
        .bind(id)
        .bind(&body.common_name)
        .bind(subject)
        .bind(issuer)
        .bind(serial_number)
        .bind(cert_pem)
        .bind(fingerprint_sha256)
        .bind(now)
        .bind(expiration)
        .bind(&san_entries)
        .bind("certificate-issuer-api")
        .bind(&body.owner_service)
        .bind(&body.environment)
        .fetch_one(&pool)
        .await;

    match cert {
        Ok(cert) => (StatusCode::CREATED, Json(cert)).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    }
}

async fn get_certificate(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let cert = sqlx::query_as::<_, Certificate>(
        "SELECT * FROM certificates WHERE id = $1",
    )
        .bind(id)
        .fetch_one(&pool)
        .await;

    match cert {
        Ok(cert) => (StatusCode::OK, Json(cert)).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn list_certificates(State(pool): State<PgPool>) -> impl IntoResponse {
    match sqlx::query_as::<_, Certificate>(
        "SELECT * FROM certificates ORDER BY created_at DESC",
    )
        .fetch_all(&pool)
        .await
    {
        Ok(certs) => Json(certs).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    }
}

async fn dashboard_stats(State(pool): State<PgPool>) -> impl IntoResponse {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM certificates")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    let expiring_soon: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM certificates WHERE expiration <= NOW() + INTERVAL '30 days'",
    )
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    Json(DashboardStats {
        total_certificates: total,
        expiring_soon_30_days: expiring_soon,
    })
}

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set");

    let pool = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to postgres");

    let app = Router::new()
        .route("/health", get(health))
        .route("/certificates", get(list_certificates).post(create_certificate))
        .route("/certificates/issue", post(issue_certificate))
        .route("/certificates/stats", get(dashboard_stats))
        .route("/certificates/{id}", get(get_certificate))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("Failed to bind port 8080");

    axum::serve(listener, app).await.expect("Server failed");
}