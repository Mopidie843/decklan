#!/usr/bin/env bash
# Build APK sans Gradle : aapt2 + javac + dx + zipalign + apksigner.
# Usage : scripts/build-apk.sh <android.jar> <sortie.apk>
set -euo pipefail
JAR=${1:?android.jar (API 34) requis}; OUT=${2:-DeckLan.apk}
A="$(cd "$(dirname "$0")/../android" && pwd)"; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
DX=/usr/lib/android-sdk/build-tools/debian/dx; command -v dx >/dev/null && DX=dx
mkdir -p "$W/res" "$W/gen" "$W/cls" "$W/dex"
aapt2 compile --dir "$A/app/src/main/res" -o "$W/res.zip"
sed 's#<manifest #<manifest package="app.decklan" #' "$A/app/src/main/AndroidManifest.xml" > "$W/AndroidManifest.xml"
aapt2 link -o "$W/base.apk" -I "$JAR" --manifest "$W/AndroidManifest.xml" \
  --min-sdk-version 21 --target-sdk-version 34 --version-code 1 --version-name 1.0 \
  --java "$W/gen" "$W/res.zip"
javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -d "$W/cls" "$W"/gen/app/decklan/R.java "$A"/app/src/main/java/app/decklan/*.java 2>&1 | grep -v "^Picked\|warning" || true
"$DX" --dex --output="$W/dex/classes.dex" "$W/cls" 2>&1 | grep -v "^Picked" || true
cp "$W/base.apk" "$W/app.apk"; (cd "$W/dex" && zip -q -j "$W/app.apk" classes.dex)
zipalign -f 4 "$W/app.apk" "$W/aligned.apk"
KS="${DECKLAN_KEYSTORE:-$HOME/.decklan-debug.jks}"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass decklan -keypass decklan -alias decklan \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=DeckLan" 2>/dev/null
apksigner sign --ks "$KS" --ks-pass pass:decklan --key-pass pass:decklan --out "$OUT" "$W/aligned.apk"
apksigner verify "$OUT" && echo "OK $OUT"
