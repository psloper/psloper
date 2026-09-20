#!/bin/sh
# Build the hand-over package: the two offline builds, the documents, the
# samples, example outputs and the source, with a checksum list.
#
# The zip is NOT committed. It is 15 MB of already-compressed data, so every
# rebuild would add 15 MB to the repository history permanently, the same trap
# the pre-baked terrain has. Build it when you need it.
#
#   sh tools/build_package.sh [output-directory]
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/dist"}
work=$(mktemp -d)
pkg="$work/windfarm-radar"
mkdir -p "$pkg/source"

# The builds, made fresh so the package can never ship stale code.
node "$root/tools/build_offline.mjs" --200m
node "$root/tools/build_offline.mjs" --coarse
cp "$root/dist/windfarm-radar-offline-200m.html" "$pkg/"
cp "$root/dist/windfarm-radar-offline-500m.html" "$pkg/"

cp "$root/docs/PACKAGE-README.md" "$pkg/START-HERE.md"
mkdir -p "$pkg/docs"
for f in "$root"/docs/*; do
  case $(basename "$f") in PACKAGE-README.md) continue ;; esac
  cp -r "$f" "$pkg/docs/"
done
cp -r "$root/samples" "$pkg/samples"

# Source, for review. The 100 m terrain blocks are 27 MB and stay in the
# repository; the package carries the 500 m grid, and the manifest says so, so
# the source tree runs rather than failing to load anything.
for d in js css test tools samples calibration; do cp -r "$root/$d" "$pkg/source/"; done
cp "$root/index.html" "$root/package.json" "$root/README.md" "$pkg/source/"
rm -rf "$pkg/source/tools/__pycache__"
mkdir -p "$pkg/source/data/terrain"
cp "$root/data/uk-wind-farms.json" "$root/data/uk-radar-sites.json" "$pkg/source/data/"
cp "$root/data/terrain/uk-500m.bin" "$pkg/source/data/terrain/"
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
m.blocks = []; m.coarseOnly = true;
m.note = "This copy carries the 500 m national grid only. The 100 m blocks are "
  + "in the git repository; they are 27 MB and were left out of the hand-over package.";
fs.writeFileSync(process.argv[2], JSON.stringify(m, null, 1));
' "$root/data/terrain/manifest.json" "$pkg/source/data/terrain/manifest.json"

# Example outputs, if a demo run left any behind.
if [ -d "$root/dist/example-outputs" ]; then cp -r "$root/dist/example-outputs" "$pkg/"; fi

cd "$pkg"
find . -type f ! -name SHA256SUMS.txt | sed 's|^\./||' | sort | xargs sha256sum > SHA256SUMS.txt
mkdir -p "$out"
rm -f "$out/windfarm-radar-package.zip"
cd "$work" && zip -rq "$out/windfarm-radar-package.zip" windfarm-radar
rm -rf "$work"
ls -l "$out/windfarm-radar-package.zip"
