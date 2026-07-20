#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "${TMP}"' EXIT

fail() {
  printf 'docker-host.repository-safe.sh: %s\n' "$1" >&2
  exit 1
}

export DOCKER_HOST_LIBRARY_ONLY=1
source "${ROOT}/scripts/docker-host.sh"
source "${ROOT}/scripts/docker-host-debian.sh"
DOCKER_HOST_STATE_ROOT=${TMP}/state
mkdir -p "${DOCKER_HOST_STATE_ROOT}"
DOCKER_DEBIAN_CODENAME=trixie

PRIMARY=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
SUBKEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
cat > "${TMP}/valid-key.txt" <<EOF
tru::1:1:0:0:0:0:0:0:
pub:-:4096:1:1111111111111111:0:0::::::scESC::::::23::0:
fpr:::::::::${PRIMARY}:
uid:-::::0::hash::Docker Release::::::::::0:
sub:-:4096:1:2222222222222222:0:0::::::e::::::23:
fpr:::::::::${SUBKEY}:
EOF
[[ "$(docker_debian_primary_fingerprint_from_colons "${TMP}/valid-key.txt")" == "${PRIMARY}" ]] \
  || fail "valid primary key with subkey was rejected"

cat > "${TMP}/two-primary.txt" <<EOF
pub:::::::::
fpr:::::::::${PRIMARY}:
pub:::::::::
fpr:::::::::${SUBKEY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/two-primary.txt" >/dev/null; then fail "multiple primary keys were accepted"; fi
cat > "${TMP}/missing-primary-fpr.txt" <<EOF
pub:::::::::
uid:::::::::
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/missing-primary-fpr.txt" >/dev/null; then fail "missing primary fingerprint was accepted"; fi
cat > "${TMP}/duplicate-primary-fpr.txt" <<EOF
pub:::::::::
fpr:::::::::${PRIMARY}:
fpr:::::::::${PRIMARY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/duplicate-primary-fpr.txt" >/dev/null; then fail "duplicate primary fingerprint was accepted"; fi
cat > "${TMP}/sub-before-primary.txt" <<EOF
sub:::::::::
fpr:::::::::${SUBKEY}:
pub:::::::::
fpr:::::::::${PRIMARY}:
EOF
if docker_debian_primary_fingerprint_from_colons "${TMP}/sub-before-primary.txt" >/dev/null; then fail "subkey before primary key was accepted"; fi

: > "${TMP}/audit"
printf '%s\n' 'docker-ce|ii |1.0' 'old-package|rc |0.1' > "${TMP}/packages"
docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages" || fail "clean dpkg state was rejected"
printf 'pending configuration\n' > "${TMP}/audit"
if docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages"; then fail "dpkg audit output was ignored"; fi
: > "${TMP}/audit"
printf 'broken|iF |1.0\n' > "${TMP}/packages"
if docker_debian_dpkg_state_clean "${TMP}/audit" "${TMP}/packages"; then fail "broken dpkg state was accepted"; fi

printf 'sl\n' > "${TMP}/requested"
printf '%s\n' sl libncurses6 > "${TMP}/allowed"
printf '%s\n' 'base-files|ii |13' > "${TMP}/installed"
docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-new-dependency.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted" \
  || fail "approved dependency closure was rejected"
printf 'libncurses6|ii |old\n' > "${TMP}/installed"
if docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-new-dependency.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted"; then
  fail "installed dependency modification was accepted"
fi
printf '%s\n' sl libncurses6 unrelated-agent > "${TMP}/allowed"
: > "${TMP}/installed"
if docker_debian_parse_simulation \
  "${ROOT}/test-system/fixtures/apt-simulation-unrelated-package.txt" \
  "${TMP}/requested" "${TMP}/allowed" "${TMP}/installed" "${TMP}/accepted"; then
  fail "unrelated package installation was accepted"
fi

for path in "${ROOT}/scripts/docker-host.sh" "${ROOT}/scripts/docker-host-debian.sh"; do
  ! grep -Eqi 'data-root|/var/lib/docker|/var/lib/containerd|daemon\.json|containerd/config\.toml|\brsync\b' "${path}" \
    || fail "forbidden Docker state migration or configuration logic found in ${path}"
done

grep -Fq '/usr/bin/docker|--version|' "${ROOT}/scripts/docker-host.sh" || fail "supported daemon-independent Docker CLI probe is missing"
! grep -Fq 'version|--client' "${ROOT}/scripts/docker-host.sh" || fail "unsupported docker version --client probe remains"
grep -Fq 'GNUPGHOME="${home}"' "${ROOT}/scripts/docker-host-debian.sh" || fail "isolated GnuPG home is missing"
grep -Fq 'docker_debian_recover_key_stage' "${ROOT}/scripts/docker-host-debian.sh" || fail "managed key recovery is missing"
grep -Fq 'docker_debian_recover_source_stage' "${ROOT}/scripts/docker-host-debian.sh" || fail "managed source recovery is missing"
grep -Fq 'docker_debian_candidate_is_unambiguously_official' "${ROOT}/scripts/docker-host-debian.sh" || fail "candidate-origin validation is missing"

printf 'Docker key/package diagnostics passed\n'