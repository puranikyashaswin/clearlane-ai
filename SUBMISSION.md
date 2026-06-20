# ClearLane AI: Submission for Gridlock Hackathon 2.0

## Theme

Poor Visibility on Parking-Induced Congestion

## Problem Statement

How can AI-driven parking intelligence detect illegal parking hotspots and quantify their impact on traffic flow to enable targeted enforcement?

## Solution Summary

ClearLane AI is a predictive parking intelligence platform that transforms 298,450 raw parking violation records from Bengaluru Traffic Police into an operational command center. It detects illegal parking hotspots at street level, forecasts their congestion impact 60 minutes in advance, and generates optimized patrol routes so enforcement reaches bottlenecks before gridlock forms.

## How It Works

**1. Spatial Hotspot Detection.** Every violation is geocoded into an H3 hexagon at approximately 150-meter resolution. A Proxy Congestion Index (PCI) is computed per hexagon based on vehicle footprint, peak-hour frequency, and road capacity. The result is a live 3D heatmap of parking-induced congestion across Bengaluru, color-coded by severity.

**2. Predictive Horizon.** The engine projects how congestion evolves across four time windows (now, +15 min, +30 min, +60 min) by analyzing historical violation patterns. Officers see not just where congestion is, but where it will be, enabling proactive deployment.

**3. Patrol Route Optimization.** The five highest-delay hexagons are automatically sequenced into an ordered patrol route with per-stop delay impact and total route metrics. This gives officers a clear, data-driven patrol plan.

**4. Analytics Terminal.** A dedicated analytics page surfaces hourly congestion distributions, vehicle-type breakdowns (cars, autos, buses, etc.), top affected junctions, and a week-by-hour density heatmap for strategic resource planning.

## Key Results

- 298,450 parking violation records processed from Bengaluru Traffic Police
- 2,534 unique H3 hexagons mapped at street level (resolution 10)
- 60-minute predictive horizon for congestion forecasting
- 7,000+ hours of estimated delay mapped across the network
- 15 police stations covered (Upparpet, Shivajinagar, Malleshwaram, HAL, City Market, and more)

## Tech Stack

**Backend:** Python, FastAPI, Polars (DataFrame engine), H3 v4 (geospatial indexing), structlog, Pydantic V2, Uvicorn. Hosted locally with REST API.

**Frontend:** Next.js 16 (App Router), React 19, deck.gl (WebGL 3D map), Mapbox GL JS (base tiles), Tailwind CSS v4, Framer Motion (animations), Recharts (analytics charts). Deployed on Vercel.

**Data:** Single dataset provided by HackerEarth: 298,450 parking violation records from Bengaluru Traffic Police (January May 2026). No external datasets used.

## How to Run

See README.md for full instructions.

## Demo Video

[Link to be added]

## Deployed Link

[Link to be added]

## Repository

[Link to be added]
