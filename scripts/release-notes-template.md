# ExcaliDash v{{VERSION}}

Release date: {{DATE}}

## Upgrading

<details>
<summary>Show upgrade steps</summary>

### Data safety checklist

- Back up backend volume (`dev.db`, secrets) before upgrading.
- Let migrations run on startup (`RUN_MIGRATIONS=true`) for normal deploys.
- Run `docker compose -f docker-compose.prod.yml logs backend --tail=200` after rollout and verify startup/migration status.

### Recommended upgrade (Docker Hub compose)

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Pin images to this release (recommended for reproducible deploys)

Edit `docker-compose.prod.yml` and pin the release tags:

```yaml
services:
  backend:
    image: zimengxiong/excalidash-backend:{{TAG}}
  frontend:
    image: zimengxiong/excalidash-frontend:{{TAG}}
```

Example:

```bash
docker compose -f docker-compose.prod.yml up -d
```

</details>
