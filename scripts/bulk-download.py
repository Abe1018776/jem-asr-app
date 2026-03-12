#!/usr/bin/env python3
"""
Bulk download audio files from Google Drive using Chrome cookies.
Downloads benchmark (5) and training (423) files, then uploads to R2.

Usage: python scripts/bulk-download.py [--benchmark] [--training] [--upload]
"""

import json
import os
import re
import sys
import time
import requests
import browser_cookie3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_JSON = os.path.join(PROJECT_DIR, "public", "data.json")
BENCHMARK_DIR = os.path.join(PROJECT_DIR, "tmp-audio", "benchmark")
TRAINING_DIR = os.path.join(PROJECT_DIR, "tmp-audio", "training")

BENCHMARK_NAMES = {
    "0015--5711-Tamuz 12 Sicha 1.mp3",
    "0142--5715-Tamuz 13d Sicha 3.mp3",
    "2781--5741-Nissan 11e Mamar.mp3",
    "0003--5711-Shvat 10c Mamar.mp3",
    "2925--5742-Kislev 19 Sicha 1.mp3",
}

def extract_drive_id(link):
    """Extract Google Drive file ID from a Drive URL."""
    m = re.search(r'/d/([a-zA-Z0-9_-]+)', link)
    if m:
        return m.group(1)
    m = re.search(r'id=([a-zA-Z0-9_-]+)', link)
    if m:
        return m.group(1)
    return None

def download_from_drive(file_id, dest_path, session, attempt=1):
    """Download a file from Google Drive using authenticated session."""
    url = f"https://drive.google.com/uc?export=download&id={file_id}"

    resp = session.get(url, stream=True, allow_redirects=True)

    # Check for virus scan warning (large files)
    if b"confirm=" in resp.content[:5000] or "download_warning" in resp.url:
        # Extract confirm token
        for key, value in resp.cookies.items():
            if key.startswith("download_warning"):
                url = f"https://drive.google.com/uc?export=download&confirm={value}&id={file_id}"
                resp = session.get(url, stream=True, allow_redirects=True)
                break
        else:
            # Try with confirm=t
            url = f"https://drive.google.com/uc?export=download&confirm=t&id={file_id}"
            resp = session.get(url, stream=True, allow_redirects=True)

    # Check if we got HTML instead of audio
    content_type = resp.headers.get("Content-Type", "")
    if "text/html" in content_type:
        # Try the confirm=t approach
        if attempt == 1:
            url = f"https://drive.google.com/uc?export=download&confirm=t&id={file_id}"
            resp = session.get(url, stream=True, allow_redirects=True)
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" in content_type:
                return False, "Got HTML response (auth or permission issue)"
        else:
            return False, "Got HTML response (auth or permission issue)"

    # Write the file
    with open(dest_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    # Verify it's actually audio (check first bytes)
    with open(dest_path, "rb") as f:
        header = f.read(4)

    if header[:3] == b"ID3" or (header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
        return True, None
    elif header[:4] == b"RIFF":  # WAV
        return True, None
    elif header[:4] == b"fLaC":  # FLAC
        return True, None
    elif header[:9] == b"<!doctype" or header[:5] == b"<html":
        os.remove(dest_path)
        return False, "Downloaded HTML instead of audio"
    else:
        # Could still be valid, keep it
        return True, f"Unknown format (header: {header.hex()})"

def get_chrome_cookies():
    """Get Chrome cookies for Google Drive."""
    try:
        cj = browser_cookie3.chrome(domain_name=".google.com")
        session = requests.Session()
        session.cookies = cj
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        })
        return session
    except Exception as e:
        print(f"Error getting Chrome cookies: {e}")
        print("Make sure Chrome is closed or try again.")
        sys.exit(1)

