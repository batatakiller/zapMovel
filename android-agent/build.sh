#!/usr/bin/env bash
# Compila e assina o APK do agente sem gradle nem Android Studio.
# Cadeia: aapt2 (recursos) -> javac (classes) -> d8 (dex) -> apksigner.
set -euo pipefail

SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
KEYSTORE="$HERE/debug.keystore"

for f in "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$PLATFORM"; do
  [ -e "$f" ] || { echo "não encontrei $f — instale o SDK (veja README)"; exit 1; }
done

rm -rf "$OUT"; mkdir -p "$OUT/classes" "$OUT/dex"

# O keystore de depuração é gerado uma vez e reaproveitado. Trocar de keystore
# entre versões faria o Android recusar a atualização por assinatura diferente.
if [ ! -f "$KEYSTORE" ]; then
  echo "==> gerando keystore de depuração"
  keytool -genkeypair -keystore "$KEYSTORE" -alias zapmovel -storepass android \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=ZapMovel Agent, OU=dev, O=ZapMovel, L=, S=, C=BR" 2>/dev/null
fi

echo "==> recursos"
mkdir -p "$OUT/gen"
# compila res/ antes: o manifest referencia @xml/network_security_config, e sem
# os recursos compilados o link falha por referência não resolvida
"$BT/aapt2" compile --dir "$HERE/src/main/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$PLATFORM" -R "$OUT/res.zip" \
  --manifest "$HERE/src/main/AndroidManifest.xml" \
  --min-sdk-version 26 --target-sdk-version 35 \
  --java "$OUT/gen"

echo "==> compilando java"
find "$HERE/src/main/java" -name '*.java' > "$OUT/sources.txt"
# Sem -bootclasspath: o javac moderno o recusa junto com -target 17. O android.jar
# entra só no classpath, o que basta — as classes java.* são resolvidas no
# aparelho, e qualquer API que não exista no Android quebraria no d8 logo abaixo.
javac -nowarn -source 17 -target 17 \
  -classpath "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt"

echo "==> dex"
"$BT/d8" --min-api 26 --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class') --lib "$PLATFORM"

echo "==> montando apk"
cd "$OUT" && cp base.apk unsigned.apk && cd dex && zip -q ../unsigned.apk classes.dex && cd ..

echo "==> alinhando e assinando"
"$BT/zipalign" -f 4 unsigned.apk aligned.apk
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/zapmovel-agent.apk" aligned.apk

echo
echo "APK pronto: $OUT/zapmovel-agent.apk"
echo "Instalar:   adb install -r $OUT/zapmovel-agent.apk"
