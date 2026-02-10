#!/usr/bin/env node
require('dotenv').config();
const twilio = require('twilio');

// Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER;
const PUBLIC_URL = process.env.PUBLIC_URL;
// Use the same fixed secret as the server
const DYNAMIC_API_SECRET = process.env.API_SECRET || '';

// Get phone number from command line or use test number
const TO_NUMBER = process.argv[2] || process.env.TEST_PHONE_NUMBER;

if (!TO_NUMBER) {
    console.error('Usage: node test-call.js <phone-number>');
    console.error('Example: node test-call.js +15551234567');
    process.exit(1);
}

// Call context - what the AI should do
const callContext = `You are a friendly AI assistant calling to test a new voice calling system.
Start by greeting the person warmly and introducing yourself as Claude, an AI voice assistant.
Then tell them a really funny programming joke or a dad joke.
After the joke, ask them how their day is going and have a brief friendly conversation.
Keep your responses natural, conversational, and concise.
When the conversation naturally winds down or they say goodbye, wish them a great day and end the call.`;

const callContextEncoded = encodeURIComponent(callContext);

console.log('🤖 Initiating test call...');
console.log('From:', TWILIO_NUMBER);
console.log('To:', TO_NUMBER);
console.log('Context:', callContext);
console.log('\n📞 Making call via Twilio...\n');

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

twilioClient.calls.create({
    to: TO_NUMBER,
    from: TWILIO_NUMBER,
    url: `${PUBLIC_URL}/call/outgoing?apiSecret=${DYNAMIC_API_SECRET}&callType=outgoing&callContext=${callContextEncoded}`,
})
.then(call => {
    console.log('✅ Call initiated successfully!');
    console.log('Call SID:', call.sid);
    console.log('Status:', call.status);
    console.log('\nThe AI will call you shortly and:');
    console.log('1. Introduce itself');
    console.log('2. Tell you a joke');
    console.log('3. Have a friendly conversation');
    console.log('\nYou should receive a call within a few seconds!');
})
.catch(err => {
    console.error('❌ Error making call:', err.message);
    process.exit(1);
});
