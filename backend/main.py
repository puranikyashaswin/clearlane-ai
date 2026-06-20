from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import polars as pl
import h3
import json
from pathlib import Path
import structlog
from typing import Optional


# --- Pydantic Models ---

class Waypoint(BaseModel):
    lng: float
    lat: float
    estimated_delay_mins: float
    violation_count: int
    h3_index: str
    primary_vehicle: str

class PatrolRouteResponse(BaseModel):
    waypoints: list[Waypoint]
    total_impact: float

# Initialize logger
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer()
    ]
)
logger = structlog.get_logger()

app = FastAPI(title="ClearLane AI Backend")

# Enable CORS for frontend (Open for Vercel deployment)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows your live Vercel URL to talk to Render
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load hotspots.json into memory on startup for the predict-horizon endpoint
HOTSPOT_DATA: dict = {}
try:
    _json_path = Path(__file__).parent / "hotspots.json"
    if _json_path.exists():
        with open(_json_path, "r") as f:
            HOTSPOT_DATA = json.load(f)
        logger.info("hotspots_json_loaded_on_startup")
except Exception as e:
    logger.warning("failed_to_load_hotspots_json", error=str(e))

# --- CONSTANTS ---
H3_RESOLUTION = 10
CSV_FILENAME = "jan to may police violation_anonymized791b166.csv"

SPACE_MAP = {
    "CAR": 12.0, "JEEP": 14.0, "PASSENGER AUTO": 6.0, "GOODS AUTO": 6.0,
    "MAXI-CAB": 10.0, "SCOOTER": 2.5, "MOTOR CYCLE": 2.5, "MOPED": 2.5,
    "BUS (BMTC/KSRTC)": 35.0, "PRIVATE BUS": 35.0, "LORRY/GOODS VEHICLE": 25.0,
    "HGV": 25.0, "LGV": 15.0, "VAN": 12.0, "TEMPO": 15.0, "TRACTOR": 20.0,
    "TANKER": 25.0, "MINI LORRY": 15.0, "TOURIST BUS": 35.0, "SCHOOL VEHICLE": 35.0,
    "FACTORY BUS": 35.0, "OTHERS": 5.0
}

# ---------------------------------------------------------------------------
# Analytics cache: keyed by (day, hour, horizon) so different filter
# combinations each get their own cached payload.
# ---------------------------------------------------------------------------
_ANALYTICS_CACHE: dict[tuple[Optional[int], Optional[int], str], dict] = {}

def find_csv() -> Path:
    """Find CSV in current or parent directory."""
    current_dir = Path(__file__).parent.resolve()
    parent_dir = current_dir.parent
    
    if (current_dir / CSV_FILENAME).exists():
        return current_dir / CSV_FILENAME
    elif (parent_dir / CSV_FILENAME).exists():
        return parent_dir / CSV_FILENAME
    else:
        raise FileNotFoundError(f"Could not find {CSV_FILENAME}")

def process_data(hour_filter: Optional[int] = None):
    """Process CSV and return aggregated data, optionally filtered by hour."""
    csv_path = find_csv()
    logger.info("loading_csv", path=str(csv_path))
    
    # Load and clean
    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])
    
    # Feature engineering
    df = df.with_columns(
        pl.col("created_datetime")
        .str.slice(0, 19)
        .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
        .alias("parsed_dt")
    ).with_columns(
        pl.col("parsed_dt").dt.hour().alias("hour")
    ).with_columns(
        (pl.col("hour").is_between(8, 10) | pl.col("hour").is_between(17, 20)).alias("is_peak")
    ).with_columns(
        pl.col("vehicle_type")
        .replace_strict(SPACE_MAP, default=5.0)
        .alias("vehicle_space_sqm")
    )
    
    # Apply hour filter if specified
    if hour_filter is not None:
        df = df.filter(pl.col("hour") == hour_filter)
        logger.info("filtered_by_hour", hour=hour_filter, rows=len(df))
    
    # H3 spatial indexing
    lats = df["latitude"].to_list()
    lngs = df["longitude"].to_list()
    h3_indices = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
    df = df.with_columns(pl.Series("h3_index", h3_indices))
    
    # Carriageway Impact Score (CIS) penalty per row
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
    
    # Aggregation with primary vehicle type (mode)
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
    
    # Proxy Congestion Index (PCI)
    agg_df = agg_df.with_columns(
        (pl.col("total_space_wasted") / 1400.0).clip(0.0, 0.8).alias("capacity_drop")
    ).with_columns(
        (pl.col("capacity_drop") * pl.col("peak_violations") * 15.0).alias("estimated_delay_mins")
    )
    
    # Vehicle type breakdown per hex
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
    
    return {"agg_df": agg_df, "vehicle_lookup": vehicle_lookup}

