using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Windows.Forms;
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyTitle("SERVITEC VSA - Abrir chamado")]
namespace Servitec.Client {
    internal static class Program {
        [STAThread]
        private static void Main() {
            try {
                string directory = AppDomain.CurrentDomain.BaseDirectory;
                string configFile = Path.Combine(directory, "portal.json");
                if (new FileInfo(configFile).Length > 4096) throw new InvalidDataException();
                var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configFile));
                bool allowLan = config.ContainsKey("allowInsecureLan") && config["allowInsecureLan"] is bool && (bool)config["allowInsecureLan"];
                Uri origin = AgentPolicy.ServerUri(Convert.ToString(config["portalUrl"]), allowLan);
                UriBuilder builder = new UriBuilder(origin); builder.Query = "newTicket=1";
                string url = builder.Uri.AbsoluteUri;
                string browser = FindBrowser();
                if (browser != null) {
                    Process.Start(new ProcessStartInfo { FileName = browser, Arguments = "--app=\"" + url + "\" --new-window", UseShellExecute = false });
                } else {
                    MessageBox.Show("Instale Microsoft Edge ou Google Chrome para usar o atendimento em janela. O painel sera aberto no navegador padrao.", "SERVITEC VSA", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
                }
            } catch {
                MessageBox.Show("Nao foi possivel abrir o atendimento. Solicite a equipe de TI que confira a instalacao e o endereco do Painel do Cliente.", "SERVITEC VSA", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        private static string FindBrowser() {
            foreach (string basePath in new [] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) }) {
                if (String.IsNullOrEmpty(basePath)) continue;
                foreach (string relative in new [] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" }) {
                    string path = Path.Combine(basePath, relative);
                    if (File.Exists(path)) return path;
                }
            }
            return null;
        }
    }
}
