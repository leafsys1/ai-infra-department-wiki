#!/usr/bin/env python3
"""Render the knowledge-graph assets (`assets/graph-preview.png`, `assets/graph-demo.gif`).

Both files are generated from a knowledge repository's own build output — `generated/graph-data.json`
for the relations and `generated/catalog.json` for the titles and types — so they can never show a
corpus other than the one in the repository. There is no browser on this host, so these are renderings
of the data with the dashboard's own layout and colour mapping, not screenshots of the page.

Usage:
    python3 scripts/render-graph-assets.py <knowledge-repo> [--out <dir>]

The layout constants mirror `skills/ai-infra-department-wiki/assets/dashboard/index.html`
(cols=5, card 140x55 at a 170x105 pitch, the same per-type colours and relation labels).
"""

import argparse
import json
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
SCALE = 2  # draw at 2x, then downsample for smooth edges

# Bigger than the dashboard's on-screen cards: this file is read as an image, so legibility of the
# titles and relation labels matters more than matching the page pixel for pixel.
COLS, CARD_W, CARD_H, PITCH_X, PITCH_Y = 4, 300, 110, 345, 200
MARGIN_X, MARGIN_Y, HEADER_H = 80, 60, 170

COLORS = {
    "case": "#2f6fed",
    "evidence": "#7a4dc5",
    "decision": "#c26c10",
    "pattern": "#14866d",
    "runbook": "#bb4770",
    "environment": "#61738a",
}
TYPE_LABELS = {
    "case": "案例",
    "evidence": "证据",
    "decision": "决策",
    "pattern": "实践模式",
    "runbook": "运行手册",
    "environment": "环境基线",
}
RELATION_LABELS = {
    "has_evidence": "包含证据",
    "validated_by": "由其验证",
    "derived_from": "源自",
    "applies_to": "适用于",
    "supersedes": "替代",
    "related_to": "相关",
    "observed_in": "观测于",
    "caused_by": "由…导致",
    "mitigated_by": "由…缓解",
    "implemented_by": "由…实现",
    "supports": "支持",
    "refutes": "反驳",
    "contradicts": "矛盾",
}
INK, MUTED, LINE, PAPER, CANVAS, BRAND = "#172033", "#65718a", "#e1e7f0", "#ffffff", "#f5f7fb", "#146c5c"


def font(size):
    return ImageFont.truetype(FONT_PATH, size * SCALE)


