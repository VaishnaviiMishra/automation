param()

$ErrorActionPreference = "Stop"

$TaskName = $env:HC_TASK
$BatPath = $env:HC_BAT
$WorkDir = $env:HC_DIR
$Profile = $env:HC_ENV
$StartTime = $env:HC_TIME

$AllowedProfiles = @("stg-usa-23005")

if (-not $TaskName -or -not $BatPath -or -not $WorkDir -or -not $Profile -or -not $StartTime) {
    throw "Missing HC_TASK / HC_BAT / HC_DIR / HC_ENV / HC_TIME. Run via setup_schedule.bat."
}

if ($Profile -notin $AllowedProfiles) {
    throw ("HC_ENV must be one of: {0}. Got: {1}" -f ($AllowedProfiles -join ", "), $Profile)
}

$WorkDir = $WorkDir.TrimEnd("\", "/")
$BatPath = (Resolve-Path -LiteralPath $BatPath).Path
$now = Get-Date
$st = $StartTime

try {
    $display = ([DateTime]::ParseExact($st, "HH:mm", $null)).ToString("h:mm tt")
} catch {
    $display = $st
}

$parts = $st.Split(":")
$hour = [int]$parts[0]
$minute = [int]$parts[1]

$unspecifiedTime = New-Object DateTime($now.Year, $now.Month, $now.Day, $hour, $minute, 0)
$istZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
$at = [System.TimeZoneInfo]::ConvertTime($unspecifiedTime, $istZone, [System.TimeZoneInfo]::Local)

$ErrorActionPreference = "SilentlyContinue"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
$ErrorActionPreference = "Stop"

$action = New-ScheduledTaskAction `
    -Execute $BatPath `
    -Argument $Profile `
    -WorkingDirectory $WorkDir

$triggerTime = $at.ToString("HH:mm")
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew `
    -WakeToRun

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

$tz = Get-TimeZone
Write-Host "SUCCESS: $TaskName -> profile=$Profile"
Write-Host ("You requested IST Time: $display")
Write-Host ("VM timezone: {0}" -f $tz.Id)
Write-Host ("Task runs at VM Local Time: {0}" -f $at.ToString("h:mm tt"))
