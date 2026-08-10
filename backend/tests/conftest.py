import os

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://flowline:flowline@localhost:5432/flowline_test"
)
os.environ.setdefault("APP_SECRET", "test-secret-not-for-production")
