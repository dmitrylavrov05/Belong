"""Converts Natural Earth land polygons (public domain) into the compact map the app draws.

Usage:
  python3 make_world_map.py ne_50m_land.geojson ../app/src/main/assets/map/world-land.bin
  python3 make_world_map.py ne_110m_land.geojson ../app/src/main/assets/map/world-land-coarse.bin

Source: https://github.com/nvkelso/natural-earth-vector (geojson/), public domain.

Format (big-endian): b"BLW1", int32 ring count, then for each ring an int32 point count
followed by (int16 lon*100, int16 lat*100) pairs. Consecutive duplicates after rounding are dropped.
"""
import json
import struct
import sys


def rings(geometry):
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon


def main(src, dst):
    data = json.load(open(src, encoding="utf-8"))
    out = []
    points = 0
    for feature in data["features"]:
        for ring in rings(feature["geometry"]):
            compact = []
            for lon, lat in ring:
                p = (round(lon * 100), round(lat * 100))
                if not compact or compact[-1] != p:
                    compact.append(p)
            if len(compact) >= 4:
                out.append(compact)
                points += len(compact)
    with open(dst, "wb") as f:
        f.write(b"BLW1")
        f.write(struct.pack(">i", len(out)))
        for ring in out:
            f.write(struct.pack(">i", len(ring)))
            for lon, lat in ring:
                f.write(struct.pack(">hh", max(-18000, min(18000, lon)), max(-9000, min(9000, lat))))
    print(f"{len(out)} rings, {points} points -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
