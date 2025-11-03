# CDP Webhook Setup Guide

This guide explains how to set up CDP (Coinbase Developer Platform) webhooks for real-time blockchain event monitoring in Higher Steaks.

## Prerequisites

1. CDP account with API keys created at [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
2. Deployed Vercel app URL (e.g., `https://your-app.vercel.app`)
3. `cdpcurl` CLI tool installed (see instructions below)

## Install cdpcurl

```bash
# With Homebrew (macOS)
brew tap coinbase/cdpcurl && brew install cdpcurl

# Or with Go
go install github.com/coinbase/cdpcurl@latest
```

## Create Webhook Subscriptions

You need to create **three webhook subscriptions** to monitor different contract events:

### 1. LockUpCreated Events

Monitors when new lockups are created on the HIGHER lockup contract.

```bash
cdpcurl -X POST \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions" \
  -d '{
  "description": "HIGHER Lockup Created Events",
  "eventTypes": ["onchain.activity.detected"],
  "target": {
    "url": "https://higher-steaks.vercel.app/api/webhooks/cdp",
    "method": "POST"
  },
  "labels": {
    "contract_address": "0xA3dCf3Ca587D9929d540868c924f208726DC9aB6",
    "event_name": "LockUpCreated"
  },
  "isEnabled": true
}'
```

**Save the `subscriptionId` and `metadata.secret` from the response.**

### 2. Unlock Events

Monitors when lockups are unlocked (unstaked).

```bash
cdpcurl -X POST \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions" \
  -d '{
  "description": "HIGHER Unlock Events",
  "eventTypes": ["onchain.activity.detected"],
  "target": {
    "url": "https://higher-steaks.vercel.app/api/webhooks/cdp",
    "method": "POST"
  },
  "labels": {
    "contract_address": "0xA3dCf3Ca587D9929d540868c924f208726DC9aB6",
    "event_name": "Unlock"
  },
  "isEnabled": true
}'
```

**Save the `subscriptionId` and `metadata.secret` from the response.**

### 3. Transfer Events (HIGHER Token)

Monitors HIGHER token transfers to detect balance changes.

```bash
cdpcurl -X POST \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions" \
  -d '{
  "description": "HIGHER Token Transfers",
  "eventTypes": ["onchain.activity.detected"],
  "target": {
    "url": "https://higher-steaks.vercel.app/api/webhooks/cdp",
    "method": "POST"
  },
  "labels": {
    "contract_address": "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    "event_name": "Transfer"
  },
  "isEnabled": true
}'
```

**Save the `subscriptionId` and `metadata.secret` from the response.**

## Set Environment Variables

Add the webhook secret to your Vercel environment variables:

```env
CDP_WEBHOOK_SECRET=your_webhook_secret_from_response
```

**Note:** If you create multiple webhooks, you may need multiple secrets or CDP may use a single secret. Check the webhook creation responses to confirm.

## Verify Webhook Setup

1. Deploy your Vercel app with the webhook endpoint
2. Create a test lockup via the onboarding modal
3. Check Vercel logs to see if webhook events are received
4. Verify the UI updates automatically

## Manage Webhook Subscriptions

### List All Subscriptions

```bash
cdpcurl -X GET \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions"
```

### View Specific Subscription

```bash
cdpcurl -X GET \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions/<SUBSCRIPTION_ID>"
```

### Update Subscription

```bash
cdpcurl -X PUT \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions/<SUBSCRIPTION_ID>" \
  -d '{
  "description": "Updated Description",
  "isEnabled": true
}'
```

### Delete Subscription

```bash
cdpcurl -X DELETE \
  -i "$CDP_API_KEY_ID" \
  -s "$CDP_API_KEY_SECRET" \
  "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions/<SUBSCRIPTION_ID>"
```

## Troubleshooting

- **Webhook not receiving events**: Check that your Vercel deployment is live and the URL is correct
- **Invalid signature errors**: Verify `CDP_WEBHOOK_SECRET` matches the secret from webhook creation
- **Events not updating UI**: Check browser console for SSE connection errors
- **Testing locally**: Use [ngrok](https://ngrok.com/) to expose localhost, or test directly on deployed Vercel instance

## Security Best Practices

- Never commit webhook secrets to version control
- Use environment variables for all sensitive values
- Verify webhook signatures in production
- Monitor webhook delivery in CDP dashboard
- Set up alerts for failed webhook deliveries

## Resources

- [CDP Webhooks Quickstart](https://docs.cdp.coinbase.com/data/webhooks/quickstart)
- [CDP Webhook Signature Verification](https://docs.cdp.coinbase.com/data/webhooks/verify-signatures)
- [CDP Platform API Reference](https://docs.cdp.coinbase.com/api-reference/v2/introduction)

