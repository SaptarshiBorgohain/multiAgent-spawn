FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	PIP_NO_CACHE_DIR=1 \
	PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

FROM base AS builder

COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM base AS runtime

COPY requirements.txt .
COPY --from=builder /wheels /wheels
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
	&& rm -rf /wheels

COPY . .

FROM runtime AS dev

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
