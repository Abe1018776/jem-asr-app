#!/bin/bash
# Download all 423 training files from Google Drive and upload to R2
# Uses rclone OAuth token for Google Drive API auth

RCLONE="/c/Users/chezk/AppData/Local/Microsoft/WinGet/Packages/Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe/rclone-v1.73.2-windows-amd64/rclone.exe"
PROJECT_DIR="/c/Users/chezk/jem-asr-app"
BENCHMARK_DIR="$PROJECT_DIR/tmp-audio/benchmark"
TRAINING_DIR="$PROJECT_DIR/tmp-audio/training"

mkdir -p "$TRAINING_DIR"

# Get OAuth token from rclone
get_token() {
  "$RCLONE" config dump 2>/dev/null | python -c "import sys,json; d=json.load(sys.stdin); t=json.loads(d['gdrive']['token']); print(t['access_token'])"
}

TOKEN=$(get_token)

# Extract file list from data.json
node -e "
const data = require('$PROJECT_DIR/public/data.json');
const benchmarks = new Set([
  '0015--5711-Tamuz 12 Sicha 1.mp3',
  '0142--5715-Tamuz 13d Sicha 3.mp3',
  '2781--5741-Nissan 11e Mamar.mp3',
  '0003--5711-Shvat 10c Mamar.mp3',
  '2925--5742-Kislev 19 Sicha 1.mp3',
]);
const selected = data.selected || [];
for (const s of selected) {
  if (benchmarks.has(s.audioName)) continue;
  const m = s.audioLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) console.log(m[1] + '\t' + s.audioName);
}
" > "$PROJECT_DIR/tmp-audio/training-files.tsv"

TOTAL=$(wc -l < "$PROJECT_DIR/tmp-audio/training-files.tsv")
echo "=== Downloading $TOTAL training files ==="

COUNT=0
SKIP=0
FAIL=0
OK=0

while IFS=$'\t' read -r FILE_ID FILENAME; do
  COUNT=$((COUNT + 1))
  DEST="$TRAINING_DIR/$FILENAME"

  # Skip if already downloaded
  if [ -f "$DEST" ]; then
    HEADER=$(xxd -l 3 "$DEST" 2>/dev/null | awk '{print $2}')
    if [ "$HEADER" = "4944" ] || [ "$HEADER" = "ffe3" ] || [ "$HEADER" = "fff3" ] || [ "$HEADER" = "fffa" ] || [ "$HEADER" = "fffb" ]; then
      SKIP=$((SKIP + 1))
      continue
    fi
  fi

  # Refresh token every 100 files
  if [ $((COUNT % 100)) -eq 0 ]; then
    TOKEN=$(get_token)
  fi

  curl -s -L -H "Authorization: Bearer $TOKEN" \
    "https://www.googleapis.com/drive/v3/files/$FILE_ID?alt=media" \
    -o "$DEST" \
    -w "" 2>/dev/null

  # Verify
  if [ -f "$DEST" ]; then
    SIZE=$(wc -c < "$DEST")
    HEADER=$(xxd -l 4 "$DEST" 2>/dev/null | awk '{print $2}')
    if [ "$SIZE" -gt 10000 ] && [ "$HEADER" != "3c21" ]; then
      OK=$((OK + 1))
    else
      rm -f "$DEST"
      FAIL=$((FAIL + 1))
    fi
  else
    FAIL=$((FAIL + 1))
  fi

  # Progress every 20 files
  if [ $((COUNT % 20)) -eq 0 ]; then
    echo "  [$COUNT/$TOTAL] OK:$OK Skip:$SKIP Fail:$FAIL"
  fi

done < "$PROJECT_DIR/tmp-audio/training-files.tsv"

echo ""
echo "=== Download complete ==="
echo "  Downloaded: $OK"
echo "  Skipped:    $SKIP"
echo "  Failed:     $FAIL"
echo "  Total:      $TOTAL"
