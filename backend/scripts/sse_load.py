"""
Prueba de carga mínima del canal SSE de OTs (HU-10, CGBIDA-352).

Abre N clientes SSE contra un servidor real, cambia el estado de M OTs y mide la latencia
PATCH -> evento recibido en cada cliente. Crea OTs de prueba y las elimina al terminar.

    uv run fastapi dev src/barb/main.py --port 9000     # en otra terminal
    uv run python scripts/sse_load.py --clients 50 --changes 10
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

import httpx

MARCA = "Test HU-10 carga"


async def listen(
    client: httpx.AsyncClient, url: str, headers: dict, sent: dict, latencies: list, ready: asyncio.Event, state: dict
):
    try:
        async with client.stream("GET", url, headers=headers, timeout=None) as resp:
            event = None
            async for line in resp.aiter_lines():
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    if event == "hello":
                        state["connected"] += 1
                        if state["connected"] == state["expected"]:
                            ready.set()
                    elif event == "ot.status_changed":
                        numero = json.loads(line[5:])["numero_ot"]
                        if numero in sent:
                            latencies.append(time.perf_counter() - sent[numero])
                    event = None
    except (httpx.HTTPError, asyncio.CancelledError):
        state["dropped"] += 1


async def main(args: argparse.Namespace) -> None:
    limits = httpx.Limits(max_connections=args.clients + 10, max_keepalive_connections=args.clients + 10)
    async with httpx.AsyncClient(base_url=args.base_url, limits=limits, timeout=30) as client:
        resp = await client.post("/api/auth/login", json={"email": args.email, "password": args.password})
        resp.raise_for_status()
        headers = {"Authorization": f"Bearer {resp.json()['token']}"}

        maquina_id = (await client.get("/api/machines", headers=headers)).json()[0]["id"]
        tecnico_id = (await client.get("/api/technicians", headers=headers)).json()[0]["id"]

        ots = []
        for i in range(args.changes):
            r = await client.post(
                "/api/work-orders",
                json={"maquina_id": maquina_id, "tecnico_id": tecnico_id, "descripcion_problema": f"{MARCA} {i}"},
                headers=headers,
            )
            r.raise_for_status()
            ots.append(r.json()["numero_ot"])

        sent: dict[str, float] = {}
        latencies: list[float] = []
        state = {"connected": 0, "expected": args.clients, "dropped": 0}
        ready = asyncio.Event()
        tasks = [
            asyncio.create_task(listen(client, "/api/work-orders/stream", headers, sent, latencies, ready, state))
            for _ in range(args.clients)
        ]
        try:
            await asyncio.wait_for(ready.wait(), timeout=30)
            for numero in ots:
                sent[numero] = time.perf_counter()
                r = await client.patch(f"/api/work-orders/{numero}/status", json={"status": "in_progress"}, headers=headers)
                r.raise_for_status()
                await asyncio.sleep(0.05)
            await asyncio.sleep(2)  # margen para que lleguen los últimos eventos
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for numero in ots:
                await client.delete(f"/api/work-orders/{numero}", headers=headers)

    esperados = args.clients * args.changes
    print(f"clientes conectados : {state['connected']}/{args.clients}  (caídos: {state['dropped']})")
    print(f"eventos recibidos   : {len(latencies)}/{esperados}")
    if latencies:
        ordered = sorted(latencies)
        p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
        p50 = statistics.median(ordered)
        print(f"latencia p50 / p95 / max: {p50 * 1000:.0f} / {p95 * 1000:.0f} / {ordered[-1] * 1000:.0f} ms")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:9000")
    parser.add_argument("--clients", type=int, default=50)
    parser.add_argument("--changes", type=int, default=10)
    parser.add_argument("--email", default="admin@barb.com")
    parser.add_argument("--password", default="admin123")
    asyncio.run(main(parser.parse_args()))
