#!/usr/bin/env bash
set -eo pipefail

echo "================================================================================"
echo "  KYRO FINANCE — SCRIPT DE AUDITORIA CRIPTOGRÁFICA & PREPARAÇÃO DE RELEASE"
echo "================================================================================"

# Diretórios de trabalho parametrizáveis com valores padrão
ARTIFACT_DIR="${ARTIFACT_DIR:-./downloaded-artifact}"
OUTPUT_DIR="${OUTPUT_DIR:-./verified-release}"

CONFIRM="${INPUT_CONFIRM_PROMOTION:-$CONFIRM_PROMOTION}"
RUN_ID="${INPUT_RUN_ID:-$RUN_ID}"
EXPECTED_SHA="${INPUT_EXPECTED_SHA256:-$EXPECTED_SHA256}"
TARGET_TAG="${INPUT_TARGET_TAG:-$TARGET_TAG}"

echo "--- 1. Validação Sanitizada de Entradas Manuais ---"
if [ "$CONFIRM" != "CONFIRMAR" ]; then
  echo "ERRO DE SEGURANÇA: confirm_promotion inválido. Esperado 'CONFIRMAR', recebido '$CONFIRM'."
  exit 1
fi

if ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "ERRO DE VALIDAÇÃO: run_id inválido. Deve conter estritamente dígitos numéricos. Recebido: '$RUN_ID'."
  exit 1
fi

