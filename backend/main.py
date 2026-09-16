"""Entry point: `uvicorn main:app`. The application lives in the `app` package."""
from app.api import create_app

app = create_app()