def layout(records):
    positions = {}
    for index, record in enumerate(records):
        positions[record["id"]] = (
            (MARGIN_X + (index % COLS) * PITCH_X) * SCALE,
            (HEADER_H + MARGIN_Y + (index // COLS) * PITCH_Y) * SCALE,
        )
    return positions


def canvas_size(records):
    rows = max(1, -(-len(records) // COLS))
    width = (MARGIN_X * 2 + (COLS - 1) * PITCH_X + CARD_W) * SCALE
    height = (HEADER_H + MARGIN_Y * 2 + (rows - 1) * PITCH_Y + CARD_H + 60) * SCALE
    return width, height


def centered(draw, text, cx, cy, fnt, fill):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    draw.text((cx - (right - left) / 2 - left, cy - (bottom - top) / 2 - top), text, font=fnt, fill=fill)


def draw_header(draw, width, title, records, edges):
    draw.text((MARGIN_X * SCALE, 36 * SCALE), title, font=font(18), fill=BRAND)
    draw.text((MARGIN_X * SCALE, 68 * SCALE), "部门知识图谱", font=font(30), fill=INK)
    stats = f"{len(records)} 条知识 · {len(edges)} 条显式关系"
    draw.text((MARGIN_X * SCALE, 116 * SCALE), stats, font=font(15), fill=MUTED)

    # legend: one swatch per type actually present, right-aligned
    present = [t for t in COLORS if any(r.get("type") == t for r in records)]
    x = width - MARGIN_X * SCALE
    for kind in reversed(present):
        label = TYPE_LABELS.get(kind, kind)
        w = draw.textlength(label, font=font(12))
        x -= w
        draw.text((x, 74 * SCALE), label, font=font(14), fill=MUTED)
        x -= 9 * SCALE
        draw.ellipse((x - 13 * SCALE, 76 * SCALE, x - 1 * SCALE, 88 * SCALE), fill=COLORS[kind])
        x -= 20 * SCALE
    draw.line((MARGIN_X * SCALE, 150 * SCALE, width - MARGIN_X * SCALE, 150 * SCALE), fill=LINE, width=SCALE)


def draw_edges(draw, edges, positions, limit=None, label=True):
    drawn = 0
    for edge in edges:
        source, target = positions.get(edge["from"]), positions.get(edge["to"])
        if not source or not target:
            continue
        if limit is not None and drawn >= limit:
            break
        start = (source[0] + CARD_W * SCALE / 2, source[1] + CARD_H * SCALE)
        end = (target[0] + CARD_W * SCALE / 2, target[1])
        if target[1] < source[1]:  # target above: leave from the top edge instead
            start = (source[0] + CARD_W * SCALE / 2, source[1])
            end = (target[0] + CARD_W * SCALE / 2, target[1] + CARD_H * SCALE)
        draw.line((start, end), fill="#aeb9c8", width=SCALE)
        if label:
            mx, my = (start[0] + end[0]) / 2 + 34 * SCALE, (start[1] + end[1]) / 2
            text = RELATION_LABELS.get(edge.get("relation_type"), edge.get("relation_type", ""))
            w, h = draw.textlength(text, font=font(12)), 16 * SCALE
            draw.rounded_rectangle((mx - w / 2 - 5 * SCALE, my - h / 2, mx + w / 2 + 5 * SCALE, my + h / 2), radius=4 * SCALE, fill=PAPER, outline=LINE, width=SCALE)
            centered(draw, text, mx, my, font(12), MUTED)
        drawn += 1
    return drawn


def draw_nodes(draw, records, positions, highlight=None, dim=False):
    for record in records:
        x, y = positions[record["id"]]
        color = COLORS.get(record.get("type"), "#61738a")
        selected = highlight == record["id"]
        draw.rounded_rectangle(
            (x, y, x + CARD_W * SCALE, y + CARD_H * SCALE),
            radius=9 * SCALE,
            fill=PAPER if not selected else "#e4f5f0",
            outline=color,
            width=(3 if selected else 2) * SCALE,
        )
        id_color = INK if not dim else MUTED
        draw.text((x + 16 * SCALE, y + 14 * SCALE), record["id"], font=font(17), fill=color)
        for index, line in enumerate(wrap(draw, record.get("title", ""), font(13), (CARD_W - 32) * SCALE, 2)):
            draw.text((x + 16 * SCALE, (y // SCALE + 46 + index * 20) * SCALE), line, font=font(13), fill=id_color)


def wrap(draw, text, fnt, limit, max_lines):
    """Greedy wrap for CJK/Latin mix; the last line gets an ellipsis when the text does not fit."""
    lines, current = [], ""
    for char in text:
        if draw.textlength(current + char, font=fnt) <= limit:
            current += char
            continue
        lines.append(current)
        current = char
        if len(lines) == max_lines:
            break
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if draw.textlength("".join(lines), font=fnt) < draw.textlength(text, font=fnt) and lines:
        while lines[-1] and draw.textlength(lines[-1] + "…", font=fnt) > limit:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines


def render_frame(records, edges, positions, size, title, edge_limit=None, highlight=None, dim=False):
    image = Image.new("RGB", size, CANVAS)
    draw = ImageDraw.Draw(image)
    draw_header(draw, size[0], title, records, edges)
    draw_edges(draw, edges, positions, limit=edge_limit)
    draw_nodes(draw, records, positions, highlight=highlight, dim=dim)
    return image


def load(repo):
    generated = pathlib.Path(repo) / "generated"
    graph = json.loads((generated / "graph-data.json").read_text(encoding="utf-8"))
    catalog = json.loads((generated / "catalog.json").read_text(encoding="utf-8"))
    titles = {entry["id"]: entry.get("title", "") for entry in catalog["records"]}
    types = {entry["id"]: entry.get("type") for entry in catalog["records"]}
    records = [
        {"id": node["id"], "title": titles.get(node["id"], ""), "type": types.get(node["id"])}
        for node in graph["nodes"]
    ]
    records.sort(key=lambda r: r["id"])
    return records, graph["edges"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo")
    parser.add_argument("--out", default=None, help="output directory (default: <repo-root>/assets next to this script)")
    args = parser.parse_args()

    records, edges = load(args.repo)
    if not records:
        raise SystemExit("no nodes in generated/graph-data.json — run `team-wiki build` first")

    positions = layout(records)
    size = canvas_size(records)
    out = pathlib.Path(args.out) if args.out else pathlib.Path(__file__).resolve().parent.parent / "assets"
    out.mkdir(parents=True, exist_ok=True)

    title = "AI Infra 部门知识库 · 知识图谱"
    preview = render_frame(records, edges, positions, size, title)
    preview.resize((size[0] // SCALE, size[1] // SCALE), Image.Resampling.LANCZOS).save(out / "graph-preview.png", optimize=True)

    # The animation draws the relations one by one, then walks the records in order, so the GIF shows
    # how many relations exist and which records they connect — not just a static picture.
    frames = [render_frame(records, edges, positions, size, title, edge_limit=n) for n in range(0, len(edges) + 1)]
    frames += [
        render_frame(records, edges, positions, size, title, highlight=record["id"], dim=True)
        for record in records
    ]
    frames.append(render_frame(records, edges, positions, size, title))
    small = [frame.resize((size[0] // 3, size[1] // 3), Image.Resampling.LANCZOS) for frame in frames]
    small[0].save(
        out / "graph-demo.gif",
        save_all=True,
        append_images=small[1:],
        duration=[140] * (len(edges) + 1) + [420] * (len(records) + 1),
        loop=0,
        optimize=True,
    )
    print(f"nodes={len(records)} edges={len(edges)} frames={len(frames)}")
    for name in ("graph-preview.png", "graph-demo.gif"):
        path = out / name
        print(f"{name}: {path} ({path.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    sys.exit(main())