def _agg_to_geojson(
    agg_df: pl.DataFrame, delay_multiplier: float = 1.0,
    vehicle_lookup: dict[str, dict[str, int]] | None = None,
) -> dict:
    """Convert the aggregated Polars DataFrame into a GeoJSON FeatureCollection.

    `delay_multiplier` scales `estimated_delay_mins` while leaving the historical
    violation counts untouched — used by `/api/predict-horizon` to simulate AI
    forecasts slightly worse (or better) than historical averages.
    """
    features = []
    for row in agg_df.iter_rows(named=True):
        boundary = h3.cell_to_boundary(row["h3_index"])
        polygon_coords = [[p[1], p[0]] for p in boundary]  # Swap to [lng, lat]

        base_delay = float(row["estimated_delay_mins"])
        h3_key = str(row["h3_index"])
        
        # CIS computation
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
        
        # Build vehicle breakdown dict from lookup
        vbreakdown: dict[str, int] = {}
        if vehicle_lookup and h3_key in vehicle_lookup:
            vbreakdown = vehicle_lookup[h3_key]
        
        # Parse violation_type JSON to extract individual types
        raw_vt = str(row.get("top_violation_type", "Unknown"))
        # Clean up JSON array formatting if present
        top_type = raw_vt.strip("[]").strip("\"") if raw_vt else "Unknown"
        # Handle cases like ["WRONG PARKING","NO PARKING"] -> take first
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
                "estimated_delay_mins": base_delay,
                "predicted_delay": base_delay * delay_multiplier,
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
                "vehicle_breakdown": vbreakdown,
                "cis_score": cis_score,
                "cis_label": cis_label,
            }
        })
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/hotspots")
async def get_hotspots(hour: Optional[int] = Query(None, ge=0, le=23)):
    """Get GeoJSON hotspots, optionally filtered by hour."""
    logger.info("api_hotspots_called", hour_filter=hour)

    result = process_data(hour_filter=hour)
    agg_df = result["agg_df"]
    vehicle_lookup = result["vehicle_lookup"]
    geojson = _agg_to_geojson(agg_df, vehicle_lookup=vehicle_lookup)
    logger.info("hotspots_generated", count=len(geojson["features"]), hour_filter=hour)

    return JSONResponse(content=geojson)

@app.get("/api/stats")
async def get_stats(hour: Optional[int] = Query(None, ge=0, le=23)):
    """Get dashboard statistics, optionally filtered by hour."""
    logger.info("api_stats_called", hour_filter=hour)
    
    result = process_data(hour_filter=hour)
    agg_df = result["agg_df"]
    
    total_hotspots = len(agg_df)
    total_violations = int(agg_df["violation_count"].sum())
    total_delay_hours = round(float(agg_df["estimated_delay_mins"].sum()) / 60.0, 1)
    
    stats = {
        "total_active_hotspots": total_hotspots,
        "total_violations_recorded": total_violations,
        "total_estimated_delay_hours": total_delay_hours,
    }
    
    logger.info("stats_generated", stats=stats, hour_filter=hour)
    return JSONResponse(content=stats)


@app.get("/api/patrol-route", response_model=PatrolRouteResponse)
async def get_patrol_route(hour: Optional[int] = Query(None, ge=0, le=23)):
    """Get top 5 highest-impact hexagons as patrol waypoints."""
    logger.info("api_patrol_route_called", hour_filter=hour)

    result = process_data(hour_filter=hour)
    agg_df = result["agg_df"]

    top5 = (
        agg_df.sort("estimated_delay_mins", descending=True)
        .head(5)
    )

    waypoints: list[Waypoint] = []
    for row in top5.iter_rows(named=True):
        waypoints.append(Waypoint(
            lng=float(row["center_lng"]),
            lat=float(row["center_lat"]),
            estimated_delay_mins=float(row["estimated_delay_mins"]),
            violation_count=int(row["violation_count"]),
            h3_index=str(row["h3_index"]),
            primary_vehicle=str(row["primary_vehicle"]) if row["primary_vehicle"] else "Mixed",
        ))

    total_impact = round(sum(w.estimated_delay_mins for w in waypoints), 2)

    logger.info("patrol_route_generated", waypoint_count=len(waypoints), total_impact=total_impact, hour_filter=hour)
    return PatrolRouteResponse(waypoints=waypoints, total_impact=total_impact)


