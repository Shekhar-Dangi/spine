"""
Geographic map service — extracts places from chapter text via LLM.

Flow:
  1. Load chapter text from filesystem (or DB chunks as fallback).
  2. Call provider.generate_json() with extraction prompt.
  3. Parse + validate JSON response.
  4. Persist GeoMap + GeoMarker rows.
  5. On failure, set GeoMap.status = failed.

Context injection:
  get_map_context(chapter_id, db) → formatted string for LLM system prompts.
  Returns None if no ready map exists for the chapter.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import Chapter, Chunk, GeoConfidence, GeoMap, GeoMapStatus, GeoMarker, MarkerType

log = logging.getLogger(__name__)

_MAX_CHAPTER_CHARS = 60_000  # keep extraction prompt within context limits

_EXTRACTION_PROMPT = """\
You are a geographic historian. Analyze the chapter text below and extract the most \
significant geographic places mentioned (up to 20 places maximum — prioritize the \
most important ones).

For each place provide:
- name: the place name as it appears (or is clearly implied) in the text
- type: one of "city", "region", "battle", "route", "other"
- period: approximate historical period (e.g. "~9500 BC", "800–1200 AD") — keep brief
- annotation: 2–3 sentences covering: (1) what this place is or was historically, \
(2) why it appears in this chapter specifically, (3) its broader significance if relevant. \
Be specific to the chapter content, not generic.
- latitude: best estimated decimal latitude as a float
- longitude: best estimated decimal longitude as a float
- confidence: "high" (well-known, coordinates reliable), "medium" (approximate), \
"low" (very uncertain)

Respond with ONLY valid JSON — no markdown, no extra text:
{{
  "period_label": "overall time period (e.g. '10,000–3,000 BC')",
  "period_start_year": <integer, negative for BC, or null>,
  "period_end_year": <integer, or null>,
  "places": [
    {{
      "name": "Fertile Crescent",
      "type": "region",
      "period": "~9500 BC",
      "annotation": "Region where agriculture first emerged.",
      "latitude": 34.0,
      "longitude": 39.0,
      "confidence": "high"
    }}
  ]
}}

If no geographic places are mentioned, return:
{{"places": [], "period_label": "unknown", "period_start_year": null, "period_end_year": null}}

