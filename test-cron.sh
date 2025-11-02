#!/bin/bash
# Bash script to test the cron endpoint (for Mac/Linux)

echo -e "\033[36mTesting Cron Job Endpoint...\033[0m"
echo ""

# Test locally first
echo -e "\033[33m1. Testing LOCAL endpoint (http://localhost:3000)...\033[0m"
response=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/cron/update-staking-leaderboard)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "\033[32m✓ Status Code: $http_code\033[0m"
    echo -e "\033[90mResponse:\033[0m"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
else
    echo -e "\033[31m✗ Local test failed with status: $http_code\033[0m"
    echo "$body"
    echo -e "\033[33mMake sure dev server is running: npm run dev\033[0m"
fi

echo ""
echo -e "\033[33m2. Testing PRODUCTION endpoint (https://higher-steaks.vercel.app)...\033[0m"
response=$(curl -s -w "\n%{http_code}" https://higher-steaks.vercel.app/api/cron/update-staking-leaderboard)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" -eq 200 ]; then
    echo -e "\033[32m✓ Status Code: $http_code\033[0m"
    echo -e "\033[90mResponse:\033[0m"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
else
    echo -e "\033[31m✗ Production test failed with status: $http_code\033[0m"
    echo "$body"
fi

echo ""
echo -e "\033[36mDone!\033[0m"

