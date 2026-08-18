# Database Backup and Restore Strategy

## Overview

This document defines the production backup and restore procedures for the PredictionPro database.

## Backup Requirements

- **Automated backups:** Daily automated backups
- **Retention policy:** 30 days of daily backups, 12 monthly archives
- **Point-in-time recovery:** Supported if database provider supports it
- **Restore testing:** Quarterly restore tests to verify backup integrity

## Backup Configuration

### PostgreSQL Backups

```bash
# Daily logical backup
pg_dump -Fc -v -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "/backups/predictpro_$(date +%Y%m%d).dump"

# Daily schema-only backup
pg_dump -s -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "/backups/predictpro_schema_$(date +%Y%m%d).sql"
```

### Retention Script

```bash
# Keep 30 daily backups
find /backups -name "predictpro_*.dump" -mtime +30 -delete

# Keep 12 monthly backups
find /backups -name "predictpro_*.dump" -mtime +365 -delete
```

## Restore Procedure

### Prerequisites

- Access to backup storage
- Database credentials with restore permissions
- Maintenance window scheduled
- Team notification sent

### Steps

1. **Verify backup integrity:**
   ```bash
   pg_restore -l /backups/predictpro_20240101.dump | head
   ```

2. **Create new database for restore:**
   ```bash
   createdb -h "$DB_HOST" -U "$DB_USER" predictpro_restore
   ```

3. **Restore backup:**
   ```bash
   pg_restore -h "$DB_HOST" -U "$DB_USER" -d predictpro_restore /backups/predictpro_20240101.dump
   ```

4. **Verify data integrity:**
   ```sql
   SELECT COUNT(*) FROM User;
   SELECT COUNT(*) FROM Subscription;
   -- Compare with expected counts
   ```

5. **Switch application to restored database:**
   - Update `DATABASE_URL` environment variable
   - Deploy or restart application
   - Verify application functionality

6. **Monitor for issues:**
   - Check application logs
   - Verify user authentication works
   - Test critical flows (payments, predictions)

## Point-in-Time Recovery

If your database provider supports PITR (e.g., AWS RDS, Supabase):

1. **Identify recovery point:**
   - Determine exact timestamp before incident
   - Note WAL archive location

2. **Restore to new instance:**
   ```bash
   # AWS RDS example
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier predictpro-prod \
     --target-db-instance-identifier predictpro-recovery \
     --restore-time "2024-01-15T14:30:00Z"
   ```

3. **Verify and promote:**
   - Validate data integrity
   - Update application connection string
   - Promote restored instance to primary

## Backup Verification Schedule

- **Daily:** Automated backup completion check
- **Weekly:** Restore to staging and verify
- **Quarterly:** Full restore drill with team

## Database Security Requirements

### Transport Security

- **TLS required:** All database connections must use TLS
- **Certificate verification:** Verify server certificate
- **Connection string example:**
  ```
  DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
  ```

### Access Control

- **Private network:** Database is not publicly accessible
- **Least privilege:** Application user has only required permissions
- **Separate users:** Application user vs migration user
- **Connection pooling:** Use PgBouncer or similar for connection limits

### Monitoring

- **Connection limits:** Monitor active connections
- **Slow queries:** Log queries > 1 second
- **Failed logins:** Alert on authentication failures
- **Backup status:** Alert on backup failures

## Incident Response

### Database Compromise

1. **Isolate database** from application
2. **Preserve evidence** - do not destroy logs
3. **Assess scope** - what data was accessed
4. **Restore from backup** to known good state
5. **Rotate all credentials**
6. **Notify affected users** if data was exposed
7. **File incident report**

### Backup Failure

1. **Alert on-call team** immediately
2. **Check backup storage** for available recent backups
3. **Attempt manual backup**
4. **Review backup logs** for root cause
5. **Update runbook** if process failure

## Backup Retention Policy

| Backup Type | Retention | Storage Location |
|-------------|-----------|------------------|
| Daily | 30 days | Primary + offsite |
| Weekly | 12 weeks | Offsite |
| Monthly | 12 months | Offsite |
| Pre-migration | 90 days | Offsite |
