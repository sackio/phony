# 🚀 Production Deployment Checklist

Complete checklist for deploying Phony Voice AI Agent to production.

## Pre-deployment Preparation

### ✅ Environment Setup
- [ ] **Server Requirements Met**
  - [ ] 4+ GB RAM available
  - [ ] 20+ GB disk space
  - [ ] Docker 20.10+ installed
  - [ ] Docker Compose 2.0+ installed
  - [ ] Public domain/IP configured

- [ ] **Credentials Configured**
  - [ ] Twilio Account SID obtained
  - [ ] Twilio Auth Token obtained
  - [ ] Twilio phone number purchased
  - [ ] OpenAI API key with Realtime API access
  - [ ] JWT secret generated (32+ characters)
  - [ ] SSL certificates obtained (if not using reverse proxy)

- [ ] **Network Configuration**
  - [ ] Firewall rules configured (ports 80, 443, 24187)
  - [ ] DNS records configured
  - [ ] Load balancer configured (if applicable)
  - [ ] CDN configured (if applicable)

### ✅ Code Preparation
- [ ] **Repository Setup**
  - [ ] Latest code pulled from main branch
  - [ ] All tests passing locally
  - [ ] Docker images build successfully
  - [ ] Environment variables reviewed

- [ ] **Configuration Files**
  - [ ] `.env.prod` created with production values
  - [ ] `docker-compose.prod.yml` configured
  - [ ] `nginx.conf` configured (if using)
  - [ ] Log rotation configured

## Security Checklist

### ✅ Credentials & Secrets
- [ ] **Environment Variables Secured**
  - [ ] No hardcoded secrets in code
  - [ ] `.env` files not in version control
  - [ ] Strong JWT secret configured
  - [ ] Database passwords changed from defaults

- [ ] **API Security**
  - [ ] Rate limiting configured
  - [ ] Input validation enabled
  - [ ] CORS properly configured
  - [ ] API authentication enforced

- [ ] **Network Security**
  - [ ] HTTPS/TLS enabled
  - [ ] HTTP redirects to HTTPS
  - [ ] Security headers configured
  - [ ] Firewall rules restrictive

### ✅ Data Protection
- [ ] **Database Security**
  - [ ] MongoDB authentication enabled
  - [ ] Database network isolated
  - [ ] Backup encryption enabled
  - [ ] Access logs enabled

- [ ] **Application Security**
  - [ ] Debug mode disabled (`PHONY_DEBUG=0`)
  - [ ] Error messages sanitized
  - [ ] File upload restrictions
  - [ ] XSS protection enabled

## Deployment Steps

### ✅ Phase 1: Infrastructure Setup
```bash
# 1. Create production directory
mkdir /opt/phony-prod
cd /opt/phony-prod

# 2. Clone repository
git clone https://github.com/sackio/phony.git .
git checkout main

# 3. Create production environment
cp .env.example .env.prod
# Edit .env.prod with production values

# 4. Verify configuration
docker-compose -f docker-compose.yml -f docker-compose.prod.yml config
```

### ✅ Phase 2: Database Setup
```bash
# 1. Start database services
docker-compose -f docker-compose.prod.yml up -d mongodb redis

# 2. Wait for services to initialize
sleep 30

# 3. Verify database connectivity
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"
docker-compose exec redis redis-cli ping

# 4. Create initial data (if needed)
docker-compose run --rm backend python3 scripts/init_production.py
```

### ✅ Phase 3: Application Deployment
```bash
# 1. Build production images
docker-compose -f docker-compose.prod.yml build --no-cache

# 2. Start all services
docker-compose -f docker-compose.prod.yml up -d

# 3. Wait for services to start
sleep 60

# 4. Verify health
curl -f https://your-domain.com/healthz
```

### ✅ Phase 4: Twilio Configuration
```bash
# 1. Configure webhooks
docker-compose run --rm backend python3 scripts/setup_twilio.py

# 2. Test phone number
# Call your Twilio number and verify it works

# 3. Verify webhook endpoints
curl -X POST https://your-domain.com/receive_call \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=TEST123&From=%2B15551234567"
```

## Post-deployment Verification

### ✅ Functionality Testing
- [ ] **Basic Functionality**
  - [ ] Health endpoint responds
  - [ ] Dashboard loads successfully
  - [ ] WebSocket connections work
  - [ ] API endpoints respond correctly

- [ ] **Call Testing**
  - [ ] Inbound calls connect successfully
  - [ ] AI responds to voice input
  - [ ] Outbound calls initiate correctly
  - [ ] Call transcripts appear in dashboard

- [ ] **Multi-tenant Testing** (if enabled)
  - [ ] Tenant creation works
  - [ ] Agent assignment works
  - [ ] Data isolation verified
  - [ ] Authentication enforced

### ✅ Performance Testing
- [ ] **Load Testing**
  - [ ] Concurrent call handling tested
  - [ ] Resource usage monitored
  - [ ] Response times acceptable
  - [ ] Database performance verified

