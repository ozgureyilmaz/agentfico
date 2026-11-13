#!/usr/bin/env python3
"""Rebuild AgentFICO's outlined lockup and raster brand assets on macOS.

Requires fontTools and sips. The distributed font and its license are kept in
fonts/; no network access or package-manager install is used.
"""

from __future__ import annotations

import html
import re
import struct
import shutil
import subprocess
import tempfile
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parent
FONT_PATH = ROOT / "fonts" / "Newsreader-Variable.ttf"
THEME_SOURCE = (ROOT / "theme.css").read_text()


def theme_token(name: str) -> str:
    match = re.search(rf"--{re.escape(name)}:\s*(#[0-9a-fA-F]{{6}})\s*;", THEME_SOURCE)
    if match is None:
        raise ValueError(f"Missing --{name} color in theme.css")
    return match.group(1).lower()


INK = theme_token("ink")
GLACIER = theme_token("bg")
NIGHT = theme_token("night")
MIST = theme_token("mist")
DEEP = theme_token("deep")
WORDMARK = "AgentFICO"
TAGLINE = "Trust, traced to behavior."


def outlined_text(value: str, size_px: float, color: str, baseline: float, x: float = 0) -> tuple[str, float]:
    font = instantiateVariableFont(
        TTFont(FONT_PATH), {"wght": 450, "opsz": max(6, min(72, size_px))}, inplace=False
    )
    units = font["head"].unitsPerEm
    scale = size_px / units
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    metrics = font["hmtx"].metrics
    letter_spacing = units * 0.012
    pieces: list[str] = []
    pen_x = 0.0
    for character in value:
        glyph_name = cmap.get(ord(character))
        if glyph_name is None:
            continue
        pen = SVGPathPen(glyph_set)
        glyph_set[glyph_name].draw(pen)
        path = pen.getCommands()
        if path:
            pieces.append(
                f'<path d="{path}" transform="translate({x + pen_x * scale:.3f},{baseline:.3f}) '
                f'scale({scale:.6f},-{scale:.6f})"/>'
            )
        pen_x += metrics[glyph_name][0] + letter_spacing
    return f'<g fill="{color}" aria-hidden="true">{"".join(pieces)}</g>', pen_x * scale


def mark_svg(color: str = INK, width: int = 120, height: int = 120) -> str:
    source = (ROOT / "logo-mark.svg").read_text()
    source = source.replace('width="120" height="120"', f'width="{width}" height="{height}"')
    if color != INK:
        source = source.replace(INK, color)
    return source


def lockup(color: str = INK, x: float = 0, y: float = 0, scale: float = 1) -> str:
    mark = mark_svg(color).replace(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-labelledby="title desc">',
        '<svg x="0" y="0" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">',
    )
    mark = mark.replace("  <title id=\"title\">AgentFICO ledger seal</title>\n", "")
    mark = mark.replace("  <desc id=\"desc\">A fine-line ledger enclosed by a paired laurel wreath.</desc>\n", "")
    text_paths, _ = outlined_text(WORDMARK, 54, color, 81, 140)
    inner = f'{mark}{text_paths}'
    return f'<g transform="translate({x:.2f},{y:.2f}) scale({scale:.5f})">{inner}</g>'


def svg_document(width: int, height: int, body: str, title: str, desc: str = "") -> str:
    description = f'<desc>{html.escape(desc)}</desc>' if desc else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title">'
        f'<title id="title">{html.escape(title)}</title>{description}{body}</svg>\n'
    )


def save(path: Path, content: str) -> None:
    path.write_text(content)


