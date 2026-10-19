using System;
using Servitec;
class PolicyTests {
    static void Main() {
        int count = 0;
        if (AgentPolicy.NetworkSpeedMbps(1000000000) != 1000 || AgentPolicy.NetworkSpeedMbps(18446744073709551615d) != null || AgentPolicy.NetworkSpeedMbps(-1) != null || AgentPolicy.NetworkSpeedMbps(null) != null) throw new Exception("Velocidade desconhecida deve ser nula"); count += 4;
        string secret = "aB3dE5gH7j"; string safe = AgentPolicy.SafeDiagnostic("Erro " + secret + "\r\nBearer outraChave",secret);
        if (safe.Contains(secret) || safe.Contains("outraChave") || safe.Contains("\r") || safe.Contains("\n") || AgentPolicy.SafeDiagnostic(new string('x',500),secret).Length != 400) throw new Exception("Diagnostico deve ocultar tokens e limitar tamanho"); count++;
        foreach (string token in new [] { "aB3dE5gH7j", new string('a',64) }) { if (!AgentPolicy.ValidAgentToken(token)) throw new Exception("Token valido rejeitado"); count++; }
        foreach (string token in new [] { "123456789", "12345678901", "12345_7890", "ABCDEFGHIJ\n" }) { if (AgentPolicy.ValidAgentToken(token)) throw new Exception("Token invalido aceito"); count++; }
        foreach (string url in new [] { "https://servidor.example", "https://servidor.example:443/", "http://127.0.0.1:3000", "http://192.168.1.10:3000", "http://10.0.0.2:3000", "http://172.16.2.3:3000", "http://172.31.255.254:3000" }) { AgentPolicy.ServerUri(url,true); count++; }
        foreach (string url in new [] { "http://servidor.example", "http://8.8.8.8", "http://172.32.0.1", "http://192.169.0.1", "https://user:pass@servidor.example", "https://servidor.example/other", "https://servidor.example/?token=test", "https://servidor.example/#fragment", "file:///tmp/data", "not a url" }) {
            bool rejected = false; try { AgentPolicy.ServerUri(url,true); } catch (ArgumentException) { rejected = true; }
            if (!rejected) throw new Exception("URL insegura aceita: " + url); count++;
        }
        foreach (string url in new [] { "http://vsuarez.ddns.net", "http://vsuarez.ddns.net:3000", "http://8.8.8.8" }) { AgentPolicy.ServerUri(url,false,true); count++; }
        foreach (string url in new [] { "http://user:pass@vsuarez.ddns.net", "http://vsuarez.ddns.net/path", "http://vsuarez.ddns.net/?token=secret", "file:///tmp/test" }) {
            bool rejected = false; try { AgentPolicy.ServerUri(url,false,true); } catch (ArgumentException) { rejected = true; }
            if (!rejected) throw new Exception("Destino invalido aceito no modo HTTP externo: " + url); count++;
        }
        bool blocked = false; try { AgentPolicy.ServerUri("http://192.168.1.10:3000",false); } catch (ArgumentException) { blocked = true; }
        if (!blocked) throw new Exception("HTTP aceito sem consentimento"); count++;
        Console.WriteLine(count + " verificacoes de politica de conexao passaram.");
    }
}
