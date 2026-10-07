param([Parameter(Mandatory=$true)][string]$RunnerDirectory,[Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
$runnerRoot=(Resolve-Path -LiteralPath $RunnerDirectory).Path
$nodeExe=(Resolve-Path -LiteralPath $NodePath).Path
$starter=Join-Path $runnerRoot 'start-runner.mjs'
if(!(Test-Path -LiteralPath $starter)){throw 'Runner starter is missing'}
# Runs only in the signed-in user's session, where the paired Edge extension lives.
$action=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"'+(Join-Path $runnerRoot 'autostart.vbs')+'"') -WorkingDirectory $runnerRoot
$logon=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$periodic=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'MAUM Booking Runner Watchdog' -Action $action -Trigger @($logon,$periodic) -Principal $principal -Settings $settings -Description 'Checks the local booking runner every minute and restarts it when stopped. Does not approve or resend customer messages.' -Force | Out-Null
Write-Output 'Booking runner watchdog installed: every minute and at logon.'
