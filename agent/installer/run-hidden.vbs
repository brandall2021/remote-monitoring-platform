Set sh = CreateObject("WScript.Shell")
agentPath = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\RemoteMonitoringAgent\agent.exe"
sh.Run """" & agentPath & """", 0, False