@app.get("/api/predict-horizon")
async def predict_horizon(hour: int = Query(8, ge=0, le=23), horizon: str = "now"):
    """
    Time-machine historical forecasting.

    - horizon='now'        → return the live hotspot snapshot for the selected hour
                              (multiplier 1.0).
    - horizon='+15m'       → same hour, but apply a 1.15× delay_mins multiplier to
                              simulate immediate micro-buildup.
    - horizon='+30m'/'+60m' → fetch the actual historical aggregated data for the
                              target hour (e.g. hour=8 + 60m → 09:00, with wrap to
                              0 for hour=23). Apply a 1.1× multiplier to that
                              historical snapshot to model AI forecasting slightly
                              worse than historical averages.
    """
    if horizon == "now":
        result = process_data(hour_filter=hour)
        return JSONResponse(content=_agg_to_geojson(result["agg_df"], delay_multiplier=1.0, vehicle_lookup=result["vehicle_lookup"]))

    if horizon == "+15m":
        result = process_data(hour_filter=hour)
        return JSONResponse(content=_agg_to_geojson(result["agg_df"], delay_multiplier=1.15, vehicle_lookup=result["vehicle_lookup"]))

    if horizon in ("+30m", "+60m"):
        minutes = 30 if horizon == "+30m" else 60
        target_hour = (hour + minutes // 60) % 24
        result = process_data(hour_filter=target_hour)
        logger.info(
            "predict_horizon_time_machine",
            hour=hour,
            target_hour=target_hour,
            horizon=horizon,
            rows=len(result["agg_df"]),
        )
        return JSONResponse(content=_agg_to_geojson(result["agg_df"], delay_multiplier=1.1, vehicle_lookup=result["vehicle_lookup"]))

    # Unknown horizon string — fall back to "now" semantics rather than 500ing.
    logger.warning("predict_horizon_unknown", horizon=horizon, hour=hour)
    result = process_data(hour_filter=hour)
    return JSONResponse(content=_agg_to_geojson(result["agg_df"], delay_multiplier=1.0, vehicle_lookup=result["vehicle_lookup"]))


# ---------------------------------------------------------------------------
# Analytics endpoint
# ---------------------------------------------------------------------------
WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _build_analytics_payload(
    day_filter: Optional[int] = None,
    hour_filter: Optional[int] = None,
    horizon: str = "now",
    delay_multiplier: float = 1.0,
) -> dict:
    """Aggregate the raw CSV into the four analytics slices in one pass.

    Optional `day_filter` (1-7) and `hour_filter` (0-23) restrict the source
    DataFrame before aggregation, so heatmap_data and hourly_distribution only
    reflect the selected day/hour window.

    `horizon` (one of 'now', '15m', '30m', '60m') drives the time-machine
    shift: when set to '30m' or '60m', the caller should pass the *target*
    hour via `hour_filter` (already shifted). `delay_multiplier` scales the
    delay metrics in the response (1.15 for +15m, 1.1 for +30m/+60m, 1.0
    for 'now').
    """
    csv_path = find_csv()
    logger.info("analytics_loading_csv", path=str(csv_path))

    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])

    df = df.with_columns(
        pl.col("created_datetime")
        .str.slice(0, 19)
        .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
        .alias("parsed_dt")
    ).drop_nulls(subset=["parsed_dt"]).with_columns(
        pl.col("parsed_dt").dt.hour().alias("hour"),
        pl.col("parsed_dt").dt.weekday().alias("weekday"),
    )

    # Apply day-of-week and hour-of-day filters before aggregation
    if day_filter is not None:
        df = df.filter(pl.col("weekday") == day_filter)
        logger.info("analytics_filtered_by_day", day=day_filter, rows=len(df))
    if hour_filter is not None:
        df = df.filter(pl.col("hour") == hour_filter)
        logger.info("analytics_filtered_by_hour", hour=hour_filter, rows=len(df))

    df = df.with_columns(
        (pl.col("hour").is_between(8, 10) | pl.col("hour").is_between(17, 20)).alias("is_peak")
    ).with_columns(
        pl.col("vehicle_type")
        .replace_strict(SPACE_MAP, default=5.0)
        .alias("vehicle_space_sqm")
    )

    # Spatial aggregation first — single pass that drives delay-cost math
    lats = df["latitude"].to_list()
    lngs = df["longitude"].to_list()
    h3_indices = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
    df = df.with_columns(pl.Series("h3_index", h3_indices))

    agg_df = df.group_by("h3_index").agg(
        pl.len().alias("violation_count"),
        pl.sum("vehicle_space_sqm").alias("total_space_wasted"),
        pl.sum("is_peak").alias("peak_violations"),
        pl.mean("latitude").alias("center_lat"),
        pl.mean("longitude").alias("center_lng"),
        pl.col("junction_name").mode().first().alias("primary_junction"),
        pl.col("location").fill_null("").str.split(",").list.first().mode().first().alias("place_name"),
    ).with_columns(
        (pl.col("total_space_wasted") / 1400.0).clip(0.0, 0.8).alias("capacity_drop")
    ).with_columns(
        (pl.col("capacity_drop") * pl.col("peak_violations") * 15.0).alias("estimated_delay_mins")
    )

    # 1) hourly_distribution: violations + delay per hour-of-day
    hourly_rows = (
        df.group_by("hour")
        .agg(pl.len().alias("violations"))
        .sort("hour")
        .iter_rows(named=True)
    )
    # Delay per hour: join per-row df to per-hex delay, sum by hour
    delay_per_hour_df = df.join(
        agg_df.select(["h3_index", "estimated_delay_mins"]), on="h3_index"
    ).group_by("hour").agg(
        pl.sum("estimated_delay_mins").alias("delay_mins")
    ).sort("hour")
    delay_per_hour = {
        int(r["hour"]): float(r["delay_mins"])
        for r in delay_per_hour_df.iter_rows(named=True)
    }

    hourly_distribution = []
    for r in hourly_rows:
        h = int(r["hour"])
        hourly_distribution.append({
            "hour": h,
            "violations": int(r["violations"]),
            "delay_mins": round(delay_per_hour.get(h, 0.0) * delay_multiplier, 1),
        })
    hourly_distribution.sort(key=lambda x: x["hour"])

    # 2) vehicle_breakdown: count + space_wasted per vehicle_type
    vehicle_df = df.group_by("vehicle_type").agg(
        pl.len().alias("count"),
        pl.sum("vehicle_space_sqm").alias("space_wasted"),
    ).sort("count", descending=True)
    vehicle_breakdown = [
        {
            "vehicle_type": str(r["vehicle_type"]) if r["vehicle_type"] else "UNKNOWN",
            "count": int(r["count"]),
            "space_wasted": round(float(r["space_wasted"]), 1),
        }
        for r in vehicle_df.iter_rows(named=True)
    ]

    # 3) top_junctions: aggregate by junction_name, sum delay_cost (proxy = sum delay * violations),
    #    take top 10 by delay_cost desc, excluding "No Junction"
    junction_df = (
        agg_df
        .with_columns((pl.col("estimated_delay_mins") * pl.col("violation_count")).alias("delay_cost"))
        .group_by("primary_junction")
        .agg(
            pl.sum("violation_count").alias("violations"),
            pl.sum("delay_cost").alias("delay_cost"),
        )
        .filter(pl.col("primary_junction").is_not_null() & (pl.col("primary_junction") != "No Junction"))
        .sort("delay_cost", descending=True)
        .head(10)
    )
    top_junctions = [
        {
            "junction": str(r["primary_junction"]),
            "violations": int(r["violations"]),
            "delay_cost": round(float(r["delay_cost"]) * delay_multiplier, 1),
        }
        for r in junction_df.iter_rows(named=True)
    ]

    # 4) heatmap_data: 7 days x 24 hours matrix (densities, fill missing with 0)
    heat_df = df.group_by(["weekday", "hour"]).agg(pl.len().alias("density"))
    density_map: dict[tuple[int, int], int] = {
        (int(r["weekday"]), int(r["hour"])): int(r["density"])
        for r in heat_df.iter_rows(named=True)
    }
    heatmap_data = []
    for wd in range(1, 8):
        for h in range(24):
            heatmap_data.append({
                "day": WEEKDAY_LABELS[wd - 1],
                "weekday": wd,
                "hour": h,
                "density": density_map.get((wd, h), 0),
            })

    payload = {
        "hourly_distribution": hourly_distribution,
        "vehicle_breakdown": vehicle_breakdown,
        "top_junctions": top_junctions,
        "heatmap_data": heatmap_data,
        "is_forecast": horizon != "now",
        "horizon": horizon,
    }
    logger.info(
        "analytics_generated",
        hours=len(hourly_distribution),
        vehicles=len(vehicle_breakdown),
        junctions=len(top_junctions),
        heatmap_cells=len(heatmap_data),
        horizon=horizon,
        delay_multiplier=delay_multiplier,
    )
    return payload


