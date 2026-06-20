# ClearLane AI — Full Implementation Plan (Features 1-6)

## How to Use This Document

This plan is designed for a **fresh AI coding session with zero context**. Give this entire document to the new session at the start. It explains everything that exists, everything that needs to be built, and the exact order to build it.

Rollback commit: `c4e4af5`

---

## 0. Project Architecture (Existing)

### Repo Structure

```
clearlane-ai/
├── backend/
│   ├── main.py              # FastAPI server with all API endpoints
│   ├── engine.py             # Data processing pipeline (generates hotspots.json)
│   ├── hotspots.json         # Pre-computed GeoJSON (1.3MB, 2,534 hexagons)
│   └── jan to may police...  # Raw CSV (298K rows, the dataset)
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root layout: metadata, fonts, OG tags
│   │   │   ├── page.tsx             # Home page: renders DashboardShell
│   │   │   ├── analytics/page.tsx   # Analytics dashboard (Recharts, KPIs)
│   │   │   └── api/chat/route.ts    # NVIDIA NIM LLM proxy
│   │   ├── components/
│   │   │   ├── DashboardShell.tsx   # Main 3D map command center (898 lines)
│   │   │   ├── ChatPanel.tsx        # Persistent bottom chat bar
│   │   │   ├── DispatchNotification.tsx
│   │   │   ├── ExportActionsPanel.tsx
│   │   │   ├── HorizonControl.tsx
│   │   │   ├── Logo.tsx
│   │   │   ├── PatrolMiniMap.tsx
│   │   │   ├── PatrolRouteBuilder.tsx
│   │   │   ├── PixelDataBackground.tsx
│   │   │   ├── TimeSlider.tsx
│   │   │   └── LandingPage.tsx (dead code, not imported)
│   │   ├── lib/
│   │   │   ├── api.ts               # API client with live + demo fallback
│   │   │   └── (context-summary.ts) # NOT YET CREATED
│   │   └── hooks/
│   │       └── useAnimationFrame.ts
│   └── public/
│       └── demo-data/               # Pre-computed files for standalone demo
│           ├── hotspots.json (1.3MB)
│           ├── stats.json
│           ├── analytics.json
│           └── context-summary.json
├── SUBMISSION.md
├── requirements.txt
└── BUILD_PLAN.md (this file)
```

### Key Architecture Details

**Backend (FastAPI, port 8000):**
- `process_data()` in main.py reads the CSV, cleans, adds H3 index, aggregates by hex
- `_agg_to_geojson()` converts Polars DataFrame to GeoJSON FeatureCollection
- Endpoints:
  - `GET /api/hotspots?hour=N` — GeoJSON hexagons
  - `GET /api/stats?hour=N` — aggregate stats
  - `GET /api/patrol-route?hour=N` — top 5 waypoints
  - `GET /api/predict-horizon?hour=N&horizon=now` — forecast
  - `GET /api/analytics?hour=N&horizon=now&day=M` — analytics payload
  - `GET /api/context-summary` — LLM chat context (40 locations, 25 stations)

**Frontend (Next.js 16, port 3000):**
- DashboardShell uses deck.gl with Mapbox dark-v11
- Data flows: `useEffect` → `fetchHotspots()` / `fetchStats()` → set state → render
- GeoJSON features have properties: h3_index, violation_count, total_space_wasted, peak_violations, estimated_delay_mins, center, primary_vehicle, place_name
- ChatPanel self-fetches context-summary on mount, sends it with every LLM query

### CSV Columns Used

```
id, latitude, longitude, location, vehicle_number, vehicle_type, description,
violation_type (ARRAY field like ["WRONG PARKING","NO PARKING"]),
offence_code (ARRAY), created_datetime, closed_datetime, modified_datetime,
device_id, created_by_id, center_code, police_station, data_sent_to_scita (BOOL),
junction_name, action_taken_timestamp, data_sent_to_scita_timestamp,
updated_vehicle_number, updated_vehicle_type, validation_status, validation_timestamp
```

### Data Notes

