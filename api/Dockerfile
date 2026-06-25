FROM python:3.12-slim

WORKDIR /app

# fonts-dejavu-core is required by the share-html OG image renderer
# (api/routers/share_html.py uses Pillow to overlay the share title on the
# brand template; without a TTF Pillow falls back to a tiny bitmap font).
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv --no-cache-dir

# Copy dependency files and install
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --no-install-project

# Copy application code
COPY config/ config/
COPY api/ api/
COPY channels/ channels/
COPY workers/ workers/
COPY bigquery/ bigquery/

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
