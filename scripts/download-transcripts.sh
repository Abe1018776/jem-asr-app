#!/bin/bash
# Download all transcript .doc files from Google Drive using rclone OAuth token

RCLONE="/c/Users/chezk/AppData/Local/Microsoft/WinGet/Packages/Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe/rclone-v1.73.2-windows-amd64/rclone.exe"
BASE="tmp-audio/transcripts"
TSV="tmp-audio/transcript-files.tsv"
mkdir -p "$BASE"

get_token() {
  "$RCLONE" about gdrive: > /dev/null 2>&1
  "$RCLONE" config dump 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); t=json.loads(d['gdrive']['token']); print(t['access_token'])" 2>/dev/null
}

TOKEN=$(get_token)
if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not get OAuth token"
  exit 1
fi

TOTAL=$(wc -l < "$TSV")
COUNT=0
FAILED=0
SKIPPED=0
DOWNLOADED=0

echo "=== Downloading $TOTAL transcript files ==="
while IFS=$'\t' read -r fid name; do
  name="${name%$'\r'}"
  fid="${fid%$'\r'}"
  COUNT=$((COUNT+1))

  # Skip if already downloaded
  if [ -f "$BASE/$name" ]; then
    fsize=$(wc -c < "$BASE/$name")
    if [ "$fsize" -gt 100 ]; then
      SKIPPED=$((SKIPPED+1))
      continue
    fi
  fi

  echo "  [$COUNT/$TOTAL] $name"

  curl -sk --max-time 30 \
    -H "Authorization: Bearer $TOKEN" \
    "https://www.googleapis.com/drive/v3/files/${fid}?alt=media" \
    -o "$BASE/$name" 2>/dev/null

  if [ -f "$BASE/$name" ]; then
    fsize=$(wc -c < "$BASE/$name")
    if [ "$fsize" -gt 100 ]; then
      DOWNLOADED=$((DOWNLOADED+1))
    else
      echo "    FAILED (${fsize}B): $name"
      rm -f "$BASE/$name"
      FAILED=$((FAILED+1))
    fi
  else
    echo "    FAILED (no file): $name"
    FAILED=$((FAILED+1))
  fi

  # Refresh token every 200 files
  if [ $((COUNT % 200)) -eq 0 ]; then
    TOKEN=$(get_token)
    echo "  [Token refreshed at $COUNT]"
  fi
done < "$TSV"

echo ""
echo "=== Download Complete ==="
echo "Downloaded: $DOWNLOADED"
echo "Skipped:    $SKIPPED"
echo "Failed:     $FAILED"
echo "Total:      $TOTAL"