- `violation_type` is a JSON array string like `["WRONG PARKING"]` or `["NO PARKING","PARKING IN A MAIN ROAD"]`
- `offence_code` is similar array
- `data_sent_to_scita` is TRUE/FALSE string
- `validation_status` is "approved"/"rejected"/NULL or empty
- `junction_name` is often "No Junction" or a named junction
- 298,450 rows, all parking violations
- H3 resolution 10 (~150m hexagons)
- 2,534 unique hexagons generated

---

## 1. Feature Implementation Order

Build in this exact order:

1. **Feature 1 gaps** (violation type + vehicle type + police station in popups, filter panel)
2. **Feature 2** (ranked hotspot list in sidebar with severity score)
3. **Feature 3** (per-hotspot time patterns + patrol window recommendation)
4. **Feature 4** (Carriageway Impact Score)
5. **Feature 5 improvements** (chat polish, no robot icon, streaming)
6. **Feature 6** (enforcement dark spot detector)

---

## 2. Feature 1 — Interactive Violation Map (Gaps)

### What exists
- Deck.gl 3D map with H3 hexagons
- Click popup shows: violations, delay, vehicle, place_name
- Filters: hour slider, horizon selector
- Map style: dark-v11

### What needs to change

#### 2a. Add violation_type, vehicle_type breakdown, police_station to GeoJSON

**File: `backend/main.py`**
In `process_data()`, after the aggregation step, add these fields to the aggregation:

```python
# In the agg_df group_by section, ADD these aggregations:
pl.col("violation_type").mode().first().alias("top_violation_type"),
pl.col("police_station").mode().first().alias("police_station"),
# For vehicle_type breakdown: aggregate all vehicle types per hex
pl.col("vehicle_type").alias("vehicle_types"),  # list
```

Then in `_agg_to_geojson()`, add these to the properties dict:
```python
"top_violation_type": str(row.get("top_violation_type", "Unknown")),
"police_station": str(row.get("police_station", "Unknown")),
"vehicle_breakdown": {}  # computed from vehicle_types list
```

**Important:** `pl.col("vehicle_type").mode().first()` will give the most common vehicle type. For a full breakdown, you need to do a second aggregation pass.

**File: `backend/engine.py`**
Update the same fields to keep consistency with the pre-computed hotspots.json.

**File: `frontend/public/demo-data/hotspots.json`**
Re-generate after backend changes by running `python3 backend/engine.py`.

#### 2b. Update the HotspotProperties interface

**File: `frontend/src/components/DashboardShell.tsx`**
In the `HotspotProperties` interface (around line 51), add:
```typescript
top_violation_type?: string;
police_station?: string;
```

#### 2c. Update the hover tooltip to show new fields

**File: `frontend/src/components/DashboardShell.tsx`**
In the `HoverTooltip` component (near line 800-860), add rows for:
- Violation Type
- Police Station
- Vehicle Breakdown (compact format)

#### 2d. Add filter panel with violation type, vehicle type dropdowns

**File: `frontend/src/components/DashboardShell.tsx`**

Add state:
```typescript
const [violationTypeFilter, setViolationTypeFilter] = useState<string>("all");
const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>("all");
```

Add filter dropdowns to the left sidebar (below the global stats section):
- Violation Type dropdown: "All", "Wrong Parking", "No Parking", "Parking in Main Road", etc.
- Vehicle Type dropdown: "All", "CAR", "SCOOTER", "MOTOR CYCLE", "PASSENGER AUTO", etc.

Filter logic in the GeoJsonLayer: when filters change, filter `data.features` to only include matching features before passing to the layer.

**Important:** The GeoJSON currently has `primary_vehicle` but not `violation_type`. You need Feature 2a (backend change) first, OR you can do client-side filtering on available data.

#### 2e. Update demo-data files

After making backend changes, re-run the data pipeline:
```bash
cd backend && python3 engine.py
```
Then copy the new `hotspots.json` to `frontend/public/demo-data/hotspots.json`.

For stats and analytics, re-run:
```bash
cd backend && python3 -c "from main import *; ..." # or re-generate manually
```

---

## 3. Feature 2 — Hotspot Severity Scoring and Ranked Zone List

