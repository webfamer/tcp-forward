module.exports = {
  apps: [
    {
      name: "tcp-forward",
      script: "index.js",
      interpreter: "node",
      env: {
        LISTEN_PORT: "7777",
        ADMIN_HOST: "0.0.0.0",
        ADMIN_PORT: "3010",
      },
    }
  ],
};
