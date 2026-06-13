import json
import logging
import ssl
import time
from pathlib import Path

from google.api_core import exceptions as gcp_exceptions
from google.cloud import bigquery

from config.settings import Settings, get_settings

logger = logging.getLogger(__name__)

SQL_BASE_DIR = Path(__file__).resolve().parent.parent.parent / "bigquery"

# Transient errors that should be retried automatically.
_TRANSIENT_EXCEPTIONS = (
    ssl.SSLError,
    ConnectionResetError,
    ConnectionError,
    gcp_exceptions.ServiceUnavailable,
    gcp_exceptions.InternalServerError,
    gcp_exceptions.TooManyRequests,
)

# Retry config
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0  # seconds: 2, 4, 8
_BACKOFF_MAX = 30.0


def _normalize_rows(rows: list[dict], json_cols: set[str]) -> list[dict]:
    """Normalize raw downloaded rows to query()'s public contract, in place.

    - JSON-typed columns (``json_cols``) arrive parsed (dict/list) over REST but
      as raw JSON strings over the Storage API; parse the strings so both paths
      yield the same dict/list. Malformed JSON is left as the raw string.
    - Any value with ``isoformat`` (datetime/date/time) is stringified, matching
      the original REST behavior so downstream JSON serialization is unchanged.
    """
    for row_dict in rows:
        for key, value in row_dict.items():
            if value is None:
                continue
            if key in json_cols and isinstance(value, str):
                try:
                    row_dict[key] = json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    pass  # leave malformed JSON as the raw string
            elif hasattr(value, "isoformat"):
                row_dict[key] = value.isoformat()
    return rows


def _is_transient(exc: Exception) -> bool:
    """Check if an exception is transient and worth retrying."""
    if isinstance(exc, _TRANSIENT_EXCEPTIONS):
        return True
    # Catch SSL errors wrapped in other exceptions (e.g. urllib3, requests)
    err_str = str(exc).lower()
    if "ssl" in err_str or "eof occurred" in err_str or "connection reset" in err_str:
        return True
    return False


def _retry(func, *args, **kwargs):
    """Execute func with retry on transient errors."""
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if not _is_transient(e) or attempt == _MAX_RETRIES:
                raise
            last_exc = e
            wait = min(_BACKOFF_BASE * (2 ** attempt), _BACKOFF_MAX)
            logger.warning(
                "BQ transient error (attempt %d/%d), retrying in %.1fs: %s",
                attempt + 1, _MAX_RETRIES + 1, wait, str(e)[:200],
            )
            time.sleep(wait)
    raise last_exc  # unreachable but satisfies type checker


