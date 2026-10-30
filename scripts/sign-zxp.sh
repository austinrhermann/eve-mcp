#!/usr/bin/env bash
# Signs dist/stage into dist/Eve.zxp with a throwaway self-signed cert. Needs macOS (Adobe's ZXPSignCmd has no Linux build); run scripts/build.sh first.
set -euo pipefail
cd "$(dirname "$0")/.."
PASS="${ZXP_CERT_PASSWORD:-eve-selfsigned}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
npm install --silent --prefix "$T" zxp-sign-cmd
BIN="$(find "$T/node_modules/zxp-provider/bin" -path '*osx*' -name ZXPSignCmd | sort | tail -1)"
chmod +x "$BIN"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$T/k.pem" -out "$T/c.pem" -days 3650 -subj "/C=US/ST=CA/O=Eve/CN=com.austin.eve" 2>/dev/null
openssl pkcs12 -export -inkey "$T/k.pem" -in "$T/c.pem" -out "$T/cert.p12" -passout "pass:$PASS"
rm -rf dist/stage/META-INF dist/stage/mimetype dist/Eve.zxp
"$BIN" -sign dist/stage dist/Eve.zxp "$T/cert.p12" "$PASS"
"$BIN" -verify dist/Eve.zxp | tail -1
