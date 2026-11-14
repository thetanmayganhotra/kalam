#!/bin/bash
# Builds whisper.cpp's whisper-server (offline speech-to-text) as one universal macOS binary with Metal.
# The binary (a few MB) ships inside the app; the model (~550 MB) is downloaded by the user from Settings.
# Needs: cmake (brew install cmake), Xcode command line tools.
set -euo pipefail
TAG=v1.9.5
cd "$(dirname "$0")/.."
SRC=vendor/whisper.cpp
OUT=vendor/whisper/bin
if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$SRC"
fi
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_NATIVE=OFF -DGGML_BLAS=ON \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF
cmake --build "$SRC/build" --config Release -j --target whisper-server
mkdir -p "$OUT"
cp "$SRC/build/bin/whisper-server" "$OUT/"
cp "$SRC/LICENSE" "$OUT/LICENSE-whisper.cpp.txt"
lipo -archs "$OUT/whisper-server"
echo "built $OUT/whisper-server"
