import subprocess, statistics, json, sys
HOSTS = {"hf": "https://huggingface.co", "holo": "https://gethologram.ai"}
REPO = "openai-community/gpt2"
CASES = [
 ("HEAD resolve config.json", "-I", "/{r}/resolve/main/config.json"),
 ("HEAD resolve model.safetensors", "-I", "/{r}/resolve/main/model.safetensors"),
 ("GET api/models/{repo}", "", "/api/models/{r}"),
 ("GET api tree main", "", "/api/models/{r}/tree/main"),
 ("GET api/models?search", "", "/api/models?search=gpt2&limit=5"),
]
N = 30
def pct(xs, p):
    xs = sorted(xs); k = min(len(xs)-1, int(round(p*(len(xs)-1)))); return xs[k]
out = []
for hn, base in HOSTS.items():
    for name, flag, path in CASES:
        url = base + path.format(r=REPO)
        # warm: one process, N+1 requests on one connection; drop the first (handshake)
        cmd = ["curl", "-s", "-o", "NUL", "-w", "%{http_code} %{time_starttransfer} %{time_total} %{size_download}\n"]
        if flag: cmd.append(flag)
        args = []
        for i in range(N+1):
            if i: args.append("--next"); args += ["-s", "-o", "NUL", "-w", "%{http_code} %{time_starttransfer} %{time_total} %{size_download}\n"] + ([flag] if flag else [])
            args.append(url)
        r = subprocess.run(cmd + args, capture_output=True, text=True)
        rows = [l.split() for l in r.stdout.strip().splitlines()]
        codes = sorted(set(x[0] for x in rows))
        cold = float(rows[0][2])*1000
        warm = [float(x[2])*1000 for x in rows[1:]]
        size = rows[-1][3]
        out.append(dict(host=hn, case=name, codes=codes, cold_ms=round(cold,1), p50=round(statistics.median(warm),1), p90=round(pct(warm,.9),1), p99=round(pct(warm,.99),1), bytes=size))
        print(out[-1], flush=True)
json.dump(out, open("baseline.json","w"), indent=1)
