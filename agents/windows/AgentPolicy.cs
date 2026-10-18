using System;
using System.Net;

namespace Servitec {
    public static class AgentPolicy {
        public const string Version = "1.0.0";
        public static bool PrivateHttp(Uri uri) {
            IPAddress ip;
            if (!IPAddress.TryParse(uri.Host, out ip)) return false;
            if (IPAddress.IsLoopback(ip)) return true;
            byte[] b = ip.GetAddressBytes();
            return b.Length == 4 && (b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168));
        }
        public static Uri ServerUri(string value, bool allowLan) {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment) || uri.AbsolutePath != "/") throw new ArgumentException("URL deve conter apenas protocolo, servidor e porta.");
            if (uri.Scheme != "https" && !(uri.Scheme == "http" && allowLan && PrivateHttp(uri))) throw new ArgumentException("Use HTTPS, ou HTTP explicitamente permitido para IP privado da LAN.");
            return uri;
        }
    }
}
