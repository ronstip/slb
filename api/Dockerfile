FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files and install
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

# Copy application code
COPY config/ config/
COPY api/ api/
COPY workers/ workers/
COPY bigquery/ bigquery/

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
