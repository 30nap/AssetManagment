# Start the dashboard.
#
# Right-click this file -> "Run with PowerShell" (that path already bypasses
# the execution policy), or from a shell:
#     powershell -ExecutionPolicy Bypass -File run.ps1

Set-Location -LiteralPath $PSScriptRoot

# 'py' (the Windows launcher) goes first: a bare 'python' can be the Microsoft
# Store stub, which opens the Store instead of running anything.
$python = $null
foreach ($candidate in @('py', 'python', 'python3')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $python = $candidate
        break
    }
}

if (-not $python) {
    Write-Host ''
    Write-Host 'Python was not found.'
    Write-Host 'Install it from python.org and tick "Add Python to PATH" during setup.'
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit 1
}

& $python run.py
$exitCode = $LASTEXITCODE

# "Run with PowerShell" closes the window the moment the script ends, so hold
# it open long enough to read what happened.
Write-Host ''
Read-Host 'Press Enter to close'
exit $exitCode