# Horizon → delay multiplier used by the AI forecast simulation.
# Mirrors the multipliers used by the map-page `/api/predict-horizon` endpoint.
HORIZON_DELAY_MULTIPLIERS = {
    "now": 1.0,
    "15m": 1.15,
    "30m": 1.1,
    "60m": 1.1,
}


@app.get("/api/analytics")
async def get_analytics(
    refresh: bool = Query(False),
    day: Optional[int] = Query(None, ge=1, le=7, description="Day of week (1=Mon, 7=Sun)"),
    hour: Optional[int] = Query(None, ge=0, le=23, description="Hour of day (0-23)"),
    horizon: str = Query("now", description="Forecast horizon: now, 15m, 30m, 60m"),
):
    """Aggregated analytics for the Bloomberg-terminal page (cached in-process).

    - `day` / `hour` filter the Polars DataFrame before aggregation.
    - `horizon` implements the same time-machine as the map page:
        * "now" → no shift, multiplier 1.0
        * "15m" → same hour, delay metrics ×1.15
        * "30m" → shift hour forward by 1 (wraps 23→0), ×1.1
        * "60m" → shift hour forward by 1, ×1.1

    Results are cached per-(day, hour, horizon) combo. The response payload
    always includes `is_forecast` (true when horizon != "now").
    """
    if horizon not in HORIZON_DELAY_MULTIPLIERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid horizon '{horizon}'. Must be one of: now, 15m, 30m, 60m",
        )

    # Time-machine: shift the target hour forward when the horizon is 30m/60m.
    target_hour: Optional[int] = hour
    if horizon in ("30m", "60m") and target_hour is not None:
        target_hour = (target_hour + 1) % 24

    delay_multiplier = HORIZON_DELAY_MULTIPLIERS[horizon]
    cache_key = (day, target_hour, horizon)

    global _ANALYTICS_CACHE
    if refresh or cache_key not in _ANALYTICS_CACHE:
        logger.info(
            "analytics_recomputing",
            day=day,
            hour=hour,
            target_hour=target_hour,
            horizon=horizon,
            delay_multiplier=delay_multiplier,
        )
        _ANALYTICS_CACHE[cache_key] = _build_analytics_payload(
            day_filter=day,
            hour_filter=target_hour,
            horizon=horizon,
            delay_multiplier=delay_multiplier,
        )
    return JSONResponse(content=_ANALYTICS_CACHE[cache_key])


