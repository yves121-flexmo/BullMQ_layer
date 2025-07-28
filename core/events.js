// events.js
import { QueueEvents } from 'bullmq';
import dotenv from 'dotenv';
dotenv.config();

const events = new QueueEvents('email', {
  connection: { url: process.env.REDIS_URL }
});

events.on('completed', ({ jobId, name }) => {
  console.log(`(Events) Job ${jobId} ${name} done`);
});
events.on('failed', ({ jobId, failedReason }) => {
  console.log(`(Events) Job ${jobId} failed: ${failedReason}`);
});
