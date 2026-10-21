import os
from collections.abc import Iterator

import psycopg
import pytest


@pytest.fixture
def db() -> Iterator[psycopg.Connection]:
    """Connection to the local test database. Every test runs in a rolled-back transaction."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set (start local Supabase: npx supabase start)")
    with psycopg.connect(url) as conn:
        yield conn
        conn.rollback()