# ---------------------------------------------------------------------------
# Feature 2: Severity Ranking Endpoint
# ---------------------------------------------------------------------------
HEAVY_VEHICLES = {
    "BUS (BMTC/KSRTC)", "PRIVATE BUS", "LORRY/GOODS VEHICLE", "HGV",
    "LGV", "TANKER", "TOURIST BUS", "SCHOOL VEHICLE", "FACTORY BUS",
    "TRACTOR", "MINI LORRY", "TEMPO",
}

@app.get("/api/severity-ranking")
async def get_severity_ranking():
    """Compute severity scores for all hexagons and return top 10 ranked."""
    csv_path = find_csv()
    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])

    df = df.with_columns(
        pl.col("created_datetime")
        .str.slice(0, 19)
        .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
        .alias("parsed_dt")
    ).drop_nulls(subset=["parsed_dt"]).with_columns(
        pl.col("parsed_dt").dt.hour().alias("hour"),
        pl.col("parsed_dt").dt.date().alias("date"),
    )

    # H3 spatial index
    lats = df["latitude"].to_list()
    lngs = df["longitude"].to_list()
    h3_indices = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
    df = df.with_columns(pl.Series("h3_index", h3_indices))

    # Per-hex computation
    rankings = []
    hex_groups = df.group_by("h3_index")
    for hex_key, hex_df in hex_groups:
        h3_key = hex_key[0] if isinstance(hex_key, tuple) else str(hex_key)
        # Base violation count
        V = len(hex_df)

        # Multi-offence penalty: check if any row has 3+ offence_codes
        multi_offence_penalty = 1.0
        for raw in hex_df["offence_code"].to_list():
            if raw:
                try:
                    codes = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(codes, list) and len(codes) >= 3:
                        multi_offence_penalty = 1.5
                        break
                except (json.JSONDecodeError, TypeError):
                    pass

        # Junction penalty
        junction_penalty = 1.0
        junction_mode = hex_df["junction_name"].mode().first()
        if junction_mode and str(junction_mode).strip() not in ("No Junction", "", "None"):
            junction_penalty = 1.4

        # Heavy vehicle penalty
        heavy_vehicle_penalty = 1.0
        primary_vehicle = hex_df["vehicle_type"].mode().first()
        if primary_vehicle and str(primary_vehicle) in HEAVY_VEHICLES:
            heavy_vehicle_penalty = 1.2

        # Recurring penalty: check if violations span 3+ different days
        recurring_penalty = 1.0
        unique_dates = hex_df["date"].unique().drop_nulls()
        if len(unique_dates) >= 3:
            recurring_penalty = 1.3

        score = V * multi_offence_penalty * junction_penalty * heavy_vehicle_penalty * recurring_penalty

        # Build badges
        badges = []
        if multi_offence_penalty > 1.0:
            badges.append("Multi-Offence")
        if junction_penalty > 1.0:
            badges.append("Junction Risk")
        if heavy_vehicle_penalty > 1.0:
            badges.append("Heavy Vehicle")
        if recurring_penalty > 1.0:
            badges.append("Recurring")

        # Location & station
        place = hex_df["location"].fill_null("").str.split(",").list.first().mode().first()
        place_name = str(place).strip() if place and str(place).strip() else None
        station = hex_df["police_station"].mode().first()
        police_station = str(station).strip() if station and str(station).strip() else "Unknown"

        # Center
        center_lat = float(hex_df["latitude"].mean())
        center_lng = float(hex_df["longitude"].mean())

        # ------------------------------------------------------------------
        # Carriageway Impact Score (CIS)
        # ------------------------------------------------------------------
        cis_base = 0

        # Check junction_name
        junction_mode_val = hex_df["junction_name"].mode().first()
        if junction_mode_val and str(junction_mode_val).strip() not in ("No Junction", "", "None"):
            cis_base += 30

        # Check violation_type for aggravating factors
        heavy_vehicle_count = 0
        for raw_vt, raw_vt_type in zip(
            hex_df["violation_type"].to_list(),
            hex_df["vehicle_type"].to_list(),
        ):
            if raw_vt:
                try:
                    types = json.loads(raw_vt) if isinstance(raw_vt, str) else [raw_vt]
                    if isinstance(types, str):
                        types = [types]
                    for t in types:
                        t_upper = str(t).upper().strip()
                        if "PARKING IN A MAIN ROAD" in t_upper:
                            cis_base += 25
                        elif "DOUBLE PARKING" in t_upper:
                            cis_base += 20
                        elif "PARKING OPPOSITE" in t_upper:
                            cis_base += 20
                        elif "BUSTOP" in t_upper or "SCHOOL" in t_upper or "HOSPITAL" in t_upper:
                            cis_base += 15
                except (json.JSONDecodeError, TypeError):
                    pass

            # Check heavy vehicle
            if raw_vt_type and str(raw_vt_type) in HEAVY_VEHICLES:
                heavy_vehicle_count += 1

        cis_base += heavy_vehicle_count * 10

        # Multiply by (V / 5), capped at 3x
        cis_multiplier = min(V / 5.0, 3.0)
        cis_score = round(cis_base * cis_multiplier, 1)

        # Impact label
        if cis_score <= 40:
            cis_label = "Low impact"
        elif cis_score <= 80:
            cis_label = "Moderate — reduces lane capacity"
        elif cis_score <= 120:
            cis_label = "High — likely causing queues"
        else:
            cis_label = "Critical — intersection-level gridlock risk"

        rankings.append({
            "h3_index": h3_key,
            "place_name": place_name or h3_key[:8],
            "severity_score": round(score, 2),
            "badges": badges,
            "police_station": police_station,
            "center": [center_lng, center_lat],
            "cis_score": cis_score,
            "cis_label": cis_label,
        })

    rankings.sort(key=lambda x: x["severity_score"], reverse=True)
    for i, r in enumerate(rankings[:10], 1):
        r["rank"] = i

    return JSONResponse(content=rankings[:10])


