# ClearLane AI

**AI-powered parking intelligence for Bengaluru Traffic Police.**

ClearLane transforms 298,000+ raw parking violation records into a predictive congestion command center. It detects illegal parking hotspots, forecasts their traffic impact 60 minutes in advance, and generates optimized patrol routes so enforcement reaches bottlenecks before gridlock forms.

---

## Problem

Bengaluru loses over 1,240 hours of commuter time daily to parking-induced congestion. Enforcement today is entirely reactive: officers patrol on fixed routes, respond to complaints after gridlock forms, and have no data-driven way to prioritize which zones need attention.

Three things make this hard:

- No heatmap exists that maps parking violations to actual congestion impact.
- Enforcement zones are prioritized by intuition, not data.
- There is no way to forecast how congestion will build throughout the day.

---

## Solution

ClearLane closes this gap with four capabilities:

**1. Spatial Hotspot Detection.** Every violation is geocoded into an H3 hexagon at street-level resolution (res 10, ~150 m). The engine computes a Proxy Congestion Index per hex based on vehicle footprint, peak-hour frequency, and road capacity, then surfaces the highest-impact zones on a 3D map.

**2. Predictive Horizon.** The same engine simulates how congestion evolves across four time horizons (now, +15 m, +30 m, +60 m) by projecting historical violation patterns forward. Officers see not just where congestion is, but where it will be.

**3. Patrol Route Optimization.** The top five highest-delay hexagons are sequenced into an ordered patrol route with estimated delay impact per stop and total route metrics. Officers get a clear, drivable plan.

**4. Analytics Terminal.** A full analytics page surfaces hourly distributions, vehicle-type breakdowns, top affected junctions, and a week-by-hour density heatmap, giving command staff the data they need for resource planning.

---

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│   FastAPI Backend     │     │  Next.js Frontend     │
│   (port 8000)         │◄────┤  (port 3000)          │
│                       │     │                       │
│  engine.py            │     │  DashboardShell       │
│   • Polars ETL        │     │   • deck.gl 3D map    │
│   • H3 spatial index  │     │   • Hex overlay       │
│   • PCI math          │     │   • Dispatch feed     │
│                       │     │                       │
│  main.py              │     │  Analytics page       │
│   • REST API          │     │   • Recharts charts   │
│   • Caching           │     │   • KPIs / heatmap    │
│   • Prediction        │     │   • Vehicle breakdown │
│   • Analytics         │     │                       │
└──────────────────────┘     └──────────────────────┘
```

**Backend stack:** Python, FastAPI, Polars, H3 v4, structlog, Pydantic V2.  
**Frontend stack:** Next.js 16, React 19, deck.gl, Mapbox GL JS, Tailwind CSS v4, Framer Motion, Recharts.  
**Data:** 298,450 parking violation records from Bengaluru Traffic Police (Jan May 2026).

---

## Quick Start

### Backend

```bash
cd backend
pip install -r ../requirements.txt
python main.py
```

The API starts at `http://127.0.0.1:8000`. Endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/hotspots?hour=N` | GeoJSON hexagons for a given hour |
| `GET /api/stats?hour=N` | Aggregate dashboard statistics |
| `GET /api/patrol-route?hour=N` | Top 5 patrol waypoints |
| `GET /api/predict-horizon?hour=N&horizon=now` | Forecast at four horizons |
| `GET /api/analytics?hour=N&horizon=now&day=M` | Full analytics payload |

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

You will need a Mapbox token. Set it in `frontend/.env.local`:

```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token_here
```

---

## Submission

**Gridlock Hackathon 2.0 Round 2**  
Theme: Poor Visibility on Parking-Induced Congestion  
Team: Solo  
Deadline: June 21, 2026, 23:59 IST

Demo video: [Link TK]  
Deployed frontend: [Link TK]
