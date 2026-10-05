param([int]$RunnerProcessId)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StudioAwake {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint flags);
}
'@
try {
  while ($RunnerProcessId -gt 0 -and (Get-Process -Id $RunnerProcessId -ErrorAction SilentlyContinue)) {
    $previousState = [StudioAwake]::SetThreadExecutionState([uint32]2147483649)
    if ($previousState -eq 0) { throw 'Windows awake request failed' }
    @{ systemRequired = $true; displayRequired = $false; runnerPid = $RunnerProcessId } | ConvertTo-Json | Set-Content -LiteralPath 'keep-awake-state.json' -Encoding UTF8
    Start-Sleep -Seconds 20
  }
} finally {
  [void][StudioAwake]::SetThreadExecutionState([uint32]2147483648)
}
