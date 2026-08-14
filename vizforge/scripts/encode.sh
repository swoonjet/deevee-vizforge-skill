#!/usr/bin/env bash
# scripts/encode.sh — turn a retained PNG frame sequence into an archival master MP4,
# a compatible delivery MP4, a palette-optimized GIF, and a poster PNG.
#
# Both MP4s are encoded independently from the SAME frame sequence (never one from
# the other's output) — see docs/pipeline.md "dual-encode rule" and
# 01-RESEARCH.md Pattern 3. The poster is a plain file copy of a retained frame,
# never a fresh screenshot or an MP4 frame extraction (MOTION-02).
#
# Usage:
#   encode.sh <framesDir> <outDir> <fps> [--poster-frame N] [--gif-encoder gifski|palettegen] [--gif-width 960]
set -euo pipefail

usage() {
  echo "Usage: encode.sh <framesDir> <outDir> <fps> [--poster-frame N] [--gif-encoder gifski|palettegen] [--gif-width 960]" >&2
}

if [[ $# -lt 3 ]]; then
  usage
  exit 1
fi

FRAMES_DIR="$1"
OUT_DIR="$2"
FPS="$3"
shift 3

POSTER_FRAME=""
GIF_ENCODER="gifski"
GIF_WIDTH="960"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --poster-frame)
      POSTER_FRAME="$2"
      shift 2
      ;;
    --gif-encoder)
      GIF_ENCODER="$2"
      shift 2
      ;;
    --gif-width)
      GIF_WIDTH="$2"
      shift 2
      ;;
    *)
      echo "encode.sh: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$GIF_ENCODER" != "gifski" && "$GIF_ENCODER" != "palettegen" ]]; then
  echo "encode.sh: --gif-encoder must be 'gifski' or 'palettegen', got '$GIF_ENCODER'" >&2
  exit 1
fi

# Sanity: fail loudly if there are zero frame_*.png files rather than letting ffmpeg
# produce a confusing, near-empty output.
FRAME_COUNT=$(find "$FRAMES_DIR" -maxdepth 1 -name 'frame_*.png' | wc -l | tr -d ' ')
if [[ "$FRAME_COUNT" -eq 0 ]]; then
  echo "encode.sh: no frame_*.png files found in $FRAMES_DIR" >&2
  exit 1
fi

# Determine the last frame index (highest frame_NNNNN.png) for the default poster frame.
LAST_FRAME_FILE=$(find "$FRAMES_DIR" -maxdepth 1 -name 'frame_*.png' | sort | tail -n 1)
LAST_FRAME_BASENAME=$(basename "$LAST_FRAME_FILE")
LAST_FRAME_INDEX=$(echo "$LAST_FRAME_BASENAME" | sed -E 's/frame_0*([0-9]+)\.png/\1/')
if [[ -z "$POSTER_FRAME" ]]; then
  POSTER_FRAME="$LAST_FRAME_INDEX"
fi

mkdir -p "$OUT_DIR"

FRAME_GLOB_PATTERN="$FRAMES_DIR/frame_%05d.png"

# --- Master: archival only, near-full chroma, preserves fine gridlines/hairlines.
# NOT for direct playback/embedding — Safari and Firefox cannot decode yuv444p H.264.
ffmpeg -y -framerate "$FPS" -i "$FRAME_GLOB_PATTERN" \
  -c:v libx264 -preset slow -tune animation -crf 16 -pix_fmt yuv444p \
  -movflags +faststart "$OUT_DIR/master.mp4"

# --- Delivery: independently encoded from the SAME source frames (not from master.mp4),
# broadly compatible. Pad to even dimensions for yuv420p only (chroma subsampling
# requires even width/height); the master above needs no such padding.
ffmpeg -y -framerate "$FPS" -i "$FRAME_GLOB_PATTERN" \
  -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" \
  -c:v libx264 -preset slow -tune animation -crf 18 -pix_fmt yuv420p \
  -movflags +faststart "$OUT_DIR/delivery.mp4"

# --- GIF: same source frames, gifski preferred (temporal dithering), ffmpeg
# palettegen/paletteuse as the documented fallback.
if [[ "$GIF_ENCODER" == "gifski" ]]; then
  # gifski's frame glob must NOT be shell-quoted — it relies on shell expansion
  # (01-RESEARCH.md Pitfall 5). Do not add quotes around the glob below.
  gifski -o "$OUT_DIR/piece.gif" --fps "$FPS" --width "$GIF_WIDTH" --quality 90 "$FRAMES_DIR"/frame_*.png
else
  PALETTE_PNG="$OUT_DIR/.palette.png"
  ffmpeg -y -framerate "$FPS" -i "$FRAME_GLOB_PATTERN" \
    -vf "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos,palettegen=stats_mode=diff" \
    "$PALETTE_PNG"
  ffmpeg -y -framerate "$FPS" -i "$FRAME_GLOB_PATTERN" -i "$PALETTE_PNG" \
    -lavfi "fps=$FPS,scale=$GIF_WIDTH:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=floyd_steinberg" \
    "$OUT_DIR/piece.gif"
  rm -f "$PALETTE_PNG"
fi

if [[ ! -s "$OUT_DIR/piece.gif" ]]; then
  echo "encode.sh: piece.gif was not produced (or is empty) — GIF encode failed silently" >&2
  exit 1
fi

# --- Poster: a plain file COPY of the chosen frame — never a fresh screenshot or an
# MP4 frame extraction (MOTION-02 mechanics).
POSTER_SOURCE=$(printf "$FRAMES_DIR/frame_%05d.png" "$POSTER_FRAME")
if [[ ! -f "$POSTER_SOURCE" ]]; then
  echo "encode.sh: poster source frame not found: $POSTER_SOURCE" >&2
  exit 1
fi
cp "$POSTER_SOURCE" "$OUT_DIR/poster.png"

echo "encode.sh: wrote $OUT_DIR/master.mp4, $OUT_DIR/delivery.mp4, $OUT_DIR/piece.gif, $OUT_DIR/poster.png (poster frame $POSTER_FRAME)"
