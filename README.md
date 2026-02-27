# GoTradeTalk UI

## Development

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
```

## E2E

See `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/e2e/README.md`.

## Docker (Nginx)

This project supports a production image using Nginx to serve `dist`.

### Build image

```bash
docker build -t gotradetalk-ui:latest .
```

### Run image

```bash
docker run --rm -p 8080:80 gotradetalk-ui:latest
```

### Health check

```bash
curl -i http://127.0.0.1:8080/healthz
```

Expected:
- HTTP 200
- body: `ok`

### Notes

- Nginx SPA fallback is enabled (`/ -> /index.html`) for route refresh/deep-link.
- Nginx config path: `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/deploy/nginx/default.conf`
- Dockerfile path: `/Users/mac/Documents/github/matrix-gitradetalk/gotradetalk-ui/Dockerfile`
