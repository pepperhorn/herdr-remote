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
- Send text to a selected pane from the agent input, with a Send button beside it. Enter sends, Shift+Enter adds a newline.
- Send keys from an on-screen key row: Esc, arrow keys, Tab, a sticky Ctrl (tap Ctrl, then type a letter in the agent input to send Ctrl+letter), and Return.
- Run shell commands from a bottom drawer, opened by the terminal icon in the header.
- Run Herdr's detector explanation for a pane.
- Switch between light, dark, or follow-system theme with the toggle in the workspace sidebar.

Most Herdr workspaces use a single pane, so the selected tab's first pane is used automatically. If a tab has more than one pane, the app shows a pane selector before sending or reading.

## Requirements

- Node.js 20.12 or newer.
- `herdr` on `PATH` for the user running the server (tested with herdr 0.7.1), with a herdr server running as that same user.

## Run

```bash
cp .env.example .env   # then edit it
npm install
npm run build
npm start
```

The server reads `.env` from the project directory on startup. Variables already set in the real environment take precedence over `.env`.

Open `http://<dev-box-tailnet-name-or-ip>:8787`.

During development, run the API server and Vite separately:

```bash
npm start
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

## PM2

Run the production server under PM2. Settings come from `.env`; `ecosystem.config.cjs` does not set `HOST` or `PORT`.

```bash
npm run build
pm2 start ecosystem.config.cjs --only herdrrmt
pm2 save
```

After changing `.env`:

```bash
pm2 restart herdrrmt
```

## Installable PWA

The app includes a web app manifest, SVG icon, service worker, and SPA history fallback. Browser installation requires a secure context, so serve it over HTTPS with Tailscale Serve:

```bash
tailscale serve --bg --https=8443 8787
```

Then open:

```text
https://<machine>.<tailnet>.ts.net:8443/
```

To remove it:

```bash
tailscale serve --https=8443 off
```

## Environment

- `HOST`: bind address. Default: `127.0.0.1`. Use `0.0.0.0` to reach it from other tailnet devices.
- `PORT`: HTTP port. Default: `8787`.
- `HERDR_REMOTE_TOKEN`: optional. When set, API requests must send `Authorization: Bearer <token>`. The browser prompts once and remembers it.
- `HERDR_BIN`: Herdr executable. Default: `herdr`.
- `ALLOWED_HOSTS`: optional, comma-separated extra hostnames the server will answer to (e.g. a custom DNS name or reverse proxy name). IP addresses, `localhost`, single-label names (such as Tailscale MagicDNS short names) and `*.ts.net` names are always allowed.

## Security

- Anyone who can reach the port can read pane output and type into panes, including running shell commands. Keep it on a private network such as your tailnet. Never expose it to the public internet, and do not use Tailscale Funnel.
- Cross-site protections are always on, token or not. The server only answers to trusted Host names (blocks DNS-rebinding attacks), rejects browser requests whose Origin doesn't match, and only accepts JSON POST bodies, so a web page open on one of your devices can't forge commands.
- The token is optional. On a private tailnet where you trust every device and user, the tailnet is the access control. Set a token if the tailnet is shared with others or you want defence in depth. The server prints a warning at startup when it listens beyond localhost without a token.
- The on-screen keys are limited to a fixed allowlist of key names on the server.

## License

MIT. See [LICENSE](LICENSE).
