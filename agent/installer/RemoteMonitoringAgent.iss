; Build with Inno Setup 6: ISCC.exe RemoteMonitoringAgent.iss

#define AppName "Remote Monitoring Agent"
#define AppVersion "1.0.0"
#define AppPublisher "Remote Monitoring Platform"

[Setup]
AppId={{8A5D1E8E-8D2A-4C04-A7E7-4D20C99D7C31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\RemoteMonitoringAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..
OutputBaseFilename=RemoteMonitoringAgentSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\agent-live.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var
  ConfigPage: TInputQueryWizardPage;

function JsonEscape(const Value: string): string;
begin
  Result := Value;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
  StringChangeEx(Result, #13, '\r', True);
  StringChangeEx(Result, #10, '\n', True);
end;

function ConfigFilePath: string;
begin
  Result := ExpandConstant('{userappdata}\remote-monitor-agent.json');
end;

function AgentPath: string;
begin
  Result := ExpandConstant('{app}\agent.exe');
end;

function RunHiddenPath: string;
begin
  Result := ExpandConstant('{app}\run-hidden.vbs');
end;

function TaskCommand: string;
begin
  Result := '"' + ExpandConstant('{sys}\wscript.exe') + '" "' +
    RunHiddenPath + '" "' + AgentPath + '"';
end;

function InstallScheduledTask: Boolean;
var
  ResultCode: Integer;
  Parameters: string;
begin
  Parameters := '/Create /F /SC ONLOGON /TN "RemoteMonitoringAgent" /TR "' +
    TaskCommand + '" /RL LIMITED';
  Result := Exec(ExpandConstant('{sys}\schtasks.exe'), Parameters, '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Configuracion del agente', 'Conectar este equipo al servidor',
    'Ingrese la URL publica y el token de registro del servidor.');
  ConfigPage.Add('URL del servidor:', False);
  ConfigPage.Add('Token de registro:', True);
  ConfigPage.Values[0] := 'https://monitor.recuperocrediticio.com';
  ConfigPage.Values[1] := '';
  Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = ConfigPage.ID then begin
    if Trim(ConfigPage.Values[0]) = '' then begin
      MsgBox('La URL del servidor es obligatoria.', mbError, MB_OK);
      Result := False;
    end else if Trim(ConfigPage.Values[1]) = '' then begin
      MsgBox('El token de registro es obligatorio.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigJson: string;
  ResultCode: Integer;
begin
  if CurStep = ssInstall then begin
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM agent.exe', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
  end;

  if CurStep = ssPostInstall then begin
    ConfigJson := '{' +
      '"serverUrl":"' + JsonEscape(Trim(ConfigPage.Values[0])) + '",' +
      '"registrationToken":"' + JsonEscape(ConfigPage.Values[1]) + '",' +
      '"agentVersion":"{#AppVersion}",' +
      '"heartbeatInterval":30000' +
      '}';

    if not SaveStringToFile(ConfigFilePath, ConfigJson + #13#10, False) then
      MsgBox('No se pudo guardar la configuracion del agente.', mbError, MB_OK);

    if not InstallScheduledTask then
      MsgBox('No se pudo registrar el inicio automatico del agente.', mbError, MB_OK)
    else
      Exec(ExpandConstant('{sys}\wscript.exe'), '"' + RunHiddenPath + '" "' +
        AgentPath + '"', '', SW_HIDE, ewNoWait, ResultCode);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    Exec(ExpandConstant('{sys}\schtasks.exe'),
      '/Delete /F /TN "RemoteMonitoringAgent"', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM agent.exe', '', SW_HIDE,
      ewWaitUntilTerminated, ResultCode);
    DeleteFile(ConfigFilePath);
  end;
end;
