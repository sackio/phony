import dotenv from 'dotenv';
import { VoiceCallMcpServer } from './servers/mcp.server.js';
import { TwilioCallService } from './services/twilio/call.service.js';
import twilio from 'twilio';

// Load environment variables
dotenv.config();

// Define required environment variables
const REQUIRED_ENV_VARS = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'PUBLIC_URL',
    'TWILIO_NUMBER'
] as const;

function validateEnvironmentVariables(): boolean {
    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            console.error(`Error: ${envVar} environment variable is required`);
            process.exit(1);
        }
    }
    return true;
}

function getPublicUrl(): string {
    const publicUrl = process.env.PUBLIC_URL;
    if (!publicUrl) {
        throw new Error('PUBLIC_URL environment variable is required');
    }
    return publicUrl.replace(/\/$/, '');
}

async function main(): Promise<void> {
    try {
        validateEnvironmentVariables();
        
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const twilioCallService = new TwilioCallService(twilioClient);
        const twilioCallbackUrl = getPublicUrl();

        const mcpServer = new VoiceCallMcpServer(twilioCallService, twilioCallbackUrl);
        await mcpServer.start();
        
        console.error('MCP Server started via stdio');
    } catch (error) {
        console.error('Error starting MCP server:', error);
        process.exit(1);
    }
}

main();
