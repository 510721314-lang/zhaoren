' zhaoren hidden task launcher
' usage: wscript.exe run-hidden.vbs <script.ps1> [args...]
' Runs PowerShell with window style 0 (hidden) and waits for completion.
Option Explicit
Dim sh, i, cmd, q, a, rc
If WScript.Arguments.Count < 1 Then WScript.Quit 2
q = Chr(34)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & q & WScript.Arguments(0) & q
For i = 1 To WScript.Arguments.Count - 1
  a = WScript.Arguments(i)
  If Left(a, 1) = "-" Then
    cmd = cmd & " " & a
  Else
    cmd = cmd & " " & q & a & q
  End If
Next
Set sh = CreateObject("WScript.Shell")
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
