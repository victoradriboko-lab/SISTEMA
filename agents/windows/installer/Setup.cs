using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyVersion("1.2.4.0")]
[assembly: AssemblyTitle("Servitec - Instalador do client")]
[assembly: AssemblyProduct("Servitec Agent Setup")]
namespace Servitec.Setup {
    internal static class Program {
        [STAThread]
        private static void Main() {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
    internal sealed class SetupForm : Form {
#if HTTP_DEFAULT
        private const bool UseHttp = true;
#else
        private const bool UseHttp = false;
#endif
        private readonly Panel body = new Panel();
        private readonly Label title = new Label();
        private readonly Button back = new Button(), next = new Button(), cancel = new Button();
        private readonly TextBox token = new TextBox();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Label status = new Label();
        private readonly TextBox details = new TextBox();
        private int page;
        private bool installing;
        private string secret;
        private string Server { get { return (UseHttp ? "http" : "https") + "://vsuarez.ddns.net:3000"; } }
        public SetupForm() {
            Text = "Instalação do App Servitec";
            ClientSize = new Size(580, 420);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Panel header = new Panel { Dock = DockStyle.Top, Height = 78, BackColor = Color.White };
            header.Controls.Add(new PictureBox { Image = Icon.ToBitmap(), SizeMode = PictureBoxSizeMode.Zoom, Bounds = new Rectangle(22, 18, 42, 42) });
            title.SetBounds(82, 20, 470, 45); title.Font = new Font(Font, FontStyle.Bold); header.Controls.Add(title);
            Panel footer = new Panel { Dock = DockStyle.Bottom, Height = 54, BackColor = SystemColors.Control };
            back.Text = "< Voltar"; next.Text = "Próximo >"; cancel.Text = "Cancelar";
            back.SetBounds(270, 15, 90, 27); next.SetBounds(366, 15, 95, 27); cancel.SetBounds(467, 15, 90, 27);
            footer.Controls.AddRange(new Control[] { back, next, cancel });
            body.Dock = DockStyle.Fill; body.Padding = new Padding(24); body.BackColor = SystemColors.Control;
            Controls.Add(body); Controls.Add(header); Controls.Add(footer);
            back.Click += delegate { page--; ShowPage(); };
            next.Click += delegate { Advance(); };
            cancel.Click += delegate { Close(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (installing) { e.Cancel = true; return; }
                if (page < 3 && MessageBox.Show(this, "Deseja cancelar a instalação?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) e.Cancel = true;
            };
            AcceptButton = next; CancelButton = cancel;
            ShowPage();
        }
        private void AddText(string text, int top, int height) {
            body.Controls.Add(new Label { Text = text, Bounds = new Rectangle(24, top, 530, height) });
        }
        private void ShowPage() {
            body.Controls.Clear(); back.Visible = page > 0 && page < 3; next.Enabled = true;
            if (page == 0) {
                title.Text = "Bem-vindo ao Instalador do App Servitec";
                AddText("Este assistente instalará o aplicativo de atendimento e o agente de monitoramento no seu computador.", 24, 55);
                AddText("Feche o aplicativo Abrir Chamado antes de continuar.\n\nClique em Próximo para continuar.", 95, 110);
            } else if (page == 1) {
                title.Text = "Informações da instalação";
                AddText("Serão instalados o serviço de monitoramento e o aplicativo Abrir Chamado, com atalhos na Área de Trabalho e no menu Iniciar.", 24, 65);
                AddText("O agente envia inventário e telemetria para a empresa. Não coleta senhas ou arquivos pessoais. A reinstalação preserva a identidade da máquina e mantém a fila conforme a configuração da empresa.", 100, 85);
                AddText("Clique em Próximo para informar o token da empresa.", 210, 40);
            } else if (page == 2) {
                title.Text = "Configuração da empresa";
                AddText("Servidor: " + Server, 24, 35);
                AddText("Token da empresa (10 letras e números):", 70, 25);
                token.SetBounds(24, 101, 350, 27); token.UseSystemPasswordChar = true; token.MaxLength = 10;
                body.Controls.Add(token);
                AddText(UseHttp ? "Conexão HTTP: o token e os dados serão enviados sem criptografia." : "A conexão HTTPS verifica o certificado do servidor.", 150, 55);
                next.Text = "Instalar"; token.Focus();
            }
            if (page < 2) next.Text = "Próximo >";
        }
        private async void Advance() {
            if (page == 3) { Close(); return; }
            if (page < 2) { page++; ShowPage(); return; }
            secret = token.Text.Trim();
            if (!Regex.IsMatch(secret, "^[A-Za-z0-9]{10}$")) {
                MessageBox.Show(this, "Informe o token de 10 letras e números da ficha da empresa.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return;
            }
            token.Clear(); page = 3; installing = true;
            back.Visible = false; next.Enabled = false; cancel.Enabled = false;
            body.Controls.Clear(); title.Text = "Instalando o App Servitec";
            status.SetBounds(24, 22, 530, 35); progress.SetBounds(24, 62, 530, 20);
            Button toggle = new Button { Text = "Mostrar detalhes", Bounds = new Rectangle(24, 94, 140, 27) };
            details.SetBounds(24, 132, 530, 140); details.Multiline = true; details.ReadOnly = true; details.ScrollBars = ScrollBars.Vertical; details.Visible = false;
            toggle.Click += delegate { details.Visible = !details.Visible; toggle.Text = details.Visible ? "Ocultar detalhes" : "Mostrar detalhes"; };
            body.Controls.AddRange(new Control[] { status, progress, toggle, details });
            bool success = await Task.Run(() => Install());
            secret = null; installing = false; next.Enabled = true; next.Text = "Concluir";
            title.Text = success ? "Instalação concluída" : "Não foi possível concluir a instalação";
            if (success) Report(100, "App Servitec instalado. Confira Monitoramento na plataforma.");
            else { status.Text = "Confira os detalhes abaixo antes de tentar novamente."; details.Visible = true; }
        }
        private void Report(int percent, string message) {
            if (InvokeRequired) { Invoke(new Action<int, string>(Report), percent, message); return; }
            if (!String.IsNullOrEmpty(secret)) message = message.Replace(secret, "[token oculto]");
            if (percent >= 0) progress.Value = Math.Max(progress.Value, Math.Min(100, percent));
            status.Text = progress.Value + "% — " + message;
            details.AppendText(message + Environment.NewLine);
        }
        private bool Install() {
            string staging = null;
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
                        int extracted = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries) {
                            expanded += entry.Length;
                            if (expanded > 5 * 1024 * 1024) throw new InvalidDataException("Pacote excedeu o tamanho permitido.");
                            string destination = Path.GetFullPath(Path.Combine(staging, entry.FullName));
                            if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || String.IsNullOrEmpty(entry.Name)) throw new InvalidDataException("Caminho de pacote invalido.");
                            Report(5 + (++extracted * 20 / archive.Entries.Count), "Extraindo: " + entry.Name);
                            Directory.CreateDirectory(Path.GetDirectoryName(destination));
                            using (Stream input = entry.Open()) using (Stream output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) input.CopyTo(output);
                        }
                    }
                }
                ProcessStartInfo start = new ProcessStartInfo {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(staging, "instalar-agente.ps1") + "\" -Gui" + (UseHttp ? " -UseHttp" : ""),
                    WorkingDirectory = staging, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true
                };
                // Token fora da linha de comando e dos arquivos temporários.
                start.EnvironmentVariables["SERVITEC_SETUP_TOKEN"] = secret;
                using (Process child = new Process { StartInfo = start }) {
                    DataReceivedEventHandler receive = delegate(object sender, DataReceivedEventArgs e) {
                        if (e.Data == null) return;
                        Match m = Regex.Match(e.Data, @"^SERVITEC_PROGRESS:(\d+):(.*)$");
                        if (m.Success) Report(Int32.Parse(m.Groups[1].Value), m.Groups[2].Value);
                        else Report(-1, e.Data);
                    };
                    child.OutputDataReceived += receive; child.ErrorDataReceived += receive;
                    child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine(); child.WaitForExit();
                    return child.ExitCode == 0;
                }
            } catch (Exception error) { Report(-1, "ERRO: " + error.Message); return false; }
            finally {
                if (staging != null) { try { Directory.Delete(staging, true); } catch { Report(-1, "Não foi possível remover os arquivos temporários da instalação."); } }
            }
        }
    }
}
