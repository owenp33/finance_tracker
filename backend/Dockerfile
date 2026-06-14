FROM python:3.11-slim

WORKDIR /app

# Install OS-level deps needed by psycopg2-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt

COPY . .

EXPOSE 5000

# 2 workers is a sensible default for a small VPS; tune with GUNICORN_WORKERS env var
CMD ["sh", "-c", "gunicorn wsgi:application --bind 0.0.0.0:5000 --workers ${GUNICORN_WORKERS:-2} --timeout 120"]
