FROM eclipse-temurin:21-jdk-jammy AS java

FROM node:22-bookworm

ARG GO_VERSION=1.24.5
ARG TYPESCRIPT_VERSION=5.8.3
ARG CODEX_VERSION=0.144.3
ARG USER_ID=1000
ARG GROUP_ID=1000

ENV DEBIAN_FRONTEND=noninteractive
ENV JAVA_HOME=/opt/java/openjdk
ENV CARGO_HOME=/home/agent/.cargo
ENV RUSTUP_HOME=/home/agent/.rustup
ENV PATH="/opt/java/openjdk/bin:/usr/local/go/bin:/home/agent/.cargo/bin:${PATH}"
ENV EXPECTED_CODEX_VERSION=${CODEX_VERSION}

COPY --from=java /opt/java/openjdk /opt/java/openjdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl wget jq git git-lfs sudo \
    python3 python3-pip python3-venv \
    build-essential clang cmake pkg-config \
    zip unzip xz-utils zstd rsync file findutils diffutils \
  && apt-get purge -y openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && git lfs install --system \
  && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz \
  && npm install --global "typescript@${TYPESCRIPT_VERSION}" "@openai/codex@${CODEX_VERSION}" \
  && groupadd --non-unique --gid "${GROUP_ID}" agent \
  && useradd --non-unique --create-home --uid "${USER_ID}" --gid "${GROUP_ID}" --shell /bin/bash agent \
  && groupadd --system relay \
  && useradd --system --create-home --gid relay --shell /bin/bash relay \
  && usermod --append --groups agent relay \
  && mkdir -p /app /runner/_work /var/lib/agent-relay /home/agent/.cargo /home/agent/.rustup /home/agent/.codex \
  && chown -R relay:relay /app /var/lib/agent-relay /home/relay \
  && chown -R agent:agent /runner /home/agent \
  && chmod 0700 /var/lib/agent-relay /home/agent/.codex /home/relay \
  && printf '%s\n' 'relay ALL=(agent) NOPASSWD: /usr/local/bin/codex-run' > /etc/sudoers.d/agent-relay \
  && chmod 0440 /etc/sudoers.d/agent-relay

ENV HOME=/home/agent
USER agent
WORKDIR /home/agent

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path

USER root
COPY scripts/codex-run /usr/local/bin/codex-run
RUN chown -R root:root /home/agent/.cargo /home/agent/.rustup \
  && chmod -R a-w /home/agent/.cargo /home/agent/.rustup \
  && chown root:root /usr/local/bin/codex-run \
  && chmod 0755 /usr/local/bin/codex-run

ENV HOME=/home/relay
USER relay
WORKDIR /app

COPY --chown=relay:relay package.json package-lock.json tsconfig.json ./
COPY --chown=relay:relay types ./types
COPY --chown=relay:relay src ./src
COPY --chown=relay:relay scripts ./scripts

RUN chmod +x scripts/toolchain-smoke.sh \
  && npm ci \
  && npm run build \
  && chmod -R o-rwx /app

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
