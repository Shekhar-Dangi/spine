"""
Backfill node_sources from existing evidence rows.

For every edge that has evidence, insert node_sources rows for both endpoints
(from_node_id and to_node_id) pointing to the same source.

Skips rows that already exist (identified by node_id + source_type + source_id).
No excerpt is available for old rows — the old suggestion payloads had no quotes.

Run once:
    cd backend && .venv/bin/python3.13 scripts/backfill_node_sources.py
"""
import asyncio
import sys
from pathlib import Path

# Allow running from the scripts/ directory
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, text
from db.database import AsyncSessionLocal
from db.models import Evidence, KnowledgeEdge, NodeSource


async def backfill() -> None:
    async with AsyncSessionLocal() as db:
        # Load all edges with their evidence
        edges_result = await db.execute(
            select(KnowledgeEdge).options()
        )
        edges = edges_result.scalars().all()

        ev_result = await db.execute(select(Evidence))
        evidence_rows = ev_result.scalars().all()

        # Build edge_id → (from_node_id, to_node_id) map
        edge_map: dict[int, tuple[int, int]] = {
            e.id: (e.from_node_id, e.to_node_id) for e in edges
        }

        # Load existing node_sources to avoid duplicates
        existing_result = await db.execute(
            text("SELECT node_id, source_type, source_id FROM node_sources")
        )
        existing: set[tuple] = {
            (row[0], row[1], row[2]) for row in existing_result.fetchall()
        }

        inserted = 0
        for ev in evidence_rows:
            if ev.edge_id not in edge_map:
                continue
            from_node_id, to_node_id = edge_map[ev.edge_id]
            source_type = ev.source_type.value  # e.g. "note"
            source_id = ev.source_id

            for node_id in (from_node_id, to_node_id):
                key = (node_id, source_type, source_id)
                if key in existing:
                    continue
                db.add(NodeSource(
                    node_id=node_id,
                    source_type=source_type,
                    source_id=source_id,
                    excerpt=ev.quote or None,
                ))
                existing.add(key)
                inserted += 1

        await db.commit()
        print(f"Inserted {inserted} node_sources rows.")


if __name__ == "__main__":
    asyncio.run(backfill())
