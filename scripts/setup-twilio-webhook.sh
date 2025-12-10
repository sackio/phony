#!/bin/bash
set -e

# Load environment variables
source .env

echo "🔍 Finding Twilio phone number SID for $TWILIO_NUMBER..."

# Get phone number SID
RESPONSE=$(curl -s -X GET "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN")

PHONE_SID=$(echo "$RESPONSE" | jq -r ".incoming_phone_numbers[] | select(.phone_number == \"$TWILIO_NUMBER\") | .sid")

if [ -z "$PHONE_SID" ] || [ "$PHONE_SID" == "null" ]; then
    echo "❌ Error: Could not find phone number $TWILIO_NUMBER"
    echo "Response from Twilio:"
    echo "$RESPONSE" | jq .
    exit 1
fi

echo "✓ Found phone number SID: $PHONE_SID"

# Set webhook URL
VOICE_URL="$PUBLIC_URL/call/incoming"

echo "🔧 Configuring webhook..."
echo "   Voice URL: $VOICE_URL"

# Update phone number configuration
UPDATE_RESPONSE=$(curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers/$PHONE_SID.json" \
  --data-urlencode "VoiceUrl=$VOICE_URL" \
  --data-urlencode "VoiceMethod=POST" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN")

# Check if update was successful
UPDATED_URL=$(echo "$UPDATE_RESPONSE" | jq -r '.voice_url')

if [ "$UPDATED_URL" == "$VOICE_URL" ]; then
    echo "✅ Webhook configured successfully!"
    echo "   Phone Number: $TWILIO_NUMBER"
    echo "   Voice URL: $UPDATED_URL"
    echo ""
    echo "✓ Incoming calls will now be routed to: $VOICE_URL"
else
    echo "❌ Error: Failed to update webhook"
    echo "Response from Twilio:"
    echo "$UPDATE_RESPONSE" | jq .
    exit 1
fi
