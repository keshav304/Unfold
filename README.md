# Argus — AI Shadow Audit

An observability product that measures the relationship between AI shopping agents
and a retailer, and outputs **one score plus a ranked, evidence-backed fix list**.

It answers three questions, and the console has a page for each:

1. **OUTBOUND — what do agents say?** Fire realistic shopping prompts at three
   model slots, 5 runs each. Measure presence, rank, whether the claims are TRUE
   against verified data, and which competitor displaced us on which claim.
2. **INBOUND — can agents actually shop?** Replay complete agent journeys against
   a mock transaction platform and find where they silently fail (a tier that can
   browse but never check out; member prices never applied).
3. **INTEGRITY — is the retailer's own assistant honest?** Run the same missions
   with sponsorship weighting ON vs OFF and measure whether paid placement changes
   recommendations and whether the customer pays more.

**Everything runs against a synthetic retailer we built ourselves**, with defects
planted on purpose. That is what makes every finding provable: we hold the ground
truth. LLMs only role-play shopping agents — **all scoring, verification, journey
logic and optimisation is deterministic application code.**

---

## Quick start (inside the company environment)

**First time running this? Open `RUNBOOK.md`** — it is the ordered checklist of what
is left to do now that Vertex, node_modules and PostgreSQL are available, including
the two blockers that must be cleared before the app can boot.

```bash
cp .env.example .env         # then fill in GCP_PROJECT / DB_* (never commit .env)
./setup.sh                   # conda envs + npm installs (uses Artifactory)
make up                      # node + fastapi + react + nginx
make seed                    # synthetic estate + deterministic fixtures
make demo                    # reseed, cache the three acts, launch in demo mode
```

Open **`http://localhost:8080/argus/`** — the console is served through nginx at
the proxy path. `localhost:3000` works too but is *not* the deployment path: always
verify through the proxy.

### The `make` targets

| Command | What it does |
|---|---|
| `make up` | `./launch-app dev` — the template's own run model |
| `make down` | stops the four processes |
| `make health` | `./check-health.sh` — all processes plus the nginx route |
| `make test` | `pytest` (backend) + `npm test` (frontend) |
| `make verify` | health + tests + `npm run build` |
| `make seed` | rebuild the synthetic estate from `SEED=42`, idempotent |
| `make demo` | reseed + cached three-act playback, zero live LLM calls |
| `make probe` | environment probe → `PROBE_REPORT.md` |
| `make bakeoff` | model bake-off → `reports/bakeoff.md` |

---

## Architecture

The template's process split is kept exactly as intended — nginx fronts a React
app, a Node pass-through and a FastAPI service:

```
browser → nginx :8080
    <PROXY_PATH>/                    → CRA        :3000   UI
    <PROXY_PATH>/api/                → node-proxy :3001   health, config, pass-through
    <PROXY_PATH>/fastapi/            → FastAPI    :9000   the console API
    <PROXY_PATH>/proxy/absolute/9000/→ FastAPI    :9000   Wharf compat router
```

All console calls go to `<PROXY_PATH>/fastapi/api/...`. The frontend reads its base
path from `REACT_APP_PROXY_PATH`; **no leading-slash URL is ever hardcoded.**

```text
Backend (python-fastapi/)
  app/estate/     synthetic retailer, planted defects, feed, personas
  app/mockapi/    the retailer's platform: catalog/cart/checkout/orders + telemetry
  app/ai/         three model slots, structured outputs, cache, simulated fixtures
  app/sensors/    S1 grid · S2 feed auditor · S3 funnel · S4 loyalty · S5 integrity
  app/journeys/   deterministic 8-step journey state machines (Penny/Dee/Nia)
  app/scoring/    ARIS · stats/CIs · fix list · impact · value-optimal baseline
  app/api/        the console API (SPEC §4.4)
  app/audit.py    one audit cycle: estate → sensors → ARIS → fix list
  scripts/        probe_env.py · bakeoff.py · prepare_demo.py

Frontend (react-frontend/) — CRA + TypeScript + Tailwind
  src/pages/      Command Center · Findings · Outbound Explorer · Journey Replay
                  · Integrity Report · Demo Mode · Models & Cache
  src/lib/        typed API client, types mirroring the OpenAPI schemas
  src/components/ panels, CIs, hand-rolled SVG charts
```

