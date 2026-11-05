# ParkPulse

Smart Parking Reservation and Analytics System (DBMS Mini Project).
Stack: MySQL 8.4 LTS, Node.js + Express (TypeScript) with `mysql2` raw SQL, Next.js 14 + Tailwind CSS (Warm Editorial Sand design system), Recharts, Leaflet + OpenStreetMap, Docker Compose.

## Repository Structure

    parkpulse/
    ├── db/                     # MySQL 8.4 3NF schema, seed, triggers, procedures, views & SQL tests
    ├── backend/                # Express + TypeScript REST & SSE API (raw SQL via mysql2/promise)
    ├── frontend/               # Next.js 14 App Router UI (Warm Editorial Sand theme, Recharts, Leaflet)
    ├── docs/                   # ER diagram, EXPLAIN index report, analytics SQL & viva demo script
    ├── docker-compose.yml      # Full-stack Docker Compose (mysql + backend + frontend)
    └── railway.json            # Railway cloud deployment configuration

## Quick Start (Local Development)

    cp .env.example .env          (Windows PowerShell: Copy-Item .env.example .env)
    docker compose up -d mysql
    docker compose ps             (wait until parkpulse-mysql shows "healthy")

    # Terminal 1 — Backend API (http://localhost:4000)
    cd backend
    npm install
    npm run dev

    # Terminal 2 — Next.js Frontend (http://localhost:3000)
    cd frontend
    npm install
    npm run dev

## Cloud Deployment (Option 1: Railway + Vercel)

### 1. Deploy MySQL 8 & Express Backend on Railway
1. Create a new project on Railway and provision a **MySQL** service.
2. Add a **GitHub Repo** service pointing to `iitdsiddhant18-blip/ParkPulse`.
3. In the backend service variables, link the Railway MySQL variables (`MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`) and set `JWT_SECRET`.
4. Run `cd backend && npm run db:init:demo` once via Railway CLI (or deployment one-off command) to initialize all 14 tables, triggers, stored procedures, views, and demo analytics data.

### 2. Deploy Next.js Frontend on Vercel
1. Import `iitdsiddhant18-blip/ParkPulse` on Vercel.
2. Set the **Root Directory** to `frontend`.
3. Set the environment variable `NEXT_PUBLIC_API_URL` to your Railway backend URL (e.g. `https://parkpulse-backend-production.up.railway.app`).
4. Click **Deploy**.

## Run All Verification Suites (343 Total Checks)

    # 1. Database Schema, Logic & Concurrency (62 + 52 + 4 checks)
    docker compose exec mysql mysql -uroot -pparkpulse_dev --batch -e "source /tests/verify_logic.sql"
    docker compose exec mysql bash -c "tr -d '\r' < /tests/test_concurrency.sh | bash"

    # 2. Backend API Suites (42 Phase 2a checks + 48 Phase 2b checks)
    cd backend
    npm run typecheck
    npm run test:2a
    npm run test:2b

    # 3. Frontend & Full-Stack End-to-End Suites (30 + 36 + 34 + 35 checks — Phase 3a through Phase 4b)
    cd ../frontend
    npm run typecheck
    npm run build
    npm run test:3a
    npm run test:3b
    npm run test:4a
    npm test              # runs verify_phase_4b.ts (Phase 4b Final QA)

## Seed Logins

- Admin: `admin@parkpulse.dev` / `Admin@123`
- Users: `rohan@example.com`, `ananya@example.com`, `karthik@example.com` / `Password@123`
