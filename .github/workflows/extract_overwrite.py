#!/usr/bin/env python3
"""
Extract a .zip archive into a directory, OVERWRITING existing files.
Usage:
  ./extract_overwrite.py vipvpn-main-updated.zip [output_dir]
If output_dir exists it will be reused and files inside will be replaced.
"""
import sys
import os
import zipfile
import shutil
from pathlib import Path

def safe_extract_overwrite(zip_path: Path, out_base: str):
    out_dir = Path(out_base)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_dir_resolved = out_dir.resolve()

    with zipfile.ZipFile(zip_path, "r") as z:
        for info in z.infolist():
            name = info.filename

            # Normalize and prevent path traversal
            dest = out_dir.joinpath(Path(name))
            try:
                dest_resolved = dest.resolve()
            except Exception:
                # ensure parent exists then resolve
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest_resolved = dest.resolve()

            if not str(dest_resolved).startswith(str(out_dir_resolved)):
                print(f"Skipping suspicious path (path traversal): {name}")
                continue

            if name.endswith("/"):  # directory entry
                dest.mkdir(parents=True, exist_ok=True)
                continue

            # Ensure parent exists
            dest.parent.mkdir(parents=True, exist_ok=True)

            # Overwrite (open with "wb")
            with z.open(info) as src, open(dest, "wb") as dst:
                shutil.copyfileobj(src, dst)

            # Try to preserve permission bits if present
            perm = (info.external_attr >> 16) & 0o777
            if perm:
                try:
                    os.chmod(dest, perm)
                except Exception:
                    pass

            print(f"Wrote: {dest}")

    print(f"Extraction complete. Files placed/overwritten in: {out_dir}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: extract_overwrite.py archive.zip [output_dir]")
        sys.exit(1)

    zipfile_path = Path(sys.argv[1])
    if not zipfile_path.is_file():
        print(f"Archive not found: {zipfile_path}")
        sys.exit(2)

    out = sys.argv[2] if len(sys.argv) >= 3 else zipfile_path.stem + "_extracted"
    safe_extract_overwrite(zipfile_path, out)