class BQClient:
    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._client = bigquery.Client(
            project=self._settings.gcp_project_id,
            location=self._settings.gcp_region,
        )
        # Lazily-created BigQuery Storage Read API client. Row download via the
        # default REST path (tabledata.list) is the dominant cost for large
        # result sets - e.g. the dashboard's ~5k wide rows took ~20s to stream
        # over REST vs ~6s via the Storage API. None = not tried yet, False =
        # tried and unavailable (fall back to REST), else a live client reused
        # across queries. See docs/bugs/api-dashboard-slow-row-download.md.
        self._bqstorage: object | None = None

    @property
    def dataset(self) -> str:
        return self._settings.bq_full_dataset

    def table_ref(self, table: str) -> str:
        return f"{self.dataset}.{table}"

    def insert_rows(self, table: str, rows: list[dict]) -> int:
        """Insert rows via streaming API. Returns count of failed rows (0 = all succeeded).

        Raises RuntimeError only if ALL rows fail (likely a connectivity/auth issue).
        Partial failures are logged as warnings - successfully inserted rows are kept.
        Retries automatically on transient network errors (SSL, connection reset).
        """
        table_ref = self.table_ref(table)
        errors = _retry(self._client.insert_rows_json, table_ref, rows)
        if errors:
            failed = len(errors)
            if failed >= len(rows):
                logger.error("BQ insert fully failed for %s: %s", table_ref, errors)
                raise RuntimeError(f"BigQuery insert fully failed: {errors}")
            logger.warning(
                "BQ insert: %d/%d rows failed for %s: %s",
                failed, len(rows), table_ref, errors,
            )
            return failed
        logger.info("Inserted %d rows into %s", len(rows), table_ref)
        return 0

    def query(self, sql: str, params: dict | None = None) -> list[dict]:
        job_config = bigquery.QueryJobConfig()
        if params:
            query_params = []
            for k, v in params.items():
                if isinstance(v, list):
                    query_params.append(
                        bigquery.ArrayQueryParameter(k, "STRING", v)
                    )
                elif isinstance(v, bool):
                    query_params.append(
                        bigquery.ScalarQueryParameter(k, "BOOL", v)
                    )
                elif isinstance(v, int):
                    query_params.append(
                        bigquery.ScalarQueryParameter(k, "INT64", v)
                    )
                elif isinstance(v, float):
                    query_params.append(
                        bigquery.ScalarQueryParameter(k, "FLOAT64", v)
                    )
                else:
                    query_params.append(
                        bigquery.ScalarQueryParameter(k, "STRING", str(v))
                    )
            job_config.query_parameters = query_params

        # Replace unqualified table references with fully qualified ones.
        # Backtick-quote the project ID since it may contain hyphens.
        import re
        project = self._settings.gcp_project_id
        dataset = self._settings.bq_dataset

        # MODEL references need a single backtick-quoted identifier
        # (e.g. `project.dataset.model`). Replace them first with a
        # placeholder so the blanket table replace doesn't double-qualify.
        model_placeholder = "__BQ_MODEL_REF__"
        models: list[str] = []

        def _replace_model(m):
            full = f"`{project}.{dataset}.{m.group(2)}`"
            models.append(full)
            return f"{m.group(1)}{model_placeholder}{len(models) - 1}"

        sql = re.sub(
            r"(MODEL\s+)social_listening\.(\w+)",
            _replace_model,
            sql,
        )

        # Replace remaining unqualified table references.
        sql = sql.replace(
            "social_listening.",
            f"`{project}`.{dataset}.",
        )

        # Restore MODEL placeholders.
        for i, ref in enumerate(models):
            sql = sql.replace(f"{model_placeholder}{i}", ref)

        query_job = _retry(self._client.query, sql, job_config=job_config)
        results = _retry(query_job.result)

        # JSON-typed columns come back parsed (dict/list) over REST but as raw
        # JSON strings over the Storage API. Track them from the schema so we
        # can normalize the Storage path back to REST's shape - keeping query()
        # output byte-identical regardless of which download path is used.
        json_cols = {f.name for f in results.schema if f.field_type == "JSON"}

        rows = self._download_rows(results, query_job)
        return _normalize_rows(rows, json_cols)

    def _download_rows(self, results, query_job) -> list[dict]:
        """Download a query's rows as plain dicts.

        Prefers the BigQuery Storage Read API (fast Arrow stream); falls back to
        REST row iteration when the Storage client is unavailable (e.g. the
        service account lacks ``bigquery.readsessions.create``) or the Arrow
        download fails. A failed ``to_arrow`` may have *already started* the
        ``results`` iterator, so the REST fallback must re-fetch a fresh
        iterator from the job's destination table rather than re-iterate the
        poisoned one (which raises "Iterator has already started").
        """
        bqs = self._bqstorage_read_client()
        if bqs is not None:
            try:
                table = _retry(results.to_arrow, bqstorage_client=bqs)
                return table.to_pylist()
            except Exception:  # noqa: BLE001 - any Storage failure -> REST
                logger.warning(
                    "Storage API download failed; falling back to REST", exc_info=True
                )
                results = self._client.list_rows(query_job.destination)
        return [dict(r) for r in results]

    def _bqstorage_read_client(self):
        """Return a reused BigQueryReadClient, or None if unavailable.

        Cached on the instance: ``None`` = not yet attempted, ``False`` =
        attempted and unavailable (don't retry), otherwise a live client.
        """
        if self._bqstorage is None:
            try:
                from google.cloud import bigquery_storage

                self._bqstorage = bigquery_storage.BigQueryReadClient()
            except Exception:  # noqa: BLE001 - missing dep/perms -> REST path
                logger.warning(
                    "BigQuery Storage client unavailable; using REST row download",
                    exc_info=True,
                )
                self._bqstorage = False
        return self._bqstorage or None

    def query_from_file(
        self, sql_file: str, params: dict | None = None
    ) -> list[dict]:
        sql_path = SQL_BASE_DIR / sql_file
        if not sql_path.exists():
            raise FileNotFoundError(f"SQL file not found: {sql_path}")
        sql = sql_path.read_text()
        return self.query(sql, params)
