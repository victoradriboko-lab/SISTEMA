using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: AssemblyVersion("1.0.0.0")]
namespace Servitec {
    internal sealed class AgentHttpException : Exception { public readonly int Status; public AgentHttpException(int status) { Status = status; } }
    public sealed class AgentService : ServiceBase {
        private readonly ManualResetEvent stop = new ManualResetEvent(false);
        private Thread worker;
        private readonly string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ServitecAgent");
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 1048576 };
        private HttpClient client;
        private string token;
        private string machineId;
        private string endpoint;
        private int interval;
        private DateTime inventoryDue = DateTime.MinValue;
        private PerformanceCounter cpu;
        public AgentService() { ServiceName = "ServitecAgent"; CanStop = true; AutoLog = false; }
        public static void Main(string[] args) {
            if (args.Length == 1 && args[0] == "--version") { Console.WriteLine(AgentPolicy.Version); return; }
            if (args.Length == 2 && args[0] == "--check-url") { try { AgentPolicy.ServerUri(args[1], true); Console.WriteLine("URL aceita"); } catch { Environment.ExitCode = 1; } return; }
            ServiceBase.Run(new AgentService());
        }
        protected override void OnStart(string[] args) {
            stop.Reset();
            worker = new Thread(Run) { IsBackground = true, Name = "ServitecTelemetry" };
            worker.Start();
        }
        protected override void OnStop() {
            stop.Set();
            if (client != null) client.CancelPendingRequests();
            if (worker != null) worker.Join(TimeSpan.FromSeconds(25));
        }
        private void Log(string message) {
            try {
                string path = Path.Combine(directory, "agent.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1048576) { string old = path + ".1"; if (File.Exists(old)) File.Delete(old); File.Move(path, old); }
                File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine, Encoding.UTF8);
            } catch { }
        }
        private void Configure() {
            Dictionary<string, object> config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(directory, "config.json"), Encoding.UTF8));
            bool allowLan = config.ContainsKey("allowInsecureLan") && Convert.ToBoolean(config["allowInsecureLan"]);
            Uri url = AgentPolicy.ServerUri(Convert.ToString(config["serverUrl"]), allowLan);
            endpoint = new Uri(url, "/api/heartbeat").AbsoluteUri;
            machineId = Convert.ToString(config["machineId"]);
            Guid parsed; if (!Guid.TryParse(machineId, out parsed)) throw new ArgumentException("machineId invalido");
            interval = Math.Max(15, Math.Min(300, Convert.ToInt32(config["intervalSeconds"])));
            token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(Convert.ToString(config["protectedToken"])), null, DataProtectionScope.LocalMachine));
            if (token.Length != 64 || token.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Token invalido");
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = true });
            client.Timeout = TimeSpan.FromSeconds(15);
            try { cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total"); cpu.NextValue(); } catch { cpu = null; }
        }
        private void Run() {
            try {
                Configure();
                string queue = Path.Combine(directory, "queue"); Directory.CreateDirectory(queue); foreach (string temporary in Directory.GetFiles(queue,"*.tmp")) File.Delete(temporary);
                int failures = 0; DateTime nextSend = DateTime.MinValue;
                Log("Agente " + AgentPolicy.Version + " iniciado. Coleta a cada " + interval + " segundos.");
                while (!stop.WaitOne(0)) {
                    try {
                        string payload = json.Serialize(Collect());
                        if (Encoding.UTF8.GetByteCount(payload) > 900000) throw new InvalidOperationException("Inventario excedeu limite");
                        string file = Path.Combine(queue, DateTime.UtcNow.Ticks.ToString("D19") + ".json");
                        File.WriteAllText(file + ".tmp", payload, Encoding.UTF8); File.Move(file + ".tmp", file);
                        FileInfo[] pending = new DirectoryInfo(queue).GetFiles("*.json").OrderByDescending(f => f.Name).ToArray();
                        foreach (FileInfo expired in pending.Skip(120)) expired.Delete();
                        if (DateTime.UtcNow >= nextSend) {
                            Send(file);
                            failures = 0; nextSend = DateTime.MinValue;
                            // A amostra atual vai primeiro. Depois, no maximo tres amostras antigas.
                            foreach (FileInfo previous in new DirectoryInfo(queue).GetFiles("*.json").OrderBy(f => f.Name).Take(3)) {
                                if (stop.WaitOne(0)) break;
                                Send(previous.FullName);
                            }
                        }
                    } catch (Exception error) {
                        failures++;
                        int delay = Math.Min(300, interval * (1 << Math.Min(failures - 1, 4)));
                        nextSend = DateTime.UtcNow.AddSeconds(delay);
                        AgentHttpException http = error as AgentHttpException;
                        Log("Falha de coleta/envio (" + (http != null ? "HTTP " + http.Status : error.GetType().Name) + "). Nova tentativa em ate " + delay + "s. Verifique URL, certificado e token.");
                    }
                    stop.WaitOne(TimeSpan.FromSeconds(interval));
                }
            } catch (Exception error) {
                Log("Falha de inicializacao (" + error.GetType().Name + "). Execute o instalador novamente.");
                // Codigo de falha permite a recuperacao configurada no Service Control Manager.
                Environment.Exit(1);
            } finally { if (cpu != null) cpu.Dispose(); if (client != null) client.Dispose(); }
        }
        private void Send(string path) {
            string value = File.ReadAllText(path, Encoding.UTF8);
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, endpoint)) {
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                request.Content = new StringContent(value, Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = client.SendAsync(request).GetAwaiter().GetResult()) {
                    if ((int)response.StatusCode == 400 || (int)response.StatusCode == 413) { File.Delete(path); Log("Amostra recusada e descartada: HTTP " + (int)response.StatusCode); return; }
                    if (!response.IsSuccessStatusCode) throw new AgentHttpException((int)response.StatusCode);
                    string text = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    Dictionary<string, object> result = json.Deserialize<Dictionary<string, object>>(text);
                    if (result.ContainsKey("requestInventory") && Convert.ToBoolean(result["requestInventory"])) inventoryDue = DateTime.MinValue;
                }
            }
            File.Delete(path);
        }
        private List<Dictionary<string, object>> Query(string query, string[] fields) {
            List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
            try {
                EnumerationOptions options = new EnumerationOptions { Timeout = TimeSpan.FromSeconds(10), ReturnImmediately = false };
                using (ManagementObjectSearcher search = new ManagementObjectSearcher("root\\cimv2", query, options))
                using (ManagementObjectCollection found = search.Get()) {
                    foreach (ManagementObject item in found) using (item) {
                        Dictionary<string, object> row = new Dictionary<string, object>();
                        foreach (string field in fields) row[field] = item[field];
                        rows.Add(row);
                    }
                }
            } catch { }
            return rows;
        }
        private static object Value(Dictionary<string, object> row, string key) { return row != null && row.ContainsKey(key) ? row[key] : null; }
        private static double? Number(object value) { double n; return value != null && Double.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out n) ? (double?)n : null; }
        private static string Text(object value) { string text = Convert.ToString(value); return text.Length > 500 ? text.Substring(0, 500) : text; }
        private Dictionary<string, object> Collect() {
            Dictionary<string, object> os = Query("SELECT Caption,Version,OSArchitecture,TotalVisibleMemorySize,FreePhysicalMemory,LastBootUpTime,ProductType FROM Win32_OperatingSystem", new [] { "Caption","Version","OSArchitecture","TotalVisibleMemorySize","FreePhysicalMemory","LastBootUpTime","ProductType" }).FirstOrDefault();
            double? cpuValue = null;
            try { if (cpu != null) cpuValue = Math.Max(0, Math.Min(100, Math.Round(cpu.NextValue(), 1))); } catch { }
            if (!cpuValue.HasValue) { double[] loads = Query("SELECT LoadPercentage FROM Win32_Processor", new [] { "LoadPercentage" }).Select(p => Number(Value(p,"LoadPercentage"))).Where(n => n.HasValue).Select(n => n.Value).ToArray(); if (loads.Length > 0) cpuValue = loads.Average(); }
            double? total = Number(Value(os, "TotalVisibleMemorySize")), free = Number(Value(os, "FreePhysicalMemory"));
            Dictionary<string, object> memory = new Dictionary<string, object> { {"total",total * 1024}, {"available",free * 1024}, {"usedPercent",total > 0 && free.HasValue ? (double?)Math.Round((1 - free.Value / total.Value) * 100, 1) : null} };
            List<Dictionary<string, object>> disks = new List<Dictionary<string, object>>();
            foreach (Dictionary<string, object> disk in Query("SELECT DeviceID,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType=3", new [] {"DeviceID","Size","FreeSpace"})) {
                double? size = Number(Value(disk,"Size")), available = Number(Value(disk,"FreeSpace"));
                disks.Add(new Dictionary<string, object> { {"name",Text(Value(disk,"DeviceID"))}, {"total",size}, {"available",available}, {"usedPercent",size > 0 && available.HasValue ? (double?)Math.Round((1 - available.Value / size.Value) * 100,1) : null} });
            }
            double? uptime = null;try { uptime = Math.Max(0, (DateTime.Now - ManagementDateTimeConverter.ToDateTime(Text(Value(os,"LastBootUpTime")))).TotalSeconds); } catch { }
            Dictionary<string, object> payload = new Dictionary<string, object> {
                {"schemaVersion",1}, {"sampleId",Guid.NewGuid().ToString()}, {"observedAt",DateTime.UtcNow.ToString("o")},
                {"agent",new Dictionary<string, object> { {"version",AgentPolicy.Version}, {"platform","windows"}, {"machineId",machineId} }},
                {"os",Text(Value(os,"Caption"))},
                {"metrics",new Dictionary<string, object> { {"cpuPercent",cpuValue}, {"memory",memory}, {"disks",disks}, {"uptimeSeconds",uptime} }}
            };
            if (DateTime.UtcNow >= inventoryDue) { payload["inventory"] = Inventory(os); inventoryDue = DateTime.UtcNow.AddHours(6); }
            return payload;
        }
        private Dictionary<string, object> Inventory(Dictionary<string, object> os) {
            Dictionary<string, object> system = Query("SELECT Manufacturer,Model,Domain FROM Win32_ComputerSystem",new [] {"Manufacturer","Model","Domain"}).FirstOrDefault();
            Dictionary<string, object> bios = Query("SELECT SerialNumber,SMBIOSBIOSVersion FROM Win32_BIOS",new [] {"SerialNumber","SMBIOSBIOSVersion"}).FirstOrDefault();
            List<Dictionary<string, object>> processors = Query("SELECT Name,NumberOfCores,NumberOfLogicalProcessors FROM Win32_Processor",new [] {"Name","NumberOfCores","NumberOfLogicalProcessors"});
            List<Dictionary<string, object>> network = new List<Dictionary<string, object>>();
            foreach (Dictionary<string, object> n in Query("SELECT Description,MACAddress,IPAddress FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=True",new [] {"Description","MACAddress","IPAddress"}).Take(32)) {
                network.Add(new Dictionary<string, object> { {"name",Text(Value(n,"Description"))}, {"mac",Text(Value(n,"MACAddress"))}, {"addresses",Value(n,"IPAddress") ?? new string[0]} });
            }
            List<Dictionary<string, object>> services = Query("SELECT Name,DisplayName,State,StartMode FROM Win32_Service WHERE StartMode='Auto'",new [] {"Name","DisplayName","State","StartMode"}).Take(300).Select(s => new Dictionary<string,object> { {"name",Text(Value(s,"Name"))}, {"displayName",Text(Value(s,"DisplayName"))}, {"state",Text(Value(s,"State"))}, {"startMode","Auto"} }).ToList();
            return new Dictionary<string, object> {
                {"hostname",Environment.MachineName}, {"manufacturer",Text(Value(system,"Manufacturer"))}, {"model",Text(Value(system,"Model"))}, {"serialNumber",Text(Value(bios,"SerialNumber"))}, {"biosVersion",Text(Value(bios,"SMBIOSBIOSVersion"))}, {"domain",Text(Value(system,"Domain"))},
                {"osVersion",Text(Value(os,"Version"))}, {"architecture",Text(Value(os,"OSArchitecture"))}, {"productType",Number(Value(os,"ProductType"))},
                {"processors",processors.Select(p => new Dictionary<string,object> { {"name",Text(Value(p,"Name"))}, {"cores",Number(Value(p,"NumberOfCores"))}, {"logicalProcessors",Number(Value(p,"NumberOfLogicalProcessors"))} }).ToArray()},
                {"network",network}, {"programs",Programs()}, {"services",services}
            };
        }
        private List<Dictionary<string, object>> Programs() {
            List<Dictionary<string, object>> programs = new List<Dictionary<string, object>>(); HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (RegistryView view in new [] {RegistryView.Registry64,RegistryView.Registry32}) {
                try {
                    using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,view))
                    using (RegistryKey uninstall = machine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
                        if (uninstall == null) continue;
                        foreach (string name in uninstall.GetSubKeyNames()) using (RegistryKey key = uninstall.OpenSubKey(name)) {
                            if (key == null) continue;
                            string display = Text(key.GetValue("DisplayName")), version = Text(key.GetValue("DisplayVersion"));
                            if (display.Length == 0 || !seen.Add(display + "|" + version)) continue;
                            programs.Add(new Dictionary<string,object> { {"name",display}, {"version",version}, {"publisher",Text(key.GetValue("Publisher"))} });
                            if (programs.Count >= 500) return programs;
                        }
                    }
                } catch { }
            }
            return programs;
        }
    }
}