### What exists
- Sidebar shows 3 global stats (total hotspots, violations, delay hours)
- No per-zone ranking, no severity scores
- No click-to-pan interaction

### What needs to be built

#### 3a. Add severity score computation to backend

**File: `backend/main.py`**

Add a new endpoint `GET /api/severity-ranking` or compute within the existing `process_data()`.

The severity formula:
```
V = violation_count for the hex
multi_offence_penalty = 1.5 if any violation in hex has 3+ offence_codes
junction_penalty = 1.4 if junction_name != "No Junction"
heavy_vehicle_penalty = 1.2 if primary_vehicle in heavy vehicles
recurring_penalty = 1.3 if violations span 3+ different days

score = V * multi_offence_penalty * junction_penalty * heavy_vehicle_penalty * recurring_penalty
```

To compute this, the aggregation needs access to:
- `offence_code` — to count codes per violation
- `junction_name` — to check if named
- `vehicle_type` — to check for heavy vehicles
- `created_datetime` — to check date spread

This means the `process_data()` function needs a more granular DataFrame before aggregation, or you need a separate endpoint.

**Recommended approach:** Create a separate endpoint `/api/severity-ranking` that:
1. Loads CSV
2. Groups by H3 hex
3. For each hex, computes the severity score using raw data
4. Returns top 10 sorted by score descending

Add these to the response for each zone:
```json
{
  "rank": 1,
  "place_name": "Kamaraj Road",
  "severity_score": 34.2,
  "badges": ["Junction Risk", "Recurring", "Heavy Vehicle", "Multi-Offence"],
  "police_station": "Upparpet",
  "h3_index": "...",
  "center": [77.59, 12.97]
}
```

#### 3b. Pre-compute severity data for demo mode

**File: `frontend/public/demo-data/severity-ranking.json`**

Run the backend once and save the output.

**File: `frontend/src/lib/api.ts`**

Add:
```typescript
export async function fetchSeverityRanking(): Promise<SeverityRankingItem[]> {
  // Try backend, fall back to demo data
}
```

#### 3c. Build the ranked list sidebar component

**File: `frontend/src/components/` — create `RankedZoneList.tsx`**

