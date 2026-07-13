FROM eclipse-temurin:21-jdk-jammy AS java

FROM node:22-bookworm

ARG GO_VERSION=1.24.5
ARG TYPESCRIPT_VERSION=5.8.3

ENV DEBIAN_FRONTEND=noninteractive
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/local/go/bin:/home/agent/.cargo/bin:${PATH}"

COPY --from=java /opt/java/openjdk /opt/java/openjdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl wget jq git git-lfs \
    python3 python3-pip python3-venv \
    build-essential clang cmake pkg-config \
    zip unzip xz-utils zstd rsync file findutils diffutils \
  && rm -rf /var/lib/apt/lists/* \
  && git lfs install --system \
  && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz \
  && npm install --global "typescript@${TYPESCRIPT_VERSION}" @openai/codex \
  && useradd --create-home --uid 10001 --shell /bin/bash agent \
  && mkdir -p /app /runner/_work /var/lib/agent-relay \
  && chown -R agent:agent /app /runner /var/lib/agent-relay

USER agent
WORKDIR /app

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

COPY --chown=agent:agent package.json tsconfig.json ./
COPY --chown=agent:agent types ./types
COPY --chown=agent:agent src ./src
COPY --chown=agent:agent scripts ./scripts

RUN npm run build

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
