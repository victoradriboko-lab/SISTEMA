"""Empacota um executavel previamente compilado; nao inclui tokens ou config local."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import sys

root = Path(__file__).resolve().parent.parent
source = root / 'agents/windows'
binary = Path(sys.argv[1]) if len(sys.argv) > 1 else source / 'bin/Release/net462/ServitecAgent.exe'
executable = binary.read_bytes()
if not executable.startswith(b'MZ'):
    raise SystemExit('O arquivo nao e um executavel Windows.')
files = {name: (source / name).read_bytes() for name in [
    'instalar-agente.bat', 'instalar-agente.ps1', 'desinstalar-agente.bat',
    'desinstalar-agente.ps1', 'ServitecAgent.exe.config', 'README.md',
    'ServitecAgent.cs', 'AgentPolicy.cs', 'ServitecAgent.csproj',
]}
files['ServitecAgent.exe'] = executable
files['ServitecAgent.sha256'] = (hashlib.sha256(executable).hexdigest() + '\n').encode('ascii')
archive = source / 'servitec-agent-windows.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as package:
    for name, content in sorted(files.items()):
        if name.endswith(('.ps1', '.bat')):
            content = content.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        package.writestr(info, content)
with ZipFile(archive) as package:
    assert package.testzip() is None
    assert package.read('ServitecAgent.sha256').decode().strip() == hashlib.sha256(package.read('ServitecAgent.exe')).hexdigest()
print('Pacote gerado e validado:', archive.name, '-', len(files), 'arquivos')
