#!/usr/bin/env python3
"""Build a read-only Rhino object inventory for safe Tracker catalogue cleanup.

All Rhino object GUIDs are included: this intentionally errs toward retaining
old records rather than deleting an object missing its render mesh.
"""
import datetime as dt
import hashlib
import json
import pathlib
import sys

import rhino3dm

source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "model.3dm")
destination = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "assets/catalog/model-inventory.json")
data = source.read_bytes()
model = rhino3dm.File3dm.Read(str(source))
if model is None:
    raise SystemExit(f"Could not parse Rhino model: {source}")

ids = set()
types = {}
for obj in model.Objects:
    try:
        uid = str(obj.Attributes.Id).strip().lower()
        kind = type(obj.Geometry).__name__
    except (AttributeError, ValueError):
        continue
    if uid and uid != "00000000-0000-0000-0000-000000000000":
        ids.add(uid)
        types[kind] = types.get(kind, 0) + 1

if not ids or len(ids) < 10:
    raise SystemExit(f"Unsafe/empty model inventory ({len(ids)} IDs); refusing to publish.")

out = {
    "source": "model.3dm",
    "sha256": hashlib.sha256(data).hexdigest(),
    "total_objects": len(ids),
    "object_types": dict(sorted(types.items())),
    "rhino_object_ids": sorted(ids),
    "note": "Only rows whose Rhino GUID is absent from ALL model objects qualify as stale.",
}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
print("MODEL_SHA256:", out["sha256"])
print("OBJECT_COUNT:", out["total_objects"])
print("OBJECT_TYPES:", json.dumps(out["object_types"], sort_keys=True))
print("WROTE:", destination)
