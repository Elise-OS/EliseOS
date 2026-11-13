#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: build-minipc-installer.sh VERSION OUTPUT.iso}"
OUTPUT="${2:?Usage: build-minipc-installer.sh VERSION OUTPUT.iso}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO_NAME="${UBUNTU_ISO_NAME:-ubuntu-24.04.5-live-server-amd64.iso}"
ISO_BASE_URL="${UBUNTU_ISO_BASE_URL:-https://releases.ubuntu.com/24.04.5}"
ISO_URL="${UBUNTU_ISO_URL:-$ISO_BASE_URL/$ISO_NAME}"
BUILD_ROOT="${ELISE_BUILD_WORKDIR:-${TMPDIR:-/tmp}}"
ISO_CACHE="${UBUNTU_ISO_CACHE:-$BUILD_ROOT/$ISO_NAME}"
UBUNTU_KEYRING="${UBUNTU_KEYRING:-/usr/share/keyrings/ubuntu-archive-keyring.gpg}"
TEST_INSTALLER_URL="${ELISE_TEST_INSTALLER_URL:-}"
# Ubuntu's live server has Python 3.12 but no python3-pil: the installer screens bring their own
# Pillow, the same release as Ubuntu 24.04 and the CI, as the official self-contained wheel.
PILLOW_WHEEL="pillow-10.2.0-cp312-cp312-manylinux_2_28_x86_64.whl"
PILLOW_URL="https://files.pythonhosted.org/packages/5c/c6/5b6b1f7362267494a423b45af684d604491565e81436e3ebeefee68f78fd/$PILLOW_WHEEL"
PILLOW_SHA256="127cee571038f252a552760076407f9cff79761c3d436a12af6000cd182a9d04"
PILLOW_CACHE="${ELISE_PILLOW_WHEEL_CACHE:-$BUILD_ROOT/$PILLOW_WHEEL}"
# The app's QR code during the install: pure-Python qrcode, no dependency, also SHA-256 pinned.
QRCODE_WHEEL="qrcode-8.2-py3-none-any.whl"
QRCODE_URL="https://files.pythonhosted.org/packages/dd/b8/d2d6d731733f51684bbf76bf34dab3b70a9148e8f2cef2bb544fccec681a/$QRCODE_WHEEL"
QRCODE_SHA256="16e64e0716c14960108e85d853062c9e8bba5ca8252c0b4d0231b9df4060ff4f"
QRCODE_CACHE="${ELISE_QRCODE_WHEEL_CACHE:-$BUILD_ROOT/$QRCODE_WHEEL}"

for command in curl gpgv sha256sum xorriso rsync tar python3; do
  command -v "$command" >/dev/null || { echo "Missing build dependency: $command" >&2; exit 1; }