CLEAN_SHA=$(echo "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
if ! [[ "$CLEAN_SHA" =~ ^[a-f0-9]{64}$ ]]; then
  echo "ERRO DE VALIDAÇÃO: expected_sha256 inválido. Deve ser um hash SHA-256 hexadecimal de 64 caracteres. Recebido: '$EXPECTED_SHA'."
  exit 1
fi

if ! [[ "$TARGET_TAG" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "ERRO DE VALIDAÇÃO: target_tag possui formato inválido. Recebido: '$TARGET_TAG'."
  exit 1
fi

echo "Entradas validadas com sucesso:"
echo "  RUN_ID:       $RUN_ID"
echo "  EXPECTED_SHA: $CLEAN_SHA"
echo "  TARGET_TAG:   $TARGET_TAG"

echo "--- 2. Conferência Criptográfica do APK Principal ---"
PRIMARY_APK="$ARTIFACT_DIR/KYRO-Finance.apk"
if [ ! -f "$PRIMARY_APK" ]; then
  echo "ERRO CRÍTICO: Arquivo principal KYRO-Finance.apk não encontrado em $ARTIFACT_DIR!"
  exit 1
fi

BASE_SHA=$(sha256sum "$PRIMARY_APK" | awk '{print $1}' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
echo "Calculado: $BASE_SHA"
echo "Esperado:  $CLEAN_SHA"

if [ "$BASE_SHA" != "$CLEAN_SHA" ]; then
  echo "=========================================================="
  echo "FALHA DE INTEGRIDADE: O SHA-256 do arquivo baixado diverge!"
  echo "Calculado: $BASE_SHA"
  echo "Esperado:  $CLEAN_SHA"
  echo "Operação abortada imediatamente. NENHUM arquivo foi publicado."
  echo "=========================================================="
  exit 1
fi
echo "APK principal aprovado: $PRIMARY_APK"

echo "--- 3. Validação Estrita de Arquivos Alternativos Pré-Existentes ---"
shopt -s nullglob
ALT_FILES=("$ARTIFACT_DIR"/*.apk)
shopt -u nullglob

for alt_file in "${ALT_FILES[@]}"; do
  # Binários com sufixo -debug.apk são artefatos de diagnóstico interno e não candidatos a release pública
  if [[ "$alt_file" == *"-debug.apk" ]]; then
    echo "Ignorando binário de diagnóstico interno (não-candidato a release): $alt_file"
    continue
  fi

  if [ -f "$alt_file" ]; then
    ALT_SHA=$(sha256sum "$alt_file" | awk '{print $1}' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
    if [ "$ALT_SHA" != "$CLEAN_SHA" ]; then
      echo "=========================================================="
      echo "ERRO CRÍTICO: Arquivo alternativo pré-existente $alt_file possui digest divergente!"
      echo "Arquivo:   $alt_file"
      echo "Digest:    $ALT_SHA"
      echo "Esperado:  $CLEAN_SHA"
      echo "Operação abortada imediatamente. NENHUM arquivo foi publicado."
      echo "=========================================================="
      exit 1
    fi
    echo "Arquivo alternativo validado com sucesso: $alt_file"
  fi
done

echo "--- 4. Validação Rigorosa do Manifesto de Origem ---"
MANIFEST_FILE="$ARTIFACT_DIR/build-manifest.json"
if [ ! -f "$MANIFEST_FILE" ]; then
  echo "ERRO CRÍTICO: build-manifest.json não encontrado em $ARTIFACT_DIR!"
  exit 1
fi

MANIFEST_VERSION=$(node -p "try { const m = require('$MANIFEST_FILE'); String(m.version_name || ''); } catch(e){ '' }")
MANIFEST_BUILD=$(node -p "try { const m = require('$MANIFEST_FILE'); String(m.build_code || ''); } catch(e){ '' }")

if ! [[ "$MANIFEST_VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "ERRO DE VALIDAÇÃO: version_name no manifesto possui formato inválido: '$MANIFEST_VERSION'!"
  exit 1
fi

if ! [[ "$MANIFEST_BUILD" =~ ^[0-9]+$ ]]; then
  echo "ERRO DE VALIDAÇÃO: build_code no manifesto possui formato inválido: '$MANIFEST_BUILD'!"
  exit 1
fi

echo "Manifesto validado com sucesso:"
echo "  version_name: '$MANIFEST_VERSION'"
echo "  build_code:   '$MANIFEST_BUILD'"

echo "--- 5. Preparação da Lista Explícita de Publicação ---"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

FILE_MAIN="$OUTPUT_DIR/KYRO-Finance.apk"
FILE_V="$OUTPUT_DIR/KYRO-Finance-v${MANIFEST_VERSION}.apk"
FILE_NUM="$OUTPUT_DIR/KYRO-Finance-1.${MANIFEST_BUILD}.apk"

cp "$PRIMARY_APK" "$FILE_MAIN"
cp "$PRIMARY_APK" "$FILE_V"
cp "$PRIMARY_APK" "$FILE_NUM"

EXPLICIT_LIST=("$FILE_MAIN" "$FILE_V" "$FILE_NUM")

echo "--- 6. Conferência Final da Integridade da Lista Explícita ---"
for verified_file in "${EXPLICIT_LIST[@]}"; do
  if [ ! -f "$verified_file" ]; then
    echo "ERRO: Arquivo verificado não encontrado: $verified_file"
    exit 1
  fi
  CHECK_SHA=$(sha256sum "$verified_file" | awk '{print $1}' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  if [ "$CHECK_SHA" != "$CLEAN_SHA" ]; then
    echo "FALHA CRÍTICA: Arquivo verificado $verified_file divergiu ($CHECK_SHA != $CLEAN_SHA)!"
    exit 1
  fi
  echo "APROVADO: $verified_file -> SHA-256: $CHECK_SHA"
done

echo "================================================================================"
echo "SUCESSO: Todos os arquivos da lista explícita conferem rigorosamente com o digest aprovado!"
echo "================================================================================"

# Exportação para GITHUB_ENV se estiver em ambiente GitHub Actions
if [ -n "$GITHUB_ENV" ] && [ -f "$GITHUB_ENV" ]; then
  echo "VALIDATED_RUN_ID=$RUN_ID" >> "$GITHUB_ENV"
  echo "VALIDATED_EXPECTED_SHA256=$CLEAN_SHA" >> "$GITHUB_ENV"
  echo "VALIDATED_TARGET_TAG=$TARGET_TAG" >> "$GITHUB_ENV"
  echo "VALIDATED_VERSION_NAME=$MANIFEST_VERSION" >> "$GITHUB_ENV"
  echo "VALIDATED_BUILD_CODE=$MANIFEST_BUILD" >> "$GITHUB_ENV"
  echo "VALIDATED_RELEASE_DIR=$OUTPUT_DIR" >> "$GITHUB_ENV"
fi
