# Multi-stage build: deps compiled in builder, slim runtime image.
FROM python:3.12-slim AS builder

WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.12-slim

# Run as non-root (least privilege).
RUN useradd --create-home appuser
WORKDIR /srv

COPY --from=builder /install /usr/local
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

USER appuser
EXPOSE 8000

# Default command runs the API; the worker overrides this in compose/ECS.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
