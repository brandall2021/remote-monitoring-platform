# Remote Monitoring Platform

Enterprise remote monitoring system for authorized corporate device administration.

## Architecture

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │    │    Server    │    │    Agent     │
│  React + MUI │◄──►│  Node.js +   │◄──►│  Windows     │
│  Port 5173   │    │  Express +   │    │  Agent       │
│              │    │  Socket.IO   │    │              │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
                    ┌──────┴───────┐
                    │  PostgreSQL  │
                    │  Redis       │
                    └──────────────┘
```

## Quick Start (Docker)

```bash
# Clone and configure
cp server/.env.example server/.env
cp client/.env.example client/.env

# Start all services
docker-compose up -d

# Access the panel
open http://localhost:5173
```

## Default Credentials

- **Email:** admin@monitoring.local
- **Password:** admin123

## Manual Installation

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 7+

### Server Setup

```bash
cd server
npm install
cp .env.example .env   # Edit with your config
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

### Client Setup

```bash
cd client
npm install
npm run dev
```

### Agent Setup (Windows)

```bash
cd agent
npm install
cp .env.example .env   # Configure server URL and token
npm run dev
```

## API Documentation

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh token |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/profile | Get profile |

### Users

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | /api/users | USERS_READ | List users |
| POST | /api/users | USERS_WRITE | Create user |
| PUT | /api/users/:id | USERS_WRITE | Update user |
| DELETE | /api/users/:id | USERS_DELETE | Delete user |

### Devices

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | /api/devices | DEVICES_READ | List devices |
| GET | /api/devices/:id | DEVICES_READ | Device details |
| GET | /api/devices/stats | DEVICES_READ | Dashboard stats |
| DELETE | /api/devices/:id | DEVICES_DELETE | Remove device |

### Commands

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | /api/commands | COMMANDS_READ | List commands |
| POST | /api/commands | COMMANDS_WRITE | Create command |
| POST | /api/commands/:id/approve | COMMANDS_EXECUTE | Approve |
| POST | /api/commands/:id/reject | COMMANDS_EXECUTE | Reject |

### Screenshots

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | /api/screenshots | SCREENSHOTS_VIEW | List screenshots |
| POST | /api/screenshots/request | SCREENSHOTS_REQUEST | Request capture |
| GET | /api/screenshots/:id | SCREENSHOTS_VIEW | View screenshot |

### Audit

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | /api/audit | AUDIT_READ | View audit logs |

## Roles & Permissions

| Permission | SUPER_ADMIN | ADMIN | OPERATOR |
|------------|:-----------:|:-----:|:--------:|
| USERS_READ | ✓ | ✓ | |
| USERS_WRITE | ✓ | ✓ | |
| USERS_DELETE | ✓ | | |
| DEVICES_READ | ✓ | ✓ | ✓ |
| DEVICES_WRITE | ✓ | ✓ | |
| DEVICES_DELETE | ✓ | | |
| COMMANDS_READ | ✓ | ✓ | ✓ |
| COMMANDS_WRITE | ✓ | ✓ | |
| COMMANDS_EXECUTE | ✓ | ✓ | |
| SCREENSHOTS_REQUEST | ✓ | ✓ | |
| SCREENSHOTS_VIEW | ✓ | ✓ | ✓ |
| AUDIT_READ | ✓ | ✓ | ✓ |

## Security Features

- JWT + Refresh Tokens authentication
- Role-Based Access Control (RBAC)
- HTTPS enforcement
- Rate limiting
- Helmet security headers
- CORS configuration
- Complete audit logging
- Command signing
- Token-based agent authentication
- Encrypted screenshot transmission

## Deploy with Dokploy

### Option 1: Full Stack (Server + PostgreSQL + Redis)

1. Create a new project in Dokploy
2. Add a **Docker Compose** service
3. Upload `docker-compose.dokploy.yml`
4. Configure environment variables in Dokploy UI (see `dokploy.env.example`)
5. Deploy

### Option 2: Server Only (External Database)

1. Create PostgreSQL and Redis in Dokploy (or use external)
2. Create a new **Docker** service in Dokploy
3. Set source to GitHub repo: `remote-monitoring-platform`
4. Set Dockerfile: `server/Dockerfile`
5. Configure environment variables:

```
DATABASE_URL=postgresql://user:pass@your-pg-host:5432/remote_monitoring
REDIS_URL=redis://your-redis-host:6379
JWT_SECRET=generate-random-32-chars
JWT_REFRESH_SECRET=generate-random-32-chars
CORS_ORIGIN=https://your-domain.com
AGENT_REGISTRATION_TOKEN=generate-random-token
NODE_ENV=production
PORT=3000
```

6. Deploy

### Dokploy Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:pass@postgres:5432/remote_monitoring` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | `your-super-secret-jwt-key-change-this` |
| `JWT_REFRESH_SECRET` | Refresh token secret | `your-super-secret-refresh-key-change-this` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `CORS_ORIGIN` | Allowed origin for CORS | `https://monitoring.yourdomain.com` |
| `AGENT_REGISTRATION_TOKEN` | Token for agent registration | `random-token-here` |
| `NODE_ENV` | Environment mode | `production` |

### Post-Deploy

1. Run database migration: `npx prisma migrate deploy` (automatic in Dockerfile)
2. Seed initial data: `npx prisma db seed`
3. Access admin panel at your configured domain
4. Default login: `admin@monitoring.local` / `admin123`

## Development

```bash
# Run in development mode
docker-compose -f docker-compose.dev.yml up

# Or run individually
cd server && npm run dev
cd client && npm run dev
```

## License

MIT
