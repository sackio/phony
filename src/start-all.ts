import dotenv from 'dotenv';
import { isPortInUse } from './utils/execution-utils.js';
import { VoiceCallMcpServer } from './servers/mcp.server.js';
import { TwilioCallService } from './services/twilio/call.service.js';
import { VoiceServer } from './servers/voice.server.js';
import twilio from 'twilio';
import { CallSessionManager } from './handlers/openai.handler.js';

// Load environment variables
dotenv.config();

// Define required environment variables
const REQUIRED_ENV_VARS = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'PUBLIC_URL',
    'TWILIO_NUMBER'
] as const;

/**
 * Validates that all required environment variables are present
 * @returns true if all variables are present, exits process otherwise
 */
function validateEnvironmentVariables(): boolean {
    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            console.error(`Error: ${envVar} environment variable is required`);
            process.exit(1);
        }
    }
    return true;
}

/**
 * Sets up the port for the application
 */
function setupPort(): number {
    const PORT = process.env.PORT || '3004';
    process.env.PORT = PORT;
    return parseInt(PORT);
}

/**
 * Gets the public URL from environment variable
 * @returns The public URL for Twilio callbacks
 */
function getPublicUrl(): string {
    const publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl) {
        throw new Error('PUBLIC_URL environment variable is required');
    }

    // Remove trailing slash if present
    return publicUrl.replace(/\/$/, '');
}

/**
 * Sets up graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
    process.on('SIGINT', () => {
        console.log('\nGracefully shutting down...');
        process.exit(0);
    });
}

/**
 * Retries starting the server when the port is in use
 * @param portNumber - The port number to check
 */
function scheduleServerRetry(portNumber: number): void {
    console.error(`Port ${portNumber} is already in use. Server may already be running.`);
    console.error('Will retry in 15 seconds...');

    const RETRY_INTERVAL_MS = 15000;

    const retryInterval = setInterval(async () => {
        const stillInUse = await isPortInUse(portNumber);

        if (!stillInUse) {
            clearInterval(retryInterval);
            main();
        } else {
            console.error(`Port ${portNumber} is still in use. Will retry in 15 seconds...`);
        }
    }, RETRY_INTERVAL_MS);
}


async function main(): Promise<void> {
    try {
        validateEnvironmentVariables();
        const portNumber = setupPort();

        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        const sessionManager = new CallSessionManager(twilioClient);
        const twilioCallService = new TwilioCallService(twilioClient);

        // Check if port is already in use
        const portInUse = await isPortInUse(portNumber);
        if (portInUse) {
            scheduleServerRetry(portNumber);
            return;
        }

        // Get the public URL for Twilio callbacks
        const twilioCallbackUrl = getPublicUrl();

        // Start the main HTTP server
        const server = new VoiceServer(twilioCallbackUrl, sessionManager);
        server.start();

        console.log(`Voice server listening on port ${portNumber}`);
        console.log(`Public URL: ${twilioCallbackUrl}`);

        const mcpServer = new VoiceCallMcpServer(twilioCallService, twilioCallbackUrl);
        await mcpServer.start();

        // Set up graceful shutdown
        setupShutdownHandlers();
    } catch (error) {
        console.error('Error starting services:', error);
        process.exit(1);
    }
}

// Start the main function
main();
