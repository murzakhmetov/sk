# API image: runtime dependencies only (tests, evals and ML run on the dev machine).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /srv/.cache \
    && chown appuser /srv/.cache
USER appuser

ENV CACHE_DIR=/srv/.cache/llm \
    PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request as u; u.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=3)"

# Shell form so the $PORT injected by Render/Railway/Fly is honoured; `exec` keeps uvicorn as PID 1.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
