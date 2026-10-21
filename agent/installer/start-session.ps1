param(
  [Parameter(Mandatory = $true)][string]$AgentExe
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AgentExe)) {
  Write-Output "ERROR: agent executable not found at $AgentExe"
  exit 1
}

if (-not ("RemoteMonitor.SessionBridge" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace RemoteMonitor {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public int dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public int dwProcessId;
    public int dwThreadId;
  }

  public static class SessionBridge {
    public const int TOKEN_ALL_ACCESS = 0xF01FF;
    public const int TOKEN_DUPLICATE = 0x0002;
    public const int TOKEN_ASSIGN_PRIMARY = 0x0001;
    public const int TOKEN_QUERY = 0x0008;
    public const int TOKEN_ADJUST_PRIVILEGES = 0x0020;
    public const int TOKEN_ADJUST_DEFAULT = 0x0080;
    public const int TOKEN_ADJUST_SESSIONID = 0x0080;
    public const int SecurityImpersonation = 2;
    public const int TokenPrimary = 1;
    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint CREATE_NEW_CONSOLE = 0x00000010;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public const uint DETACHED_PROCESS = 0x00000008;
    public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    public const int ERROR_SUCCESS = 0;
    public const uint INFINITE = 0xFFFFFFFF;

    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool DuplicateTokenEx(
      IntPtr existingToken, int desiredAccess, IntPtr tokenAttributes,
      int impersonationLevel, int tokenType, out IntPtr newToken);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(
      IntPtr token, string applicationName, StringBuilder commandLine,
      IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
      uint creationFlags, IntPtr environment, string currentDirectory,
      ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll")]
    static extern bool GetExitCodeProcess(IntPtr handle, out uint exitCode);

    public static int Launch(int agentArgCount, string[] agentArgs) {
      uint sessionId = WTSGetActiveConsoleSessionId();
      if (sessionId == 0xFFFFFFFF) {
        Console.WriteLine("SKIP: no active console session");
        return 0;
      }

      IntPtr userToken = IntPtr.Zero;
      IntPtr primaryToken = IntPtr.Zero;
      IntPtr environment = IntPtr.Zero;
      int envKind = 0;
      IntPtr process = IntPtr.Zero;
      IntPtr thread = IntPtr.Zero;

      try {
        if (!WTSQueryUserToken(sessionId, out userToken)) {
          Console.WriteLine("ERROR: WTSQueryUserToken failed for session " + sessionId + " (error " + Marshal.GetLastWin32Error() + ")");
          return 2;
        }

        int access = TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY |
                     TOKEN_ADJUST_PRIVILEGES | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID;

        if (!DuplicateTokenEx(userToken, access, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out primaryToken)) {
          Console.WriteLine("ERROR: DuplicateTokenEx failed (error " + Marshal.GetLastWin32Error() + ")");
          return 3;
        }

        environment = BuildEnvironmentWithSecret(primaryToken, out envKind);
        if (environment == IntPtr.Zero) {
          Console.WriteLine("ERROR: CreateEnvironmentBlock failed (error " + Marshal.GetLastWin32Error() + ")");
          return 4;
        }

        StringBuilder commandLine = new StringBuilder();
        commandLine.Append('"').Append(agentArgs[0]).Append('"');
        for (int i = 1; i < agentArgCount; i++) {
          commandLine.Append(' ').Append(agentArgs[i]);
        }

        STARTUPINFO startupInfo = new STARTUPINFO();
        startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        startupInfo.lpDesktop = "winsta0\\default";

        PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
        uint flags = CREATE_UNICODE_ENVIRONMENT | DETACHED_PROCESS | CREATE_NEW_CONSOLE;

        if (!CreateProcessAsUser(
              primaryToken, null, commandLine, IntPtr.Zero, IntPtr.Zero, false,
              flags, environment, null, ref startupInfo, out processInfo)) {
          Console.WriteLine("ERROR: CreateProcessAsUser failed (error " + Marshal.GetLastWin32Error() + ")");
          return 5;
        }

        process = processInfo.hProcess;
        thread = processInfo.hThread;

        uint waitResult = WaitForSingleObject(process, 30000);
        if (waitResult == 0x00000000) {
          uint exitCode = 0;
          GetExitCodeProcess(process, out exitCode);
          if (exitCode == 0) {
            Console.WriteLine("OK: session worker started in session " + sessionId);
            return 0;
          }
          Console.WriteLine("ERROR: bridge script exited with code " + exitCode);
          return 6;
        }

        Console.WriteLine("OK: session worker launched in session " + sessionId);
        return 0;
      } finally {
        if (process != IntPtr.Zero) CloseHandle(process);
        if (thread != IntPtr.Zero) CloseHandle(thread);
        // envKind 1 = bloque creado por CreateEnvironmentBlock (LocalFree), 2 = el que reservo
        // Marshal (CoTaskMemFree). Liberarlos con la otra API corrompe el heap.
        if (environment != IntPtr.Zero) {
          if (envKind == 2) Marshal.FreeHGlobal(environment); else DestroyEnvironmentBlock(environment);
        }
        if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
        if (userToken != IntPtr.Zero) CloseHandle(userToken);
      }
    }

    // El worker prueba ser el proceso que este supervisor levanto con un secreto efimero que solo
    // existe en memoria. Se pasa en el bloque de entorno, no en la linea de comandos: el command
    // line de un proceso lo puede leer cualquier cuenta de la consola (Task Manager, wmic, WMI).
    public static IntPtr BuildEnvironmentWithSecret(IntPtr token, out int kind) {
      kind = 0;
      IntPtr baseEnv;
      if (!CreateEnvironmentBlock(out baseEnv, token, false)) return IntPtr.Zero;
      kind = 1;

      string secret = Environment.GetEnvironmentVariable("RM_SESSION_SECRET");
      if (string.IsNullOrEmpty(secret)) return baseEnv;

      List<string> vars = new List<string>();
      int offset = 0;
      while (true) {
        string entry = Marshal.PtrToStringUni(IntPtr.Add(baseEnv, offset));
        if (string.IsNullOrEmpty(entry)) break;
        vars.Add(entry);
        offset += (entry.Length + 1) * 2;
      }

      DestroyEnvironmentBlock(baseEnv);
      kind = 0;

      vars.RemoveAll(delegate(string v) {
        return string.IsNullOrEmpty(v) ||
               v.StartsWith("RM_SESSION_SECRET=", StringComparison.OrdinalIgnoreCase);
      });
      vars.Add("RM_SESSION_SECRET=" + secret);

      StringBuilder block = new StringBuilder();
      foreach (string v in vars) { block.Append(v); block.Append('\0'); }
      block.Append('\0');

      IntPtr rebuilt = Marshal.StringToHGlobalUni(block.ToString());
      kind = 2;
      return rebuilt;
    }
  }
}
"@
}

$arguments = @($AgentExe, "--role=session")
exit ([RemoteMonitor.SessionBridge]::Launch($arguments.Count, $arguments))