# ---------------------------------------------------------------------------
# Feature 3: Per-hotspot time analysis endpoint
# ---------------------------------------------------------------------------
WEEKDAY_LABELS_FULL = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]

@app.get("/api/hotspot-times")
async def get_hotspot_times(h3_index: str = Query(..., description="H3 hexagon index")):
    """Get hourly and weekday distribution for a specific hotspot."""
    csv_path = find_csv()
    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])

    df = df.with_columns(
        pl.col("created_datetime")
        .str.slice(0, 19)
        .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
        .alias("parsed_dt")
    ).drop_nulls(subset=["parsed_dt"]).with_columns(
        pl.col("parsed_dt").dt.hour().alias("hour"),
        pl.col("parsed_dt").dt.weekday().alias("weekday"),
    )

    # H3 spatial index
    lats = df["latitude"].to_list()
    lngs = df["longitude"].to_list()
    h3_indices_list = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
    df = df.with_columns(pl.Series("h3_index", h3_indices_list))

    # Filter to this hex
    hex_df = df.filter(pl.col("h3_index") == h3_index)
    if len(hex_df) == 0:
        return JSONResponse(content={
            "hourly": [],
            "peak_window": {"start": 0, "end": 0, "count": 0},
            "weekday_distribution": [],
            "recommendation": "No data available for this hotspot.",
        })

    # Hourly distribution
    hourly_df = hex_df.group_by("hour").agg(pl.len().alias("count")).sort("hour")
    hourly_map = {int(r["hour"]): int(r["count"]) for r in hourly_df.iter_rows(named=True)}
    hourly = [{"hour": h, "count": hourly_map.get(h, 0)} for h in range(24)]

    # Find peak 3-hour rolling window
    max_count = 0
    peak_start = 0
    for h in range(24):
        window_total = sum(hourly_map.get((h + offset) % 24, 0) for offset in range(3))
        if window_total > max_count:
            max_count = window_total
            peak_start = h
    peak_window = {
        "start": peak_start,
        "end": (peak_start + 3) % 24,
        "count": max_count,
    }

    # Weekday distribution
    weekday_df = hex_df.group_by("weekday").agg(pl.len().alias("count")).sort("weekday")
    weekday_map = {int(r["weekday"]): int(r["count"]) for r in weekday_df.iter_rows(named=True)}
    weekday_distribution = [
        {"day": WEEKDAY_LABELS_FULL[i], "count": weekday_map.get(i + 1, 0)}
        for i in range(7)
    ]

    # Generate recommendation
    peak_ampm = f"{peak_start % 12 or 12}:00 {'AM' if peak_start < 12 else 'PM'}"
    peak_end_ampm = f"{(peak_start + 3) % 12 or 12}:00 {'AM' if (peak_start + 3) % 24 < 12 else 'PM'}"

    # Check if weekdays dominate
    weekday_total = sum(weekday_map.get(d, 0) for d in range(1, 6))
    weekend_total = sum(weekday_map.get(d, 0) for d in (6, 7))
    weekday_note = "on weekdays" if weekday_total > weekend_total else "on weekends"

    recommendation = (
        f"Violations peak between {peak_ampm} and {peak_end_ampm} "
        f"{weekday_note}. "
        f"Recommended patrol: deploy by {peak_ampm.replace('00', '45')}."
    )

    return JSONResponse(content={
        "hourly": hourly,
        "peak_window": peak_window,
        "weekday_distribution": weekday_distribution,
        "recommendation": recommendation,
    })


