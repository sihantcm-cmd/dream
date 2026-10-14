import { createApp } from '../server/app';
import { createCloudRuntime } from '../server/cloudRuntime';

// Vercel owns the listener. Do not import the local server.ts entry point here.
export default createApp(createCloudRuntime());
