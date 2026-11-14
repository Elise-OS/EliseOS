import importlib.util
import json
import os
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('elise-health-agent.py')

def load_agent(monkeypatch, tmp_path):
    proc = tmp_path / 'proc'; sysroot = tmp_path / 'sys'; bin_dir = tmp_path / 'bin'
    (proc).mkdir(); (sysroot / 'class/thermal/thermal_zone0').mkdir(parents=True); bin_dir.mkdir()
    (proc / 'meminfo').write_text('MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 100 kB\nSwapFree: 50 kB\n')
    (proc / 'uptime').write_text('12.5 9.2\n'); (proc / 'loadavg').write_text('0.1 0.2 0.3 1/2 42\n')
    (sysroot / 'class/thermal/thermal_zone0/temp').write_text('68000')
    docker = bin_dir / 'docker'
    docker.write_text('#!/bin/sh\nif [ "$1" = ps ]; then echo container-id; else echo \'[{"Name":"/api","RestartCount":0,"State":{"Status":"running","OOMKilled":false,"Health":{"Status":"healthy"}}}]\'; fi\n')
    docker.chmod(0o755)
    (bin_dir / 'journalctl').write_text('#!/bin/sh\nexit 0\n')
    (bin_dir / 'journalctl').chmod(0o755)
    monkeypatch.setenv('PROC_ROOT', str(proc)); monkeypatch.setenv('SYS_ROOT', str(sysroot)); monkeypatch.setenv('PATH', f'{bin_dir}:{os.environ["PATH"]}')
    monkeypatch.setenv('ELISE_BACKUP_META', str(tmp_path / 'last.json'))
    spec = importlib.util.spec_from_file_location('elise_health_agent', MODULE_PATH)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

def test_reads_fake_proc_sys_and_docker(monkeypatch, tmp_path):
    agent = load_agent(monkeypatch, tmp_path)
    result = agent.status()
    assert result['memory']['MemTotal'] == 1024000
    assert result['temperatureC'] == [68.0]
    assert result['containers'][0]['name'] == 'api'
    assert result['diskErrors'] == {'count': 0, 'recent': []}
    assert result['backup']['last'] is None
