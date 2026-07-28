module.exports = {
  apps: [
    {
      name: "herdrrmt",
      script: "server.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "8787",
        HERDR_BIN: "herdr"
      }
    }
  ]
};
