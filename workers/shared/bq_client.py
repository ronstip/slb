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

    def insert_rows(self, table: str, rows: list[dict]) -> None:
        table_ref = self.table_ref(table)
        errors = self._client.insert_rows_json(table_ref, rows)
        if errors:
            logger.error("BQ insert errors for %s: %s", table_ref, errors)
            raise RuntimeError(f"BigQuery insert failed: {errors}")
        logger.info("Inserted %d rows into %s", len(rows), table_ref)

    def query(self, sql: str, params: dict | None = None) -> list[dict]:
        job_config = bigquery.QueryJobConfig()
        if params:
            query_params = []
            for k, v in params.items():
                if isinstance(v, list):
                    query_params.append(
                        bigquery.ArrayQueryParameter(k, "STRING", v)
                    )
                else:
                    query_params.append(
                        bigquery.ScalarQueryParameter(k, "STRING", v)
                    )
            job_config.query_parameters = query_params

        # Replace unqualified table references with fully qualified ones
        sql = sql.replace("social_listening.", f"{self.dataset}.")

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
