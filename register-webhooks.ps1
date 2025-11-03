# PowerShell script to register CDP webhooks for Higher Steaks

param(
    [Parameter(Mandatory=$false)]
    [string]$ApiKeyId = $env:CDP_API_KEY_ID,
    
    [Parameter(Mandatory=$false)]
    [string]$ApiKeySecret = $env:CDP_API_KEY_SECRET,
    
    [Parameter(Mandatory=$false)]
    [string]$WebhookUrl = "https://higher-steaks.vercel.app/api/webhooks/cdp"
)

if (-not $ApiKeyId -or -not $ApiKeySecret) {
    Write-Error "CDP API credentials not found. Please set CDP_API_KEY_ID and CDP_API_KEY_SECRET environment variables."
    exit 1
}

Write-Host "Registering CDP webhooks..." -ForegroundColor Green
Write-Host "Webhook URL: $WebhookUrl" -ForegroundColor Cyan
Write-Host ""

function Register-Webhook {
    param(
        [string]$Description,
        [string]$ContractAddress,
        [string]$EventName
    )
    
    $body = @{
        description = $Description
        eventTypes = @("onchain.activity.detected")
        target = @{
            url = $WebhookUrl
            method = "POST"
        }
        labels = @{
            contract_address = $ContractAddress
            event_name = $EventName
        }
        isEnabled = $true
    } | ConvertTo-Json -Depth 10 -Compress
    
    Write-Host "Registering $Description..." -ForegroundColor Yellow
    
    try {
        $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $method = "POST"
        $path = "/platform/v2/data/webhooks/subscriptions"
        $message = "$timestamp$method$path$body"
        
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Convert]::FromBase64String($ApiKeySecret)
        $signature = [System.Convert]::ToBase64String($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($message)))
        
        $headers = @{
            "Content-Type" = "application/json"
            "X-Coinbase-Access" = $ApiKeyId
            "X-Coinbase-Timestamp" = $timestamp
            "X-Coinbase-Signature" = $signature
        }
        
        $response = Invoke-RestMethod -Uri "https://api.cdp.coinbase.com/platform/v2/data/webhooks/subscriptions" `
            -Method POST `
            -Headers $headers `
            -Body $body `
            -ContentType "application/json"
        
        Write-Host "Success! Subscription ID: $($response.subscriptionId)" -ForegroundColor Green
        Write-Host ""
        
        return $response
    }
    catch {
        Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        }
        Write-Host ""
    }
}

$LOCKUP_CONTRACT = "0xA3dCf3Ca587D9929d540868c924f208726DC9aB6"
$HIGHER_TOKEN = "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe"

$webhook1 = Register-Webhook -Description "HIGHER Lockup Created" -ContractAddress $LOCKUP_CONTRACT -EventName "LockUpCreated"
$webhook2 = Register-Webhook -Description "HIGHER Unlock" -ContractAddress $LOCKUP_CONTRACT -EventName "Unlock"
$webhook3 = Register-Webhook -Description "HIGHER Transfer" -ContractAddress $HIGHER_TOKEN -EventName "Transfer"

$successCount = 0
if ($webhook1) { $successCount++ }
if ($webhook2) { $successCount++ }
if ($webhook3) { $successCount++ }

Write-Host "Registered $successCount/3 webhooks" -ForegroundColor Cyan

if ($successCount -eq 3) {
    Write-Host "All done! Add CDP_WEBHOOK_SECRET to Vercel and redeploy." -ForegroundColor Green
}

