# PostgreSQL + Electron Research

## Summary
Running PostgreSQL locally via Docker is a solid approach for an Electron desktop app. Drizzle ORM is recommended over Prisma for this use case due to lighter weight and SQL-first approach.

## Key Findings

### Docker Integration
- Use `dockerode` npm package to manage Docker containers from Electron
- Alternatively, shell out to `docker compose` via child_process
- Docker Compose is simpler and more reliable for managing PostgreSQL lifecycle

### Recommended docker-compose.yml

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: living-dashboard-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: living_dashboard
      POSTGRES_USER: dashboard
      POSTGRES_PASSWORD: ${DB_PASSWORD:-localdev}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dashboard"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### ORM Comparison for This Project

| Feature | Drizzle | Prisma |
|---------|---------|--------|
| Bundle size | ~7.4kB (min+gzip) | ~2MB+ (engine binary) |
| Schema approach | TypeScript code | .prisma file + codegen |
| SQL familiarity | SQL-like syntax | Custom query builder |
| Learning curve | Lower (if you know SQL) | Moderate |
| Migrations | Built-in (drizzle-kit) | Built-in (prisma migrate) |
| Type safety | Full | Full |
| Code generation | Not needed | Required (prisma generate) |
| Electron fit | Excellent (lightweight) | Good but heavier |

**Recommendation: Drizzle ORM** — lighter, no codegen step, SQL-first fits well with PostgreSQL, works great in Electron's Node.js process.

### Data Model Sketch

Core entities for Living Dashboard:

```
Projects
  ├── Boards (Kanban views)
  │     └── Cards (tasks, items)
  │           ├── Labels
  │           ├── Comments
  │           └── Attachments
  ├── Meetings
  │     ├── Transcripts
  │     ├── Briefs (AI summaries)
  │     └── ActionItems → Cards
  ├── Ideas
  │     ├── Tags
  │     └── Links (to Projects/Cards)
  └── BrainstormSessions
        └── Messages
```

### Connection Management
- Use `postgres` (porsager/postgres) or `pg` package as driver
- Drizzle supports both
- Connection pooling via `pg-pool` for concurrent queries
- Handle app startup: check Docker → check PostgreSQL health → connect

### Migration Strategy
- Use `drizzle-kit` for schema migrations
- Store migration files in the app
- Run migrations on app startup (after DB connection)
- Version migrations with app version

### Backup/Restore
- `pg_dump` via Docker exec for backups
- Export to `.sql` file in user-chosen directory
- Restore via `psql` from backup file
- Consider scheduled auto-backups

### Alternative: Without Docker
- **Embedded PostgreSQL**: Not really viable — PostgreSQL doesn't embed well
- **SQLite alternative**: Could start with SQLite (simpler) and migrate to PostgreSQL later
- **PostgreSQL via native install**: User installs PostgreSQL directly — less portable

## Risks
- Docker must be installed and running (dependency)
- First-time setup requires Docker image pull
- PostgreSQL container uses RAM even when idle (~30-50MB)
- Data lives in Docker volume — users need to understand backup

## Sources
- https://www.bytebase.com/blog/drizzle-vs-prisma/
- https://betterstack.com/community/guides/scaling-nodejs/drizzle-vs-prisma/
- https://medium.com/@codabu/drizzle-vs-prisma-choosing-the-right-typescript-orm-in-2026-deep-dive-63abb6aa882b
