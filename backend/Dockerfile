FROM rust:1 AS builder

WORKDIR /app

COPY Cargo.toml .
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

RUN useradd -m appuser

COPY --from=builder /app/target/release/backend .

USER appuser

EXPOSE 8080

CMD ["./backend"]