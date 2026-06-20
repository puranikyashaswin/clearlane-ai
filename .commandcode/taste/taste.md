# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# python
- Never use Pandas; always use Polars for dataframes. Confidence: 0.95
- Never use standard lat/lon distance math; always use Uber H3 v4 API for spatial indexing. Confidence: 0.95
- All Python code must be fully type-hinted. Confidence: 0.95
- Use structlog for logging. Confidence: 0.95
- Never write placeholder comments like "# implement logic here"; write complete, production-ready logic. Confidence: 0.95

# dependencies
- Pin exact package versions in requirements.txt using == syntax. Confidence: 0.75

# backend
- Backend must be FastAPI, strictly async, using Pydantic V2 for validation. Confidence: 0.95

# writing-style
- Avoid em dashes in all written content; use commas, colons, or sentence breaks instead. Confidence: 0.70
- Write all copy and documentation in a polished, human-written style — no AI-typical phrasing, no markdown artifacts in final output. Confidence: 0.70

# workflow
- Commit working state before starting any major feature work so there's a rollback point. Confidence: 0.70
- Before implementing features, first provide a detailed plan with hierarchy, time estimates, and what will be built in what order. Confidence: 0.70

# frontend
See [frontend/taste.md](frontend/taste.md)
