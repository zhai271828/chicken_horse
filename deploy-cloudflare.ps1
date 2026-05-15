param(
    [Parameter(Mandatory = $false)]
    [string]$WorkerName = "chicken-horse-game",

    [Parameter(Mandatory = $false)]
    [string]$WorkerUrl = "wss://chicken-horse-game.1056593143.workers.dev",

    [Parameter(Mandatory = $false)]
    [string]$PagesProject = "chicken-horse-web"
)

$ErrorActionPreference = "Stop"

Write-Host "Deploying Worker..." -ForegroundColor Cyan
Push-Location "workers"
try {
    npx wrangler deploy
}
finally {
    Pop-Location
}

Write-Host "Building frontend with worker URL: $WorkerUrl" -ForegroundColor Cyan
$env:VITE_WORKER_URL = $WorkerUrl
npm run build

Write-Host "Deploying Pages project: $PagesProject" -ForegroundColor Cyan
npx wrangler pages deploy dist --project-name $PagesProject

Write-Host "Done." -ForegroundColor Green