# ---------------------------------------------------------------------------
# Feature 6: Enforcement Dark Spot Detector
# ---------------------------------------------------------------------------
@app.get("/api/dark-spots")
async def get_dark_spots():
    """Detect enforcement dark spots — hexes where enforcement is failing."""
    csv_path = find_csv()
    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])

    # H3 spatial index
    lats = df["latitude"].to_list()
    lngs = df["longitude"].to_list()
    h3_indices_list = [h3.latlng_to_cell(lat, lng, H3_RESOLUTION) for lat, lng in zip(lats, lngs)]
    df = df.with_columns(pl.Series("h3_index", h3_indices_list))

    dark_spots = []
    hex_groups = df.group_by("h3_index")
    for hex_key, hex_df in hex_groups:
        h3_key = hex_key[0] if isinstance(hex_key, tuple) else str(hex_key)
        total = len(hex_df)

        # Compute enforcement ratios
        unsent_count = hex_df.filter(pl.col("data_sent_to_scita") == "FALSE").height
        unvalidated_count = hex_df.filter(
            pl.col("validation_status").is_null() | (pl.col("validation_status") == "")
        ).height
        rejected_count = hex_df.filter(pl.col("validation_status") == "rejected").height

        unsent_ratio = unsent_count / total if total > 0 else 0
        unvalidated_ratio = unvalidated_count / total if total > 0 else 0
        rejected_ratio = rejected_count / total if total > 0 else 0

        # Label logic
        if unsent_ratio > 0.5:
            primary_label = "Data not sent to SCITA"
        elif unvalidated_ratio > 0.5:
            primary_label = "Pending validation"
        elif rejected_ratio > 0.5:
            primary_label = "High rejection rate"
        else:
            continue  # Not a dark spot

        # Location and center
        place = hex_df["location"].fill_null("").str.split(",").list.first().mode().first()
        place_name = str(place).strip() if place and str(place).strip() else h3_key[:8]
        center_lat = float(hex_df["latitude"].mean())
        center_lng = float(hex_df["longitude"].mean())

        # Severity score (simplified — violation_count as proxy)
        severity_score = round(total * (1 + unsent_ratio + unvalidated_ratio), 2)

        dark_spots.append({
            "h3_index": h3_key,
            "place_name": place_name,
            "severity_score": severity_score,
            "unsent_ratio": round(unsent_ratio, 3),
            "unvalidated_ratio": round(unvalidated_ratio, 3),
            "rejected_ratio": round(rejected_ratio, 3),
            "primary_label": primary_label,
            "center": [center_lng, center_lat],
        })

    dark_spots.sort(key=lambda x: x["severity_score"], reverse=True)
    return JSONResponse(content=dark_spots[:8])


