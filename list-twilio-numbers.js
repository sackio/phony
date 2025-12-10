const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

async function listAvailableNumbers() {
    try {
        const numbers = await client.incomingPhoneNumbers.list();

        console.log('\n=== Twilio Phone Numbers ===\n');

        const availableNumbers = [];

        for (const number of numbers) {
            const hasVoiceUrl = number.voiceUrl && number.voiceUrl.trim() !== '';
            const status = hasVoiceUrl ? '❌ Has webhook' : '✅ Available';

            console.log(`${status}: ${number.phoneNumber}`);
            console.log(`  Friendly Name: ${number.friendlyName || '(none)'}`);
            console.log(`  Voice URL: ${number.voiceUrl || '(none)'}`);
            console.log(`  SMS URL: ${number.smsUrl || '(none)'}`);
            console.log('');

            if (!hasVoiceUrl) {
                availableNumbers.push({
                    phoneNumber: number.phoneNumber,
                    friendlyName: number.friendlyName,
                    sid: number.sid
                });
            }
        }

        console.log('\n=== Summary ===');
        console.log(`Total numbers: ${numbers.length}`);
        console.log(`Available (no webhook): ${availableNumbers.length}`);
        console.log(`In use (has webhook): ${numbers.length - availableNumbers.length}`);

        if (availableNumbers.length > 0) {
            console.log('\n=== Available Numbers for Configuration ===');
            availableNumbers.forEach(num => {
                console.log(`${num.phoneNumber} - ${num.friendlyName || 'No name'}`);
            });
        }

    } catch (error) {
        console.error('Error fetching Twilio numbers:', error.message);
        process.exit(1);
    }
}

listAvailableNumbers();