Chapter text:
---
{chapter_text}
---"""

_VALID_TYPES = {t.value for t in MarkerType}
_VALID_CONFIDENCE = {c.value for c in GeoConfidence}


async def _load_chapter_text(book_id: int, chapter: Chapter, db: AsyncSession) -> str:
    text_file = (
        Path(settings.parsed_path) / str(book_id) / f"chapter_{chapter.chapter_index}.txt"
    )
    if text_file.exists():
        return text_file.read_text(encoding="utf-8")

    result = await db.execute(
        select(Chunk)
        .where(Chunk.chapter_id == chapter.id)
        .order_by(Chunk.id)
    )
    return "\n\n".join(c.text for c in result.scalars().all())


def _parse_response(raw: str) -> dict:
    """Parse and minimally validate the LLM JSON response.

    If the response is truncated (common when hitting max_tokens), attempts
    to recover by truncating to the last complete place entry.
    """
    # Strip markdown code fences if the model wrapped the response
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Attempt recovery: truncate to last complete place object
        data = _recover_truncated_json(text)

    if not isinstance(data.get("places"), list):
        raise ValueError("Response missing 'places' array")

    return data


def _recover_truncated_json(text: str) -> dict:
    """Best-effort recovery from truncated JSON by finding the last complete object."""
    # Find the last occurrence of '}' followed only by whitespace/commas/brackets
    # — this marks the end of the last complete place entry.
    import re
    # Try to find complete place objects and rebuild valid JSON
    # Look for the opening of the places array
    places_start = text.find('"places"')
    if places_start == -1:
        return {"places": [], "period_label": "unknown", "period_start_year": None, "period_end_year": None}

    # Extract period fields from the start of the response
    period_label = None
    period_start = None
    period_end = None
    m = re.search(r'"period_label"\s*:\s*"([^"]*)"', text)
    if m:
        period_label = m.group(1)
    m = re.search(r'"period_start_year"\s*:\s*(-?\d+|null)', text)
    if m:
        v = m.group(1)
        period_start = int(v) if v != "null" else None
    m = re.search(r'"period_end_year"\s*:\s*(-?\d+|null)', text)
    if m:
        v = m.group(1)
        period_end = int(v) if v != "null" else None

    # Collect all complete place objects by finding balanced braces
    array_start = text.find("[", places_start)
    if array_start == -1:
        return {"places": [], "period_label": period_label, "period_start_year": period_start, "period_end_year": period_end}

    places = []
    depth = 0
    obj_start = None
    for i, ch in enumerate(text[array_start:], array_start):
        if ch == "{":
            if depth == 1:  # start of a place object (depth 1 = inside array)
                obj_start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 1 and obj_start is not None:  # completed a place object
                try:
                    obj = json.loads(text[obj_start:i + 1])
                    places.append(obj)
                except json.JSONDecodeError:
                    pass
                obj_start = None
        elif ch == "[" and i > array_start:
            depth += 1
        elif ch == "]" and depth <= 1:
            break

    log.warning("geo_map: recovered %d places from truncated JSON response", len(places))
    return {"places": places, "period_label": period_label, "period_start_year": period_start, "period_end_year": period_end}


def _coerce_marker(place: dict) -> dict | None:
    """Validate and coerce a single place dict. Returns None if invalid."""
    name = str(place.get("name", "")).strip()
    if not name:
        return None

    try:
        lat = float(place.get("latitude", 0))
        lon = float(place.get("longitude", 0))
    except (TypeError, ValueError):
        return None

    # Clamp to valid ranges
    lat = max(-90.0, min(90.0, lat))
    lon = max(-180.0, min(180.0, lon))

    marker_type = place.get("type", "other")
    if marker_type not in _VALID_TYPES:
        marker_type = "other"

    confidence = place.get("confidence", "medium")
    if confidence not in _VALID_CONFIDENCE:
        confidence = "medium"

    return {
        "name": name,
        "latitude": lat,
        "longitude": lon,
        "marker_type": marker_type,
        "period_label": str(place.get("period", "")).strip() or None,
        "annotation": str(place.get("annotation", "")).strip(),
        "confidence": confidence,
    }


async def generate_geo_map(
    book_id: int, chapter_id: int, db: AsyncSession, provider
) -> None:
    """
    Generate geographic map for a chapter. Runs as a background task.
    Expects a GeoMap row with status=generating to already exist.
    """
    result = await db.execute(
        select(GeoMap).where(GeoMap.chapter_id == chapter_id)
    )
    geo_map = result.scalar_one_or_none()
    if not geo_map:
        log.error("generate_geo_map: no GeoMap row for chapter_id=%d", chapter_id)
        return

    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        geo_map.status = GeoMapStatus.FAILED
        geo_map.error_message = "Chapter not found."
        await db.commit()
        return

    try:
        chapter_text = await _load_chapter_text(book_id, chapter, db)
        chapter_text = chapter_text[:_MAX_CHAPTER_CHARS]

        prompt = _EXTRACTION_PROMPT.format(chapter_text=chapter_text)
        messages = [{"role": "user", "content": prompt}]

        raw = await provider.generate_json(messages, max_tokens=8192)
        data = _parse_response(raw)

        # Delete old markers (handles regeneration) — direct query, no lazy load
        await db.execute(delete(GeoMarker).where(GeoMarker.geo_map_id == geo_map.id))
        await db.flush()

        geo_map.period_label = str(data.get("period_label", "")).strip() or None
        try:
            geo_map.period_start_year = int(data["period_start_year"]) if data.get("period_start_year") is not None else None
            geo_map.period_end_year = int(data["period_end_year"]) if data.get("period_end_year") is not None else None
        except (TypeError, ValueError):
            geo_map.period_start_year = None
            geo_map.period_end_year = None

        for place in data.get("places", []):
            coerced = _coerce_marker(place)
            if not coerced:
                continue
            db.add(GeoMarker(
                geo_map_id=geo_map.id,
                place_name=coerced["name"],
                latitude=coerced["latitude"],
                longitude=coerced["longitude"],
                marker_type=MarkerType(coerced["marker_type"]),
                period_label=coerced["period_label"],
                llm_annotation=coerced["annotation"],
                confidence=GeoConfidence(coerced["confidence"]),
                created_at=datetime.now(timezone.utc),
            ))

        geo_map.status = GeoMapStatus.READY
        geo_map.error_message = None
        geo_map.generated_at = datetime.now(timezone.utc)
        await db.commit()

        log.info(
            "geo_map: generated for chapter_id=%d — %d markers",
            chapter_id,
            len(data.get("places", [])),
        )

    except Exception as exc:
        log.exception("geo_map: generation failed for chapter_id=%d", chapter_id)
        geo_map.status = GeoMapStatus.FAILED
        geo_map.error_message = str(exc)[:500]
        await db.commit()


async def get_map_context(chapter_id: int, db: AsyncSession) -> str | None:
    """
    Return a formatted map context string for injection into LLM prompts.
    Returns None if no ready geo map exists for this chapter.
    """
    result = await db.execute(
        select(GeoMap).where(
            GeoMap.chapter_id == chapter_id,
            GeoMap.status == GeoMapStatus.READY,
        )
    )
    geo_map = result.scalar_one_or_none()
    if not geo_map:
        return None

    # Eagerly load markers via a second query (avoids lazy-load issues)
    marker_result = await db.execute(
        select(GeoMarker).where(GeoMarker.geo_map_id == geo_map.id)
    )
    markers = marker_result.scalars().all()
    if not markers:
        return None

    lines = ["[CHAPTER MAP CONTEXT]"]
    if geo_map.period_label:
        lines.append(f"Approximate period: {geo_map.period_label}")
    lines.append("Geographic places referenced in this chapter:")
    for m in markers:
        annotation = m.user_annotation or m.llm_annotation
        period_str = f" ({m.period_label})" if m.period_label else ""
        lines.append(f"- {m.place_name}{period_str}: {annotation}")
    lines.append("[/CHAPTER MAP CONTEXT]")

    return "\n".join(lines)
