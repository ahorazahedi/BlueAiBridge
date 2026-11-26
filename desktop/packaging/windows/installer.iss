; Inno Setup script for the BlueAIBridge desktop app on Windows.
; Built by the GitHub Actions workflow: iscc /DVersion=x.y.z installer.iss
#ifndef Version
  #define Version "1.0.0"
#endif
[Setup]
AppId={{6A1D2F3C-6C8E-4B53-9E9D-B1A2A7B1E001}
AppName=BlueAIBridge
AppVersion={#Version}
AppPublisher=BlueAIBridge
DefaultDirName={localappdata}\Programs\BlueAIBridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\build\dist
OutputBaseFilename=BlueAIBridge-{#Version}-windows-x64-setup
SetupIconFile=..\..\assets\app_icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\blue_ai_bridge.exe

[Files]
Source: "..\..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userprograms}\BlueAIBridge"; Filename: "{app}\blue_ai_bridge.exe"
Name: "{userstartup}\BlueAIBridge"; Filename: "{app}\blue_ai_bridge.exe"; Parameters: "--background"; Tasks: startup

[Tasks]
Name: "startup"; Description: "Start BlueAIBridge in the tray when I sign in"

[Run]
Filename: "{app}\blue_ai_bridge.exe"; Description: "Open BlueAIBridge"; Flags: nowait postinstall skipifsilent
