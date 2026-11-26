'use strict';
// Entry point. Starts the Discord transport, or prints usage with no token.
const path = require('path');

const token = process.env.DISCORD_TOKEN || process.env.CONQUIZTA_BOT_TOKEN;

if (!token) {
  console.error('DISCORD_TOKEN (or CONQUIZTA_BOT_TOKEN) is not set — nothing to start.');
  console.error('Harness (no token needed):  node --env-file=../.env src/harness.js');
  process.exit(1);
}

const { start } = require('./discord-transport');

// The arena stays up even if one interaction or one message fails.
process.on('unhandledRejection', (e) => console.error('unhandled rejection (bot keeps running):', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('uncaught exception (bot keeps running):', (e && e.message) || e));

start({ token }).catch((err) => {
  console.error('bot failed:', err);
  process.exit(1);
});
