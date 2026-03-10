import json
import logging
from pathlib import Path

from google.cloud import bigquery

from config.settings import Settings, get_settings

logger = logging.getLogger(__name__)

SQL_BASE_DIR = Path(__file__).resolve().parent.parent.parent / "bigquery"


class BQClient:
    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._client = bigquery.Client(
            project=self._settings.gcp_project_id,
            location=self._settings.gcp_region,
        )

    @property
    def dataset(self) -> str:
        return self._settings.bq_full_dataset

    def table_ref(self, table: str) -> str:
        return f"{self.dataset}.{table}"

    def insert_rows(self, table: str, rows: list[dict]) -> int:
        """Insert rows via streaming API. Returns count of failed rows (0 = all succeeded).

        Raises RuntimeError only if ALL rows fail (likely a connectivity/auth issue).
        Partial failures are logged as warnings — successfully inserted rows are kept.
        """
        table_ref = self.table_ref(table)
        errors = self._client.insert_rows_json(table_ref, rows)
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
        sql = sql.replace(
            "social_listening.",
            f"`{self._settings.gcp_project_id}`.{self._settings.bq_dataset}.",
        )

        query_job = self._client.query(sql, job_config=job_config)
        results = query_job.result()

        rows = []
        for row in results:
            row_dict = dict(row)
            # Convert non-serializable types
            for key, value in row_dict.items():
                if hasattr(value, "isoformat"):
                    row_dict[key] = value.isoformat()
            rows.append(row_dict)
        return rows

    def query_from_file(
        self, sql_file: str, params: dict | None = None
    ) -> list[dict]:
        sql_path = SQL_BASE_DIR / sql_file
        if not sql_path.exists():
            raise FileNotFoundError(f"SQL file not found: {sql_path}")
        sql = sql_path.read_text()
        return self.query(sql, params)
