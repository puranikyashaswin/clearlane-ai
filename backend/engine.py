import json
import json
import time
from pathlib import Path
import polars as pl
import h3
import structlog

# Initialize enterprise logger
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer()
    ]
)
logger = structlog.get_logger()

# --- CONSTANTS ---
H3_RESOLUTION = 9
CSV_FILENAME = "jan to may police violation_anonymized791b166.csv"

# All values MUST be floats (e.g., 12.0) to prevent Polars Int/Float type crashes
SPACE_MAP = {
    "CAR": 12.0, "JEEP": 14.0, "PASSENGER AUTO": 6.0, "GOODS AUTO": 6.0,
    "MAXI-CAB": 10.0, "SCOOTER": 2.5, "MOTOR CYCLE": 2.5, "MOPED": 2.5,
    "BUS (BMTC/KSRTC)": 35.0, "PRIVATE BUS": 35.0, "LORRY/GOODS VEHICLE": 25.0,
    "HGV": 25.0, "LGV": 15.0, "VAN": 12.0, "TEMPO": 15.0, "TRACTOR": 20.0,
    "TANKER": 25.0, "MINI LORRY": 15.0, "TOURIST BUS": 35.0, "SCHOOL VEHICLE": 35.0,
    "FACTORY BUS": 35.0, "OTHERS": 5.0
}

HEAVY_VEHICLES = {
    "BUS (BMTC/KSRTC)", "PRIVATE BUS", "LORRY/GOODS VEHICLE", "HGV",
    "LGV", "TANKER", "TOURIST BUS", "SCHOOL VEHICLE", "FACTORY BUS",
    "TRACTOR", "MINI LORRY", "TEMPO",
}

def find_csv() -> Path:
    """Dynamically find the CSV in the current directory or parent directory."""
    current_dir = Path(__file__).parent.resolve()
    parent_dir = current_dir.parent
    
    if (current_dir / CSV_FILENAME).exists():
        return current_dir / CSV_FILENAME
    elif (parent_dir / CSV_FILENAME).exists():
        return parent_dir / CSV_FILENAME
    else:
        raise FileNotFoundError(f"Could not find {CSV_FILENAME} in {current_dir} or {parent_dir}")