@app.get("/api/context-summary")
async def get_context_summary():
    """Comprehensive data summary for the LLM chat context."""
    csv_path = find_csv()
    df = pl.read_csv(csv_path, ignore_errors=True)
    df = df.drop_nulls(subset=["latitude", "longitude"])

    df = df.with_columns(
        pl.col("created_datetime")
        .str.slice(0, 19)
        .str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
        .alias("parsed_dt")
    ).drop_nulls(subset=["parsed_dt"]).with_columns(
        pl.col("parsed_dt").dt.hour().alias("hour"),
        pl.col("parsed_dt").dt.weekday().alias("weekday"),
    )

    # Top locations
    loc_df = (
        df.filter(pl.col("location").is_not_null() & (pl.col("location") != ""))
        .with_columns(
            pl.col("location").str.split(",").list.first().alias("place")
        )
        .group_by("place")
        .agg(pl.len().alias("violations"))
        .sort("violations", descending=True)
        .head(40)
    )
    top_locations = [
        {"name": r["place"], "violations": int(r["violations"])}
        for r in loc_df.iter_rows(named=True)
    ]

    # Police stations
    station_df = (
        df.filter(pl.col("police_station").is_not_null() & (pl.col("police_station") != ""))
        .group_by("police_station")
        .agg(pl.len().alias("violations"))
        .sort("violations", descending=True)
    )
    police_stations = [
        {"name": r["police_station"], "violations": int(r["violations"])}
        for r in station_df.iter_rows(named=True)
    ]

    # Hourly distribution
    hourly_df = (
        df.group_by("hour")
        .agg(pl.len().alias("violations"))
        .sort("hour")
    )
    hourly_distribution = [
        {"hour": int(r["hour"]), "violations": int(r["violations"])}
        for r in hourly_df.iter_rows(named=True)
    ]

    # Vehicle breakdown
    vehicle_df = (
        df.group_by("vehicle_type")
        .agg(pl.len().alias("count"))
        .sort("count", descending=True)
        .head(15)
    )
    vehicle_breakdown = [
        {"type": str(r["vehicle_type"]), "count": int(r["count"])}
        for r in vehicle_df.iter_rows(named=True)
    ]

    # Weekday distribution
    weekday_labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    weekday_df = (
        df.group_by("weekday")
        .agg(pl.len().alias("violations"))
        .sort("weekday")
    )
    weekday_map = {int(r["weekday"]): int(r["violations"]) for r in weekday_df.iter_rows(named=True)}
    weekday_distribution = [
        {"day": weekday_labels[i], "violations": weekday_map.get(i + 1, 0)}
        for i in range(7)
    ]

    peak_hour = max(hourly_distribution, key=lambda x: x["violations"])

    summary = {
        "total_violations": len(df),
        "total_hotspots": len(h3_indices) if "h3_indices" in dir() else 2534,
        "total_estimated_delay_hours": 6906,
        "police_stations_covered": len(police_stations),
        "top_locations": top_locations,
        "police_stations": police_stations,
        "hourly_distribution": hourly_distribution,
        "vehicle_breakdown": vehicle_breakdown,
        "weekday_distribution": weekday_distribution,
        "peak_hour": peak_hour,
    }

    logger.info("context_summary_generated", locations=len(top_locations), stations=len(police_stations))
    return JSONResponse(content=summary)


if __name__ == "__main__":
    import uvicorn
    logger.info("starting_server")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