def render_svg(source: Path, destination: Path, size: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="agentfico-brand-") as temporary:
        rendered = Path(temporary) / "rendered.png"
        subprocess.run(
            ["sips", "-s", "format", "png", str(source), "--out", str(rendered)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        dimension_output = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(rendered)],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout
        width = height = 0
        for line in dimension_output.splitlines():
            if "pixelWidth:" in line:
                width = int(line.split(":", 1)[1].strip())
            if "pixelHeight:" in line:
                height = int(line.split(":", 1)[1].strip())
        if width == 0 or height == 0:
            raise RuntimeError(f"Unable to read rendered dimensions for {source}")
        if max(width, height) != size:
            factor = size / max(width, height)
            target_width = round(width * factor)
            target_height = round(height * factor)
            subprocess.run(
                ["sips", "-z", str(target_height), str(target_width), str(rendered), "--out", str(destination)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        else:
            shutil.copyfile(rendered, destination)


def write_ico(path: Path, images: list[Path]) -> None:
    entries: list[bytes] = []
    payloads: list[bytes] = []
    offset = 6 + 16 * len(images)
    for image_path in images:
        data = image_path.read_bytes()
        with tempfile.TemporaryDirectory(prefix="agentfico-ico-") as temporary:
            png = Path(temporary) / "image.png"
            png.write_bytes(data)
            dimensions = subprocess.run(
                ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(png)],
                check=True,
                stdout=subprocess.PIPE,
                text=True,
            ).stdout
        width = height = 0
        for line in dimensions.splitlines():
            if "pixelWidth:" in line:
                width = int(line.split(":", 1)[1].strip())
            if "pixelHeight:" in line:
                height = int(line.split(":", 1)[1].strip())
        entries.append(struct.pack("<BBBBHHII", width % 256, height % 256, 0, 0, 1, 32, len(data), offset))
        payloads.append(data)
        offset += len(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries) + b"".join(payloads))


def build_vectors() -> None:
    lockup_svg = svg_document(432, 120, lockup(), "AgentFICO", "AgentFICO ledger seal and outlined wordmark.")
    save(ROOT / "logo.svg", lockup_svg)
    save(ROOT / "logo-inverse.svg", svg_document(432, 120, lockup(GLACIER), "AgentFICO inverse"))

    favicon_mark = mark_svg().replace(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-labelledby="title desc">',
        '<svg x="0" y="0" width="64" height="64" viewBox="0 0 120 120" aria-hidden="true">',
    )
    favicon_mark = favicon_mark.replace("  <title id=\"title\">AgentFICO ledger seal</title>\n", "")
    favicon_mark = favicon_mark.replace("  <desc id=\"desc\">A fine-line ledger enclosed by a paired laurel wreath.</desc>\n", "")
    favicon_body = f'<rect width="64" height="64" fill="{GLACIER}"/>{favicon_mark}'
    save(ROOT / "favicon.svg", svg_document(64, 64, favicon_body, "AgentFICO favicon"))

    for color, background, label in ((INK, GLACIER, "glacier"), (GLACIER, NIGHT, "night")):
        mark, _ = outlined_text(WORDMARK, 67, color, 397, 0)
        mark_width = outlined_text(WORDMARK, 67, color, 397)[1]
        centered_x = (512 - mark_width) / 2
        mark, _ = outlined_text(WORDMARK, 67, color, 397, centered_x)
        art = f'<rect width="512" height="512" fill="{background}"/>'
        art += f'<g transform="translate(176,72) scale(1.33)">{mark_svg(color)}</g>{mark}'
        save(ROOT / f".app-icon-{label}.svg", svg_document(512, 512, art, f"AgentFICO {label} icon"))

    tagline_center = 600
    tagline, width = outlined_text(TAGLINE, 32, INK, 406)
    tagline, _ = outlined_text(TAGLINE, 32, INK, 406, tagline_center - width / 2)
    og_fields = (
        '<defs><filter id="haze" x="-30%" y="-50%" width="160%" height="200%">'
        '<feGaussianBlur stdDeviation="62"/></filter></defs>'
        f'<rect width="1200" height="630" fill="{GLACIER}"/>'
        f'<ellipse cx="246" cy="210" rx="340" ry="180" fill="{MIST}" opacity=".17" filter="url(#haze)"/>'
        f'<ellipse cx="920" cy="430" rx="350" ry="170" fill="{DEEP}" opacity=".10" filter="url(#haze)"/>'
        f'{lockup(INK, 384, 208, 1.0)}{tagline}'
    )
    save(ROOT / "og-image.svg", svg_document(1200, 630, og_fields, "AgentFICO social image", TAGLINE))

    header_tagline, width = outlined_text(TAGLINE, 38, INK, 381)
    header_tagline, _ = outlined_text(TAGLINE, 38, INK, 381, 750 - width / 2)
    header_fields = (
        '<defs><filter id="haze" x="-30%" y="-50%" width="160%" height="200%">'
        '<feGaussianBlur stdDeviation="72"/></filter></defs>'
        f'<rect width="1500" height="500" fill="{GLACIER}"/>'
        f'<ellipse cx="268" cy="142" rx="360" ry="180" fill="{MIST}" opacity=".16" filter="url(#haze)"/>'
        f'<ellipse cx="1235" cy="375" rx="340" ry="175" fill="{DEEP}" opacity=".10" filter="url(#haze)"/>'
        f'{lockup(INK, 534, 113, 1.0)}{header_tagline}'
    )
    save(ROOT / "x-header.svg", svg_document(1500, 500, header_fields, "AgentFICO X header", TAGLINE))


def build_rasters() -> None:
    for label, size in (("glacier", 512), ("glacier", 1024), ("night", 512), ("night", 1024)):
        source = ROOT / f".app-icon-{label}.svg"
        output = ROOT / f"logo-{size}-{label}.png"
        render_svg(source, output, size)
    (ROOT / "logo.png").write_bytes((ROOT / "logo-512-glacier.png").read_bytes())
    for size, name in ((16, "favicon-16.png"), (32, "favicon-32.png"), (180, "apple-touch-icon.png")):
        render_svg(ROOT / "favicon.svg", ROOT / name, size)
    write_ico(ROOT / "favicon.ico", [ROOT / "favicon-16.png", ROOT / "favicon-32.png"])
    render_svg(ROOT / "og-image.svg", ROOT / "og-image.png", 1200)
    render_svg(ROOT / "x-header.svg", ROOT / "x-header.png", 1500)
    for temporary in (ROOT / ".app-icon-glacier.svg", ROOT / ".app-icon-night.svg"):
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    build_vectors()
    build_rasters()
    print("Generated AgentFICO brand SVG, PNG, favicon, and social image assets.")
