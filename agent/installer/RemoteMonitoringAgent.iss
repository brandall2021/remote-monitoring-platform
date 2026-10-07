; Build with Inno Setup 6: ISCC.exe RemoteMonitoringAgent.iss

#define AppName "Remote Monitoring Agent"
#define AppVersion "1.1.0"
#define AppPublisher "Remote Monitoring Platform"

[Setup]
AppId={{8A5D1E8E-8D2A-4C04-A7E7-4D20C99D7C31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\RemoteMonitoringAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..\..
OutputBaseFilename=RemoteMonitoringAgentSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Files]
; The installer script consumes these files from {tmp} and performs an atomic
; machine-wide install into Program Files / ProgramData.
Source: "..\agent-live.exe"; Flags: dontcopy
Source: "install-silent.ps1"; Flags: dontcopy
Source: "start-session.ps1"; Flags: dontcopy
Source: "uninstall-silent.ps1"; DestDir: "{app}"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\uninstall-silent.ps1"" -InstallDir ""{app}"" -ConfigDir ""{commonappdata}\RemoteMonitoringAgent"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveAgent"

[Code]
var
  ConfigPage: TInputQueryWizardPage;

function QuotePowerShell(const Value: string): string;
begin
  Result := Value;
  StringChangeEx(Result, '"', '""', True);
  Result := '"' + Result + '"';
end;

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Configuracion del agente', 'Conectar este equipo al servidor',
    'Ingrese la URL HTTPS y el token de registro. El agente se ejecutara oculto al arrancar Windows.');
  ConfigPage.Add('URL del servidor:', False);
  ConfigPage.Add('Token de registro:', True);
  ConfigPage.Values[0] := 'https://monitor.recuperocrediticio.com';
  ConfigPage.Values[1] := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ServerUrl: string;
begin
  Result := True;
  if CurPageID <> ConfigPage.ID then
    exit;

  ServerUrl := Lowercase(Trim(ConfigPage.Values[0]));
  if Pos('https://', ServerUrl) <> 1 then begin
    MsgBox('La URL del servidor debe comenzar con https://.', mbError, MB_OK);
    Result := False;
  end else if Trim(ConfigPage.Values[1]) = '' then begin
    MsgBox('El token de registro es obligatorio.', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PowerShellPath: string;
  InstallScript: string;
  AgentPayload: string;
  Parameters: string;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;

  ExtractTemporaryFile('agent-live.exe');
  ExtractTemporaryFile('install-silent.ps1');
  ExtractTemporaryFile('start-session.ps1');

  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  InstallScript := ExpandConstant('{tmp}\install-silent.ps1');
  AgentPayload := ExpandConstant('{tmp}\agent-live.exe');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    QuotePowerShell(InstallScript) +
    ' -ServerUrl ' + QuotePowerShell(Trim(ConfigPage.Values[0])) +
    ' -RegistrationToken ' + QuotePowerShell(ConfigPage.Values[1]) +
    ' -AgentPath ' + QuotePowerShell(AgentPayload) +
    ' -InstallDir ' + QuotePowerShell(ExpandConstant('{app}')) +
    ' -ConfigDir ' + QuotePowerShell(ExpandConstant('{commonappdata}\RemoteMonitoringAgent')) +
    ' -Session0';

  if (not Exec(PowerShellPath, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or
     (ResultCode <> 0) then begin
    MsgBox('No se pudo instalar o iniciar el agente. Codigo: ' + IntToStr(ResultCode), mbError, MB_OK);
    RaiseException('La instalacion del agente fallo.');
  end;
end;
