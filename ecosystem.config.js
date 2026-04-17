module.exports = {
  apps: [
    {
      name: "tcp-forward",
      script: "index.js",
      interpreter: "node",
      env: {
        LISTEN_HOST: "0.0.0.0",
        ADMIN_HOST: "127.0.0.1",
        ADMIN_PORT: "3000",
      },
    },
  ],
};
