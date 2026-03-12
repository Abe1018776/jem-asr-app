#!/usr/bin/env node
/**
 * Download files from Google Drive using a service account or API key.
 * Since we don't have credentials set up, this script opens the browser
 * for manual download of each file and then uploads to R2.
 *
 * Usage: node scripts/download-drive.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BENCHMARK_FILES = [
  { name: '0015--5711-Tamuz 12 Sicha 1.mp3', id: '1T2ZO1beQY_1djomoEZjCRqvZuNhhKAVY' },
  { name: '0142--5715-Tamuz 13d Sicha 3.mp3', id: '1Y4FKItmdHdWkH8i3KM2yd5okAMoi_5XI' },
  { name: '2781--5741-Nissan 11e Mamar.mp3', id: '1uYuJzCX8I6plFC9WYr7Acf8o_Fd3WUpT' },
  { name: '0003--5711-Shvat 10c Mamar.mp3', id: '1weJBOCJTTCFX6umi-pwyHW35EbY8XLXP' },
  { name: '2925--5742-Kislev 19 Sicha 1.mp3', id: '1RqlRVYPHSoIQhqgFeI_d9jZSYpHamr30' },
];

const DOWNLOAD_DIR = path.join(__dirname, '..', 'tmp-audio', 'benchmark');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Check which files already exist and are valid audio
const pending = [];
for (const f of BENCHMARK_FILES) {
  const filepath = path.join(DOWNLOAD_DIR, f.name);
  if (fs.existsSync(filepath)) {
    const content = fs.readFileSync(filepath, { encoding: null });
    // Check if it starts with ID3 (mp3) or is actual audio
    if (content[0] === 0x49 && content[1] === 0x44 && content[2] === 0x33) {
      console.log(`✓ ${f.name} already downloaded (${(content.length / 1024 / 1024).toFixed(1)}MB)`);
      continue;
    } else if (content[0] === 0xFF && (content[1] & 0xE0) === 0xE0) {
      console.log(`✓ ${f.name} already downloaded (${(content.length / 1024 / 1024).toFixed(1)}MB)`);
      continue;
    }
  }
  pending.push(f);
}

if (pending.length === 0) {
  console.log('\nAll benchmark files already downloaded! Uploading to R2...');
  uploadToR2();
} else {
  console.log(`\n${pending.length} files need manual download.`);
  console.log('Opening each in Chrome - save them to:');
  console.log(DOWNLOAD_DIR);
  console.log('');

  for (const f of pending) {
    const url = `https://drive.google.com/uc?export=download&id=${f.id}`;
    console.log(`→ ${f.name}`);
    console.log(`  ${url}`);
    try {
      execSync(`start chrome "${url}"`, { stdio: 'ignore' });
    } catch (e) {}
  }

  console.log('\nAfter downloading all files, run this script again to upload to R2.');
}

function uploadToR2() {
  console.log('\nUploading benchmark files to R2 bucket jem-asr-audio...');
  for (const f of BENCHMARK_FILES) {
    const filepath = path.join(DOWNLOAD_DIR, f.name);
    if (!fs.existsSync(filepath)) {
      console.log(`✗ Missing: ${f.name}`);
      continue;
    }
    const r2Key = `benchmark/${f.name}`;
    try {
      execSync(`wrangler r2 object put "jem-asr-audio/${r2Key}" --file "${filepath}" --content-type "audio/mpeg"`, { stdio: 'pipe' });
      console.log(`✓ Uploaded: ${r2Key}`);
    } catch (e) {
      console.log(`✗ Failed: ${r2Key} - ${e.message}`);
    }
  }
  console.log('\nDone! Benchmark audio files are in R2.');
}
