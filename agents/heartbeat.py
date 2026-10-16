"""Agente inicial de telemetria Linux. Sem execução remota de comandos."""
import json
import os
import platform
import shutil
import time
import urllib.request

url = os.environ.get('SISTEMA_URL', 'http://127.0.0.1:3000').rstrip('/')
token = os.environ['SISTEMA_AGENT_TOKEN']
if not url.startswith('https://') and not url.startswith('http://127.0.0.1:'):
    raise SystemExit('Use HTTPS para enviar o token fora da máquina local.')
while True:
    disk = shutil.disk_usage('/')
    metrics = {'os': platform.platform(), 'cpu': os.getloadavg()[0],
               'disk': {'total': disk.total, 'used': disk.used}}
    try:
        request = urllib.request.Request(url + '/api/heartbeat', data=json.dumps(metrics).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(request, timeout=15) as response:
            print('Telemetria enviada:', response.status, flush=True)
    except Exception as error:
        print('Falha de comunicação:', type(error).__name__, flush=True)
    time.sleep(60)
