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

# frontend
See [frontend/taste.md](frontend/taste.md)
