#!/usr/bin/env bash
# Usage: ./unzip_overwrite.sh archive.zip [output_dir]
set -e

ZIP="$1"
OUT="${2:-${ZIP%.*}_extracted}"

if [ -z "$ZIP" ]; then
  echo "Usage: $0 archive.zip [output_dir]"
  exit 1
fi
if [ ! -f "$ZIP" ]; then
  echo "Archive not found: $ZIP"
  exit 2
fi

mkdir -p "$OUT"
# -o : overwrite existing files without prompting
unzip -o "$ZIP" -d "$OUT"
echo "Extracted to: $OUT (existing files overwritten)"
