# Herdrrmt

Small remote dashboard for a running [Herdr](https://github.com/ogulcancelik/herdr) server.

It uses Herdr's CLI socket helpers instead of talking to the private Unix socket protocol directly. The app can:

- Show server compatibility/status.
- List workspaces, tabs, panes, and agents in a desktop-style sidebar.
- Open a full-screen workspace drawer and close it to give the reader the full viewport.
- Switch the focused tab. Workspace focus is intentionally not exposed as a primary action.
- Highlight agents that likely need attention: `blocked`, `done`, or `unknown`.
- Auto-read the active pane over an SSE stream with a low polling interval.
- Render ANSI terminal colors from Herdr reads.
- Submit text to a selected pane and press Enter.
- Run shell commands in the selected pane.
- Run Herdr's detector explanation for a pane.

Most Herdr workspaces use a single pane, so the selected tab's first pane is used automatically. If a tab has more than one pane, the app shows a pane selector before sending or reading.

## Run

```bash
cp .env.example .env
npm install
npm run build
npm start
```

Open `http://<dev-box-tailnet-name-or-ip>:8787`.

For remote use, set `HERDR_REMOTE_TOKEN` in `.env` and enter the token in the browser when prompted.

During development, run the API server and Vite separately:

```bash
npm start
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

## PM2

Run the production server under PM2:

```bash
npm run build
pm2 start ecosystem.config.cjs --only herdrrmt
pm2 save
```

The PM2 config binds the app to `HOST=0.0.0.0` and `PORT=8787`.

## Installable PWA

The app includes a web app manifest, SVG icon, service worker, and SPA history fallback. Browser installation requires a secure context, so use the Tailscale HTTPS endpoint:

```text
https://make-1.piranha-bitterling.ts.net:8443/
```

Current Tailscale Serve setup:

```bash
tailscale serve --bg --https=8443 8787
```

To remove it:

```bash
tailscale serve --https=8443 off
```

## Environment

- `HOST`: bind address. Use `0.0.0.0` for tailnet access. Default: `127.0.0.1`.
- `PORT`: HTTP port. Default: `8787`.
- `HERDR_REMOTE_TOKEN`: optional bearer token for API requests.
- `HERDR_BIN`: Herdr executable path. Default: `herdr`.

## Security Notes

This app can focus Herdr workspaces/tabs and read terminal output. Do not expose it on the public internet. Prefer Tailscale-only access, set `HERDR_REMOTE_TOKEN`, and use host firewall rules if needed.
