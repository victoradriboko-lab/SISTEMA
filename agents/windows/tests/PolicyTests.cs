using System;
using Servitec;
class PolicyTests {
    static void Main() {
        int count = 0;
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
