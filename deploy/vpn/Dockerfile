FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ppp pptp-linux tinyproxy curl ca-certificates iproute2 python3 \
    && rm -rf /var/lib/apt/lists/*
COPY supervisor.py /app/supervisor.py
CMD ["python3", "-u", "/app/supervisor.py"]
