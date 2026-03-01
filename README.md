# Ring NVR

A self-hosted network video recorder for Ring doorbells and cameras. Consists of a FastAPI backend that connects to the Ring API and records motion events, and a React frontend for browsing and playing back recordings.

## Stack

- Backend: Python, FastAPI, SQLAlchemy, SQLite
- Frontend: React 19, TypeScript, Vite, Tailwind CSS
- Auth: JWT (local users defined in config.yaml), Ring account via Ring API

## Requirements

- Docker (recommended)
- Or: Python 3.11+ and Node.js 20+ for running locally

## Configuration

Copy and edit `config.yaml` before running:

- `users`: list of local NVR users (username + bcrypt or plaintext password)
- `auth.secret_key`: change to a long random string before deploying
- `recording.storage_path`: path where video files are stored
- `recording.duration_seconds`: how long each recording runs after a motion event
- `recording.autodelete_days`: automatically delete recordings older than this many days (0 to disable)

## Running with Docker

```
docker build -t ring-nvr .
docker run -d \
  -p 8000:8000 \
  -v $(pwd)/config.yaml:/app/config.yaml \
  -v $(pwd)/recordings:/app/app/recordings \
  --name ring-nvr \
  ring-nvr
```

The API will be available at http://localhost:8000.

## Running Locally

Backend:

```
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```
cd web
npm install
npm run dev
```

## CI/CD

GitHub Actions runs on every push and pull request:

- CI: lints and type-checks the frontend
- CD: builds and pushes a Docker image to GitHub Container Registry on every push to `main`

The image is tagged with both `latest` and the commit SHA.

## Project Structure

```
app/         FastAPI backend
  main.py    API routes
  auth.py    JWT and user auth
  database.py  SQLAlchemy models and session
  ring_manager.py  Ring API integration and recording logic
  schemas.py Pydantic schemas
  recordings/  Default recording storage location
web/         React frontend
config.yaml  Runtime configuration
nvr.db       SQLite database (created at runtime)
```

## Notes

- On first run, log in to your Ring account through the Settings page in the UI. Two-factor authentication is supported.
- The JWT secret key and user passwords in `config.yaml` must be changed before exposing the service publicly.
- Recordings are stored as files on disk. Make sure the storage path is on a volume with sufficient space.