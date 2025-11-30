# ASDF-DAT Monitoring Stack

This directory contains the Docker Compose configuration for running Prometheus and Grafana to monitor the ASDF-DAT ecosystem.

## Prerequisites

- Docker and Docker Compose installed
- ASDF-DAT daemon running and exposing metrics on port 3030

## Quick Start

```bash
# Start the monitoring stack
cd monitoring
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the stack
docker-compose down
```

## Accessing the Services

| Service | URL | Default Credentials |
|---------|-----|---------------------|
| Grafana | http://localhost:3001 | admin / asdf-admin |
| Prometheus | http://localhost:9090 | N/A |

## Configuration

### Environment Variables

Create a `.env` file in the `monitoring/` directory (optional):

```bash
# Change Grafana admin password
GRAFANA_PASSWORD=your-secure-password
```

### Prometheus Scrape Target

By default, Prometheus scrapes the daemon at `host.docker.internal:3030`. If your daemon runs on a different host/port, edit `prometheus/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'asdf-daemon'
    static_configs:
      - targets: ['your-host:your-port']
```

## Pre-built Dashboard

The Grafana dashboard is automatically provisioned with the following panels:

### Overview Row
- **Daemon Uptime** - How long the daemon has been running
- **Tokens Monitored** - Number of tokens being tracked
- **Error Rate** - Percentage of failed operations (gauge with thresholds)
- **Cycle Success Rate** - Percentage of successful ecosystem cycles
- **Total Cycles** - Number of cycles executed
- **Avg Cycle Duration** - Average time to complete a cycle

### Fee Flow Row
- **Fee Flow Rate** - Time series of fees detected vs flushed
- **Pending Fees by Token** - Bar gauge showing pending fees per token

### Token Performance Row
- **Tokens Burned** - Bar chart of burned tokens per token
- **Fees Collected by Token** - Bar chart of fees collected per token

### Daemon Activity Row
- **Poll & Flush Rate** - Time series of daemon activity
- **Error Rate Over Time** - Time series of errors

## Prometheus Alert Rules

The following alerts are configured in `prometheus/rules/asdf-alerts.yml`:

| Alert | Severity | Condition |
|-------|----------|-----------|
| ASDFDaemonDown | critical | Daemon unreachable for 2 min |
| ASDFHighErrorRate | warning | Error rate > 10% for 5 min |
| ASDFNoPollActivity | warning | No polls for 2 min |
| ASDFPendingFeesStuck | warning | Fees pending > 30 min |
| ASDFNoTokensMonitored | warning | Zero tokens for 5 min |
| ASDFCycleFailures | warning | > 3 failures in 1 hour |

## Data Persistence

Prometheus and Grafana data are stored in Docker volumes:
- `prometheus_data` - Prometheus TSDB (30 day retention)
- `grafana_data` - Grafana configuration and dashboards

To backup:
```bash
docker run --rm -v monitoring_prometheus_data:/data -v $(pwd):/backup alpine tar cvf /backup/prometheus-backup.tar /data
docker run --rm -v monitoring_grafana_data:/data -v $(pwd):/backup alpine tar cvf /backup/grafana-backup.tar /data
```

## Troubleshooting

### Prometheus can't scrape the daemon

1. Ensure the daemon is running: `curl http://localhost:3030/health`
2. Check if the port is accessible from Docker: The compose file uses `host.docker.internal`
3. On Linux, you may need to use your machine's actual IP instead of `host.docker.internal`

### Grafana shows "No data"

1. Check Prometheus targets: http://localhost:9090/targets
2. Verify the daemon is exporting metrics: `curl http://localhost:3030/metrics`
3. Check the datasource is configured correctly in Grafana

### Reset to factory defaults

```bash
# Remove all data and restart fresh
docker-compose down -v
docker-compose up -d
```

## Extending the Dashboard

The pre-built dashboard is editable. Changes made in the Grafana UI will persist in the volume. To export your changes:

1. Edit the dashboard in Grafana
2. Click the gear icon (Dashboard settings)
3. JSON Model > Copy to clipboard
4. Update `grafana/provisioning/dashboards/asdf-dat.json`

## Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Host Machine                           │
│                                                             │
│   ┌─────────────────┐         ┌─────────────────────────┐  │
│   │  ASDF-DAT Daemon │         │     Docker Network      │  │
│   │    :3030        │◄────────►│                         │  │
│   │  /metrics       │         │  ┌───────────────────┐  │  │
│   └─────────────────┘         │  │    Prometheus     │  │  │
│                               │  │      :9090        │  │  │
│                               │  └───────────────────┘  │  │
│                               │           │             │  │
│                               │           ▼             │  │
│                               │  ┌───────────────────┐  │  │
│                               │  │     Grafana       │  │  │
│                               │  │      :3001        │  │  │
│                               │  └───────────────────┘  │  │
│                               └─────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
