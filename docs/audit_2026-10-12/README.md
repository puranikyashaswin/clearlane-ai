# ClearLane numbers audit (2026-10-12)

Every number below comes from files in this folder. They were produced on 2026-10-12 at commit `dc26afe`.

## Inputs
- Dataset: release asset `v0.1-data/jan.to.may.police.violation_anonymized791b166.csv`, 109,589,874 bytes, sha256 `6e4b7ad2e4c713a65fe4f6a9782461f19911fad70d25132cb7aed0fa3c656438` (matches the digest GitHub reports).
- Environment: Python 3.12, `backend/requirements.txt` (polars 1.17.1, h3 4.1.2).

## Commands
```
gh release download v0.1-data -R puranikyashaswin/clearlane-ai -p '*.csv'
python -I dataset_profile_script.py <csv>            > dataset_profile.txt
# backend, with the CSV at backend/"jan to may police violation_anonymized791b166.csv"
python -m uvicorn main:app --port 8765
curl localhost:8765/api/stats          > api_stats.json
curl localhost:8765/api/patrol-route   > api_patrol-route.json
curl localhost:8765/api/context-summary > api_context-summary.json
```

## Results
| Claim | Verified value | Source |
|---|---|---|
| 298K / ~298,450 records | 298,450 data rows from both the csv module and polars. All have lat/lng. | dataset_profile.txt |
| "January through May" | Timestamps run from 2023-11-09 to 2024-04-08 and are labelled `+00` | dataset_profile.txt |
| H3 resolution 8 (~500 m) | The API uses res 10 (avg edge ~66 m), with 6,805 non-empty hexes. engine.py uses res 9. | api_stats.json, backend/main.py:62, backend/engine.py:19 |
| Top 5 patrol routes by estimated delay | Reproduced. total_impact = 61,020 (the README said 54,048). Top waypoint is KR Main Road at 20,004. | api_patrol-route.json |
| Total estimated delay | /api/stats gives 6,171.2 h. /api/context-summary returns a hard-coded 6,906 h. | api_stats.json, api_context-summary.json |
| 22 vehicle types, 55 police stations | 22 and 55 | dataset_profile.txt |

## What "estimated delay" is
`estimated_delay_mins = clip(total_space_sqm/1400, 0, 0.8) * peak_violations * 15`. The space term is hit by 387 of 6,805 hexes, which hold 85.4% of the total delay. For every top-5 waypoint it saturates, so the score reduces to `12 * peak_violations`. It is a proxy, not measured delay, and no traffic or speed data is used to validate it. `is_peak` uses the raw hour of UTC-labelled timestamps: hours 8-10 and 17-20, covering 12.6% of rows.
