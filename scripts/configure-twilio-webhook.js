#!/usr/bin/env node

/**
 * Configure Twilio phone number webhooks for incoming calls
 */

import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_NUMBER;
const publicUrl = process.env.PUBLIC_URL;

if (!accountSid || !authToken || !twilioNumber || !publicUrl) {
    console.error('❌ Missing required environment variables:');
    console.error('   TWILIO_ACCOUNT_SID:', accountSid ? '✓' : '✗');
    console.error('   TWILIO_AUTH_TOKEN:', authToken ? '✓' : '✗');
    console.error('   TWILIO_NUMBER:', twilioNumber ? '✓' : '✗');
    console.error('   PUBLIC_URL:', publicUrl ? '✓' : '✗');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

async function configureWebhook() {
    try {
        console.log('\n🔍 Looking up phone number:', twilioNumber);

        // Find the phone number SID
        const phoneNumbers = await client.incomingPhoneNumbers.list({
            phoneNumber: twilioNumber
        });

        if (phoneNumbers.length === 0) {
            console.error('❌ Phone number not found in Twilio account:', twilioNumber);
            process.exit(1);
        }

        const phoneNumber = phoneNumbers[0];
        console.log('✓ Found phone number SID:', phoneNumber.sid);

        // Check current configuration
        console.log('\n📋 Current Configuration:');
        console.log('   Voice URL:', phoneNumber.voiceUrl || '(not set)');
        console.log('   Voice Method:', phoneNumber.voiceMethod || '(not set)');
        console.log('   Status Callback:', phoneNumber.statusCallback || '(not set)');

        // New webhook URL
        const voiceUrl = `${publicUrl}/call/incoming`;

        console.log('\n🔧 Updating to:');
        console.log('   Voice URL:', voiceUrl);
        console.log('   Voice Method: POST');

        // Update the phone number configuration
        const updated = await client.incomingPhoneNumbers(phoneNumber.sid)
            .update({
                voiceUrl: voiceUrl,
                voiceMethod: 'POST'
            });

        console.log('\n✅ Webhook configured successfully!');
        console.log('   Phone Number:', updated.phoneNumber);
        console.log('   Voice URL:', updated.voiceUrl);
        console.log('   Voice Method:', updated.voiceMethod);

        console.log('\n✓ Incoming calls to', twilioNumber, 'will now be routed to:', voiceUrl);

    } catch (error) {
        console.error('\n❌ Error configuring webhook:', error.message);
        if (error.code) {
            console.error('   Error code:', error.code);
        }
        if (error.moreInfo) {
            console.error('   More info:', error.moreInfo);
        }
        process.exit(1);
    }
}

configureWebhook();
