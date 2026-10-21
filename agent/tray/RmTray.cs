using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// RmTray: el icono de la bandeja del agente de monitoreo remoto.
//
// Que hace
//   - Lee status.json (escrito por el agente) y muestra en vivo si el equipo esta conectado al
//     server, a que servidor y hace cuanto fue el ultimo heartbeat.
//   - En modo logon levanta y vigila el proceso del agente (si muere, lo rearma con backoff).
//   - Abre el panel de monitoreo en el navegador.
//
// Que NO hace, a proposito
//   - No tiene boton de "Salir" ni de "Pausar capturas". Es un aviso, no un control: si el
//     usuario pudiera apagar el monitoreo desde la bandeja, el hallazgo C-2/H-1 de la auditoria
//     volveria a abrirse por la ventana. Se documenta en el README.
//   - No guarda ni lee el registrationToken: el archivo de estado nunca lo contiene.
//
// Compilar (sin csproj, con el csc que trae .NET Framework):
//   csc /target:winexe /out:RmTray.exe RmTray.cs
//
// El codigo es ASCII puro: csc interpreta la codificacion del fuente segun el BOM y segun la
// page code del sistema, y un acento mal leido en un tooltip es un bug dificil de ver.

namespace RemoteMonitoringAgent
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Options options = Options.Parse(args);

            bool created;
            using (Mutex mutex = new Mutex(true, "Local\\RmAgentTray", out created))
            {
                if (!created)
                {
                    // Segunda instancia: la bandeja ya esta puesta. No duplicar iconos ni agentes.
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                // ApplicationContext sin Form: el message loop vive hasta ExitThread, que nadie
                // llama porque el menu es informativo. La bandeja no se cierra sola.
                ApplicationContext context = new ApplicationContext();

                using (TrayIcon tray = new TrayIcon(options))
                {
                    tray.Start();
                    Application.AddMessageFilter(tray);
                    Application.Run(context);
                }
            }

            return 0;
        }
    }

    internal sealed class Options
    {
        public bool SpawnAgent;
        public string AgentPath;
        public int PollSeconds;

        public static Options Parse(string[] args)
        {
            Options o = new Options();
            o.SpawnAgent = true;
            o.AgentPath = null;
            o.PollSeconds = 5;

            for (int i = 0; i < args.Length; i++)
            {
                string a = (args[i] ?? string.Empty).Trim().ToLowerInvariant();
                if (a == "--status-only") o.SpawnAgent = false;
                else if (a == "--agent" && i + 1 < args.Length) o.AgentPath = args[++i];
                else if (a == "--poll" && i + 1 < args.Length)
                {
                    int seconds;
                    if (int.TryParse(args[++i], out seconds) && seconds >= 1 && seconds <= 300) o.PollSeconds = seconds;
                }
            }

            if (o.SpawnAgent && string.IsNullOrEmpty(o.AgentPath)) o.AgentPath = DefaultAgentPath();
            return o;
        }

        private static string DefaultAgentPath()
        {
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (!string.IsNullOrEmpty(local))
            {
                string candidate = Path.Combine(local, "RemoteMonitoringAgent", "agent.exe");
                if (File.Exists(candidate)) return candidate;
            }

            string programFiles = Environment.GetEnvironmentVariable("ProgramFiles");
            if (!string.IsNullOrEmpty(programFiles))
            {
                string machine = Path.Combine(programFiles, "RemoteMonitoringAgent", "agent.exe");
                if (File.Exists(machine)) return machine;
            }

            return null;
        }
    }

    // Estado leido de status.json. Solo campos planos y conocidos.
    internal sealed class AgentState
    {
        public string State;
        public string ServerUrl;
        public string DeviceId;
        public string Hostname;
        public string UpdatedAt;
        public string LastHeartbeatAt;
        public string LastError;

        public static AgentState Load()
        {
            string best = null;
            long bestStamp = long.MinValue;

            foreach (string candidate in StatusPaths())
            {
                try
                {
                    if (!File.Exists(candidate)) continue;
                    string json;
                    using (FileStream stream = new FileStream(candidate, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        json = reader.ReadToEnd();
                    }

                    long stamp = ToStamp(Field(json, "updatedAt"));
                    if (stamp > bestStamp)
                    {
                        bestStamp = stamp;
                        best = json;
                    }
                }
                catch
                {
                    // Un archivo a medio escribir o corrupto no puede tumbar la bandeja.
                }
            }

            if (best == null) return null;

            AgentState s = new AgentState();
            s.State = Field(best, "state");
            s.ServerUrl = Field(best, "serverUrl");
            s.DeviceId = Field(best, "deviceId");
            s.Hostname = Field(best, "hostname");
            s.UpdatedAt = Field(best, "updatedAt");
            s.LastHeartbeatAt = Field(best, "lastHeartbeatAt");
            s.LastError = Field(best, "lastError");
            return s;
        }

        private static System.Collections.Generic.IEnumerable<string> StatusPaths()
        {
            string programData = Environment.GetEnvironmentVariable("ProgramData");
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");

            if (!string.IsNullOrEmpty(programData))
                yield return Path.Combine(programData, "RemoteMonitoringAgent", "status.json");
            if (!string.IsNullOrEmpty(local))
                yield return Path.Combine(local, "RemoteMonitoringAgent", "status.json");
        }

        // Parser minimo: status.json lo escribe el propio agente con claves planas, sin anidar
        // objetos ni escapes raros. Traerse un framework JSON a un exe de 20 KB no se justifica.
        internal static string Field(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;

            string needle = "\"" + key + "\"";
            int at = json.IndexOf(needle, StringComparison.Ordinal);
            if (at < 0) return null;

            int colon = json.IndexOf(':', at + needle.Length);
            if (colon < 0) return null;

            int i = colon + 1;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
            if (i >= json.Length) return null;

            if (json[i] == '"')
            {
                StringBuilder sb = new StringBuilder();
                i++;
                while (i < json.Length)
                {
                    char c = json[i];
                    if (c == '\\' && i + 1 < json.Length)
                    {
                        char next = json[i + 1];
                        if (next == 'n') sb.Append('\n');
                        else if (next == 't') sb.Append('\t');
                        else if (next == 'r') sb.Append('\r');
                        else if (next == '"') sb.Append('"');
                        else if (next == '\\') sb.Append('\\');
                        else if (next == '/') sb.Append('/');
                        else if (next == 'u' && i + 5 < json.Length)
                        {
                            int code;
                            if (int.TryParse(json.Substring(i + 2, 4), System.Globalization.NumberStyles.HexNumber, null, out code))
                            {
                                sb.Append((char)code);
                                i += 4;
                            }
                            else sb.Append(next);
                        }
                        else sb.Append(next);
                        i += 2;
                        continue;
                    }
                    if (c == '"') break;
                    sb.Append(c);
                    i++;
                }
                return sb.Length == 0 ? null : sb.ToString();
            }

            int end = i;
            while (end < json.Length && json[end] != ',' && json[end] != '}' && json[end] != '\n' && json[end] != '\r') end++;
            string raw = json.Substring(i, end - i).Trim();
            return raw == "null" || raw.Length == 0 ? null : raw;
        }

        internal static long ToStamp(string iso)
        {
            DateTime parsed;
            if (DateTime.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.RoundtripKind, out parsed))
            {
                return parsed.ToUniversalTime().Ticks;
            }
            return long.MinValue;
        }
    }

    internal sealed class TrayIcon : IDisposable, IMessageFilter
    {
        // La bandeja la dibuja el Explorer. Cuando Explorer se cierra (logoff, reinicio del shell,
        // un crash) manda WM_DISPLAYCHANGE y nuestros NIM_ mensajes fallan: sin este filtro el
        // icono desaparece hasta el proximo logon y el aviso de monitoreo se pierde.
        private const int WM_DISPLAYCHANGE = 0x007E;

        private readonly Options _options;
        private readonly NotifyIcon _icon;

        // Timer explicito: System.Threading.Timer esta importado y sin qualifier el compilador
        // no sabe cual de los dos queremos.
        private readonly System.Windows.Forms.Timer _timer;
        private Process _agent;
        private int _restarts;
        private DateTime _lastRestart = DateTime.MinValue;
        private string _menuSignature;
        private bool _disposed;

        public TrayIcon(Options options)
        {
            _options = options;

            _icon = new NotifyIcon();
            _icon.Icon = DrawnIcon(Color.Gray);
            _icon.Text = "Monitoreo remoto - iniciando";
            _icon.Visible = true;
            _icon.ContextMenu = new ContextMenu();
            _icon.DoubleClick += delegate { OpenPanel(); };

            _timer = new System.Windows.Forms.Timer();
            _timer.Interval = Math.Max(1, _options.PollSeconds) * 1000;
            _timer.Tick += delegate { Refresh(); };
        }

        public bool PreFilterMessage(ref Message m)
        {
            if (m.Msg != WM_DISPLAYCHANGE || _disposed) return false;

            try
            {
                // Re-registrar el icono en la bandeja del shell nuevo.
                _icon.Visible = false;
                _icon.Visible = true;
            }
            catch
            {
                // Shell todavia no listo: el proximo tick alcanza.
            }
            return false;
        }

        public void Start()
        {
            if (_options.SpawnAgent) EnsureAgent();
            Refresh();
            _timer.Start();
        }

        public void Stop()
        {
            _timer.Stop();
        }

        private void EnsureAgent()
        {
            try
            {
                if (_agent != null && !_agent.HasExited) return;
            }
            catch (InvalidOperationException)
            {
                // Proceso ya desaparecido del todo: se rearma abajo.
            }

            if (string.IsNullOrEmpty(_options.AgentPath) || !File.Exists(_options.AgentPath)) return;

            // Backoff: si el agente muere enseguida (config invalida, server caido con crash loop),
            // no lo relanzamos en bucle: 5 reapertura por hora y despues esperamos el proximo ciclo.
            DateTime now = DateTime.UtcNow;
            if ((now - _lastRestart).TotalHours >= 1.0) _restarts = 0;
            if (_restarts >= 5) return;

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(_options.AgentPath);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = Path.GetDirectoryName(_options.AgentPath);

                _agent = Process.Start(psi);
                _restarts++;
                _lastRestart = now;
            }
            catch
            {
                // Sin permisos o binario bloqueado: la bandeja igual debe mostrar estado.
            }
        }

        private void Refresh()
        {
            if (_options.SpawnAgent) EnsureAgent();

            AgentState state = AgentState.Load();

            if (state == null)
            {
                _icon.Icon = DrawnIcon(Color.Gray);
                _icon.Text = "Monitoreo remoto - sin datos del agente";
                RebuildMenu(null, "El agente aun no escribio su estado.");
                return;
            }

            Color dot;
            string label;
            switch (state.State)
            {
                case "connected": dot = Color.FromArgb(0, 170, 80); label = "Conectado"; break;
                case "starting": dot = Color.FromArgb(240, 170, 0); label = "Iniciando"; break;
                case "stopped": dot = Color.FromArgb(150, 150, 150); label = "Detenido"; break;
                default: dot = Color.FromArgb(200, 40, 40); label = "Sin conexion"; break;
            }

            string age = Age(state.LastHeartbeatAt ?? state.UpdatedAt);
            _icon.Icon = DrawnIcon(dot);
            _icon.Text = Trim("Monitoreo remoto - " + label + (age == null ? "" : " (heartbeat " + age + ")"));

            if ((state.State ?? "") == "connected" && _restarts > 0) _restarts = 0;

            RebuildMenu(state, label);
        }

        private void RebuildMenu(AgentState state, string label)
        {
            // Firma del contenido visible. Solo reconstruimos cuando cambia: descartar un
            // ContextMenu mientras el usuario lo tiene abierto es exactamente el tipo de crash
            // que se ve a media tarde y no a la primera hora.
            string signature = (label ?? "-") + "|" + (state == null ? "-" :
                (state.Hostname ?? "-") + "|" + (state.DeviceId ?? "-") + "|" +
                (state.ServerUrl ?? "-") + "|" + (Age(state.LastHeartbeatAt ?? state.UpdatedAt) ?? "-") + "|" +
                (state.LastError ?? "-"));
            if (signature == _menuSignature) return;
            _menuSignature = signature;

            ContextMenu menu = new ContextMenu();

            MenuItem head = new MenuItem(label ?? "Sin datos");
            head.Enabled = false;
            menu.MenuItems.Add(head);

            if (state != null)
            {
                menu.MenuItems.Add(Info("Equipo: " + (state.Hostname ?? "-")));
                if (!string.IsNullOrEmpty(state.DeviceId)) menu.MenuItems.Add(Info("ID: " + state.DeviceId));
                if (!string.IsNullOrEmpty(state.ServerUrl)) menu.MenuItems.Add(Info("Servidor: " + state.ServerUrl));
                string age = Age(state.LastHeartbeatAt ?? state.UpdatedAt);
                menu.MenuItems.Add(Info("Ultimo latido: " + (age ?? "-")));
                if (!string.IsNullOrEmpty(state.LastError)) menu.MenuItems.Add(Info("Detalle: " + Shorten(state.LastError)));
            }

            menu.MenuItems.Add(new MenuItem("-"));

            MenuItem open = new MenuItem("Abrir panel de monitoreo", delegate { OpenPanel(); });
            open.Enabled = state != null && !string.IsNullOrEmpty(state.ServerUrl);
            menu.MenuItems.Add(open);

            menu.MenuItems.Add(new MenuItem("Refrescar ahora", delegate { Refresh(); }));

            menu.MenuItems.Add(new MenuItem("-"));
            menu.MenuItems.Add(Info("Este icono avisa que el equipo esta monitoreado."));
            menu.MenuItems.Add(Info("No se puede apagar el monitoreo desde aqui."));

            // No se hace Dispose del anterior: el shell puede tenerlo capturado en el click loop.
            // Un ContextMenu por cambio de estado es basura transitoria; el GAC lo recoge.
            _icon.ContextMenu = menu;
        }

        private static MenuItem Info(string text)
        {
            MenuItem item = new MenuItem(Trim(text));
            item.Enabled = false;
            return item;
        }

        private void OpenPanel()
        {
            AgentState state = AgentState.Load();
            string url = state != null ? state.ServerUrl : null;
            if (string.IsNullOrEmpty(url)) return;

            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
                // Sin navegador asociado: no hay nada que mostrarle al usuario por un fallo asi.
            }
        }

        private static string Age(string iso)
        {
            long ticks = AgentState.ToStamp(iso);
            if (ticks == long.MinValue) return null;

            double seconds = (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalSeconds;
            if (seconds < 0) seconds = 0;
            if (seconds < 60) return (int)seconds + "s";
            if (seconds < 3600) return (int)(seconds / 60) + "min";
            if (seconds < 86400) return (int)(seconds / 3600) + "h";
            return (int)(seconds / 86400) + "d";
        }

        private static string Shorten(string value)
        {
            return value.Length <= 60 ? value : value.Substring(0, 57) + "...";
        }

        // El tooltip de NotifyIcon corta alrededor de 63 caracteres.
        private static string Trim(string value)
        {
            return value.Length <= 63 ? value : value.Substring(0, 60) + "...";
        }

        private static Icon DrawnIcon(Color dot)
        {
            // Icono dibujado en caliente: un punto de color sobre una pastilla clara. Evita llevar
            // un .ico por repositorio y da el feedback visual inmediato del estado.
            //
            // La pastilla es deliberada: GetHicon() no siempre conserva el alfa en la bandeja, y
            // sobre fondo oscuro un icono con alfa perdido se ve como un cuadrado negro. Con
            // relleno opaco se ve igual bien en los dos casos.
            using (Bitmap bmp = new Bitmap(16, 16, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.Clear(Color.FromArgb(245, 246, 248));
                    using (Pen border = new Pen(Color.FromArgb(120, 126, 134)))
                    {
                        g.DrawRectangle(border, 0, 0, 15, 15);
                    }
                    using (SolidBrush brush = new SolidBrush(dot)) g.FillEllipse(brush, 3, 3, 10, 10);
                }

                IntPtr handle = bmp.GetHicon();
                try
                {
                    using (Icon tmp = Icon.FromHandle(handle))
                    {
                        // Clonar: el handle de GetHicon es transitorio y DestroyIcon lo llamamos
                        // abajo; un Icon vivo sobre ese handle se cae al cambiar de estado.
                        return (Icon)tmp.Clone();
                    }
                }
                finally
                {
                    DestroyIcon(handle);
                }
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            Application.RemoveMessageFilter(this);
            _timer.Stop();
            _timer.Dispose();
            _icon.Visible = false;
            _icon.ContextMenu = null;
            _icon.Dispose();

            // El agente NO se mata al cerrar la bandeja: es un proceso aparte, registrado por el
            // instalador, y su vida util no depende de que el icono este o no este.
            if (_agent != null) _agent.Dispose();
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr handle);
    }
}
