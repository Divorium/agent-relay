# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: download and install the agy CLI binary.
# Neither curl nor APT metadata leaks into the runtime image.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS installer
ARG SANDBOX_UID=1000
ARG SANDBOX_GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/sandbox

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${SANDBOX_GID}" sandbox && useradd --uid "${SANDBOX_UID}" --gid sandbox --create-home --shell /bin/bash sandbox

USER sandbox

RUN bash -o pipefail -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --skip-aliases --skip-path' \
    && test -x /home/sandbox/.local/bin/agy


# ---------------------------------------------------------------------------
# Stage 2: runtime image.
# Includes agy, a full developer toolset, GitHub CLI, and SSH.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim
ARG SANDBOX_UID=1000
ARG SANDBOX_GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp/antigravity-home \
    UE_ROOT=/ue5 \
    PATH=/usr/local/bin:/home/sandbox/.local/bin:${PATH}

# ------------------------------------------------------------------
# Baseline packages + GitHub CLI repository
# ------------------------------------------------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         > /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        # version control & GitHub
        git \
        gh \
        # network utilities
        wget \
        openssh-client \
        curl \
        iputils-ping \
        netcat-openbsd \
        dnsutils \
        # build tools
        build-essential \
        pkg-config \
        # scripting & data
        python3 \
        python3-pip \
        python3-venv \
        jq \
        # search
        ripgrep \
        # file & archive utilities
        unzip zip tar gzip bzip2 xz-utils \
        # process inspection
        procps \
        sudo \
        # editors
        nano \
        vim-tiny \
        less \
        # ----------------------------------------------------------
        # UE5 runtime & editor dependencies.
        # UE5 bundles its own clang, dotnet and OpenSSL, but its
        # binaries are dynamically linked against standard glibc and
        # system runtime libraries.
        # zlib1g / libxml2 / libuuid1 are required by UBT and UAT.
        # The remaining packages provide shared libraries (.so)
        # required for UnrealEditor-Cmd dynamic loading even when
        # running in headless / -nullrhi CLI mode.
        # ----------------------------------------------------------
        libstdc++6 \
        libgcc-s1 \
        zlib1g \
        libxml2 \
        libssl3 \
        libuuid1 \
        libglib2.0-0 \
        libnss3 \
        libnspr4 \
        libdbus-1-3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libdrm2 \
        libx11-6 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libxcb1 \
        libxkbcommon0 \
        libpango-1.0-0 \
        libcairo2 \
        libasound2 \
        libatspi2.0-0 \
        libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------
# Create sandbox user, workspace, and UE5 engine mount point
# ------------------------------------------------------------------
RUN groupadd --gid "${SANDBOX_GID}" sandbox && useradd --uid "${SANDBOX_UID}" --gid sandbox --create-home --shell /bin/bash sandbox \
    && mkdir /workspace \
    && chown sandbox:sandbox /workspace \
    && mkdir /ue5


# ------------------------------------------------------------------
# pip: allow system-wide installs inside the container (PEP 668)
# ------------------------------------------------------------------
RUN printf 'sandbox ALL=(ALL:ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/sandbox \
    && chmod 0440 /etc/sudoers.d/sandbox

RUN printf "[global]\nbreak-system-packages = true\n" > /etc/pip.conf

# ------------------------------------------------------------------
# SSH configuration for GitHub access via the mounted private key.
# The actual key file is bind-mounted at runtime as:
#   /home/sandbox/.ssh/antigravity.priv  (read-only)
# ------------------------------------------------------------------
RUN mkdir -p -m 700 /home/sandbox/.ssh \
    && chown sandbox:sandbox /home/sandbox/.ssh \
    # ssh_config.d entry: use the mounted key for GitHub (and all hosts)
    && mkdir -p /etc/ssh/ssh_config.d \
    && printf 'Host github.com\n\
    HostName github.com\n\
    User git\n\
    IdentityFile /home/sandbox/.ssh/antigravity.priv\n\
    IdentitiesOnly yes\n\
    StrictHostKeyChecking accept-new\n\
\n\
Host *\n\
    IdentityFile /home/sandbox/.ssh/antigravity.priv\n\
    StrictHostKeyChecking accept-new\n' \
         > /etc/ssh/ssh_config.d/antigravity.conf \
    # Pre-populate known_hosts with GitHub's current public host keys
    && printf 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5A9okWi0dh2l9GKJl\n\
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV00/+hrK4KrbfbfJVoLo=\n\
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr97v8Lhk9VSTWNJs35S5PbBQoRII8yQKswazMnRaEpOTvPdGU/VDxwrPmGXzk9gMkznZsZs=\n' \
         > /etc/ssh/ssh_known_hosts \
    && chmod 644 /etc/ssh/ssh_known_hosts

# ------------------------------------------------------------------
# Git system config: trust all mounted directories
# ------------------------------------------------------------------
RUN git config --system safe.directory '*' \
    && git config --system init.defaultBranch main

# ------------------------------------------------------------------
# Copy the agy binary from the installer stage
# ------------------------------------------------------------------
COPY --from=installer /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=installer --chown=${SANDBOX_UID}:${SANDBOX_GID} /home/sandbox/.local /home/sandbox/.local

# A non-root default. Docker's --user flag may override this with the host
# UID:GID so that a bind-mounted project remains writable.
LABEL com.divorium.agent-relay.antigravity="true"
USER ${SANDBOX_UID}:${SANDBOX_GID}
WORKDIR /workspace

ENTRYPOINT ["agy"]