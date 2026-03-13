#!/bin/bash
# Upload all audio files to R2 bucket jem-asr-audio
# Benchmark files → benchmark/ prefix
# Training files → training/ prefix

BUCKET="jem-asr-audio"
BASE="tmp-audio"
FAILED=0
UPLOADED=0
SKIPPED=0

echo "=== Uploading benchmark files ==="
for file in "$BASE/benchmark/"*.mp3; do
  name=$(basename "$file")
  echo "  [$((UPLOADED+SKIPPED+1))] $name"
  if npx wrangler r2 object put "$BUCKET/benchmark/$name" --file "$file" --content-type "audio/mpeg" --remote > /dev/null 2>&1; then
    UPLOADED=$((UPLOADED+1))
  else
    echo "    FAILED: $name"
    FAILED=$((FAILED+1))
  fi
done

echo ""
echo "=== Uploading training files ==="
TOTAL=$(ls "$BASE/training/"*.mp3 2>/dev/null | wc -l)
COUNT=0
for file in "$BASE/training/"*.mp3; do
  COUNT=$((COUNT+1))
  name=$(basename "$file")
  echo "  [$COUNT/$TOTAL] $name"
  if npx wrangler r2 object put "$BUCKET/training/$name" --file "$file" --content-type "audio/mpeg" --remote > /dev/null 2>&1; then
    UPLOADED=$((UPLOADED+1))
  else
    echo "    FAILED: $name"
    FAILED=$((FAILED+1))
  fi
done

echo ""
echo "=== Done ==="
echo "Uploaded: $UPLOADED"
echo "Failed:   $FAILED"
