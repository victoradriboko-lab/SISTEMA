using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
[assembly: AssemblyVersion("1.2.1.0")]
[assembly: AssemblyTitle("SERVITEC VSA - Abrir chamado")]
namespace Servitec.Client {
    internal static class Program {
        [STAThread]
        private static void Main() {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            try {
                string configFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "portal.json");
                if (new FileInfo(configFile).Length > 8192) throw new InvalidDataException();
                var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(configFile));
                bool allowLan = config.ContainsKey("allowInsecureLan") && config["allowInsecureLan"] is bool && (bool)config["allowInsecureLan"];
                bool allowPublicHttp = config.ContainsKey("allowInsecureHttp") && config["allowInsecureHttp"] is bool && (bool)config["allowInsecureHttp"];
                Uri origin = AgentPolicy.ServerUri(Convert.ToString(config["serverUrl"]), allowLan, allowPublicHttp);
                string token = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(Convert.ToString(config["protectedSupportToken"])), null, DataProtectionScope.LocalMachine));
                if (!System.Text.RegularExpressions.Regex.IsMatch(token, "^[a-f0-9]{64}$")) throw new InvalidDataException();
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                Application.Run(new SupportForm(origin, token, Convert.ToString(config["companyName"])));
            } catch {
                MessageBox.Show("Solicite a equipe de TI que atualize a instalacao do aplicativo de atendimento. A autorizacao deste computador nao esta disponivel.", "SERVITEC VSA", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
    internal sealed class SupportForm : Form {
        private readonly Uri origin;
        private readonly string token;
        private readonly string requestId = Guid.NewGuid().ToString();
        private readonly TextBox requester = new TextBox { MaxLength = 120, Text = Environment.UserName };
        private readonly TextBox email = new TextBox { MaxLength = 254 };
        private readonly TextBox title = new TextBox { MaxLength = 500 };
        private readonly TextBox description = new TextBox { MaxLength = 5000, Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
        private readonly Button submit = new Button { Text = "Enviar chamado", Height = 44, Width = 190, BackColor = Color.FromArgb(46, 210, 228), ForeColor = Color.FromArgb(9, 18, 35), FlatStyle = FlatStyle.Flat };
        internal SupportForm(Uri server, string credential, string company) {
            origin = server; token = credential;
            Text = "SERVITEC VSA - Abrir chamado"; Size = new Size(760, 740); MinimumSize = new Size(600, 660);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10); BackColor = Color.FromArgb(10, 19, 35); ForeColor = Color.White;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 12 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.Controls.Add(new Label { Text = "SERVITEC VSA | ATENDIMENTO", AutoSize = true, ForeColor = Color.FromArgb(46, 210, 228), Font = new Font("Segoe UI", 14, FontStyle.Bold) });
            layout.Controls.Add(new Label { Text = company + "  |  Computador: " + Environment.MachineName, AutoSize = true, Margin = new Padding(0, 8, 0, 18) });
            AddField(layout, "Seu nome", requester); AddField(layout, "E-mail para contato (opcional)", email); AddField(layout, "Assunto", title); AddField(layout, "Descreva o problema", description);
            layout.RowStyles.Clear();for (int i = 0; i < 12; i++) layout.RowStyles.Add(new RowStyle(i == 9 ? SizeType.Percent : SizeType.AutoSize, i == 9 ? 100 : 0));
            layout.Controls.Add(new Label { Text = "Este computador esta autorizado a enviar chamados para esta empresa. Nao e necessario fazer login.", AutoSize = true, MaximumSize = new Size(650, 0), Margin = new Padding(0, 12, 0, 12) });
            layout.Controls.Add(submit); Controls.Add(layout);
            submit.Click += async (sender, args) => {
                if (String.IsNullOrWhiteSpace(requester.Text) || String.IsNullOrWhiteSpace(title.Text) || String.IsNullOrWhiteSpace(description.Text)) { MessageBox.Show("Informe seu nome, assunto e descricao do problema.", Text); return; }
                submit.Enabled = false; requester.ReadOnly = email.ReadOnly = title.ReadOnly = description.ReadOnly = true;
                try {
                    var payload = new { requestId = requestId, requester = requester.Text.Trim(), email = email.Text.Trim(), title = title.Text.Trim(), description = description.Text.Trim() };
                    using (var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = true })) {
                        client.Timeout = TimeSpan.FromSeconds(45); client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                        using (var content = new StringContent(new JavaScriptSerializer().Serialize(payload), Encoding.UTF8, "application/json"))
                        using (var response = await client.PostAsync(new Uri(origin, "/api/agent/support/tickets"), content)) {
                            string responseText = await response.Content.ReadAsStringAsync();
                            var result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(responseText);
                            if (!response.IsSuccessStatusCode) { MessageBox.Show(result.ContainsKey("error") ? Convert.ToString(result["error"]) : "Nao foi possivel enviar. Contate a equipe de TI.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                            MessageBox.Show("Chamado #" + Convert.ToString(result["id"]) + " enviado para a equipe SERVITEC.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); Close();
                        }
                    }
                } catch { MessageBox.Show("Nao foi possivel confirmar o envio. Confira a conexao e tente novamente com os mesmos dados. O sistema evita duplicar a solicitacao.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
                finally { if (!IsDisposed) { submit.Enabled = true; requester.ReadOnly = email.ReadOnly = title.ReadOnly = description.ReadOnly = false; } }
            };
        }
        private static void AddField(TableLayoutPanel panel, string caption, TextBox input) {
            panel.Controls.Add(new Label { Text = caption, AutoSize = true, Margin = new Padding(0, 8, 0, 4) });
            input.Dock = DockStyle.Fill; input.BackColor = Color.FromArgb(23, 37, 58); input.ForeColor = Color.White; input.BorderStyle = BorderStyle.FixedSingle;
            panel.Controls.Add(input);
        }
    }
}
