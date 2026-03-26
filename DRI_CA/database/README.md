# Database Setup — Local PostgreSQL + PostGIS

## Prerequisites
- PostgreSQL 14+ installed locally on Windows
- PostGIS extension installed (usually bundled with the PostgreSQL installer via Stack Builder)

## Setup Steps

### 1. Create the database
Open **pgAdmin** or a terminal and run:
```sql
CREATE DATABASE dri_db;
```

### 2. Create a user (optional, or use your existing postgres user)
```sql
CREATE USER dri_user WITH PASSWORD 'dri_pass';
GRANT ALL PRIVILEGES ON DATABASE dri_db TO dri_user;
```

### 3. Run the schema + seed data
```bash
psql -U postgres -d dri_db -f init/001_schema.sql
psql -U postgres -d dri_db -f init/002_alerts.sql
psql -U postgres -d dri_db -f init/003_historic_disasters.sql
psql -U postgres -d dri_db -f init/004_expanded_zones.sql
```

Or via pgAdmin: open a query tool on `dri_db` and execute the contents of the `init` SQL files in sequential order.

### 4. Verify
```sql
SELECT 'flood_zones' AS tbl, COUNT(*) FROM flood_zones
UNION ALL
SELECT 'landslide_zones', COUNT(*) FROM landslide_zones
UNION ALL
SELECT 'coastal_zones', COUNT(*) FROM coastal_zones
UNION ALL
SELECT 'seismic_zones', COUNT(*) FROM seismic_zones
UNION ALL
SELECT 'historic_disasters', COUNT(*) FROM historic_disasters;
```
Expected: All tables should return rows based on seed data.

## Connection String
```
postgresql://dri_user:dri_pass@localhost:5432/dri_db
```
Update `server/.env` if you use different credentials.
