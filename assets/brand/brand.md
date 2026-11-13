# AgentFICO brand kit

AgentFICO uses a restrained, print-like identity: an open ledger inside a paired laurel seal, fine ink outlines, and a quiet serif wordmark. The mark is drawn as original vector paths. Its stipple marks appear only at larger display sizes; the small mark remains a clear ledger-and-wreath outline.

## Color

The single source for interface color tokens is [`theme.css`](theme.css).

| Token | Value | Use |
| --- | --- | --- |
| Glacier background | `#e7eaf3` | Main canvas and light logo ground |
| Surface | `#f4f6fa` | Secondary surfaces |
| Line | `#c8cfe4` | Hairline dividers and outlines |
| Muted | `#9aa6c4` | Quiet labels and nonessential metadata |
| Body | `#3a4353` | Paragraphs and primary supporting text |
| Ink | `#0a0d12` | Wordmark, mark, headings and strong text |
| Mist | `#658ac3` | Secondary accents and painted fields |
| Deep | `#304991` | Darker accent and painted fields |
| Night | `#0d1120` | Dark background for inverse artwork |

Use body text over Glacier or Surface. At these values, body text meets WCAG AA contrast on both backgrounds. Muted is reserved for small, secondary labels and must not carry essential instructions or data on its own. Keep provenance labels visible and legible.

## Type

Headings and score numerals use the self-hosted Newsreader variable font in [`fonts/`](fonts/). Its required license is included at [`fonts/OFL.txt`](fonts/OFL.txt). The display face is also used to draw the wordmark and social-card lettering as vector outlines. Interface copy uses a system sans-serif stack; identifiers and dense data use a system monospace stack with tabular numerals where available. The CSS names are `--font-serif`, `--font-body`, and `--font-data`.

## Logo files

- [`logo.svg`](logo.svg): primary horizontal lockup, with outlined wordmark and transparent ground.
- [`logo-inverse.svg`](logo-inverse.svg): glacier ink for a Night ground.
- [`logo-mark.svg`](logo-mark.svg): standalone seal for the app shell, loading and empty states.
- [`logo.png`](logo.png): 512 px light version for existing integrations.
- `logo-512-glacier.png` / `logo-1024-glacier.png`: ink artwork on Glacier.
- `logo-512-night.png` / `logo-1024-night.png`: Glacier artwork on Night.
- `favicon.svg`, `favicon.ico`, `favicon-16.png`, `favicon-32.png`, and `apple-touch-icon.png`: browser and device icons.
- `og-image.png` and `x-header.png`: 1200 × 630 and 1500 × 500 share artwork; their editable vector sources are adjacent `.svg` files.

## Use and clear space

Keep the logo at its original proportions and preserve the specified colors. Use the transparent horizontal lockup on Glacier, Surface, or another quiet background with enough contrast. Use the inverse lockup only on Night. Do not place the mark on a busy image, add effects, recolor individual parts, or stretch the artwork.

Reserve clear space equal to one eighth of the mark's diameter around the standalone mark. For the lockup, keep at least the height of the capital `A` around the entire signature. The mark should be at least 32 px tall; use a larger size when the mark is expected to carry the brand name by itself. Keep the stippled detail for large display use and use the simplified outline at favicon scale.

## Social artwork

The Open Graph image is 1200 × 630 px and the X header is 1500 × 500 px. Both use a light Glacier ground, the outlined wordmark, the single-line tagline “Trust, traced to behavior.”, and soft, blurred color fields. Keep other copy and marks out of these compositions.

## Rebuilding assets

On macOS, run `python3 assets/brand/generate_assets.py` from the repository root. The script reads palette values from `theme.css`, converts the included variable font glyphs to SVG paths, and rasterizes the outputs with `sips` while preserving each SVG's aspect ratio. It needs Python `fontTools` and the built-in `sips` command; it makes no network calls and adds no JavaScript dependencies.
