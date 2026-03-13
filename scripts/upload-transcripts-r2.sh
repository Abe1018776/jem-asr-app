#!/bin/bash
# Upload all transcript .doc files to R2 bucket jem-asr-audio/transcripts/
# Uses --remote flag to upload to actual R2, not local emulator.

BUCKET="jem-asr-audio"
BASE="tmp-audio/transcripts"
FAILED=0
UPLOADED=0

# Count total files
TOTAL=$(ls "$BASE"/* 2>/dev/null | wc -l)
echo "=== Uploading $TOTAL transcript files to R2 ==="
echo ""

COUNT=0
for file in "$BASE"/*; do
  [ -f "$file" ] || continue
  COUNT=$((COUNT+1))
  name=$(basename "$file")
  echo "  [$COUNT/$TOTAL] $name"
  if npx wrangler r2 object put "$BUCKET/transcripts/$name" --file "$file" --content-type "application/msword" --remote > /dev/null 2>&1; then
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
echo "Total:    $TOTAL"
