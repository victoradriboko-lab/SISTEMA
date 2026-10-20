"""Gera pacote de código Servitec; não inclui dados, credenciais ou dependências."""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--from-version', required=True, help='Versão instalada compatível')
parser.add_argument('--output', required=True, help='Destino servitec-update.json')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
version = manifest['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', args.from_version) or version == args.from_version:
    parser.error('Informe uma versão de origem diferente da versão do package.json')
files = []
paths = [*root.glob('*.mjs'), root / 'package.json', * (root / 'public').rglob('*'), * (root / 'agents/windows').rglob('*')]
for path in sorted(paths):
    name = path.relative_to(root).as_posix()
    if path.is_symlink():
        raise SystemExit('Link não permitido: ' + name)
    if not path.is_file() or any(part in {'bin', 'obj', 'node_modules', '__pycache__'} for part in path.relative_to(root).parts):
        continue
    if name.startswith('public/') and path.suffix not in {'.js', '.css', '.html', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'}:
        continue
    if name.startswith('agents/windows/') and path.suffix not in {'.exe', '.zip', '.config', '.ps1', '.bat', '.cs', '.csproj', '.ico', '.md', '.sha256'}:
        continue
    content = path.read_bytes()
    files.append({'path': name, 'data': base64.b64encode(content).decode('ascii'), 'sha256': hashlib.sha256(content).hexdigest()})
payload = {'format': 'servitec-update-v1', 'dataPolicy': 'preserve-additive', 'fromVersion': args.from_version, 'version': version, 'files': files}
content = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
if len(files) > 500 or len(content) > 32 * 1024 * 1024:
    raise SystemExit('Pacote excedeu o limite de arquivos ou de 32 MB')
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(content)
print(f'Pacote {args.from_version} -> {version}: {len(files)} arquivos, {len(content)} bytes. Destino: {output}')
