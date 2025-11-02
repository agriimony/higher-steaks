# PowerShell script to test the cron endpoint

Write-Host "Testing Cron Job Endpoint..." -ForegroundColor Cyan
Write-Host ""

# Test locally first
Write-Host "1. Testing LOCAL endpoint (http://localhost:3000)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/cron/update-staking-leaderboard" -Method Get -UseBasicParsing
    Write-Host "✓ Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
} catch {
    Write-Host "✗ Local test failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Make sure dev server is running: npm run dev" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "2. Testing PRODUCTION endpoint (https://higher-steaks.vercel.app)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://higher-steaks.vercel.app/api/cron/update-staking-leaderboard" -Method Get -UseBasicParsing
    Write-Host "✓ Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
} catch {
    Write-Host "✗ Production test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Cyan