A sidebar panel component that:
1. Fetches severity ranking on mount
2. Displays a numbered list (#1 through #10)
3. Each row shows: rank number, location name, severity score, badges (colored pills)
4. Police station name at bottom of each row
5. Click handler that emits a `clearlane:pan-to-zone` custom event with the zone's coordinates

Props: none (self-fetches)

States: loading, error, empty, populated

#### 3d. Wire the ranked list into DashboardShell

**File: `frontend/src/components/DashboardShell.tsx`**

- Import and render `RankedZoneList` in the left sidebar (below stats, above TimeSlider)
- Add event listener for `clearlane:pan-to-zone` that updates the map viewState to center on that zone

The pan-to logic:
```typescript
const handlePanToZone = (e: CustomEvent) => {
  const { center, h3_index } = e.detail;
  setViewState({
    ...viewState,
    longitude: center[0],
    latitude: center[1],
    zoom: 15,
    transitionDuration: 800,
  });
};
```

#### 3e. Handle edge cases
- If severity endpoint fails, show a graceful error state in the list
- If no hotspots match, show "No data" empty state
- Badges should handle cases where none apply (show no badges, not empty pills)

---

## 4. Feature 3 — Time Pattern Analysis and Patrol Window Recommendation

### What exists
- Global hourly distribution chart in analytics page
- Global weekday heatmap in analytics page
- NO per-hotspot time analysis

### What needs to be built

#### 4a. Backend: per-hotspot time distribution endpoint

**File: `backend/main.py`**

Add `GET /api/hotspot-times?h3_index=...` endpoint:
1. Filter CSV to this hex's violations
2. Extract hour from created_datetime for each violation
3. Count violations per hour (0-23)
4. Find the 3-hour rolling window with highest total
5. Count violations per weekday
6. Return:
```json
{
  "hourly": [{"hour": 0, "count": 5}, {"hour": 1, "count": 2}, ...],
  "peak_window": {"start": 6, "end": 9, "count": 34},
  "weekday_distribution": [{"day": "Monday", "count": 12}, ...],
  "recommendation": "Violations peak between 6 AM and 9 AM on weekdays. Recommended patrol: deploy by 5:45 AM."
}
```

#### 4b. Pre-compute for demo mode

**File: `frontend/public/demo-data/hotspot-times/` (directory)**

Pre-compute the time data for the top 20 hotspots and save as individual JSON files.

#### 4c. Expandable detail panel in the ranked list

**File: `frontend/src/components/RankedZoneList.tsx`**

Modify each row to be expandable:
- Click a chevron or the row itself to expand
- Expanded view shows:
  - Hourly bar chart (24 bars, peak window in red, rest in gray)
  - Weekday distribution (7 bars)
  - Plain English patrol recommendation

For the bar chart, use simple div bars (no need for Recharts — cheaper to render):

```tsx
{hourly.map((h) => (
  <div
    key={h.hour}
    className="relative"
    style={{ height: `${(h.count / maxCount) * 100}%` }}
    title={`${h.hour}:00 — ${h.count} violations`}
  />
))}
```

Color logic:
```typescript
const isPeak = h.hour >= peakWindow.start && h.hour < peakWindow.end;
const barColor = isPeak ? "#f43f5e" : "#3f3f46";
```

#### 4d. Loading and error states
- Show skeleton bars while loading
- If endpoint fails, show "Time data unavailable"
- Cache fetched time data per hotspot (avoid re-fetching on re-expand)

---

## 5. Feature 4 — Carriageway Impact Score (CIS)

### What exists
- PCI formula: `(space_wasted / 1400) * peak_violations * 15 = estimated_delay_mins`
- Shows delay in minutes per hotspot

### What needs to be built

#### 5a. Backend: CIS computation

**File: `backend/main.py`** in `_agg_to_geojson()` or a new endpoint.

CIS formula:
```
base = 0
+ 30 if junction_name is named (not "No Junction")
+ 25 if "PARKING IN A MAIN ROAD" in violation_type
+ 20 if "DOUBLE PARKING" in violation_type
+ 20 if "PARKING OPPOSITE TO ANOTHER PARKED VEHICLE" in violation_type
+ 15 if "PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC" in violation_type
+ 10 per heavy vehicle in the cluster
multiply by (violation_count / 5), capped at 3x
```

This requires parsing the `violation_type` JSON array in the CSV. In Polars:
```python
df.with_columns(
    pl.col("violation_type")
    .str.contains("PARKING IN A MAIN ROAD")
    .alias("is_main_road")
)
```

Add CIS to the GeoJSON properties and to the severity ranking endpoint.

#### 5b. Impact label
```python
if cis <= 40: label = "Low impact"
elif cis <= 80: label = "Moderate — reduces lane capacity"
elif cis <= 120: label = "High — likely causing queues"
else: label = "Critical — intersection-level gridlock risk"
```

#### 5c. Display CIS in the UI

**File: `frontend/src/components/RankedZoneList.tsx`**

Add CIS score and impact label to each row in the ranked list:
```tsx
<span className="text-xs text-zinc-400">{cisScore}</span>
<span className="text-[10px] text-zinc-500">{impactLabel}</span>
```

**File: `frontend/src/components/DashboardShell.tsx`** (HoverTooltip)

Add CIS to the hotspot popup.

#### 5d. Pre-compute for demo mode
Update the pre-computed data files with CIS values.

---

## 6. Feature 5 — LLM Chat Improvements

### What exists
- Persistent bottom chat bar on both pages
- Context summary with 40 locations, 25 stations, hourly/weekday patterns
- NVIDIA Llama 3.1 8B model
- No robot icon (TO BE REMOVED)
- No streaming
- No map-chat linking

### What needs to change

#### 6a. Remove robot icon from chat

**File: `frontend/src/components/ChatPanel.tsx`**

Remove:
```tsx
<Bot className="h-5 w-5 shrink-0 text-zinc-500" />
```
from the input bar section.

Also check the header section — if there is a `<Bot />` icon in the toggle bar, remove it there too.

#### 6b. Add response streaming

**File: `frontend/src/app/api/chat/route.ts`**

Change the response to use streaming:
```typescript
export async function POST(request: NextRequest) {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { ... },
    body: JSON.stringify({ ..., stream: true }),
  });

  // Return a ReadableStream
  return new Response(response.body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

**File: `frontend/src/components/ChatPanel.tsx`**

Update `send()` to read from a stream:
```typescript
const reader = response.body?.getReader();
const decoder = new TextDecoder();
let accumulated = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse SSE, extract content, append to accumulated
  // Update last message progressively
}
```

#### 6c. Switch to Claude API (optional, for better demo quality)

**File: `frontend/src/app/api/chat/route.ts`**

Add an alternative using Anthropic's Claude API:
```typescript
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// ...
// If ANTHROPIC_API_KEY is set, use Claude instead of NVIDIA
```

Claude consistently produces better traffic analysis responses than Llama 3.1 8B.

#### 6d. Map highlighting from chat (if time permits)

When the LLM mentions a location, parse the response for location names and emit a `clearlane:highlight-location` event. The map listens and pans to that area.

This is complex to do reliably. Skip if short on time.

---

## 7. Feature 6 — Enforcement Dark Spot Detector

### What exists
- Nothing. The fields `data_sent_to_scita`, `validation_status` are completely unused.

### What needs to be built

#### 7a. Backend: dark spot detection endpoint

**File: `backend/main.py`**

Add `GET /api/dark-spots` endpoint:

1. Group violations by H3 hex
2. For each hex, compute:
   - `unsent_ratio`: fraction where `data_sent_to_scita` is FALSE
   - `unvalidated_ratio`: fraction where `validation_status` is NULL or empty
   - `rejected_ratio`: fraction where `validation_status` is "rejected"
3. Filter for hexes where any ratio > 0.5
4. Sort by severity (from Feature 2) descending
5. Return top 8:

```json
{
  "dark_spots": [
    {
      "h3_index": "...",
      "place_name": "Outer Ring Road",
      "severity_score": 28.5,
      "unsent_ratio": 0.65,
      "unvalidated_ratio": 0.3,
      "rejected_ratio": 0.05,
      "primary_label": "Data not sent to SCITA"
    }
  ]
}
```

Label logic:
- If `unsent_ratio > 0.5`: label = "Data not sent to SCITA"
- Else if `unvalidated_ratio > 0.5`: label = "Pending validation"
- Else if `rejected_ratio > 0.5`: label = "High rejection rate"

#### 7b. Pre-compute for demo mode

**File: `frontend/public/demo-data/dark-spots.json`**

#### 7c. Build the Dark Spots panel

**File: `frontend/src/components/` — create `DarkSpotsPanel.tsx`**

A third panel (or section in the sidebar) showing:
- Title: "Enforcement Dark Spots"
- Subtitle: "Zones where enforcement is failing"
- List of dark spots with: location name, severity score, problem label (color-coded)
- Each row is clickable → pans map to that zone

#### 7d. Wire into DashboardShell

**File: `frontend/src/components/DashboardShell.tsx`**

Add the DarkSpotsPanel to the left sidebar (below the ranked list, above TimeSlider).

Alternatively, add it as a tabbed section in the right drawer (dispatch feed area).

---

## 8. Demo Data File Generation

After all backend changes, re-generate ALL demo data files:

```bash
cd backend

