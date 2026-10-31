// PM2 process file: `pm2 start deploy/ecosystem.config.cjs` from the repo root.
// Exactly one instance: the message sender and daily reminder jobs run inside the API process,
// so a second instance (or cluster mode) would send every WhatsApp/SMS twice.
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'sabilling-api',
      cwd: path.join(__dirname, '../apps/api'),
      script: 'src/server.js',
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      time: true,
    },
  ],
};