done
[[ -r "$UBUNTU_KEYRING" ]] || { echo "Ubuntu archive keyring not found: $UBUNTU_KEYRING" >&2; exit 1; }
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version must look like v0.1.27" >&2; exit 1; }
[[ "$OUTPUT" == *.iso ]] || { echo "Output must end in .iso" >&2; exit 1; }
[[ -z "$TEST_INSTALLER_URL" || "$TEST_INSTALLER_URL" == https://* ]] \
  || { echo "ELISE_TEST_INSTALLER_URL must use HTTPS" >&2; exit 1; }

mkdir -p "$BUILD_ROOT" "$(dirname "$OUTPUT")" "$(dirname "$ISO_CACHE")"
work_dir="$(mktemp -d "$BUILD_ROOT/elise-minipc-iso-XXXXXXXX")"
cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

echo "→ Verifying Ubuntu's signed checksum list"
curl -fL --retry 3 "$ISO_BASE_URL/SHA256SUMS" -o "$work_dir/SHA256SUMS"
curl -fL --retry 3 "$ISO_BASE_URL/SHA256SUMS.gpg" -o "$work_dir/SHA256SUMS.gpg"
gpgv --keyring "$UBUNTU_KEYRING" "$work_dir/SHA256SUMS.gpg" "$work_dir/SHA256SUMS"
expected_sha="$(awk -v name="$ISO_NAME" '$2 == "*" name || $2 == name {print $1}' "$work_dir/SHA256SUMS")"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "$ISO_NAME is absent from signed SHA256SUMS" >&2; exit 1; }

if [[ ! -f "$ISO_CACHE" ]] || ! echo "$expected_sha  $ISO_CACHE" | sha256sum -c - >/dev/null 2>&1; then
  echo "→ Downloading Ubuntu Server 24.04 LTS AMD64"
  rm -f -- "$ISO_CACHE.part"
  curl -fL --retry 3 "$ISO_URL" -o "$ISO_CACHE.part"
  echo "$expected_sha  $ISO_CACHE.part" | sha256sum -c -
  mv "$ISO_CACHE.part" "$ISO_CACHE"
else
  echo "→ Reusing verified Ubuntu ISO cache"
fi
echo "$expected_sha  $ISO_CACHE" | sha256sum -c -

payload="$work_dir/payload"
bootstrap="$work_dir/bootstrap"
mkdir -p "$payload/nocloud" \
  "$bootstrap/usr/share/elise/runtime" "$bootstrap/usr/share/elise" \
  "$bootstrap/usr/lib/elise" "$bootstrap/etc/elise" "$bootstrap/etc/systemd/system" \
  "$bootstrap/var/lib/elise"

echo "→ Preparing the signed-release first-boot bootstrap"
rsync -a "$ROOT_DIR/appliance/" "$bootstrap/usr/share/elise/runtime/appliance/"
install -m 0600 "$ROOT_DIR/.env.example" "$bootstrap/etc/elise/elise.env"
sed -i 's/^ELISE_HTTP_PORT=.*/ELISE_HTTP_PORT=80/' "$bootstrap/etc/elise/elise.env"
sed -i 's|^ELISE_LOCAL_URL=.*|ELISE_LOCAL_URL=http://elise.local|' "$bootstrap/etc/elise/elise.env"
printf '%s\n' "$VERSION" > "$bootstrap/usr/share/elise/version"
if [[ -n "$TEST_INSTALLER_URL" ]]; then
  echo "→ Pinning first boot to the released test installer"
  curl -fL --retry 3 "$TEST_INSTALLER_URL" -o "$work_dir/install-elise.sh"
else
  sed "s/__ELISE_VERSION__/${VERSION}/g" "$ROOT_DIR/install/install-elise.sh" > "$work_dir/install-elise.sh"
fi
sha256sum "$work_dir/install-elise.sh" | cut -d' ' -f1 > "$bootstrap/usr/share/elise/install-elise.sha256"

install -m 0755 "$ROOT_DIR/appliance/elise-minipc-firstboot.sh" "$bootstrap/usr/lib/elise/"
install -m 0755 "$ROOT_DIR/appliance/elise-preparation.py" "$bootstrap/usr/lib/elise/"
install -m 0755 "$ROOT_DIR/appliance/elise-install-screen.py" "$bootstrap/usr/lib/elise/"
install -m 0644 "$ROOT_DIR/appliance/elise_install_state.py" "$bootstrap/usr/lib/elise/"
install -m 0644 "$ROOT_DIR/appliance/elise_install_texts.py" "$bootstrap/usr/lib/elise/"
install -m 0644 "$ROOT_DIR/appliance/elise_language.py" "$bootstrap/usr/lib/elise/"
install -m 0644 "$ROOT_DIR/appliance/systemd/elise-minipc-firstboot.service" "$bootstrap/etc/systemd/system/"
install -D -m 0644 "$ROOT_DIR/appliance/journald/90-elise.conf" "$bootstrap/etc/systemd/journald.conf.d/90-elise.conf"
install -m 0644 "$ROOT_DIR/appliance/systemd/elise-preparation.service" "$bootstrap/etc/systemd/system/"
install -m 0644 "$ROOT_DIR/appliance/systemd/elise-install-screen.service" "$bootstrap/etc/systemd/system/"

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -czf "$payload/nocloud/elise-bootstrap.tar.gz" -C "$bootstrap" .
install -m 0644 "$ROOT_DIR/appliance/minipc-installer/user-data" "$payload/nocloud/user-data"
install -m 0644 "$ROOT_DIR/appliance/minipc-installer/meta-data" "$payload/nocloud/meta-data"
install -m 0755 "$ROOT_DIR/appliance/minipc-installer/select-target.py" "$payload/nocloud/select-target.py"
install -m 0755 "$ROOT_DIR/appliance/minipc-installer/install-target.sh" "$payload/nocloud/install-target.sh"
install -m 0755 "$ROOT_DIR/appliance/minipc-installer/report-failure.py" "$payload/nocloud/report-failure.py"
rsync -a --exclude='__pycache__' --exclude='*.pyc' "$ROOT_DIR/appliance/installer_ui" "$payload/nocloud/"
printf '%s\n' "$VERSION" > "$payload/nocloud/installer_ui/VERSION"

echo "→ Adding the installer screens' drawing engine (the TV screen's) and Pillow"
engine="$payload/nocloud/installer_ui/engine"
mkdir -p "$engine/fonts"
for file in elise-install-screen.py elise_install_state.py elise_install_texts.py elise_language.py elise-logo.png; do
  install -m 0644 "$ROOT_DIR/appliance/$file" "$engine/"
done
rsync -a "$ROOT_DIR/appliance/fonts/" "$engine/fonts/"
if [[ ! -f "$PILLOW_CACHE" ]] || ! echo "$PILLOW_SHA256  $PILLOW_CACHE" | sha256sum -c - >/dev/null 2>&1; then
  rm -f -- "$PILLOW_CACHE.part"
  curl -fL --retry 3 "$PILLOW_URL" -o "$PILLOW_CACHE.part"
  echo "$PILLOW_SHA256  $PILLOW_CACHE.part" | sha256sum -c -
  mv "$PILLOW_CACHE.part" "$PILLOW_CACHE"
fi
echo "$PILLOW_SHA256  $PILLOW_CACHE" | sha256sum -c -
mkdir -p "$payload/nocloud/vendor"
python3 -m zipfile -e "$PILLOW_CACHE" "$payload/nocloud/vendor/"
if [[ ! -f "$QRCODE_CACHE" ]] || ! echo "$QRCODE_SHA256  $QRCODE_CACHE" | sha256sum -c - >/dev/null 2>&1; then
  rm -f -- "$QRCODE_CACHE.part"
  curl -fL --retry 3 "$QRCODE_URL" -o "$QRCODE_CACHE.part"
  echo "$QRCODE_SHA256  $QRCODE_CACHE.part" | sha256sum -c -
  mv "$QRCODE_CACHE.part" "$QRCODE_CACHE"
fi
echo "$QRCODE_SHA256  $QRCODE_CACHE" | sha256sum -c -
python3 -m zipfile -e "$QRCODE_CACHE" "$payload/nocloud/vendor/"

echo "→ Adding automatic NoCloud boot parameters"
for config in grub.cfg loopback.cfg; do
  xorriso -osirrox on -indev "$ISO_CACHE" -extract "/boot/grub/$config" "$work_dir/$config" >/dev/null 2>&1
  chmod u+w "$work_dir/$config"
  python3 - "$work_dir/$config" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
lines = []
changed = 0
for line in text.splitlines(keepends=True):
    if re.match(r"^\s*linux\s+", line) and "autoinstall" not in line:
        marker = " ---"
        # nomodeset: the installer keeps the firmware's picture from start to finish. Without it the
        # graphics driver changes the mode a few seconds in, and a TV behind a DisplayPort adapter
        # (HP G4 Mini) loses the signal until the cable is replugged. Only the USB stick boots so.
        argument = r" autoinstall ds=nocloud\;s=/cdrom/nocloud/ nomodeset console=tty0 console=ttyS0,115200n8"
        line = line.replace(marker, argument + marker, 1) if marker in line else line.rstrip("\n") + argument + "\n"
        changed += 1
    if re.match(r"^\s*set\s+timeout=", line):
        line = re.sub(r"timeout=.*", "timeout=3", line)
    lines.append(line)
if not changed:
    raise SystemExit(f"no Linux boot entry found in {path}")
path.write_text("".join(lines), encoding="utf-8")
PY
done

volume_uuid="$(xorriso -indev "$ISO_CACHE" -pvd_info 2>/dev/null | awk '$1 == "Creation" && $2 == "Time:" {print $3; exit}')"
[[ "$volume_uuid" =~ ^[0-9]{16}$ ]] || { echo "Cannot read Ubuntu ISO creation time" >&2; exit 1; }

echo "→ Remastering ISO without changing Ubuntu's signed boot binaries"
temporary_output="$OUTPUT.part"
rm -f -- "$temporary_output"
# Git checkouts have wall-clock mtimes. Normalize only the files we add or replace, and retain
# the official ISO's volume timestamp so two builds from the same inputs are byte-identical.
find "$payload" -exec touch -h -d '@0' {} +
touch -d '@0' "$work_dir/grub.cfg" "$work_dir/loopback.cfg"
xorriso \
  -indev "$ISO_CACHE" \
  -outdev "$temporary_output" \
  -boot_image any replay \
  -volume_date uuid "$volume_uuid" \
  -map "$payload/nocloud" /nocloud \
  -map "$work_dir/grub.cfg" /boot/grub/grub.cfg \
  -map "$work_dir/loopback.cfg" /boot/grub/loopback.cfg \
  -commit -end
mv "$temporary_output" "$OUTPUT"

echo "✓ Élise OS mini PC installer: $OUTPUT"
sha256sum "$OUTPUT"