### Database

**PostgreSQL only** (SPEC §2). `DATABASE_URL` is assembled at runtime from
`SHORTCODE` / `DB_USER` / `DB_POSTGRES` / `CUSTOM_DB_INSTANCE` / `GCP_PROJECT` plus
a Secret Manager lookup for the password — the Aeris pattern. There is **no SQLite
fallback** in the product or in the tests. Schema is created with SQLModel
`create_all` (no migrations) and reseeded by `make seed`.

---

## Configuration

`.env.example` is the source of truth for variable names; `.env` is gitignored.
Nothing in the code hardcodes a model name, key, project ID or database URL.

Key variables:

```env
SVC_PROXY_PATH=/argus          APP_PORT=9000   BACKEND_PORT=3001   FRONTEND_PORT=3000
GCP_PROJECT=your-gcp-project-id                 # placeholder only
REGION=us-central1
AI_PROVIDER=vertex
GEMINI_MODEL_1=…  GEMINI_MODEL_2=…  GEMINI_MODEL_3=…   # frozen by the bake-off
RUNS_PER_PROMPT=5              SIMULATED_AGENT_MODE=true   DEMO_MODE=false
SEED=42                        PROMPT_VERSION=v1
SHORTCODE=argus  DB_USER=  DB_POSTGRES=  CUSTOM_DB_INSTANCE=
HTTPS_PROXY=  HTTP_PROXY=  NO_PROXY=localhost,127.0.0.1,0.0.0.0
REACT_APP_PROXY_PATH=/argus    REACT_APP_API_BASE=/argus/fastapi
```

**Proxy rule:** outbound AI traffic honours `HTTPS_PROXY`; all internal traffic
(journey engine → mock platform, webhook self-calls, tests) is loopback and must
bypass it via `NO_PROXY`. This is asserted by a test, not by convention.

**Secrets:** ADC only. No API keys, no service-account files, no GCP project IDs
committed anywhere.

---

## Model slots

Three env-driven slots, and the slot order **is** the fallback chain:

```
slot 1 → slot 2 → slot 3 → simulated mode
```

Every response is validated against the `AgentAnswer` Pydantic schema, cached by
`sha256(model + prompt + temperature + prompt_version)`, and retried with backoff
before falling back. `SIMULATED_AGENT_MODE=true` (the default) serves deterministic
canned answers and makes **no API call at all** — that is the demo safety net and
the development default.

`make bakeoff` decides the authoritative trio; `make probe` reports what the
environment allows. Both write honest, committed reports.

---

## Testing

```bash
make test        # everything
pytest -k proxy  # the NO_PROXY bypass assertion
```

96 backend tests cover the deterministic core: exact defect counts, resolver
accuracy on the 30-pair gold set, fidelity maths including both planted claim
cases, ARIS aggregation and banding, the gate override, the journey state machine,
the baseline optimiser, cache keys, the retry→fallback→simulated chain, mock-API
security, and the whole console API through a real ASGI client.

Database-backed behaviour is marked `db` and skipped unless `ARGUS_TEST_DATABASE_URL`
is exported, so the suite is honest about what it verified.

---

## Documentation

| File | Purpose |
|---|---|
| `RUNBOOK.md` | **start here to run it** — ordered checklist to go from code-complete to running in the company environment, including the two known blockers to clear first |
| `SPEC.md`, `PLAN.md` | the product contract and the build order |
| `METHOD.md` | how every displayed number is produced, incl. the honest model-lineage statement |
| `DEMO_SCRIPT.md` | the three acts, beat by beat, with per-beat fallbacks |
| `PROBE_REPORT.md` | what the environment allows (and what remains unprobed) |
| `reports/bakeoff.md` | the model bake-off table and the frozen trio |
| `progress.md` | implementation status, decisions, known gaps, handoff notes |

## Out of scope (frozen)

No 3D/Three.js · no Next.js · no authentication or multi-user · no real retailer or
client data · no second AI gateway (OpenRouter is a future option only) · no Model
Garden endpoint deployments · no live LLM calls during the demo · no journey
scripts beyond Penny/Dee/Nia.
