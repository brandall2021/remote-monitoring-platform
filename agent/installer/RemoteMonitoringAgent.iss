; Build with Inno Setup 6: ISCC.exe RemoteMonitoringAgent.iss

#define AppName "Remote Monitoring Agent"
#define AppVersion "1.2.0"
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
Source: "..\tray\RmTray.exe"; Flags: dontcopy
Source: "install-silent.ps1"; Flags: dontcopy
Source: "start-session.ps1"; Flags: dontcopy
Source: "uninstall-silent.ps1"; DestDir: "{app}"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\uninstall-silent.ps1"" -InstallDir ""{app}"" -ConfigDir ""{commonappdata}\RemoteMonitoringAgent"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveAgent"

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  NoticePage: TOutputMsgMemoWizardPage;

function QuotePowerShell(const Value: string): string;
begin
  Result := Value;
  StringChangeEx(Result, '"', '""', True);
  Result := '"' + Result + '"';
end;

const
  // ISPP interpreta "#" al inicio de linea como directiva de preprocesador, asi que el salto de
  // linea se arma por constante y nunca queda primero en una linea.
  NL = #13#10;

function BuildNotice: string;
begin
  Result :=
    'Que se instala' + NL + NL +
    '  - Un agente del sistema (servicio en Session 0, cuenta SYSTEM) que se conecta al servidor ' +
    'indicado en la pantalla anterior y reporta el estado del equipo.' + NL +
    '  - Capturas de pantalla y de camara a pedido del operador del panel, con registro de ' +
    'auditoria de quien las solicito.' + NL +
    '  - Un icono en la bandeja del usuario: punto verde cuando hay conexion, con el nombre del ' +
    'equipo, el ID y hace cuanto fue el ultimo latido.' + NL + NL +
    'Sobre el icono de la bandeja' + NL + NL +
    '  El icono es solo informativo. No tiene botones para pausar ni apagar el monitoreo, y ' +
    'cerrarlo no desactiva el agente: el aviso tiene que seguir visible para quien inicie sesion. ' +
    'La unica forma de quitar el monitoreo es desinstalar el agente desde Panel de control > ' +
    'Programas, o desde la consola de administracion.' + NL + NL +
    'Base legal' + NL + NL +
    '  La instalacion de este agente supone que el titular del equipo autorizo el monitoreo y que ' +
    'los datos personales que se traten quedan cubiertos por la politica de privacidad del ' +
    'empleador (Ley 25.326, Argentina). Complete ese aviso antes de desplegar.';
end;

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Configuracion del agente', 'Conectar este equipo al servidor',
    'Ingrese la URL HTTPS y el token de registro. El agente queda corriendo como servicio del ' +
    'sistema y muestra un icono en la bandeja del usuario.');

  ConfigPage.Add('URL del servidor:', False);
  ConfigPage.Add('Token de registro:', True);
  ConfigPage.Values[0] := 'https://monitor.recuperocrediticio.com';
  ConfigPage.Values[1] := '';

  // Aviso al usuario de la PC. Antes el agente se corria oculto y sin ninguna senal visible;
  // el icono de bandeja es la contrapartida de ese diseno y este texto es donde queda declarado.
  NoticePage := CreateOutputMsgMemoPage(ConfigPage.ID,
    'Aviso: este equipo queda bajo monitoreo remoto',
    'Puede volver a leer este texto desde la bandeja del sistema.',
    'Revise el aviso antes de continuar con la instalacion.',
    BuildNotice);
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
  TrayPayload: string;
  Parameters: string;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;

  ExtractTemporaryFile('agent-live.exe');
  ExtractTemporaryFile('RmTray.exe');
  ExtractTemporaryFile('install-silent.ps1');
  ExtractTemporaryFile('start-session.ps1');

  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  InstallScript := ExpandConstant('{tmp}\install-silent.ps1');
  AgentPayload := ExpandConstant('{tmp}\agent-live.exe');
  TrayPayload := ExpandConstant('{tmp}\RmTray.exe');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    QuotePowerShell(InstallScript) +
    ' -ServerUrl ' + QuotePowerShell(Trim(ConfigPage.Values[0])) +
    ' -RegistrationToken ' + QuotePowerShell(ConfigPage.Values[1]) +
    ' -AgentPath ' + QuotePowerShell(AgentPayload) +
    ' -TrayPath ' + QuotePowerShell(TrayPayload) +
    ' -InstallDir ' + QuotePowerShell(ExpandConstant('{app}')) +
    ' -ConfigDir ' + QuotePowerShell(ExpandConstant('{commonappdata}\RemoteMonitoringAgent')) +
    ' -Session0';

  if (not Exec(PowerShellPath, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or
     (ResultCode <> 0) then begin
    MsgBox('No se pudo instalar o iniciar el agente. Codigo: ' + IntToStr(ResultCode), mbError, MB_OK);
    RaiseException('La instalacion del agente fallo.');
  end;
end;
