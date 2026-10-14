import { createApp } from '../server/app.js';
import { createCloudRuntime } from '../server/cloudRuntime.js';

// Vercel owns the listener. Do not import the local server.ts entry point here.
export default createApp(createCloudRuntime());
