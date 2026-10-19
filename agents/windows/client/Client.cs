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
[assembly: AssemblyVersion("1.2.4.0")]
[assembly: AssemblyTitle("Servitec T.I. - Abrir chamado")]
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
                MessageBox.Show("Solicite a equipe de TI que atualize a instalacao do aplicativo de atendimento. A autorizacao deste computador nao esta disponivel.", "Servitec T.I.", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
        private readonly Button submit = new Button { Text = "Enviar chamado", Height = 44, Width = 190, BackColor = Color.FromArgb(0, 204, 153), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        internal SupportForm(Uri server, string credential, string company) {
            origin = server; token = credential;
            Text = "Servitec T.I. - Abrir chamado"; Size = new Size(840, 860); MinimumSize = new Size(640, 720);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
            AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96F, 96F);
            BackColor = Color.FromArgb(248, 248, 248); ForeColor = Color.FromArgb(31, 35, 42);
            var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Margin = new Padding(0), Padding = new Padding(0) };
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 112));
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 66));
            shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var header = new TableLayoutPanel { Dock = DockStyle.Fill, BackColor = Color.Black, Padding = new Padding(26, 14, 26, 12), Margin = new Padding(0), ColumnCount = 1, RowCount = 2 };
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            header.RowStyles.Add(new RowStyle(SizeType.Percent, 65));header.RowStyles.Add(new RowStyle(SizeType.Percent, 35));
            header.Controls.Add(new Label { Text = "servitec", Dock = DockStyle.Fill, ForeColor = Color.FromArgb(192, 132, 235), Font = new Font("Segoe UI Light", 29), TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0) });
            header.Controls.Add(new Label { Text = "SERVITEC T.I.  |  ATENDIMENTO", Dock = DockStyle.Fill, ForeColor = Color.White, Font = new Font("Segoe UI", 10, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(2, 0, 0, 0) });
            var identity = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(26, 9, 26, 8), BackColor = Color.White, Margin = new Padding(0), ColumnCount = 1, RowCount = 2 };
            identity.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            identity.RowStyles.Add(new RowStyle(SizeType.Percent, 50));identity.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            identity.Controls.Add(new Label { Text = company, Dock = DockStyle.Fill, AutoEllipsis = true, Font = new Font("Segoe UI", 10, FontStyle.Bold), Margin = new Padding(0) });
            identity.Controls.Add(new Label { Text = "Computador: " + Environment.MachineName, Dock = DockStyle.Fill, AutoEllipsis = true, ForeColor = Color.FromArgb(96, 104, 114), Font = new Font("Segoe UI", 9), Margin = new Padding(0) });
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(26, 16, 26, 20), ColumnCount = 1, RowCount = 12, Margin = new Padding(0), BackColor = Color.FromArgb(248, 248, 248) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.Controls.Add(new Label { Text = "Novo chamado", AutoSize = true, Font = new Font("Segoe UI", 17, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) });
            layout.Controls.Add(new Label { Text = "Conte com a nossa equipe para ajudar você.", AutoSize = true, ForeColor = Color.FromArgb(96, 104, 114), Margin = new Padding(0, 0, 0, 8) });
            AddField(layout, "Seu nome", requester); AddField(layout, "E-mail para contato (opcional)", email); AddField(layout, "Assunto", title); AddField(layout, "Descreva o problema", description);
            for (int i = 0; i < 12; i++) layout.RowStyles.Add(new RowStyle(i == 9 ? SizeType.Percent : SizeType.AutoSize, i == 9 ? 100 : 0));
            var authorization = new Label { Text = "Este computador está autorizado a abrir chamados para sua empresa. Não é necessário fazer login.", AutoSize = true, ForeColor = Color.FromArgb(79, 93, 87), Font = new Font("Segoe UI", 9), Margin = new Padding(0, 12, 0, 12) };
            layout.Controls.Add(authorization);
            layout.SizeChanged += (sender, args) => { authorization.MaximumSize = new Size(Math.Max(1, layout.ClientSize.Width - layout.Padding.Horizontal), 0); };
            submit.Font = new Font("Segoe UI", 10, FontStyle.Bold);submit.Cursor = Cursors.Hand;submit.FlatAppearance.BorderSize = 0;
            submit.FlatAppearance.MouseOverBackColor = Color.FromArgb(0, 173, 130);submit.FlatAppearance.MouseDownBackColor = Color.FromArgb(0, 145, 109);
            submit.UseVisualStyleBackColor = false;submit.Margin = new Padding(0);submit.AccessibleName = "Enviar chamado para a equipe Servitec T.I.";
            layout.Controls.Add(submit);shell.Controls.Add(header, 0, 0);shell.Controls.Add(identity, 0, 1);shell.Controls.Add(layout, 0, 2);Controls.Add(shell);
            AcceptButton = submit;
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
                            MessageBox.Show("Chamado #" + Convert.ToString(result["id"]) + " enviado para a equipe Servitec T.I.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); Close();
                        }
                    }
                } catch { MessageBox.Show("Nao foi possivel confirmar o envio. Confira a conexao e tente novamente com os mesmos dados. O sistema evita duplicar a solicitacao.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
                finally { if (!IsDisposed) { submit.Enabled = true; requester.ReadOnly = email.ReadOnly = title.ReadOnly = description.ReadOnly = false; } }
            };
        }
        private static void AddField(TableLayoutPanel panel, string caption, TextBox input) {
            panel.Controls.Add(new Label { Text = caption, AutoSize = true, Margin = new Padding(0, 8, 0, 4) });
            input.Dock = DockStyle.Fill; input.BackColor = Color.White; input.ForeColor = Color.FromArgb(31, 35, 42); input.Margin = new Padding(0, 0, 0, 3); if (!input.Multiline) { input.AutoSize = false; input.Height = 32; } input.BorderStyle = BorderStyle.FixedSingle;
            panel.Controls.Add(input);
        }
    }
}
