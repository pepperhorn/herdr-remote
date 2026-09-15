// HOST, PORT, HERDR_REMOTE_TOKEN, HERDR_BIN and ALLOWED_HOSTS are read from
// .env by server.js, so edit .env (then `pm2 restart herdrrmt`) rather than
// setting them here — values set here would take precedence over .env.
module.exports = {
  apps: [
    {
      name: "herdrrmt",
      script: "server.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
