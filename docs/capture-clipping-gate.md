# Capture prefix clipping gate

The capture renderer must prove that the final PNG preserves the left edge of
both capture-chrome text rows:

1. the frame title; and
2. the command or channel label.

DOM text equality and `scrollWidth <= clientWidth` are insufficient. A
screenshot can lose pixels at the left edge while both checks remain green.

## Renderer contract

Place a solid 3×3 pixel sentinel immediately before each prefix:

| Prefix | RGB | Export |
|---|---|---|
| title | `255,0,255` | `CAPTURE_PREFIX_MARKERS.title` |
| command/channel | `0,255,255` | `CAPTURE_PREFIX_MARKERS.secondary` |

After rendering, record the screenshot-relative integer `x`, `y`, `size`, and
`rgb` for both sentinels:

```json
{
  "frames": [
    {
      "png": "09-search-populated.png",
      "probes": [
        {
          "kind": "title-prefix",
          "x": 68,
          "y": 49,
          "size": 3,
          "rgb": [255, 0, 255]
        },
        {
          "kind": "secondary-prefix",
          "x": 68,
          "y": 75,
          "size": 3,
          "rgb": [0, 255, 255]
        }
      ]
    }
  ]
}
```

The marker belongs to neutral capture chrome, never product output. It must be a
solid CSS block with integer dimensions; do not rely on a glyph or antialiased
border.

## Gate

```sh
pnpm capture:check capture-clipping-manifest.json
pnpm capture:check --json capture-clipping-manifest.json
```

The command decodes the final PNG bytes and exits nonzero when a manifest, PNG,
required marker contract, marker geometry, or any sentinel pixel is invalid.
The aggregate may claim `no_material_clipping: true` only after this command
passes every frame.
