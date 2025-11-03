#!/bin/bash
# WSL/Linux script to register CDP webhooks using cdpcurl

set -e

# Read credentials from environment or .env.local
if [ -f .env.local ]; then
    export $(grep "^CDP_API_KEY_ID=" .env.local | xargs)
    export $(grep "^CDP_API_KEY_SECRET=" .env.local | xargs)
fi

if [ -z "$CDP_API_KEY_ID" ] || [ -z "$CDP_API_KEY_SECRET" ]; then
    echo "Error: CDP_API_KEY_ID and CDP_API_KEY_SECRET must be set"
    exit 1
fi

WEBHOOK_URL="https://higher-steaks.vercel.app/api/webhooks/cdp"
LOCKUP_CONTRACT="0xA3dCf3Ca587D9929d540868c924f208726DC9aB6"
HIGHER_TOKEN="0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe"

echo "Registering CDP webhooks..."
echo "Webhook URL: $WEBHOOK_URL"
echo ""

# Export Go bin to PATH
export PATH=$PATH:$HOME/go/bin

if ! command -v cdpcurl &> /dev/null; then
    echo "Error: cdpcurl not found. Installing..."
    go install github.com/coinbase/cdpcurl@latest
fi

# Function to register a webhook
register_webhook() {
    local description=$1
    local contract=$2
    local event_name=$3
    
    echo "Registering $description..."
    
    cdpcurl -X POST \
        -i "$CDP_API_KEY_ID" \
        -s "$CDP_API_KEY_SECRET" \
        "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions" \
        -d "{
    \"description\": \"$description\",
    \"eventTypes\": [\"onchain.activity.detected\"],
    \"target\": {
        \"url\": \"$WEBHOOK_URL\",
        \"method\": \"POST\"
    },
    \"labels\": {
        \"contract_address\": \"$contract\",
        \"event_name\": \"$event_name\"
    },
    \"isEnabled\": true
}"
}

# Register three webhooks
register_webhook "HIGHER Lockup Created Events" "$LOCKUP_CONTRACT" "LockUpCreated"
echo ""
register_webhook "HIGHER Unlock Events" "$LOCKUP_CONTRACT" "Unlock"
echo ""
register_webhook "HIGHER Token Transfers" "$HIGHER_TOKEN" "Transfer"

echo ""
echo "Done! Add CDP_WEBHOOK_SECRET to Vercel environment variables."

