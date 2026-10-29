FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY backend/powercontext ./backend/powercontext
RUN pip install --no-cache-dir --no-deps ./backend/powercontext
COPY serve_backend.py ./
ENV POWERCONTEXT_HOST=0.0.0.0 POWERCONTEXT_PORT=18180
EXPOSE 18180
CMD ["python", "serve_backend.py"]
