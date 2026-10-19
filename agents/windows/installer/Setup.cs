using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;

[assembly: AssemblyVersion("1.2.4.0")]
[assembly: AssemblyTitle("Servitec - Instalador do agente")]
[assembly: AssemblyProduct("Servitec Agent Setup")]
namespace Servitec.Setup {
    internal static class Program {
        private static int Main() {
            string staging = null;
            int result = 1;
            Console.Title = "Servitec - Instalacao do agente Windows";
            Console.WriteLine("SERVITEC | Agente para Windows e Windows Server");
            #if HTTP_DEFAULT
            const bool useHttp = true;
            Console.WriteLine("Servidor: http://vsuarez.ddns.net:3000 | Informe somente o token da empresa.");
#else
            const bool useHttp = false;
            Console.WriteLine("Servidor: https://vsuarez.ddns.net:3000 | Informe somente o token da empresa.");
#endif
            try {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) {
                    if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) throw new InvalidOperationException("Execute o instalador como administrador.");
                }
                // Program Files evita executar scripts elevados em uma pasta temporaria gravavel por outros usuarios.
                string parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ServitecAgent");
                Directory.CreateDirectory(parent);
                staging = Path.Combine(parent, "setup-" + Guid.NewGuid().ToString("N"));
                DirectorySecurity security = new DirectorySecurity();
                security.SetAccessRuleProtection(true, false);
                foreach (string sid in new [] { "S-1-5-18", "S-1-5-32-544" }) security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
                Directory.CreateDirectory(staging, security);
                string prefix = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
                using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Servitec.AgentPackage.zip")) {
                    if (resource == null) throw new InvalidDataException("Pacote de instalacao ausente.");
                    using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read)) {
                        if (archive.Entries.Count > 32) throw new InvalidDataException("Pacote invalido.");
                        long expanded = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries) {
                            expanded += entry.Length;
                            if (expanded > 5 * 1024 * 1024) throw new InvalidDataException("Pacote excedeu o tamanho permitido.");
                            string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                            if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || String.IsNullOrEmpty(entry.Name)) throw new InvalidDataException("Caminho de pacote invalido.");
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            using (Stream input = entry.Open()) using (Stream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
                        }
                    }
                }
                string script = Path.Combine(staging, "instalar-agente.ps1");
                ProcessStartInfo start = new ProcessStartInfo {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + (useHttp ? " -UseHttp" : ""),
                    WorkingDirectory = staging,
                    UseShellExecute = false
                };
                using (Process child = Process.Start(start)) { child.WaitForExit(); result = child.ExitCode; }
                Console.WriteLine(result == 0 ? "Instalacao concluida. Confira Monitoramento na plataforma." : "Instalacao nao concluida. Confira a mensagem acima.");
            } catch (Exception error) {
                Console.WriteLine("ERRO: " + error.Message);
            } finally {
                if (staging != null) { try { Directory.Delete(staging, true); } catch { Console.WriteLine("Arquivos temporarios preservados em: " + staging); } }
            }
            Console.WriteLine("Pressione Enter para fechar.");
            Console.ReadLine();
            return result;
        }
    }
}
