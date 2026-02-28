; === FILE PURPOSE ===
; Inno Setup script for LifeDash Windows installer.
; Build with: ISCC.exe /DMyAppVersion=x.y.z installer/lifedash.iss
; Output: out\make\LifeDash-{version}-Setup.exe

#define MyAppName "LifeDash"
#define MyAppPublisher "Lab-51"
#define MyAppURL "https://lifedash.space"
#define MyAppExeName "lifedash.exe"

[Setup]
AppId={{570d3454-6859-4ff3-9f24-385a00bcc551}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={userappdata}\LifeDash
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=out\make
OutputBaseFilename=LifeDash-{#MyAppVersion}-Setup
SetupIconFile=src\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checked

[Files]
Source: "out\lifedash-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