# 1. Re-generate hotspots
python3 engine.py

# 2. Copy to frontend
cp hotspots.json ../frontend/public/demo-data/

# 3. Generate stats
python3 -c "
import json
with open('hotspots.json') as f:
    data = json.load(f)
features = data['features']
stats = {
    'total_active_hotspots': len(features),
    'total_violations_recorded': sum(f['properties']['violation_count'] for f in features),
    'total_estimated_delay_hours': round(sum(f['properties']['estimated_delay_mins'] for f in features) / 60, 1)
}
with open('../frontend/public/demo-data/stats.json', 'w') as f:
    json.dump(stats, f)
"

# 4. Generate analytics (if main.py updated)
python3 -c "
from main import _build_analytics_payload
import json
payload = _build_analytics_payload()
with open('../frontend/public/demo-data/analytics.json', 'w') as f:
    json.dump(payload, f)
"

# 5. Generate context summary (if main.py updated)
# Run the server and hit the endpoint, or run the computation script

# 6. Generate severity ranking
# Run the server and hit /api/severity-ranking, save output

# 7. Generate dark spots
# Run the server and hit /api/dark-spots, save output

# 8. Generate hotspot times for top 20
# For each top hotspot, hit /api/hotspot-times?h3_index=..., save as individual files
```

---

## 9. Files Changed Summary

### Backend (main.py)
- `process_data()` — add violation_type, police_station, vehicle breakdown to aggregation
- `_agg_to_geojson()` — add new properties
- New endpoint `GET /api/severity-ranking` — severity scoring
- New endpoint `GET /api/hotspot-times?h3_index=...` — per-hotspot time analysis
- New endpoint `GET /api/dark-spots` — enforcement dark spots
- Update `_agg_to_geojson()` — add CIS computation
- Update `GET /api/context-summary` — include new fields

### Backend (engine.py)
- Mirror changes from main.py for pre-computation

### Frontend — API Client (`src/lib/api.ts`)
- Add `fetchSeverityRanking()`
- Add `fetchHotspotTimes(h3_index)`
- Add `fetchDarkSpots()`

### Frontend — Components
- `DashboardShell.tsx` — update popup, add filters, wire ranked list + dark spots
- `RankedZoneList.tsx` — NEW, self-contained ranked list component
- `DarkSpotsPanel.tsx` — NEW, dark spots panel
- `ChatPanel.tsx` — remove robot icon, add streaming

### Frontend — Analytics Page
- `analytics/page.tsx` — possibly update to include per-hotspot drilldown

### Frontend — Demo Data
- Update all files in `public/demo-data/`
- Add `severity-ranking.json`, `dark-spots.json`
- Add `hotspot-times/` directory with individual files

### Total: ~10 files changed/created, ~800-1200 new lines of code

---

## 10. Build Verification Steps

After each feature, run:
```bash
cd frontend && npx next build 2>&1 | tail -15
```

The build should pass with:
```
✓ Compiled successfully
✓ Generating static pages
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /analytics
└ ƒ /api/chat
```

Key things that can break:
- TypeScript type mismatches (new fields in GeoJSON vs interfaces)
- Missing imports
- Backend endpoint returning wrong format
- Demo data file missing

---

## 11. Edge Cases to Handle

1. **Empty data:** If CSV has no rows after filtering, return empty arrays, not 500 errors
2. **Missing fields:** `junction_name` can be null, `violation_type` can be malformed JSON
3. **Demo mode:** Every new feature must have pre-computed demo data, or it breaks offline
4. **H3 index mismatch:** If a hex is mentioned in the ranked list but has no time data, show "No data"
5. **Severity score edge cases:** If all multipliers are 1.0 (no offences match), score = raw count
6. **Dark spots with zero data:** If no dark spots found, show "No enforcement gaps detected"
7. **Streaming failure:** If streaming is enabled but the connection drops, show partial response
8. **CIS cap:** Formula says "capped at 3x" — ensure the multiplier never exceeds 3
9. **Click-to-pan on slow data:** If data is still loading and user clicks a row, queue the pan action
10. **Chat with no context:** If context-summary hasn't loaded yet, show "Loading data..." state

---

## 12. Recommended Prompt for New Session

Start the new session with:

```
You are implementing Features 1-6 for the ClearLane AI hackathon project.

Read BUILD_PLAN.md in the project root. This document explains the entire
project architecture and exactly what needs to be built.

Rollback commit: c4e4af5

Implementation order:
1. Feature 1 gaps (violation type + police station in popups, filters)
2. Feature 2 (ranked hotspot list with severity scoring)
3. Feature 3 (per-hotspot time patterns with expandable panels)
4. Feature 4 (Carriageway Impact Score)
5. Feature 5 improvements (remove robot icon, streaming)
6. Feature 6 (enforcement dark spot detector)

After each feature, run 'cd frontend && npx next build' to verify nothing broke.
Commit after each feature with a descriptive message.
```