- [ ] **Stress Testing**
  - [ ] System behavior under high load
  - [ ] Memory usage patterns
  - [ ] Error handling under stress
  - [ ] Recovery after failures

### ✅ Security Testing
- [ ] **Vulnerability Assessment**
  - [ ] OWASP security checklist
  - [ ] Penetration testing completed
  - [ ] SSL/TLS configuration verified
  - [ ] Access controls tested

- [ ] **Data Security**
  - [ ] Call data encryption verified
  - [ ] Audit logs working
  - [ ] Backup procedures tested
  - [ ] Data retention policies enforced

## Monitoring & Maintenance

### ✅ Monitoring Setup
- [ ] **Application Monitoring**
  - [ ] Health checks automated
  - [ ] Error alerting configured
  - [ ] Performance metrics collected
  - [ ] Log aggregation setup

- [ ] **Infrastructure Monitoring**
  - [ ] Server resource monitoring
  - [ ] Database monitoring
  - [ ] Network monitoring
  - [ ] Disk space monitoring

### ✅ Backup Configuration
```bash
# Database backup script
#!/bin/bash
BACKUP_DIR="/opt/backups/phony"
DATE=$(date +%Y%m%d-%H%M%S)

# Create backup directory
mkdir -p "$BACKUP_DIR"

# MongoDB backup
docker-compose exec mongodb mongodump --out "/tmp/backup-$DATE"
docker cp phony-mongodb:/tmp/backup-$DATE "$BACKUP_DIR/mongodb-$DATE"

# Environment backup
cp .env.prod "$BACKUP_DIR/env-$DATE"

# Cleanup old backups (keep 30 days)
find "$BACKUP_DIR" -type d -mtime +30 -exec rm -rf {} \;
```

### ✅ Log Management
```bash
# Log rotation configuration
# /etc/logrotate.d/phony-docker
/var/lib/docker/containers/*/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    copytruncate
}
```

## Maintenance Procedures

### ✅ Regular Maintenance
- [ ] **Daily Tasks**
  - [ ] Monitor system health
  - [ ] Check error logs
  - [ ] Verify backup completion
  - [ ] Review security logs

- [ ] **Weekly Tasks**
  - [ ] Update Docker images
  - [ ] Review performance metrics
  - [ ] Test backup restoration
  - [ ] Security scan

- [ ] **Monthly Tasks**
  - [ ] Security updates
  - [ ] SSL certificate renewal
  - [ ] Capacity planning review
  - [ ] Disaster recovery test

### ✅ Update Procedures
```bash
# Production update script
#!/bin/bash
echo "Starting production update..."

# 1. Create backup
./backup.sh

# 2. Pull latest code
git pull origin main

# 3. Update images
docker-compose -f docker-compose.prod.yml pull

# 4. Rolling restart
docker-compose -f docker-compose.prod.yml up -d --force-recreate

# 5. Wait for services
sleep 60

# 6. Health check
curl -f https://your-domain.com/healthz || {
    echo "Health check failed! Rolling back..."
    git checkout HEAD~1
    docker-compose -f docker-compose.prod.yml up -d
    exit 1
}

echo "Update completed successfully!"
```

## Disaster Recovery

### ✅ Recovery Procedures
- [ ] **Backup Strategy**
  - [ ] Multiple backup locations
  - [ ] Automated backup testing
  - [ ] Recovery time objectives defined
  - [ ] Recovery point objectives defined

- [ ] **Failover Procedures**
  - [ ] Standby server configured
  - [ ] DNS failover configured
  - [ ] Database replication setup
  - [ ] Automated failover tested

### ✅ Emergency Contacts
- [ ] **Team Contacts**
  - [ ] DevOps team contact list
  - [ ] Management escalation path
  - [ ] Vendor support contacts
  - [ ] Communication channels defined

## Go-Live Checklist

### ✅ Final Pre-Production
- [ ] All tests passed
- [ ] Security review completed
- [ ] Performance benchmarks met
- [ ] Monitoring configured and tested
- [ ] Backup procedures verified
- [ ] Team trained on production procedures
- [ ] Documentation updated
- [ ] Runbook created

### ✅ Go-Live Execution
- [ ] **T-60 minutes**: Final system check
- [ ] **T-30 minutes**: Start services
- [ ] **T-15 minutes**: Verify all endpoints
- [ ] **T-10 minutes**: Configure DNS/load balancer
- [ ] **T-5 minutes**: Final health check
- [ ] **T-0 minutes**: Switch traffic to production
- [ ] **T+5 minutes**: Verify user traffic
- [ ] **T+15 minutes**: Monitor for issues
- [ ] **T+30 minutes**: Confirm stable operation

### ✅ Post-Go-Live
- [ ] Monitor system for 24 hours
- [ ] Document any issues encountered
- [ ] Update monitoring thresholds based on real traffic
- [ ] Conduct post-deployment retrospective
- [ ] Update documentation with lessons learned

---

**Production Deployment Completed**: ✅
**Date**: ___________
**Deployed by**: ___________
**Version**: ___________