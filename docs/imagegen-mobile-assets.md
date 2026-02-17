# Imagegen Asset Plan (Portrait-First)

This project uses the local skill CLI at:

`/Users/macbookpro/.codex/skills/imagegen/scripts/image_gen.py`

## 1. Portrait Title Backdrop

Use case: `stylized-concept`  
Asset type: title screen background (portrait phone)

Prompt spec:

```text
Use case: stylized-concept
Asset type: mobile portrait game title backdrop
Primary request: dystopian underground arena corridor with neon sponsor billboards and distant crowd silhouettes
Scene/background: deep tunnel arena with layered fog and camera depth
Style/medium: stylized concept art, game-ready
Composition/framing: portrait 9:16, clear negative space in upper-middle for title text
Lighting/mood: moody, dramatic volumetric light shafts, orange/teal contrast
Color palette: charcoal, rust orange, toxic teal, warning red accents
Constraints: no logos, no readable brand text, no watermark
Avoid: clutter, oversaturation, cheesy lens flare
```

## 2. Sponsor Contract Card Texture

Use case: `ui-mockup`  
Asset type: HUD card texture for sponsor objectives

Prompt spec:

```text
Use case: ui-mockup
Asset type: game HUD panel texture
Primary request: futuristic broadcast contract panel texture with subtle scanlines and warning stripes
Style/medium: UI concept texture, clean and high contrast
Composition/framing: 3:1 horizontal panel, center-safe text area
Lighting/mood: cool metallic with subtle emissive edges
Color palette: gunmetal, cyan highlights, amber warnings
Constraints: no text, no logos, no watermark, seamless-ish edge treatment
Avoid: noisy details that hurt readability
```

## 3. Broadcast Report Background Plate

Use case: `ui-mockup`  
Asset type: game over / victory summary backdrop

Prompt spec:

```text
Use case: ui-mockup
Asset type: report panel background for portrait game UI
Primary request: broadcast analytics panel background with clean visual hierarchy and dark sci-fi framing
Style/medium: polished UI concept art
Composition/framing: portrait, large central safe zone for text rows
Lighting/mood: dark with subtle cyan-magenta edge glows
Color palette: near-black, muted steel blue, neon accents
Constraints: no text, no logos, no watermark
Avoid: visual clutter that competes with overlay text
```

## CLI examples (when `OPENAI_API_KEY` is set)

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export IMAGE_GEN="$CODEX_HOME/skills/imagegen/scripts/image_gen.py"

python "$IMAGE_GEN" generate \
  --prompt "<PROMPT_SPEC_FROM_ABOVE>" \
  --size 1024x1536 \
  --quality high \
  --out output/imagegen/title-backdrop-portrait.png
```