def main():
    start_time = time.time()
    logger.info("pipeline_start")
    
    try:
        csv_path = find_csv()
        logger.info("loading_csv", path=str(csv_path))
        
        # 1. Load and Clean
        df = pl.read_csv(csv_path, ignore_errors=True)
        logger.info("raw_row_count", rows=len(df))
        
        df = df.drop_nulls(subset=["latitude", "longitude"])
        logger.info("after_null_filter", rows=len(df))
        
        # 2. Feature Engineering (Bulletproof Datetime & Space Mapping)
        df = df.with_columns(
            # Slice off the "+00" timezone glitch, then parse
            pl.col("created_datetime")
            .str.slice(0, 19)
            .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
            .alias("parsed_dt")
        ).with_columns(
            pl.col("parsed_dt").dt.hour().alias("hour")
        ).with_columns(
            (pl.col("hour").is_between(8, 10) | pl.col("hour").is_between(17, 20)).alias("is_peak")
        ).with_columns(
            # Map vehicle types to physical space, default=5.0 prevents crashes on unknown types
            pl.col("vehicle_type")
            .replace(SPACE_MAP, default=5.0)
            .alias("vehicle_space_sqm")
        )
        
        # 3. H3 Spatial Indexing (Fastest method for Polars + H3)
        lats = df["latitude"].to_list()
        lngs = df["longitude"].to_list()
        h3_indices = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
        df = df.with_columns(pl.Series("h3_index", h3_indices))
        
        # CIS penalty per row
        cis_penalties = []
        for row in df.iter_rows(named=True):
            penalty = 0
            jn = row.get("junction_name")
            if jn and str(jn).strip() not in ("No Junction", "", "None"):
                penalty += 30
            vt = row.get("violation_type")
            if vt:
                try:
                    types = json.loads(vt) if isinstance(vt, str) else [vt]
                    if isinstance(types, str):
                        types = [types]
                    for t in types:
                        tu = str(t).upper().strip()
                        if "PARKING IN A MAIN ROAD" in tu:
                            penalty += 25
                        elif "DOUBLE PARKING" in tu:
                            penalty += 20
                        elif "PARKING OPPOSITE" in tu:
                            penalty += 20
                        elif any(x in tu for x in ["BUSTOP", "SCHOOL", "HOSPITAL"]):
                            penalty += 15
                except (json.JSONDecodeError, TypeError):
                    pass
            vt_type = row.get("vehicle_type")
            if vt_type and str(vt_type) in HEAVY_VEHICLES:
                penalty += 10
            cis_penalties.append(penalty)
        df = df.with_columns(pl.Series("cis_penalty", cis_penalties))
        
        # 4. Aggregation
        agg_df = df.group_by("h3_index").agg(
            pl.count().alias("violation_count"),
            pl.sum("vehicle_space_sqm").alias("total_space_wasted"),
            pl.sum("is_peak").alias("peak_violations"),
            pl.sum("cis_penalty").alias("cis_penalty_total"),
            pl.mean("latitude").alias("center_lat"),
            pl.mean("longitude").alias("center_lng"),
            pl.col("vehicle_type").mode().first().alias("primary_vehicle"),
            pl.col("location").fill_null("").str.split(",").list.first().mode().first().alias("place_name"),
            pl.col("violation_type").mode().first().alias("top_violation_type"),
            pl.col("police_station").mode().first().alias("police_station"),
        )
        
        # 5. Proxy Congestion Index (PCI) Math
        agg_df = agg_df.with_columns(
            (pl.col("total_space_wasted") / 1400.0).clip(0.0, 0.8).alias("capacity_drop")
        ).with_columns(
            (pl.col("capacity_drop") * pl.col("peak_violations") * 15.0).alias("estimated_delay_mins")
        )
        
        logger.info("hexagons_generated", unique_hexes=len(agg_df))
        
        # 6. Vehicle type breakdown per hex
        vehicle_counts = (
            df.group_by(["h3_index", "vehicle_type"])
            .agg(pl.len().alias("count"))
        )
        vehicle_lookup: dict[str, dict[str, int]] = {}
        for row in vehicle_counts.iter_rows(named=True):
            key = str(row["h3_index"])
            if key not in vehicle_lookup:
                vehicle_lookup[key] = {}
            vtype = str(row["vehicle_type"]) if row["vehicle_type"] else "UNKNOWN"
            vehicle_lookup[key][vtype] = int(row["count"])
        
        # 7. Build GeoJSON
        features = []
        for row in agg_df.iter_rows(named=True):
            boundary = h3.cell_to_boundary(row["h3_index"])
            # GeoJSON requires [lng, lat], H3 returns (lat, lng)
            polygon_coords = [[p[1], p[0]] for p in boundary]
            
            h3_key = str(row["h3_index"])
            vehicle_breakdown: dict[str, int] = vehicle_lookup.get(h3_key, {})
            
            # CIS
            cis_penalty_total = float(row.get("cis_penalty_total", 0))
            V_cis = int(row["violation_count"])
            cis_multiplier = min(V_cis / 5.0, 3.0)
            cis_score = round(cis_penalty_total * cis_multiplier, 1)
            if cis_score <= 40:
                cis_label = "Low impact"
            elif cis_score <= 80:
                cis_label = "Moderate — reduces lane capacity"
            elif cis_score <= 120:
                cis_label = "High — likely causing queues"
            else:
                cis_label = "Critical — intersection-level gridlock risk"
            
            # Parse violation type
            raw_vt = str(row.get("top_violation_type", "Unknown"))
            top_type = raw_vt.strip("[]").strip("\"") if raw_vt else "Unknown"
            if top_type.startswith("\"") and top_type.endswith("\""):
                top_type = top_type.strip("\"")
            
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [polygon_coords]
                },
                "properties": {
                    "h3_index": h3_key,
                    "violation_count": int(row["violation_count"]),
                    "total_space_wasted": float(row["total_space_wasted"]),
                    "peak_violations": int(row["peak_violations"]),
                    "estimated_delay_mins": float(row["estimated_delay_mins"]),
                    "center": [float(row["center_lng"]), float(row["center_lat"])],
                    "primary_vehicle": str(row["primary_vehicle"]) if row["primary_vehicle"] else "Mixed",
                    "place_name": (
                        str(row["place_name"]).strip()
                        if row.get("place_name") is not None
                        and str(row["place_name"]).strip()
                        else None
                    ),
                    "top_violation_type": top_type,
                    "police_station": str(row["police_station"]) if row.get("police_station") else "Unknown",
                    "vehicle_breakdown": vehicle_breakdown,
                    "cis_score": cis_score,
                    "cis_label": cis_label,
                }
            })
            
        geojson = {"type": "FeatureCollection", "features": features}
        
        # Save to backend directory
        output_path = Path(__file__).parent / "hotspots.json"
        with open(output_path, "w") as f:
            json.dump(geojson, f)
            
        elapsed = round(time.time() - start_time, 2)
        logger.info("pipeline_complete", elapsed_seconds=elapsed, output_file=str(output_path))
        
    except Exception as e:
        logger.error("pipeline_failed", error=str(e))
        raise

if __name__ == "__main__":
    main()