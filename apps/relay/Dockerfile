# Build from the repository root:
#   docker build -f apps/relay/Dockerfile -t termexo-relay .
#
# The console is embedded at compile time. By default the image ships the placeholder page, so the
# relay can be built without the Node toolchain; to embed the real console, build it first and pass
# its directory:
#   npm run build:relay-console
#   docker build -f apps/relay/Dockerfile \
#     --build-arg CONSOLE_DIR=apps/desktop-ui/dist/relay-console/browser -t termexo-relay .

FROM rust:1-bookworm AS builder

WORKDIR /src
COPY crates/termexo-relay-protocol ./crates/termexo-relay-protocol
COPY apps/relay ./apps/relay

ARG CONSOLE_DIR=apps/relay/console-placeholder
COPY ${CONSOLE_DIR} ./apps/desktop-ui/dist/relay-console/browser

RUN cargo build --release --locked --manifest-path apps/relay/Cargo.toml

FROM debian:bookworm-slim

# rusqlite is built with the bundled SQLite, so only TLS roots and the C runtime are needed here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/apps/relay/target/release/termexo-relay /usr/local/bin/termexo-relay

# The database and the self-signed certificate live here; mount a volume to keep them across
# container replacements.
ENV TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
VOLUME ["/var/lib/termexo-relay"]

ENV TERMEXO_RELAY_LISTEN=0.0.0.0:8443
EXPOSE 8443

ENTRYPOINT ["termexo-relay"]
CMD ["serve"]
