$ErrorActionPreference = 'Stop'
$file = Join-Path (Get-Location) 'app/lib/firebase.ts'
if (-not (Test-Path -LiteralPath $file)) {
  throw "Cannot find app/lib/firebase.ts. Run this script from your project root."
}
$content = Get-Content -LiteralPath $file -Raw
if ($content -match 'delivery\?\s*:\s*Pick<ServiceJob,[\s\S]{0,300}returnOutcome[\s\S]{0,100}refundAmount') {
  Write-Host 'firebase.ts already includes returnOutcome and refundAmount. No change needed.' -ForegroundColor Green
  exit 0
}
$pattern = 'delivery\?\s*:\s*Pick<ServiceJob,\s*"readyAt"\s*\|\s*"deliveryOutDate"\s*\|\s*"deliveryOutPerson"\s*\|\s*"deliveryRemarks">\s*,'
$replacement = 'delivery?: Pick<ServiceJob, "readyAt" | "deliveryOutDate" | "deliveryOutPerson" | "deliveryRemarks">' + "`r`n" + '    & Partial<Pick<ServiceJob, "returnOutcome" | "refundAmount">>,'
$updated = [regex]::Replace($content, $pattern, $replacement, 1)
if ($updated -eq $content) {
  $line = Select-String -LiteralPath $file -Pattern 'changeServiceStatus|delivery\?:' -Context 0,5 | Out-String
  Write-Host 'Could not safely find the expected function parameter. No file was changed.' -ForegroundColor Yellow
  Write-Host $line
  throw 'Please share the changeServiceStatus function from your current app/lib/firebase.ts.'
}
Copy-Item -LiteralPath $file -Destination ($file + '.backup') -Force
Set-Content -LiteralPath $file -Value $updated -NoNewline -Encoding utf8
Write-Host 'Updated app/lib/firebase.ts. Backup saved as firebase.ts.backup.' -ForegroundColor Green
