# ClearLane AI

Real-time dashboard for detecting and quantifying parking-induced congestion in Bengaluru, from 298,000 historical violation records.

---

## The Problem

Bengaluru traffic police currently patrol on a reactive, beat-by-beat basis. Officers respond to complaints rather than data. There is no operational tool that maps where violations overlap with road capacity loss, or that ranks zones by congestion impact to prioritize enforcement. The hackathon problem statement asks for a system that detects hotspots from historical violation data, quantifies their impact on traffic flow, and recommends targeted patrol routes.

The core challenges are spatial: violations happen at street level but congestion propagates through intersections and corridors. Raw violation counts at a point don't tell you whether that spot actually causes delay. You need to factor in road-space consumption (a parked bus blocks far more than a parked scooter), junction proximity, and whether violations cluster during peak hours.

---

## What This Does

### Detect Hotspots

Every violation record (latitude, longitude) is indexed into **H3 hexagons at resolution 8** (roughly 500m per hex, a practical granularity for city-scale enforcement). The frontend displays these as an interactive hexagon map using deck.gl's `H3HexagonLayer`, with a **logarithmic color scale**:

```
t = log2(violation_count + 1) / log2(max_violation_count + 1)
t < 0.33  →  blue-to-yellow gradient
t < 0.66  →  yellow-to-orange transition
else      →  orange-to-deep-red
```

