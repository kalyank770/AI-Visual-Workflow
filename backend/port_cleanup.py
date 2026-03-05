#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import re
import subprocess
from typing import Iterable


def _listening_pids_windows(port: int) -> set[int]:
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return set()

    if result.returncode != 0 or not result.stdout:
        return set()

    pids: set[int] = set()
    for line in result.stdout.splitlines():
        if "LISTENING" not in line.upper():
            continue

        columns = re.split(r"\s+", line.strip())
        if len(columns) < 5:
            continue

        local_addr = columns[1]
        pid_str = columns[-1]

        if not local_addr.endswith(f":{port}"):
            continue

        try:
            pid = int(pid_str)
        except ValueError:
            continue

        if pid > 0 and pid != os.getpid():
            pids.add(pid)

    return pids


def _kill_pid_windows(pid: int) -> bool:
    result = subprocess.run(
        ["taskkill", "/PID", str(pid), "/F"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def cleanup_ports(ports: Iterable[int]) -> None:
    system = platform.system().lower()

    if "windows" not in system:
        print("[prestart] Port cleanup skipped (non-Windows platform).")
        return

    for port in ports:
        pids = _listening_pids_windows(port)
        if not pids:
            print(f"[prestart] Port {port} is free.")
            continue

        print(f"[prestart] Port {port} in use by PID(s): {sorted(pids)}. Releasing...")
        for pid in sorted(pids):
            ok = _kill_pid_windows(pid)
            if ok:
                print(f"[prestart] Killed PID {pid} on port {port}.")
            else:
                print(f"[prestart] Failed to kill PID {pid} on port {port}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Free stale listening ports before startup")
    parser.add_argument("--ports", nargs="+", type=int, required=True, help="Ports to free")
    args = parser.parse_args()
    cleanup_ports(args.ports)


if __name__ == "__main__":
    main()