def main():
    args = sys.argv[1:]
    do_benchmark = "--benchmark" in args or not any(a.startswith("--") for a in args)
    do_training = "--training" in args or not any(a.startswith("--") for a in args)
    do_upload = "--upload" in args

    # Load data.json
    with open(DATA_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Build file lists
    benchmark_files = []
    training_files = []

    # Get all audio with their drive links
    audio_by_name = {}
    for a in data.get("allAudio", []):
        audio_by_name[a["name"]] = a.get("link", "")

    # Benchmark files
    if do_benchmark:
        for name in BENCHMARK_NAMES:
            link = audio_by_name.get(name, "")
            # Also check selected/matched for links
            if not link:
                for s in data.get("selected", []):
                    if s.get("audioName") == name:
                        link = s.get("audioLink", "")
                        break
            file_id = extract_drive_id(link) if link else None
            if file_id:
                benchmark_files.append({"name": name, "id": file_id})
            else:
                print(f"WARNING: No Drive ID found for benchmark file: {name}")

    # Training files (from selected 50hr)
    if do_training:
        for s in data.get("selected", []):
            name = s.get("audioName", "")
            if name in BENCHMARK_NAMES:
                continue  # Skip benchmark files
            link = s.get("audioLink", "") or audio_by_name.get(name, "")
            file_id = extract_drive_id(link) if link else None
            if file_id:
                training_files.append({"name": name, "id": file_id})
            else:
                print(f"WARNING: No Drive ID found for training file: {name}")

    print(f"\nFiles to download:")
    if do_benchmark:
        print(f"  Benchmark: {len(benchmark_files)}")
    if do_training:
        print(f"  Training:  {len(training_files)}")
    print()

    # Get Chrome session
    print("Getting Chrome cookies for Google Drive auth...")
    session = get_chrome_cookies()

    # Test auth with a small request
    test_resp = session.get("https://drive.google.com/drive/my-drive")
    if test_resp.status_code != 200 or "accounts.google.com/signin" in test_resp.url:
        print("ERROR: Not authenticated. Make sure you're signed into Google in Chrome.")
        sys.exit(1)
    print("Authenticated with Google Drive!\n")

    # Download benchmark files
    if do_benchmark and benchmark_files:
        os.makedirs(BENCHMARK_DIR, exist_ok=True)
        print(f"=== Downloading {len(benchmark_files)} benchmark files ===")
        for i, f in enumerate(benchmark_files, 1):
            dest = os.path.join(BENCHMARK_DIR, f["name"])
            if os.path.exists(dest):
                with open(dest, "rb") as fh:
                    header = fh.read(4)
                if header[:3] == b"ID3" or (header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
                    size_mb = os.path.getsize(dest) / 1024 / 1024
                    print(f"  [{i}/{len(benchmark_files)}] SKIP {f['name']} (already downloaded, {size_mb:.1f}MB)")
                    continue

            print(f"  [{i}/{len(benchmark_files)}] Downloading {f['name']}...", end=" ", flush=True)
            start = time.time()
            ok, err = download_from_drive(f["id"], dest, session)
            elapsed = time.time() - start
            if ok:
                size_mb = os.path.getsize(dest) / 1024 / 1024
                print(f"OK ({size_mb:.1f}MB, {elapsed:.1f}s)")
            else:
                print(f"FAILED: {err}")

    # Download training files
    if do_training and training_files:
        os.makedirs(TRAINING_DIR, exist_ok=True)
        print(f"\n=== Downloading {len(training_files)} training files ===")
        success = 0
        failed = 0
        skipped = 0
        for i, f in enumerate(training_files, 1):
            dest = os.path.join(TRAINING_DIR, f["name"])
            if os.path.exists(dest):
                with open(dest, "rb") as fh:
                    header = fh.read(4)
                if header[:3] == b"ID3" or (header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
                    skipped += 1
                    if i % 50 == 0:
                        print(f"  [{i}/{len(training_files)}] Progress: {success} downloaded, {skipped} skipped, {failed} failed")
                    continue

            print(f"  [{i}/{len(training_files)}] {f['name']}...", end=" ", flush=True)
            start = time.time()
            ok, err = download_from_drive(f["id"], dest, session)
            elapsed = time.time() - start
            if ok:
                size_mb = os.path.getsize(dest) / 1024 / 1024
                print(f"OK ({size_mb:.1f}MB, {elapsed:.1f}s)")
                success += 1
            else:
                print(f"FAILED: {err}")
                failed += 1

            # Small delay to avoid rate limiting
            if i % 10 == 0:
                time.sleep(1)

        print(f"\nTraining download complete: {success} downloaded, {skipped} skipped, {failed} failed")

    # Upload to R2
    if do_upload:
        print("\n=== Uploading to R2 ===")
        upload_to_r2(BENCHMARK_DIR, "benchmark")
        upload_to_r2(TRAINING_DIR, "training")

def upload_to_r2(local_dir, prefix):
    """Upload all audio files in local_dir to R2 under the given prefix."""
    import subprocess
    if not os.path.exists(local_dir):
        print(f"  Directory not found: {local_dir}")
        return

    files = [f for f in os.listdir(local_dir) if f.endswith(".mp3")]
    print(f"  Uploading {len(files)} files to jem-asr-audio/{prefix}/...")

    for i, fname in enumerate(files, 1):
        filepath = os.path.join(local_dir, fname)
        r2_key = f"jem-asr-audio/{prefix}/{fname}"
        try:
            subprocess.run(
                ["wrangler", "r2", "object", "put", r2_key, "--file", filepath, "--content-type", "audio/mpeg"],
                capture_output=True, check=True
            )
            if i % 20 == 0 or i == len(files):
                print(f"  [{i}/{len(files)}] uploaded")
        except subprocess.CalledProcessError as e:
            print(f"  FAILED: {fname} - {e.stderr.decode()}")

if __name__ == "__main__":
    main()