A toggle switches between the hexagon view and a **contour layer** (built from deck.gl's `ContourLayer`) with thresholds at 10, 50, 150, and 500+ violations, giving an alternative density surface view. Hovering any hexagon shows a tooltip with violation count, estimated delay, top violation type, vehicle breakdown, and Carriageway Impact Score.

### Quantify Impact

Impact is computed through two scoring mechanisms in the backend:

**Carriageway Impact Score (CIS).** Per-row penalty assigned to each violation:
- Junction proximity: +30 if the violation is at a named junction (not "No Junction")
- Violation type penalties:
  - Parking in a main road: +25
  - Double parking: +20
  - Parking opposite another parked vehicle: +20
  - Parking near a bus stop, school, or hospital: +15
- Heavy vehicle (bus, lorry, tanker, etc.): +10

These per-row penalties are summed per hexagon (`cis_penalty_total`), then scaled by a multiplier based on the hexagon's violation count:

```
cis_multiplier = min(violation_count / 5.0, 3.0)
cis_score = cis_penalty_total * cis_multiplier
```

The CIS labels are: ≤40 Low impact, ≤80 Moderate (reduces lane capacity), ≤120 High (likely causing queues), >120 Critical (intersection-level gridlock risk).

**Proxy Congestion Index (PCI).** Estimates delay from road-space consumption:
- Vehicle types are mapped to road-space estimates (e.g., CAR=12 sqm, BUS=35 sqm, SCOOTER=2.5 sqm)
- Total space wasted per hexagon is summed
- `capacity_drop = clamp(total_space_wasted / 1400.0, 0, 0.8)`
- `estimated_delay_mins = capacity_drop * peak_violations * 15.0`

This is not a trained model. It is a deterministic heuristic that translates "how much road surface do parked vehicles cover" into a delay proxy. The 1400 sqm denominator approximates a standard intersection approach area; the 15x multiplier converts capacity drop into minutes per peak-violation event.

### Enable Targeted Enforcement

The **Patrol Route Panel** (left sidebar, directly below global stats) calls `/api/patrol-route` which sorts all hexagons by `estimated_delay_mins` descending and returns the top 5 as ordered waypoints:

```json
{
  "waypoints": [
    { "lng": 77.58, "lat": 12.96, "estimated_delay_mins": 20004.0,
      "violation_count": 2831, "place_name": "KR Main Road",
      "top_violation_type": "WRONG PARKING" },
    ...
  ],
  "total_impact": 54048.0
}
```

Each waypoint is clickable. Clicking flies the map to that location (via `clearlane:pan-to-zone` custom event), letting an officer see the zone and route to it in Google Maps or Apple Maps via the export panel. This is the most direct answer to "targeted enforcement" in the problem statement.

---

## Architecture

```
Browser (Next.js 16 / deck.gl)
       │
       │ HTTP (REST JSON)
       ▼
FastAPI (polars / h3-js)
       │
       ▼
CSV on disk (298K rows, downloaded at boot from DATASET_URL)
```

**Frontend.** Next.js 16 (App Router, TypeScript 5, Tailwind CSS v4, React 19). The map is deck.gl 9.x with react-map-gl (Mapbox GL tiles). Analytics charts use Recharts. The splash screen and header animations use Framer Motion.

**Backend.** FastAPI (Python 3.12, polars 1.17 for vectorized aggregation, h3 4.x for spatial indexing). The server is stateless beyond the CSV file on disk. No database. No trained ML model. All scoring is computed on each request by re-aggregating the CSV through the polars pipeline. A startup-time JSON cache (`hotspots.json`) exists for the prediction horizon feature but is not a full database.

**Chat.** The frontend's `/api/chat` route proxies to NVIDIA NIM's hosted inference API (`meta/llama-3.1-8b-instruct`). It streams responses back to the browser. The system prompt instructs the model to answer as a traffic analysis assistant for Bengaluru police. A context summary endpoint (`/api/context-summary`) provides current dashboard stats as reference material for the LLM.

**API Endpoints:**

| Endpoint | Returns |
|---|---|
| `GET /api/hotspots` | GeoJSON FeatureCollection of hexagon polygons |
| `GET /api/stats` | Total hotspots, violations, estimated delay hours |
| `GET /api/patrol-route` | Top 5 waypoints ranked by delay impact |
| `GET /api/predict-horizon` | Forecasted hex data for +15m, +30m, +60m windows |
| `GET /api/analytics` | Hourly trends, vehicle breakdown, top locations |
| `GET /api/severity-ranking` | Ranked list of zones with severity score |
| `GET /api/hotspot-times` | Hourly + weekday distributions for a single hex |
| `GET /api/dark-spots` | Zones with high unvalidated/rejected enforcement data |
| `GET /api/context-summary` | Full snapshot for LLM chat context |

---

## Live Demo

- **Frontend:** https://clearlane-ai.vercel.app
- **Backend:** Railway (free tier)

First load may take 10-20 seconds if the backend has been idled. Subsequent requests are fast. The frontend uses a fallback to pre-computed demo data if the backend is unreachable.

---

## Running Locally

### Prerequisites

- Python 3.12+
- Node.js 20+
- A Mapbox access token (free tier, from https://account.mapbox.com)

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` directory (or export the variable):

```bash
# Required only if the CSV is not already in the backend/ directory.
# The CSV is ~105 MB and excluded from git. On first boot, if the file is
# missing, the server downloads it from this URL.
DATASET_URL=https://github.com/puranikyashaswin/clearlane-ai/releases/download/v0.1-data/jan.to.may.police.violation_anonymized791b166.csv
```

Start the backend:

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server downloads the CSV on first boot if it's not present. This takes a few seconds.

### 2. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1IjoieW91ci1tYXBib3gtdG9rZW4ifQ.example
# Optional: enable demo mode (no backend needed, uses static JSON files)
# NEXT_PUBLIC_DEMO_MODE=true
# Optional: override the backend URL (defaults to http://127.0.0.1:8000)
# NEXT_PUBLIC_API_URL=http://192.168.0.x:8000
# Optional: for the chat feature. Get a key from https://build.ngc.nvidia.com/
# NVIDIA_API_KEY=nvapi-your-key-here
```

Start the frontend:

```bash
npm run dev
```

Open http://localhost:3000. The frontend expects the backend at `http://127.0.0.1:8000`. If the backend is not running, the frontend falls back to static demo data served from `/demo-data/*.json` and every feature still works.

### 3. Production Build

```bash
cd frontend
npm run build
npm run start
```

---

## Dataset

The dataset is the official hackathon-provided file: `jan to may police violation_anonymized791b166.csv`, containing approximately 298,450 rows of Bengaluru traffic violation records from January through May of the relevant year.

Key columns used by the application:

| Column | Purpose |
|---|---|
| `latitude`, `longitude` | Spatial indexing into H3 hexagons |
| `violation_type` | JSON array of violation codes (e.g. `["WRONG PARKING"]`) |
| `offence_code` | Array of offence codes matching the violation types |
| `vehicle_type` | One of 22 types (CAR, SCOOTER, BUS, LORRY, etc.) |
| `location` | Street/area name, parsed for junction detection |
| `junction_name` | Named intersection, used for junction penalty in CIS |
| `police_station` | Jurisdiction for dispatch/reporting |
| `validation_status` | Used by dark-spot detection (unvalidated, rejected, unsent to SCITA) |
| `created_datetime` | Timestamp, parsed for hour-of-day and peak-window detection |

The CSV is ~105 MB and not tracked in git. The backend downloads it automatically from a GitHub Release on first boot when `DATASET_URL` is set.

---

## Known Limitations

**The CIS and PCI scores are deterministic weighted formulas, not machine learning models.** They are interpretable heuristics designed to capture the intuition that "a bus parked on a main road near a junction during peak hours causes more congestion than a scooter in a side street." This is useful and transparent but is not a trained prediction. The "AI" in the product name refers to the chat assistant and the horizon-based pattern matching in `/api/predict-horizon`, which applies historical traffic patterns to forecast congestion windows. It is not a trained forecasting model.

**The prediction feature (`/api/predict-horizon`)** takes the current hour's aggregation and applies a multiplier (1.15x for +15m, 1.1x of the next hour's historical data for +30/+60m). It does not run a time-series model. This is a pragmatic approximation that works well for the hackathon scope but would benefit from a proper forecasting approach for production use.

**Deployed backend on Railway's free tier** may have cold-start delays of 10-20 seconds after periods of inactivity. The frontend handles this gracefully by falling back to demo data if the backend does not respond within 3 seconds.

**The chat assistant** calls a hosted NVIDIA NIM endpoint (`meta/llama-3.1-8b-instruct`). It requires an API key and internet access. It is not a fine-tuned model and its answers are only as accurate as the context summary passed to it.

**Dark spot detection** identifies hexagons where enforcement data has high proportions of unvalidated, rejected, or unsent records (relative to total at that zone). This is a ratio-based heuristic, not a predictive model of enforcement failure.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js | 16.2.9 |
| UI Library | React | 19.2.4 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| Map (base) | Mapbox GL + react-map-gl | 3.8.0 / 7.1.8 |
| Map (data) | deck.gl (core, layers, aggregation-layers, geo-layers) | 9.0.35 |
| H3 spatial | h3-js | 4.4.0 |
| Charts | Recharts | 3.8.1 |
| Animation | Framer Motion | 12.40.0 |
| Icons | Lucide React | 1.21.0 |
| Backend | FastAPI | 0.115.6 |
| Data processing | polars | 1.17.1 |
| H3 (Python) | h3 | 4.1.2 |
| Validation | Pydantic | 2.10.3 |
| Server | uvicorn | 0.34.0 |
| Logging | structlog | 24.4.0 |
| Chat LLM | NVIDIA NIM (meta/llama-3.1-8b-instruct) | API |
| Python | CPython | 3.12 |
| Deployment (frontend) | Vercel | |
| Deployment (backend) | Railway | |

---

## Credits

Built by Team [Your Team Name] for Gridlock Hackathon 2.0 Round 2 (Flipkart).
