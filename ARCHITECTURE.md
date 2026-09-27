# ARCHITECTURE.md — how Argus actually works

**As of M7.5 (post-`feat(M7.5): sidebar + polish pass`).** Every claim in this
document was derived by reading the files it names. Where a document in the repo
and the code disagree, **the code wins** and the disagreement is listed in
[§8](#8-known-divergences--errata).

This is both a learning document and a reference. If you are not a professional
developer, read §1 and §5 first. If you are looking for a specific function,
§3 (backend) and §4 (frontend) are the reference half.

**How to read a claim in here.** Whenever this document says something is
"deterministic", "honest", "enforced", "structural" or "pinned by a test", it
names the file, the function, or the test. If a sentence here has no such
anchor, treat it as orientation, not as a fact about the system.

---

## Table of contents

1. [The product in one page](#1-the-product-in-one-page)
2. [Bird's-eye architecture](#2-birds-eye-architecture)
3. [The backend, layer by layer](#3-the-backend-layer-by-layer)
4. [The frontend, layer by layer](#4-the-frontend-layer-by-layer)
5. [The data lifecycle — one claim, end to end](#5-the-data-lifecycle--one-claim-end-to-end)
6. [The safety & honesty map](#6-the-safety--honesty-map)
7. [Operational runbook pointers](#7-operational-runbook-pointers)
8. [Known divergences & errata](#8-known-divergences--errata)
9. [Glossary](#9-glossary)

---

## 1. The product in one page

### 1.1 What Argus does

Argus answers one question: **when you ask a public AI assistant a shopping
question, what does it say about your brand — and can you prove it?**

The product is a **loop**, and the loop is the product. Each stage is a real
screen in the console:

```
  MEASURE      01  Frozen prompt pack  -->  12 missions, immutable
               02  The model x N runs   -->  one model, 10 runs per mission
                    REPORT                03  Verbatim transcripts stored
                    SURFACE CLAIMS        04  Deterministic extraction
                    VERIFY                05  A human records a verdict
                    ACT                   06  Verified Report: what to fix
               -->  RE-MEASURE   the next audit, same frozen instrument
```

The three steps at the top are the **instrument**. Everything below it is
deterministic code reading what the instrument produced.

### 1.2 What is real and what is simulated

This is the single most important thing to understand, and the console labels it
on every screen. There are **two different things** called "simulated", and
conflating them is the mistake the labelling exists to prevent.

| | What it is | Where it shows |
|---|---|---|
| **The live DeepSeek instrument on Ocado** | A real model, real paid HTTP calls, `source="live"` on every stored answer | `answers.source = "live"`; badges read `deepseek:key` |
| **The simulated fixture target** | A fictional brand whose answers are authored fixtures in `data/fixtures/answers/simulated_answers.json`. `retailers.is_real = false` | Badged `simulated fixture` in the target chip; `answers.source = "simulated"` |
| **The simulated leg of the chain** | The *last* fallback when live and cache both fail, for a non-real target | `answers.source = "simulated"` |

The honest answer to "is this real?" is therefore read **off the row**, not off
a global setting. `answers.source` is `live | cache | simulated` and every one of
those values is written by the runner at the moment the answer is stored
(`app/ai/runner.py`, `Runner.run()`).

The currently deployed data (`CURRENT_STATE.md`) is: Ocado, target 3014, active,
audits **#711 / #712**, 146 live answers each, 480 claims, 5 verdicts stamped
`demo operator (simulated review)`.

### 1.3 The frozen-instrument concept

An **instrument** is the thing that produced a measurement. Argus freezes five
parts of it, and they are frozen *together*:

| Part | Where it is pinned | Why frozen |
|---|---|---|
| **Prompt pack version** | `prompt_packs.version` + `audits.pack_version` | A different set of questions is a different measurement. `add_mission` raises `PackFrozenError` on a frozen pack (`app/packs/service.py`). |
| **Model snapshot** | `answers.model` / `answers.model_version` on **every answer row** | The number characterises what *this* model says. Amendment A: one model per audit, never compared in-product. |
| **Temperature** | `.env` `GEMINI_TEMPERATURE=0.3`, carried into every `llm_cache` key and every answer's lineage | Removing the pin reverts to provider-default sampling, which invalidates the validation evidence and *raises* variance. |
| **Reasoning default** | `.env` `DEEPSEEK_THINKING` (empty = provider default = reasoning ON) | Measured: disabling reasoning cut latency 8.9 s -> 2.2 s but dropped self-agreement 69.9% -> 58.8%. Wall clock is the cheap axis; self-agreement is the expensive one. |
| **Geography scope** | `audits.geo_scope` / `audits.geo_value` (Amendment I) | A UK-market question and a Manchester question are different questions. |

**Why each is frozen: the same instrument over time is the only thing that makes
a diff meaningful.** A "movement" between two audits is only a statement about
the market if the questions, the model, the sampling and the geography were held
constant. Change any one and you have a different experiment.

This is enforced, not promised. `app/scoring/diff.py::AuditFingerprint.mismatch_reason`
compares `target_id`, `pack_version`, `geo_scope`/`geo_value` and the
`model_versions` set, and `assert_comparable` raises `NotComparable` if any
differ. The API turns that into **HTTP 409** (`app/api/router.py::diff_audits`),
and the UI renders the existing `hd-banner`. Pinned by
`tests/scoring/test_diff.py::test_a_different_prompt_pack_blocks_the_comparison`,
`::test_a_different_model_blocks_the_comparison`,
`::test_a_different_target_blocks_the_comparison`, and
`tests/test_geo_scopes.py::test_a_cross_scope_diff_is_blocked_with_the_existing_banner`.

---

## 2. Bird's-eye architecture

### 2.1 The four processes in the local profile

The **local** profile is what `make dev` starts. There is no nginx and no
corporate proxy.

```
   +------------------+        fetch()         +--------------------------+
   |  Browser         | ---------------------> |  React dev server :3000  |
   |  (CRA + TS)      | <--------------------- |  (npm start)             |
   +------------------+   JSON over HTTP/CORS  +--------------------------+
                                        |
                                        |  REACT_APP_API_BASE=http://localhost:9000
                                        v
                            +--------------------------+
                            |  FastAPI :9000           |
                            |  (uvicorn --reload)      |
                            |   app/main.py            |
                            +-----------+--------------+
                                        | SQLModel + SQLAlchemy
                                        v
                            +--------------------------+
                            |  PostgreSQL              |
                            |  (local instance)        |
                            |  search_path=argus_dev   |
                            +--------------------------+

   +------------------+
   |  node proxy :3001|  OPTIONAL in local; off by default.
   |  (server/index.js)|  Only needed by the company path.
   +------------------+
```

Source of truth for the ports: `core/config.py` fields `app_port` (9000),
`frontend_port` (3000), `backend_port` (3001), `nginx_port` (8080). The launcher
is `scripts/dev.sh`; `make dev` / `make dev-stop` / `make dev-backend` /
`make dev-frontend` / `make dev-proxy` are the entry points (`Makefile`).

### 2.2 The company profile

Identical product logic; three things change.

```
   Browser --> nginx :8080  --> <SVC_PROXY_PATH>/fastapi/...  --> FastAPI :9000
                 |  (same-origin; CRA assets under /static/)
                 |  SVC_PROXY_PATH=/argus
                 v
        +---------------------------------------------+
        |  DATABASE_URL ASSEMBLY (app/db.py)         |
        |  SHORTCODE, DB_USER, DB_POSTGRES,          |
        |  CUSTOM_DB_INSTANCE, GCP_PROJECT            |
        |      -> Secret Manager: {INSTANCE}_{USER}    |
        |      -> postgresql://user:pass@host:5432/db  |
        +---------------------------------------------+
                 |
                 v
        Vertex AI / ADC  (GOOGLE_GENAI_USE_VERTEXAI=True)
        Gemini via the Vertex OpenAI-compatible endpoint
```

1. **Process model**: `./launch-app dev` (via `make up`) starts four processes
   plus nginx. `AppConfig.route_prefix` = `{svc_proxy_path}/proxy/absolute/{app_port}`,
   and `frontend_api_base` = `{svc_proxy_path}/fastapi`.
2. **DB resolution**: `app/db.py::build_database_url` runs the Aeris assembly
   (GCP Secret Manager) instead of using `DATABASE_URL` verbatim. Gated on
   `config.is_local`.
3. **LLM auth**: `llm_auth_mode == "adc"`. `_export_vertex_env` sets
   `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI`.

### 2.3 The profile system (Amendment G)

`ARGUS_PROFILE` is one environment variable with two legal values: `local`
(default) and `company`. It is read by `AppConfig.argus_profile` /
`is_local` / `is_company` (`core/config.py`).

**What the profile DOES change — all of it wiring:**

| It changes | Where |
|---|---|
| Database resolution (`direct` vs `aeris`) | `app/db.py::build_database_url`, `AppConfig.db_mode` |
| LLM auth mode (`deepseek:key` / `gemini:key` / `adc` / `simulated_only`) | `AppConfig.llm_auth_mode` |
| Whether the Vertex env exports happen at all | `AppConfig._export_vertex_env` |
| Process model (dev server + direct CORS vs nginx + proxy path) | `scripts/dev.sh` vs `launch-app`; `AppConfig.cors_origins` |
| Which client object is constructed | `core/clients/client_factory.py::ClientFactory.create_llm_client` |

**What the profile must NEVER change:**

* **Product logic.** The scoring, extraction, classification and diff functions
  are byte-identical in both profiles. They never read `argus_profile`.
* **Honesty rules.** The confirm gate, the operator gate, the real-target
  fixture refusal, the no-claim-without-quote rule, the structural explore
  exclusion — none of them is conditional on the profile.
* **Source labels.** `answers.source in {live, cache, simulated}` in both
  profiles. `llm_auth_mode` is *about how we authenticate to a model*, never
  about whether a model is called; that stays `SIMULATED_AGENT_MODE`.

This is why `llm_auth_mode` is *provider-qualified* (`deepseek:key`, not
`api_key`): the docstring in `core/config.py` says the badge must name WHICH
assistant produced the stored answers, because "api_key" alone would not.

### 2.4 A full request lifecycle

This is the click path from the browser to a rendered number. Every arrow is a
real handoff.

```
 1. BROWSER CLICK      User clicks a tile on /visibility
 2. REACT EVENT        VisibilityReport.tsx setDrill(metricKey)
 3. FETCH              useApi(() => api.overview())  ->  axios GET
                       lib/api.ts: API_BASE = REACT_APP_API_BASE
                       = http://localhost:9000/fastapi  (local)
                       = /argus/fastapi               (company)
 4. FASTAPI ROUTE      application.get("/api/overview")
                       app/main.py mounts console_router at prefix "/api"
 5. SERVICE LAYER      app/api/router.py::overview()
                       resolves the ACTIVE target, the newest non-
                       exploratory audit, reads stored Metric rows
 6. PURE SCORING       (already done at M5) the numbers are READ, not
                       recomputed. metrics rows were written by
                       app/scoring/service.py::compute_audit_metrics
 7. SQLMODEL           session_scope() -> SELECT ... FROM metrics
                       WHERE audit_id = ? AND scope = 'headline'
 8. POSTGRESQL         returns rows
 9. JSON RESPONSE      _lineage(audit) is attached: pack_version,
                       model_versions, geo_badge, mode, lineage_sentence
10. REACT RENDER       asCI(headline.mention_rate) -> <HeadlineTile>
                       -> <CIChart ci={...}>  (components/charts.tsx)
```

The important property of stage 6: **the read path contains no scoring.** Every
number the console shows was computed once, by a pure function, and written to
the `metrics` table. That is what makes the number in Buddy's chat and the number
on the Visibility Report the *same number by construction* rather than two
implementations that happen to agree (§4.3, §6).

---

## 3. The backend, layer by layer

Layout on disk:

```
python-fastapi/
  core/            config + model clients (wiring, no product logic)
  app/
    main.py        app factory, CORS, /health
    lifespan.py    DB readiness, fail-soft
    db.py          URL assembly, engine, session
    models/        SQLModel tables
    domain.py      frozen constants (CURRENCY, CI_LEVEL)
    geo.py         geography scopes
    operator.py    the operator gate
    correlation.py X-Correlation-ID (template keep)
    audit.py       THE COMPOSITION ROOT
    ai/            schemas, cache, runner, simulated, latency
    extract/       normalize, attribution, classifier, cluster, pipeline
    scoring/       stats, metrics, diff, service
    packs/         linter, service
    buddy/         router, answers
    api/           router, facts, service
    seed/          run_seed
    persistence.py seeder machinery
  scripts/         probe_env, validate_model, seed_demo_audits, ...
  tests/           ~394 tests
```

### 3.1 `core/config.py` — one source of runtime truth

**What it is.** A `pydantic-settings` `BaseSettings` subclass, `AppConfig`,
plus a process-wide singleton `get_settings()` (memoised with
`@lru_cache(maxsize=1)`). Every environment-driven value in the product is a
field here, read through this object and nowhere else.

`model_config` reads `.env` from `REPO_ROOT` if it exists, with
`extra="ignore"` and `case_sensitive=False`.

**The profile switch.** `argus_profile: str = Field(default="local", alias="ARGUS_PROFILE")`,
with `is_local` / `is_company` as derived properties. `is_local` is
`argus_profile != "company"` — anything unrecognised is local, dev-first.

**The Vertex-export side effect — the gotcha.** `model_post_init` calls
`_export_vertex_env()`. In the **company** profile it sets
`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` and
`GOOGLE_GENAI_USE_VERTEXAI=True` into `os.environ` — a contract
`core/clients/gemini_client.py::_verify_vertex_ai_setup` hard-requires.

In the **local** profile it must NOT. If `GOOGLE_GENAI_USE_VERTEXAI` is set
locally, the `google-genai` SDK attempts Vertex/ADC auth and **silently ignores
`GEMINI_API_KEY`**. The local branch therefore does
`os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)` — defensively, so a stale
value from a company-to-local switch in the same shell cannot survive. This is
the single most likely bug in the profile design and it is pinned by
`tests/test_profiles.py::test_gotcha_local_with_api_key_does_not_export_vertexai`
and `::test_company_profile_exports_vertex_env_exactly_as_today`.

A second side effect, `_export_proxy_env`, maps `SECURECOMMS_PROXY` onto
`HTTP_PROXY` / `HTTPS_PROXY` and guarantees `NO_PROXY` contains the loopback
entries plus `169.254.169.254` (the GCP metadata server, needed for Secret
Manager). See `REQUIRED_NO_PROXY_TOKENS` and `effective_no_proxy`. Pinned by
`tests/test_config_proxy.py::test_internal_localhost_traffic_bypasses_the_corporate_proxy`,
`::test_noproxy_is_extended_when_it_misses_loopback`,
`::test_explicit_https_proxy_is_not_overwritten_by_securecomms`.

**Model slots and reserves.** `gemini_model_1` / `_2` / `_3` (env
`GEMINI_MODEL_1..3`). The `model_slots` property dedupes, drops blanks, and
falls back to `[gemini_default_model]`. Slots 2 and 3 default to `""` — they are
**unconfigured reserves**. Amendment A: resolving them is configuration, not
code, and an unconfigured slot must never raise at boot. Pinned by
`tests/test_config_proxy.py::test_single_model_operation_with_unconfigured_reserves`
and `::test_resolving_reserve_slots_is_config_not_code`.

`DEFAULT_MODEL_LADDER` is `("gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro")`.
The comment records *why* slot 1 is what it is: `gemini-2.5-flash-lite` was
measured on 2026-09-26 to 404 "no longer available to new users"; a single live
call to `gemini-3.5-flash-lite` returned a schema-valid `AgentAnswer`
(JSON-valid 100%, schema-pass 100%, 2.7 s). The full validation table is still
owed at M10.

**The resolved triple — the actual instrument.** Three properties answer "what
would this profile really call":

```python
llm_provider   -> "deepseek" if AI_PROVIDER == "deepseek" else "gemini"
resolved_model -> deepseek_model if llm_provider == "deepseek" else model_slots[0]
llm_auth_mode  -> "adc" if is_company
                  "simulated_only" if not llm_api_key.strip()
                  f"{llm_provider}:key" otherwise
db_mode        -> "aeris" if is_company else "direct"
```

`db_mode` and `llm_auth_mode` are both reported by `/health`.

Other fields worth knowing: `runs_per_prompt` (10), `runs_probe` (2),
`rpm_budget` (300 default; the Gemini free tier's measured cap is 15),
`cost_per_call_low` / `cost_per_call_high` (**None by default** — the spec
forbids a hardcoded price, so the card prints no money figure and says why),
`llm_concurrency` (1; a wall-clock lever only), `simulated_agent_mode` (True),
`operator_password` / `op_password` (the alias, §3.9).

### 3.2 `core/clients/` — providers are wiring

The design statement is in `openai_compat_client.py`'s module docstring:
*"Providers are WIRING. The instrument is the resolved
(profile -> provider, model, temperature) triple."* All three clients expose the
**same public surface** so the runner cannot tell them apart.

**`client_factory.py`**

| Function | What it does |
|---|---|
| `vertex_env_ready() -> bool` | True when the three `GOOGLE_*` vars look usable. Cheap, side-effect free. |
| `llm_readiness() -> bool` | Reported by `/health`. Never raises, never blocks. `simulated_only` -> False; a key present -> True; else defer to `vertex_env_ready()`. |
| `ClientFactory.create_llm_client(config) -> Optional[GeminiClient]` | Returns **None** in `simulated_only` rather than crashing, so the runner serves cache -> simulated. DeepSeek -> `OpenAICompatClient(...)`. Otherwise `GeminiClient(...)`. |
| `ClientFactory.slot_ladder(config) -> [(1, name), (2, name), ...]` | Slot order *is* the fallback chain. |
| `ClientFactory.create_optional_compat_client(config)` | Claude/Llama via Vertex's OpenAI-compatible endpoint. **Returns None unless `VERTEX_OPENAI_COMPAT_BASE_URL` is configured** — the probe must have proved it. Argus never deploys Model Garden endpoints. |
| `ClientFactory.describe(config) -> dict` | The instrument description `/api/meta/models` renders. |

**`gemini_client.py` — `GeminiClient`**

* `__init__(default_model, timeout, api_key)`. With a key, constructs
  `genai.Client(api_key=..., http_options=HttpOptions(api_version="v1"))` and
  does **not** verify Vertex. Without, it calls `_verify_vertex_ai_setup()`
  (raises `EnvironmentError` listing the missing vars) and constructs the ADC
  client.
* `chat_completion(messages, model, temperature, max_tokens) -> str`.
  `_convert_messages` flattens the message list into one string with an
  `Assistant:` prompt suffix.
* `structured_completion(prompt, schema, model, temperature, max_tokens, system_instruction) -> BaseModel`.
  The JSON-mode path. It sets `response_mime_type="application/json"` **and**
  `response_schema=schema` together, and deliberately omits the
  `response_modalities=["TEXT"]` that `chat_completion` sets — the two conflict
  on the Vertex API. Raises on transport errors, empty responses or
  schema-validation failure so the runner can retry, fall to the next slot, then
  to simulated.
* `model_version(model) -> str` and `get_model_info() -> dict` — the version
  string pinned with every answer.

**`openai_compat_client.py` — `OpenAICompatClient` (DeepSeek)**

This module's docstring is worth reading in full; it explains a real limitation
with measured evidence. The key points:

* DeepSeek's API accepts only `response_format: {"type": "json_object"}` —
  requesting `json_schema` returns HTTP 400 "This response_format type is
  unavailable now" (verified 2026-09-26). So **Gemini's provider-side schema
  enforcement is not available**, and the shape must be described in the prompt.
* `schema_instruction(schema)` generates that description **from the Pydantic
  model**, so it cannot drift from the contract. Three parts: the top-level keys,
  a recursive `_render_object` that spells out *every* nesting level, and
  `_filled_example` — a filled example, never empty arrays. Two measured failures
  shaped it: a truncated properties dump (cut at 1800 chars) left nested shapes
  unreadable, and an example with empty arrays taught the model to invent
  `location` / `why_relevant` instead of `rank` / `is_target` / `context`.
* `_deref(spec, root)` resolves `$ref` and flattens `allOf` against `$defs`,
  because Pydantic emits nested models as separate definitions.
* The token budget is a **parameter, not a constant**, and deliberately
  generous: default 8192 so it is never the binding constraint. Recorded
  evidence: `gemini-3.5-flash` truncated at 1024 *and* 2048 and only returned
  valid JSON at 4096.
* `_content(data)` names failure modes precisely: no choices, empty content
  (with `finish_reason`), and `finish_reason == "length"` -> a truncation error
  that says to raise `OPENAI_COMPAT_MAX_OUTPUT_TOKENS`.
* `structured_completion(...)` raises `ValueError(f"response did not match
  {schema.__name__}: {exc}")` on a `ValidationError`, so the schema-pass rate
  is a genuinely *measured* property of this provider rather than an upstream
  guarantee.
* `payload["thinking"] = {"type": self.thinking}` is added **only when
  configured**, so the default request body is unchanged. Pinned by
  `tests/test_deepseek_provider.py::test_the_client_sends_no_thinking_parameter_by_default`
  and `::test_an_explicit_thinking_setting_is_sent_when_pinned`.
* `_TRANSIENT_MARKERS` (`429`, `rate limit`, `quota`, `5xx`, `overloaded`,
  `timeout`, ...) plus `is_transient(text)` classify "the call never produced an
  answer" — a call-level artefact to retry, not a measurement of the model.
  Pinned by `::test_transient_markers_identify_retryable_failures`.
* The API key is stored in `self._api_key` and **never logged, never echoed,
  never written to a report**. The constructor **raises** when the key is blank,
  rather than constructing a client that will fail on first use. Pinned by
  `::test_the_key_never_appears_in_logs_repr_or_reported_payloads`,
  `::test_a_deepseek_client_without_a_key_refuses_to_construct` and
  `::test_no_secret_is_ever_committed`.

**`vertex_openai_compat.py` — `VertexOpenAICompatClient`**

Conditional capability for Claude/Llama via Vertex's OpenAI-compatible endpoint.
Only constructed when `VERTEX_OPENAI_COMPAT_BASE_URL` is set. Posts to
`{base_url}/models/{model}:generateContent` with
`responseMimeType: application/json` and a `_schema_to_dict` projection. Uses
`httpx.Client(trust_env=False, ...)` because outbound AI traffic is handled by
the corporate proxy contract at the process level, never per call. The ADC token
is obtained by the caller (or the probe), because ADC bootstrap belongs to the
environment, not to this client.

### 3.3 `app/ai/` — schemas, cache, runner, simulated

#### `schemas.py` — the frozen `AgentAnswer` contract

Every LLM response — live, cached or simulated — is validated against this model
before anything downstream touches it. Validation failure is what drives the
retry chain.

```
AgentAnswer
├── answer_text : str  (min_length=1)   Verbatim prose. THE EVIDENCE LAYER.
├── mentioned_retailers : List[MentionedRetailer]
│     └── MentionedRetailer
│         ├── name      : str  (min_length=1)  as written by the model
│         ├── rank      : int  (ge=1, le=20)   position in the answer's list
│         ├── is_target : bool (default False)  True when this is the audited target
│         └── context   : Literal["recommendation"|"mention"|"comparison"]
├── claims : List[ClaimItem]
│     └── ClaimItem
│         ├── about     : Literal["target"|"competitor"]   (LINEAGE ONLY)
│         ├── subject   : str  what the claim is about
│         ├── attribute : str  e.g. organic_range, delivery_minimum
│         ├── value     : str  the value/qualifier asserted
│         └── statement : str  the sentence as evidence
└── confidence : Literal["high"|"medium"|"low"]  (default "medium")
```

Field-by-field, why each exists:

* **`answer_text`** — stored verbatim and never rewritten. Every claim links
  back to the exact answer text that produced it, so this string *is* the
  evidence the product sells.
* **`mentioned_retailers`** — the **deterministic** input to metrics. The
  docstring is explicit: *rank is never inferred from prose in the POC*. Metrics
  count the structured rows.
* **`claims`** — the **judgemental** input. The deterministic extraction pipeline
  (M4) operates over these structured rows, never over prose alone.
* **`confidence`** — the model's own self-report, stored but not used in any
  metric. It is a value to read, not a value to trust.
* **The hybrid design** is stated in the module docstring: `answer_text` is the
  evidence layer; `mentioned_retailers` is what metrics consume; `claims` feeds
  extraction.
* All models are `ConfigDict(extra="ignore")` — an unknown key is dropped, never
  a crash. Pinned by `tests/ai/test_ai_layer.py::test_schema_ignores_unknown_keys_instead_of_crashing_a_run`.
* `tests/ai/test_ai_layer.py::test_no_v1_schema_concepts_survive` asserts the v1
  SKU-shaped schema (shortlist / positioning / ClaimVerdict) is gone.

#### `cache.py` — the SEVEN key inputs

```python
KEY_INPUTS = ("model", "prompt", "persona_prompt", "temperature",
              "pack_version", "target_name", "reasoning_effort")

def cache_key(model, prompt, persona_prompt="", temperature=0.3,
              pack_version="v1", target_name="", reasoning_effort="") -> str:
    return hashlib.sha256("|".join((
        (model or "").strip(), prompt or "", (persona_prompt or "").strip(),
        f"{float(temperature):.4f}", (pack_version or "").strip(),
        (target_name or "").strip(), (reasoning_effort or "").strip(),
    )).encode("utf-8")).hexdigest()
```

`SPEC_KEY_INPUTS` records the five the spec names, for comparison. Here is the
story of the two additions, because both were forced by real bugs:

**`target_name` (input 6, ratified at M3).** Spec §3.4 names five key inputs
*and*, in the same breath, requires that "two registered targets never share
cache entries". Those two statements are only compatible for the three **DIRECT**
missions, which literally contain `{target}`. The nine **OPEN** missions are
target-free *by design* — appending the brand to an OPEN question would bias the
model toward naming it and destroy the OPEN/DIRECT distinction the instrument
rests on. So for an OPEN mission the hashed `prompt` is byte-identical for every
registered brand, and a five-input key would let one brand's answer be served to
another — including a stale `is_target` flag and stale `about: "target"` claims.
That is exactly the cross-brand misattribution the rule exists to prevent.

Adding the target name resolves the contradiction in the direction the spec
states the *goal* rather than the direction it happens to *spell out*. It is a
strict superset: it can only ever reduce cache sharing, so the worst case is one
extra call. Pinned by
`tests/ai/test_ai_layer.py::test_the_key_inputs_are_the_five_the_spec_names_plus_the_target_addition`,
`::test_the_target_name_participates_in_the_key`,
`tests/ai/test_runner_db.py::test_two_targets_never_share_cache_entries`, and
`tests/test_deepseek_provider.py::test_cache_keys_cannot_collide_across_providers`.

**`reasoning_effort` (input 7, M5b).** Reasoning effort is part of the FROZEN
INSTRUMENT alongside pack version, model and temperature, so it *must* be part
of the key: a cached answer produced with thinking enabled must never be served
to a run declaring thinking disabled, or the run is not the instrument it claims
to be. Pinned by
`tests/test_deepseek_provider.py::test_reasoning_effort_is_part_of_the_cache_key`.

Two more properties worth naming:

* **Substitution happens BEFORE hashing.** The runner substitutes the registered
  target's name into the mission text first, so the hashed `prompt` already
  contains the real brand. `cache_key` never sees a template. Pinned by
  `tests/ai/test_runner_db.py::test_the_substituted_prompt_is_what_reaches_the_model_and_the_cache`.
* **Payloads are immutable.** `put_cached` returns the key without writing if a
  row already exists. With `N > 1` runs per mission the FIRST fresh response is
  kept; the later runs are the variance, not the memo.

Functions: `cache_key()` (pure, unit-tested), `CacheEntry` (frozen dataclass),
`get_cached(session, ...)` -> `CacheEntry`, `put_cached(session, ..., response, model_version)` -> `str`,
`cache_stats(session)` -> counts by model + oldest/newest (rendered by
`/api/meta/models`).

#### `runner.py` — the plan, the chain, and `force_live`

**The plan.** `build_plan(session, target, pack_version, runs_per_prompt, runs_probe, tracked_missions, include_personas, city, latency_s, ..., geo_scope, geo_value) -> Plan`
resolves the whole grid *before any call is made*. It produces a tuple of
`PlannedRun` (frozen dataclass: `prompt_id`, `mission_key`, `kind`, `q_type`,
`scope`, `run_no`, `text` with `{target}` already substituted, `persona_id`,
`persona_name`, `persona_prompt`).

Four scopes, defined as module constants:

```python
SCOPE_HEADLINE     = "headline"       # core OPEN, persona-free
SCOPE_CORE_DIRECT  = "core_direct"    # core DIRECT
SCOPE_PROBE        = "probe"          # the probe lane
SCOPE_PERSONA      = "persona"        # the tracked mini-set
```

The grid is: 12 core missions × `RUNS_PER_PROMPT` (10) + probe rows ×
`RUNS_PROBE` (2) + the persona mini-set (`DEFAULT_TRACKED_MISSIONS = ("m1","m8")`
× personas × 2 runs). `Plan.headline_n` counts only `is_headline` runs → 9 × 10
= **90**.

`build_exploratory_plan(...)` builds the tiny Explore-lane grid: N OPEN missions
× R runs for ONE persona. OPEN only, deliberately — a DIRECT mission would name
the target, and an ad-hoc sensitivity run is the wrong place to introduce that
confound. The chosen missions are the first N by id: *a stable, explainable
selection; an exploratory run that picked "interesting" missions would not be
repeatable.*

**The `Plan` estimate methods** — all computed, never asserted:

| Method | What it returns |
|---|---|
| `Plan.estimate()` | The whole card: counts, `total_calls`, `headline_n`, `requires_confirm` (= `target_is_real`), `duration`, `geo_badge`, `cost_band`, `quick_probe` |
| `Plan.duration_estimate(rpm_budget, call_latency_s)` | Takes the **slower** of two floors — the quota floor (`calls / rpm`) and the serial-latency floor (`calls x p50`) — and reports `governed_by`. The card used to promise "2-3 min", true at company Vertex quotas and false on the free-tier API-key profile (measured cap 15 rpm). |
| `Plan.cost_band(per_call_low, per_call_high)` | A **band** with its assumption. Unset -> `available: False` and a sentence saying why. Never a hardcoded price. |
| `Plan.quick_probe_estimate(missions, runs, rpm_budget, ...)` | The card's second row. `partial_evidence: True` is not decoration — any surface rendering it must carry the label, and a quick probe is never reported as a headline number. |

`_cost_per_call(bound)` deliberately returns `None` rather than a default price.
The spec forbids a hardcoded price: *a single number would be a claim about
someone else's invoice, and it would rot the moment a provider changes price.*

**The chain.** `Runner._resolve(run)` is four legs, in this order:

```
  (1) CACHE          skip when force_live=True          -> source="cache"
  (2) LIVE           retry x3, backoff (0.0, 0.5, 1.5s) -> source="live"
  (3) CACHE AGAIN    a hit means something populated it
  (4) SIMULATED      the labelled offline fallback      -> source="simulated"
```

**Why `force_live` is load-bearing.** All N runs of one mission share a cache
key — the ruled key inputs do not include `run_no` — so a naive cache-first grid
would serve runs 2..N as replays of run 1 and `run_stability` would measure
nothing but our own cache. The spec's own escape hatch ("a `--live` flag forces
fresh calls") is therefore what a live audit uses: `force_live=True` skips the
*up-front* cache check so every run is a real observation, while a repeat audit
stays fully cache-served. `run_audit` sets
`force_live=bool(force_live or mode == "live")`. The post-failure cache check
applies in both modes. Pinned by
`tests/ai/test_runner_db.py::test_force_live_makes_every_run_a_real_call` and
`::test_a_repeat_audit_is_served_entirely_from_cache`.

**Amendment E refusal, the second layer.** On the simulated leg, if
`plan.target_is_real`, `assert_fixture_allowed(True, target_name)` raises
`SimulatedTargetError`. A real brand's answers must be `live` or `cache`;
substituting fiction about a real company would be fabricating an observation
about a real business. Pinned by
`tests/ai/test_runner_db.py::test_a_registered_target_never_receives_a_simulated_answer`.

**`empty_response` is refusal-as-data.** `is_empty_response(answer)` is
`not answer.mentions and not answer.claims`. A schema-valid response that named
nobody and asserted nothing is stored with `empty_response=true` and contributes
zero to mention. It is never a failure, never retried, never dropped — "an answer
that omits you *is* the finding". The chain raises only when *every* leg fails
(`RunnerError`). Pinned by
`tests/ai/test_runner_refusal.py::test_a_successful_answer_naming_nobody_is_stored_as_an_observation`
and `::test_empty_response_is_false_for_a_normal_answer`.

**Concurrency.** `_execute_live_calls()` issues live calls through a
`ThreadPoolExecutor` when `concurrency > 1`. Two invariants:

* **Nothing touches the database inside a worker.** A SQLAlchemy `Session` is not
  thread-safe, so a worker's live call is pure IO and every cache read/write
  happens later on the main thread. The docstring records that writing from a
  worker produced a duplicate-key race on `llm_cache` and poisoned the whole
  transaction.
* **Every run still makes its own call.** Concurrency changes the wall clock,
  never the measurement. Pinned by
  `tests/test_concurrency_and_schema.py::test_concurrent_and_sequential_runs_produce_identical_observations`
  and `::test_concurrency_actually_overlaps_the_calls`.

Other functions: `mention_contribution(parsed, target_name) -> int` (pure — M4/M5
reuse it), `active_target(session, target_id) -> Retailer` (explicit id, else the
`is_active=true` row; raises `LookupError` naming the fix when there is none),
`_pack_prompts`, `_variants_for_prompts`, `_rpm_budget()`, `_cost_per_call(bound)`.

#### `simulated.py` — deterministic fixtures

`simulated_answer(mission_key, target_name, persona_name, run_no, city) -> AgentAnswer`
reads `data/fixtures/answers/simulated_answers.json` (memoised by `@lru_cache`,
with `reset_fixture_cache()` as the test hook).

**Determinism is the contract.** There is no randomness anywhere. The fixture
authors a **pool** of candidate mentions per mission and the selection is derived
from a SHA-256 digest of `(mission_key, persona_name, run_no)`. Different runs
therefore disagree the way real model runs disagree — *reproducibly* — which is
exactly the signal `run_stability` measures. A simulator that returned the same
answer for all 10 runs would make the variance story a fiction. Pinned by
`tests/ai/test_runner_db.py::test_the_simulated_grid_is_deterministic_across_audits`.

The selection logic, in order:

1. `MAX_MENTIONS_PER_RUN = 3` — at most three mentions per run, so a pool always
   leaves room for run-to-run disagreement.
2. **The authored m7 decline.** A mission with `may_decline: true` (m7 — *"Is
   {target} cheaper than Tesco for a standard basket?"*) returns its hedged
   non-answer on runs where `digest % DECLINE_MODULUS == 0` (`DECLINE_MODULUS = 3`),
   with `mentioned_retailers: []` and `claims: []`. Roughly a third of the runs,
   which is what DIRECT comparison prompts realistically produce.
3. **Persona bias merged BY NAME.** A persona that favours a retailer already in
   the pool must promote it, not duplicate it — two identical mentions in one
   answer would corrupt the rank/mention metrics and read as a fabrication. The
   stronger signal wins: the persona's `context`, and `max(existing weight, bias weight)`.
4. **Ordering.** Highest weight first, ties broken by
   `sha256(name)[:8]` so two equal weights still order identically on every run.
5. **How many to take.** `take = 1 + digest % min(MAX_MENTIONS_PER_RUN, len(ordered))`.
6. **Claims.** At least one claim whenever the mission authors any, so the claims
   queue is never empty for a mission that always asserts something:
   `for item in authored[: 1 + digest % len(authored)]`.
7. `_fill(text, target_name, city_name)` substitutes `{target}` and `{city}`.

`assert_fixture_allowed(is_real, target_name)` is the Amendment E gate (above).
`has_fixture(mission_key)`, `city_default()`, `_entry(mission_key)`.

#### `latency.py` — the card measures, it does not pin

`measure_p50_latency_ms(session, model, limit=200)` takes the median of
`answers.latency_ms WHERE latency_ms > 0` — only rows with a real latency, because
cache-served and simulated answers store 0 and would drag the median toward zero
and produce a duration estimate that is a lie.

`resolve_latency_s(session, model, fallback_s=2.2)` returns the number **and
where it came from** (`"measured"` or `"config_fallback"`). The card's duration
used to read a PINNED per-call latency from config; the docstring records that
this is the wrong design because the project already lived through three moves
that made it stale (2.7 s -> 2.2 s -> 8.9 s). Pinned by
`tests/ai/test_runner_db.py::test_the_card_measures_latency_from_stored_live_answers`.

### 3.4 `app/audit.py` — the composition root

This is the module that composes the whole grid, enforces the confirm gate, runs
the runner, persists answers, and then runs the extraction and metrics stages.
It is the only place that knows the order of the pipeline.

**`estimate_audit(session, ...) -> dict`.** Calls `_plan_for(...)` then
`plan.estimate()`. It reads the **CURRENT** pack and probe lane, so adding a
probe during a demo moves the number from ~120 to 120+2n. It is a function, not
a constant. The `GET /api/estimate` endpoint calls the same function the
confirm gate calls, so what the user is shown is what will be spent. Pinned by
`tests/ai/test_runner_db.py::test_the_estimate_is_computed_from_the_current_pack_and_probe_lane`
and `tests/test_api_real_data.py::test_the_estimate_endpoint_never_shows_a_hardcoded_price`.

**`enforce_confirm_gate(plan, *, mode, confirmed) -> None`.** One function, one
rule, three entry points. It runs **before any client is constructed**.

```
if not plan.target_is_real:      return      # the is_real=false fixture target
if mode != "live":              raise SimulatedModeRefused    # 409, NOT confirmable
if not confirmed:               raise LiveConfirmRequired     # 428
```

The rule is two-part and the **second half is the one that mattered**.
`mode="simulated"` is not a simulation: it leaves `force_live=False`, so the
chain runs cache -> live -> cache -> simulated and **reaches live on a cache
miss**. Seven real paid calls were spent this way in the M9 rehearsal because the
gate only tested `mode == "live"` and the 428 message then recommended the ungated
path. `mode="simulated"` on a real target is now refused outright (4xx / 409),
because confirming does not help — the caller asked for a simulation, and a real
brand cannot have one (Amendment E).

The three entry points, all in `app/audit.py`:

| Door | Function | Called at |
|---|---|---|
| Grid audit | `run_audit` | line 688, before the audit row is created |
| Explore-lane persona run | `run_exploratory_run` | line 571 |
| Quick run | `run_quick_run` | line 391, **before** `_synth_quick_prompt` so a refused quick run leaves no probe row behind |

The gate is now also asserted **structurally**: any module-level function in
`app/audit.py` that constructs a `Runner` (the module's only route to a model)
must also call `enforce_confirm_gate`. The check keys on `Runner(`, not on a
name list, so it follows new code. See
`tests/test_harness.py::test_every_model_calling_path_passes_the_confirm_gate`
and `::test_the_confirm_gate_cannot_be_bypassed_with_a_second_definition`.
Behaviourally the three doors are pinned by
`tests/ai/test_confirm_gate.py` (12 tests, including
`::test_no_confirm_live_makes_zero_client_calls`,
`::test_confirmed_simulated_is_still_refused`,
`::test_an_exploratory_persona_run_on_a_real_target_is_gated`,
`::test_a_quick_run_on_a_real_target_is_gated`,
`::test_a_refused_quick_run_leaves_no_prompt_row_behind`) and
`tests/ai/test_confirm_gate_api.py` (9 tests, mapping the same rules onto 428 /
409 / no-500 responses).

**`run_audit(...) -> AuditResult`** — the stages, in order:

```
 1. resolve the target                       (explicit id, else the active one)
 2. _plan_for(...)  -> build_plan(...)       (the grid, with measured latency)
 3. enforce_confirm_gate(plan, mode, confirmed)     <-- BEFORE any client
 4. create the audits row (status="running", n=0)
 5. Runner(plan=plan, force_live=force_live or mode=="live",
           reasoning_effort=..., concurrency=...).run()  -> List[Answer]
 6. tally sources, count empty_responses
 7. finish the audit row: status, n=headline_n, notes with
    scopes=... sources=... empty_responses=... geo=...
 8. M4 STAGE  extract_audit(session, audit_id, target)     (if extract and rows)
 9. M5 STAGE  compute_audit_metrics(session, audit_id, target)  (if metrics and rows)
10. return AuditResult(...).as_dict()
```

`extract=False` stops after the answers, which is what the extraction tests use
to set up an audit with known content.

`run_quick_run(...) -> QuickRunResult` is the ad-hoc sensitivity run: one
mission, one persona, one call. It reuses the real `Runner` so the answer
carries a real `source` label and real latency, and the audit it lands in is
`mode="exploratory"`, which no headline surface reads. Its claim list is
**candidates with their verbatim quotes, not persisted `Claim` rows** — filing a
claim is a human decision, and the strip's outcome is stated explicitly:
*"Claim candidates are shown with their verbatim quotes and are NOT written to
the review queue. Filing one is a human decision."*

`run_exploratory_run(...) -> AuditResult` is the persona lane. Same properties;
`n=0` because an exploratory audit contributes nothing to the headline n, and
`extraction=None`, `metrics=None` because headline metrics are not computed for
an exploratory audit at all.

**`EXPLORATORY_MODE = "exploratory"`** is a **structural** exclusion, not a
badge. It is filtered out of the audit list, the Overview, the report and every
headline metric query, so an ad-hoc sensitivity run cannot contaminate a trend
or inflate n **even if a screen forgets to badge it**. Pinned by
`tests/test_api_real_data.py::test_an_exploratory_audit_never_becomes_a_headline_subject`.

`AuditResult` is the dataclass the M6 API and the demo both read: `audit_id`,
`status`, `mode`, `target_name`, `pack_version`, `model`, `model_version`, `n`
(headline observations), `rows` (every persisted answer row, all scopes),
`geo_scope`, `geo_value`, `counts_by_scope`, `sources`, `empty_responses`,
`duration_ms`, `estimate`, `extraction`, `metrics`, `errors` — plus `as_dict()`.

Other functions: `_synth_quick_prompt` (stores a user-authored question as a real
`prompts` row, `kind="probe"`, so the answer's `prompt_id` links back),
`_plan_for`, `_concurrency()`, `_reasoning_effort()`, `_instrument_model()`.

### 3.5 `app/extract/` — deterministic extraction

Every judgemental function in this package is **pure**: no database, no clock, no
model call. `pipeline.py` is the only module that touches the DB, and it only
reads answers and writes claims.

#### `normalize.py` — alias-lite, deliberately

The model writes a brand name the way it feels like writing it: "tesco", "Tesco ",
"Tesco Extra". Metrics must not care.

`normalize_name(name) -> str` is the comparison key: NFKD normalise, drop accents,
lowercase, **remove apostrophes** (`Sainsbury's` -> `sainsburys`, because
converting the apostrophe to a space would split one brand into two keys and halve
its mention counts), punctuation -> space, collapse whitespace, strip a legal
suffix, strip a trailing `'s`.

`_LEGAL_SUFFIXES` = `plc, ltd, limited, llc, inc, incorporated, group, co, company, uk, the`.

**Why there is no real-brand alias table.** The module docstring is explicit: a
hand-kept alias table would be **retailer knowledge in code**, which Amendment E
forbids (no retailer names hardcoded anywhere in `app/**` or `core/**`), and it
would silently merge two genuinely different entities. Alias-lite also means the
normalisation is explainable to a reader: "we lowercased and stripped a legal
suffix", not "we knew these are the same". Pinned by
`tests/extract/test_cluster.py::test_normalisation_folds_case_punctuation_and_legal_suffixes`,
`::test_a_legal_suffix_variant_still_resolves_as_the_target` and
`::test_substring_collision_is_not_a_target_match`.

Other functions: `target_key`, `is_target_mention(mention, target_name)` (the
model's `is_target` flag first, then normalised **equality** as a backstop — a
bare substring match would be wrong, because "Tesco Express" is not "Tesco"),
`target_rank`, `normalize_mentions(mentioned, target_name)` (adds `name_key` and
`is_target_resolved`; **never** touches the model's `rank` or `context`, because
rank is the model's ordering and re-deriving it would destroy the evidence layer),
`target_is_named`, `named_competitors`, `is_empty(mentioned, claims)` (kept in
step with `runner.is_empty_response` so the two layers can never disagree about
what "empty" means).

#### `classifier.py` — the frozen trichotomy, most-conservative-wins

Three types:

| Type | Meaning | `precheck` | `needs_feed` |
|---|---|---|---|
| `OPINION` | preference / superlative with **no** checkable comparable | False | False |
| `PUBLIC_FACT` | checkable against a public page (counts, hours, minimums) | True | False |
| `RETAILER_ONLY` | the retailer's own business (price, range, stock, fees) | False | True |

`classify(attribute, statement, *, about_target=True) -> Classification` is pure,
total and deterministic. **Order is deliberate:**

1. `about_target=False` -> `RETAILER_ONLY` with reason "claim is about a
   competitor, not the audited target". A competitor's store count is not
   something the retailer can correct, so the caller can drop it.
2. `_OPINION_MARKERS` matches -> `OPINION`. An explicit opinion marker wins
   because a sentence can contain a checkable number and still be framed as a
   preference ("best value, 280+ stores") — and the reviewer's job is to judge
   the framing, since a preference is not a fact to be corrected. The marker list
   is deliberately narrow: a word like "good" alone is not enough, because a
   claim can say "good range" and still be checkable.
3. Any of `_PUBLIC_FACT_RULES` matches -> `PUBLIC_FACT` with the specific reason
   ("store count", "opening hours", "named scheme", "delivery terms", "delivery
   minimum", "stated price", "coverage", "range composition").
4. **Otherwise `RETAILER_ONLY`, never `OPINION`.**

**The rule that matters most.** Defaulting to OPINION would quietly remove a
claim from the verification queue on the grounds that it "sounded like an
opinion" — a claim escaping review because of how it was phrased is precisely
the failure this product exists to prevent. Opinion is reserved for claims that
carry an explicit preference marker, and nothing else.

Pinned by `tests/extract/test_classifier.py::test_classification_is_pure_and_total`,
`::test_precheck_is_set_for_public_facts_only`,
`::test_needs_feed_is_set_for_retailer_only_claims_only`,
`::test_a_claim_about_a_competitor_is_not_the_targets_verification_queue`.

At **cluster** level the most conservative member wins:
`pipeline._conservative_type(types)` iterates
`(RETAILER_ONLY, PUBLIC_FACT, OPINION)` and returns the first present — a claim
mixed with a business fact is not publicly checkable and must not be pre-checked.

`needs_feed_prompt(claim_type)` returns the itemised V2-API conversation string
for `RETAILER_ONLY` and `""` otherwise. `CLAIM_TYPES` is the trichotomy tuple.

#### `attribution.py` — TARGET / COMPETITOR / MARKET, from the subject

**THE PRINCIPLE: relationship is DERIVED from the `subject` field by
deterministic matching. The model's `about` label is retained for lineage only,
never used in logic.**

This exists because of a measured failure, not a hypothetical one. On the first
live audits of a real brand, **81.4% of claim rows (249 of 306) never named it
target** — the model asserted things about several named rivals and labelled
every one `about: "target"`. Trusting that label would have put 249 competitor
claims into the retailer's verification queue and counted them as findings about
that brand: a confidently wrong number produced by a plausible-looking field.

`resolve_relationship(subject, target_name, competitors) -> str` — the order of
the tests **is** the safety property:

```
 1. empty subject                             -> MARKET
 2. key == target_key(target_name)            -> TARGET
 3. subject names the target as a run         -> TARGET
 4. subject names a competitor, not us        -> COMPETITOR
 5. everything else, unresolved                -> MARKET
```

Matching is by **contiguous token run**, not substring (`_names_phrase`): the
target name must not match inside a longer word, and a rival's longer trading
name must not read as the rival. This is what makes `"Tesco Express"` not a
match for `"Tesco"`. Pinned by
`tests/extract/test_attribution.py::test_the_target_name_is_matched_as_whole_words_not_substrings`.

Step 2 before step 3 is the second rule: a **comparison-shaped subject** that
names us ("Ocado versus Tesco") stays `TARGET`. Resolving those as COMPETITOR
would drop a genuine claim about our price position out of the review queue.
Pinned by `::test_a_comparison_shaped_subject_that_names_us_stays_a_target_claim`.

**The asymmetric default and why.** Step 5: **unresolved resolves to MARKET,
never TARGET.** The docstring gives the failure-mode reasoning directly —
*over-attribution's failure mode is a false finding about a named real company;
under-attribution's is a claim that displays without gating anything. The first
is neither visible nor survivable.* A blank or unrecognised subject must not
enter the verification queue by accident, and must never pull a competitor's
claim in. The second asymmetry: **MARKET claims still display and still count.**
They gate nothing and the UI marks them, but a market-level claim is a real
observation about how the model frames the category; dropping it would lose
evidence. Pinned by `::test_an_unresolved_subject_is_never_resolved_as_the_target`
and `::test_a_market_claim_can_never_carry_the_affects_you_marker`.

`affects_target(relationship, statement, target_name) -> bool` is the second half
of the queue rule: a **COMPETITOR-subject claim whose STATEMENT names us** is a
claim about our position ("a discount pair is cheaper than Ocado"), so it
displaces us and joins the queue. A competitor claim that never mentions us is
pure competitor intelligence — badged, quoted, counted, no verdict required.
Pinned by
`::test_the_pinned_comparative_fixture_is_a_competitor_claim_that_displaces_us`,
`::test_a_competitor_claim_that_never_names_us_is_not_ours`,
`::test_affects_target_only_applies_to_competitor_claims`.

`in_queue(relationship, affects) -> bool` is **THE queue rule, in one place so
nothing can drift from it**: `relationship == TARGET or bool(affects)`.

**The competitor set is derived, never hardcoded.**
`competitor_set_from_answers(answers_parsed, target_name) -> Set[str]` unions the
normalised `mentioned_retailers` of **every answer in the audit**, minus the
target. It is scoped to the audit, not the single answer, because a claim's
subject can name a retailer the model mentioned in a *different* run — deriving
it per answer would make resolution depend on which run a claim happened to land
in, which is exactly the non-determinism this module exists to remove. No
hardcoded brand list: Amendment E. Pinned by
`::test_the_competitor_set_is_derived_from_the_mentions_not_hardcoded`,
`::test_the_competitor_set_is_scoped_to_the_whole_audit`,
`::test_an_answer_that_named_nobody_yields_no_competitors`,
`::test_a_rival_named_only_in_the_statement_is_still_a_competitor_subject`.

`attribute_claim(claim, target_name, competitors) -> Attribution` and
`attribute_claims(claims, target_name, competitors) -> List[dict]` — the second
**keeps the model's `about` as `model_about`** so a reader can see what the
model believed and that we overrode it. Pinned by
`::test_the_models_own_label_never_changes_the_outcome` and
`::test_the_model_label_is_retained_as_lineage_not_logic`.
`RELATIONSHIPS = (TARGET, COMPETITOR, MARKET)` is the trichotomy in queue order;
a resolution outside this set is a bug, so the resolver is total by construction.

#### `cluster.py` — key-only identity

```
cluster_key     = normalized (relationship, subject, attribute)
merge rule      = EXACT cluster_key equality, nothing else
tie-break       = earliest first-seen wins
canonical text  = most frequent verbatim statement (tie -> earliest)
threshold       = TOKEN_OVERLAP_THRESHOLD = 0.6, used for CANONICAL TEXT ONLY
```

**Why determinism is the whole point.** Clusters persist across audits via
`cluster_key`, and that identity is what makes claim movement diffable: "this
claim is new in audit #3" is only a true statement if the same claim produced
the same key last time. A clustering pass that depended on dict ordering, thread
scheduling or hash randomisation would make the diff engine lie. So: no
randomness, no clock, no set iteration order in any decision.

`make_cluster_key(relationship, subject, attribute)` uses the **RESOLVED**
relationship (Amendment J), never the model's `about` label. Two claims sharing a
subject but differing in relationship are now DIFFERENT claims and must not
merge: "Ocado's own-brand range" and "Tesco's own-brand range" are one attribute
and two different facts. Pinned by
`tests/extract/test_cluster.py::test_the_cluster_key_is_normalized_relationship_subject_attribute`,
`::test_the_cluster_key_never_merges_two_relationships`,
`::test_an_unknown_relationship_is_treated_as_market_never_target`,
`::test_a_claim_with_no_relationship_at_all_lands_in_market`.

**Why the overlap threshold is NOT a merge gate.** An earlier version also merged
a different key whose statement was a near-duplicate, and a test caught it: "a
limited organic range" and a loyalty claim phrased identically collapsed into
one cluster, which would conflate two unrelated claims on the board and
contradict the unique `(target_id, cluster_key)` constraint. Within one key,
phrasing differences are the NORMAL case — that is why the key is
relationship/subject/attribute and not the sentence. So `overlap()` (Jaccard over
content tokens, with a stopword list) is used **only** inside `_canonical()`: a
statement that is not a near-duplicate of the current canonical is not eligible
to become the canonical phrasing, so a cluster can never present an unrelated
sentence as its claim. **≥ 0.6 for canonical text only.** Pinned by
`::test_near_duplicate_phrasings_merge_at_the_threshold`,
`::test_different_attributes_stay_separate`,
`::test_claims_about_different_subjects_never_merge`.

`cluster_claims(claims, threshold=0.6) -> List[Cluster]` merges only on exact key
equality. `Cluster` is a dataclass with `cluster_key`, `canonical_text`,
`statements`, `occurrences`, `first_seen_index`, `payload`.
`_canonical(cluster, threshold)` picks the most frequent statement among the
*eligible* ones, ties to the earliest — never "the longest" or "the last one",
both of which would drift between audits and make the diff engine lie.

#### `pipeline.py` — the pass that writes rows

`extract_audit(session, audit_id, *, target=None) -> ExtractionResult` runs, in
order:

```
 1. read the audit's answers                       (LookupError if none)
 2. normalise every answer's mentions              -> result.mentions
 3. collect_claims(session, audit_id)               -> raw claim dicts
 4. competitor_set = competitor_set_from_answers(ALL answers)
 5. raw_claims = attribute_claims(raw_claims, target_name, competitor_set)
 6. per claim: classify(attribute, statement, about_target=claim["in_queue"])
 7. cluster_claims(...)                            -> List[Cluster]
 8. for each cluster:
      - members = [c for c in raw_claims if _in_cluster(c, cluster)]
      - claim_type = _conservative_type(member types)   # most conservative
      - relationship = head member's resolved relationship (it is part of the key)
      - affects = ANY member's affects_target
      - queued = in_queue(relationship, affects)
      - UPSERT the Claim row
      - write up to MAX_QUOTES_PER_CLAIM claim_quotes rows
 9. flush
```

Note step 6 passes `about_target=bool(claim["in_queue"])` — the **queue**
decision, not the raw relationship: a competitor claim that displaces us is the
retailer's problem to verify.

**Step 5 before step 7 is load-bearing (Amendment J ordering).** Attribution runs
FIRST, on the raw claims, because the cluster key is built from the resolved
relationship. A clusterer that ran on the model's own `about` label would merge a
competitor's claim into the target's claim space — the 81.4% over-labelling
failure measured on the live Ocado audits.

**Upsert semantics.** The claim lookup is
`select(Claim).where(Claim.target_id == target_id, Claim.cluster_key == cluster_key)`.

* **New row:** `status="new"`, `first_audit_id=last_seen_audit_id=audit_id`,
  `obs_audits=1`, `obs_runs=len(members)`, `obs_models` counted per model,
  `needs_feed` set when the classification asks for it, `precheck` set only for a
  `PUBLIC_FACT`.
* **Existing row:** the claim's identity and first sighting are immutable; only
  its movement is recorded. `last_seen_audit_id = audit_id`, `obs_audits += 1`,
  `obs_runs += len(members)`, `obs_models` incremented, `canonical_text`
  refreshed. Attribution **is** refreshed (it is derived, so a later pass may
  correct it) — but `status` is not, unless it is still `"new"`.

**Never demote a resolved claim.** The update path only touches `claim_type`,
`precheck` and `needs_feed` `if row.status == "new"`. Re-running an audit must
not silently reopen a closed question. Pinned by
`tests/extract/test_pipeline_db.py::test_re_running_an_audit_does_not_reopen_a_resolved_claim`
and `::test_a_second_audit_updates_the_claim_instead_of_duplicating_it`.

**The quote requirement.** A claim with no quote is not persisted — a claim
nobody can trace is not evidence. Every `ClaimQuote` row carries
`claim_id`, `answer_id`, `verbatim` (the statement), `model` and `run_no`. There
is no code path that writes a `Claim` without at least one quote, because quotes
are written in the same loop as the claim. Pinned by
`::test_extraction_writes_claims_with_quote_links` and
`tests/test_api_real_data.py::test_claims_carry_verbatim_quotes`.

**The 3-quote cap.** `MAX_QUOTES_PER_CLAIM = 3` — enough to show the pattern,
bounded so a claim cannot flood the queue. `members[:MAX_QUOTES_PER_CLAIM]` are
the **earliest** distinct answers that asserted this claim.

`ExtractionResult` carries: `answers_read`, `empty_responses`, `claims_written`,
`claims_updated`, `quotes_written`, `clusters`, `by_type`, `by_relationship`,
`affects_target_count`, `queue_claims`, `offscreen_claims`, `competitors`,
`mentions`, `errors`.

An answer with `empty_response=true` contributes no claim and no mention — its
absence is the finding, and it is already stored on the answer row. It is never
an error here either. Pinned by
`::test_an_empty_response_contributes_no_claim_and_is_not_an_error` and
`::test_extraction_refuses_an_audit_with_no_answers`.

### 3.6 `app/scoring/` — statistics, metrics, diff

#### `stats.py` — CI helpers, no scipy

| Function | What it does |
|---|---|
| `t_critical(df, level=CI_LEVEL)` | Two-sided critical value. Exact table `_T95_TABLE` for df 1..30; beyond that a **Cornish-Fisher** expansion `z + (z^3+z)/(4df) + (5z^5+16z^3+3z)/(96df^2)`. Non-95% levels fall back to the normal quantile, which is documented behaviour. |
| `mean(values)` | Arithmetic mean. |
| `stdev(values)` | Sample standard deviation (n-1). Returns 0 for n < 2. |
| `confidence_interval(values, level, clamp)` | The frozen shape `{value, ci_low, ci_high, n}`. n = 0 -> all zeros. n = 1 -> degenerate `[avg, avg]`. |
| `ratio(n, d, default)`, `pct(value, digits)`, `clamp(v, lo, hi)` | Guarded arithmetic. |
| `deterministic_spread(seed, index, spread)` | Reproducible jitter in `[-spread, +spread]`. A pure function of `(seed, index)` — no clock, no `random` global state. |
| `weighted_mean(pairs)` | Weighted mean over `(value, weight)`. |
| `quantise(value, digits)` | Display rounding. |

The module docstring records *why* there is no scipy: the Student-t quantile is
computed from a small exact table for the degrees of freedom actually used
(n ≤ 30) and a Cornish-Fisher expansion beyond that, keeping the dependency
surface small (PLAN T0.2).

`CI_LEVEL = 0.95` and `CURRENCY = "GBP"` live in `app/domain.py` — the only two
constants the surviving code quotes. Everything else M5 removed (TRUST_TIERS,
RATE_LIMITS_PER_MIN, ARIS_WEIGHTS, the v1 METRIC_NAMES, ...) belonged to the
deleted v1 product; the v2 metric set is defined in `app/scoring/metrics.py`,
the module that computes it.

#### `metrics.py` — the exact definitions

The frozen metric names (`HEADLINE_METRICS` + `SUPPORT_METRICS`):

```
mention_rate  top3_rate  recommended_rate  competitor_share        (headline)
run_stability  claims_new  claims_open                            (support)
```

`SINGLE_MODEL_NA = "n/a — single model"` is what any metric needing ≥ 2 models
renders instead of a number (Amendment A). Pinned by
`tests/scoring/test_metrics.py::test_a_multi_model_metric_renders_as_not_available`.

Five scopes, as constants: `SCOPE_HEADLINE`, `SCOPE_CORE_DIRECT`, `SCOPE_PROBE`,
`SCOPE_PERSONA`, `SCOPE_MISSION`.

**`headline_observations` — structural scoping.** `is_headline(o)` is
`o.scope == "headline" and o.persona_id is None`. That admits **core OPEN,
persona-free runs only**. DIRECT missions, probe rows and persona rows are stored
and badged but **cannot leak into a headline number**. That is what makes
headline n = 90 (9 OPEN × 10 runs) rather than whatever the grid happened to
produce. Pinned by
`tests/scoring/test_metrics_db.py::test_probe_persona_and_direct_rows_never_reach_a_headline_metric`
and `tests/ai/test_runner_db.py::test_probe_rows_are_structurally_excluded_from_headline_n`.

**The four headline rates.** Each is a **proportion** over
`[o for o in observations if is_headline(o)]`, computed by `ci_proportion(successes, n)`:

| Metric | Numerator | Note |
|---|---|---|
| `mention_rate` | runs where `_target_rank(o) is not None` | An empty answer counts in the **denominator** and never in the numerator — an answer that named nobody is the finding, and it must drag the rate down honestly. |
| `top3_rate` | runs where `rank is not None and rank <= 3` | The shared helper `_top3_over(rows, target_name)` is reused by the persona matrix over its own rows. |
| `recommended_rate` | runs where `rank == 1` | The strictest rate. Zero here is a real finding, and the UI says so in the reader's terms ("0 of 90 runs ranked you first") rather than rendering a bare zero. |
| `competitor_share` | runs naming ≥ 1 non-target mention | Explicitly **not** the complement of mention rate: an answer can name both. |

**`run_stability` — the same measure the gate used.**
`mission_self_agreement(names_by_run)` computes the mean **pairwise Jaccard**
over the mention-name sets of a mission's runs, and returns `None` for fewer
than 2 runs. `run_stability(observations)` takes the **mean of those per-mission
values** — and the docstring's justification is the key sentence: *this is the
SAME measure the validation table used to accept the model, and it is
deliberately one definition in one place: if the product computed a different
noise floor than the gate did, the badge would be grading itself against a number
the instrument never agreed with.* The per-mission map travels with the aggregate,
because the aggregate hides the thing that matters: a few missions can be
perfectly stable while others are chaotic. Pinned by
`tests/scoring/test_metrics.py::test_run_stability_needs_at_least_two_runs` and
`::test_run_stability_reports_per_mission_because_the_aggregate_hides_the_structure`.

**Normal approximation vs t — and why.** `ci_proportion` uses
`half = Z95 * sqrt(p(1-p)/n)`, clamped to [0, 1]. `max_half_width(n)` is
`Z95 * sqrt(0.25/n)` — the spec's ±10.3pp at n = 90, because
`1.96 * sqrt(.25/90) = 0.1033` exactly. The module docstring gives the reason
this is a deliberate choice: the t-based helper in `stats.py` would give ~±10.5pp
at the same n and would **silently contradict the frozen copy contract in §11**.
So **proportions use the normal approximation** here, and
`stats.confidence_interval` (t-based) stays where it belongs: **intervals around
MEANS**, such as `run_stability`.

Other functions: `jaccard(left, right)` (set overlap, ignoring order and rank;
both-empty -> 1.0), `per_mission_stability`, `per_mission_metrics(observations, target_name)`
-> `{mission_key: {metric: ci}}` over that mission's headline runs, so a movement
like m8's 4/10 -> 9/10 is readable with its own denominators,
`displacement_table(observations, target_name)` -> `{"competitor@mission": count}`
— which brand the model displaces where, `persona_matrix(observations, target_name)`
-> per-persona top3 with its own `n` and a `small_n` flag, `probe_results(observations)`
-> per-probe counts with `excluded_from_headline: True` and
`in_trend_until_promoted: False`, `claim_counts(claims)`, `compute_headline(observations, target_name)`.

`claim_counts` returns `claims_new`, `claims_open`, `by_status`, `by_relationship`,
`queue_claims` and `excluded_from_queue` — and **counts the review queue only**.
A pure-competitor claim is not a task the retailer can do, and a pure-market
claim is not about anyone; including them would inflate the headline claim count
with rows the Verified Report never shows, which is the same class of bug as the
count wearing a ratio badge. The excluded rows are still reported, so the number
can never quietly hide them. Pinned by
`tests/scoring/test_metrics.py::test_claim_counts_count_the_review_queue_only` and
`::test_claim_counts_treat_a_claim_with_no_relationship_as_market`.

`tests/scoring/test_metrics.py::test_the_v2_metric_names_are_the_live_ones` and
`::test_the_v1_metric_names_are_gone` pin the name set; `::test_metrics_are_deterministic`
pins that identical inputs produce identical output.

#### `diff.py` — the guardrails

1. **Comparable or blocked.** `AuditFingerprint` carries `audit_id`, `target_id`,
   `pack_version`, `model_versions` (a tuple), `geo_scope`, `geo_value`.
   `mismatch_reason(other)` returns a human sentence for the first mismatch;
   `assert_comparable` raises `NotComparable` if there is one. This is also what
   stops a DeepSeek audit being diffed against a Gemini one.
2. **The badge threshold is the COMBINED band of both audits.**
   `combined_half_width(ci_a, ci_b) = sqrt(half_a^2 + half_b^2)` where
   `half = |ci_high - ci_low| / 2`. A delta is `BADGE_PROOF` only when
   `abs(delta) > threshold`; otherwise `BADGE_TREND` ("trend, not proof"). At
   equal n that is ~1.4× a single-audit half-width. Using one audit's own CI would
   badge as "proof" a movement that its own noise fully explains — the single most
   tempting way for this product to lie. `metric_delta` returns the threshold
   **and the reason string**, so the badge can state what it used. Pinned by
   `tests/scoring/test_diff.py::test_the_combined_band_is_the_root_sum_of_both_half_widths`,
   `::test_it_is_wider_than_either_single_audit_ci`,
   `::test_the_seeded_gf_movement_is_badged_proof`,
   `::test_a_movement_inside_the_combined_band_is_a_trend_not_proof`,
   `::test_a_delta_at_exactly_the_threshold_is_not_proof`,
   `::test_the_badge_states_the_threshold_it_used`.
3. **Counts never wear the ratio badge.** A `unit == "count"` metric's stored CI
   is degenerate (`ci_low == ci_high == value`), so the combined band collapses
   to 0 and *any* change would badge as "proof". `metric_delta` short-circuits to
   `BADGE_COUNT` ("count — no sampling band") with `delta_pp: None` and an
   explicit reason. The docstring records the incident verbatim: `"claims_new
   306 -> 212, -9400pp, band 0.0pp, proof"` happened on the first real diff.
4. **Claim movement is by cluster.** `claim_movement(before, after, target_id=...)`
   indexes on `(target_id, cluster_key)` and returns `new`, `resolved`,
   `frequency` and `counts`. Frequency rows are emitted **only for claims whose
   `obs_runs` actually changed** — an unchanged claim produces no row. Pinned by
   `::test_claim_movement_keys_on_cluster_identity`,
   `::test_claim_movement_ignores_another_targets_claims`,
   `::test_an_unchanged_claim_produces_no_frequency_row`.
5. **Probes are excluded** from every comparison until promoted at a pack freeze
   — a discovery lane that entered the trend would make the trend an artefact of
   when someone got curious. The result carries
   `probes_excluded_until_promoted: True`.

`diff_audits(before, after, *, metrics_before, metrics_after, claims_before, claims_after, run_stability_before, run_stability_after, strict=True)`.
Deltas are sorted headline-first then by metric name, so the diff reads as a
summary followed by detail. `run_stability` is reported as `noise_floor` — the
context in which a movement is read, never badged as a movement itself. Pinned by
`::test_the_diff_reports_the_noise_floor_as_context_not_as_a_movement`.
With `strict=False` the result is a blocked shape rather than a raise; the API
uses `strict=True`. Pinned by
`::test_strict_false_returns_a_blocked_shape_instead_of_raising`.

The model-set comparison is order-insensitive (`set(...) != set(...)`), pinned by
`::test_the_model_set_comparison_ignores_order`. The DeepSeek/Gemini block is
pinned twice — in `test_diff.py::test_a_deepseek_audit_can_never_be_diffed_against_a_gemini_audit`
and `tests/test_deepseek_provider.py::test_a_deepseek_and_a_gemini_audit_can_never_be_diffed`.

#### `service.py` — the only module here that touches the DB

`observations_for_audit(session, audit_id, target_name) -> List[Observation]`
joins `Answer` to `Prompt` and turns rows into `Observation` dataclasses.
`text` on the row is the **SUBSTITUTED** prompt, so mission identity comes from
the joined `prompts.mission_key` rather than from parsing prose. Persona names
are read in one pass rather than a query per row.

`_scope_of(kind, q_type, persona_id)` is **structural**: a persona row is never a
headline row; a probe is a probe; otherwise OPEN -> headline, DIRECT ->
`core_direct`.

`compute_audit_metrics(session, audit_id, *, target) -> dict` computes **and
persists**. Metric rows are **replaced wholesale** for the audit (they are derived
rows, not observations), which keeps re-running a metric pass idempotent. Pinned
by `tests/scoring/test_metrics_db.py::test_metric_rows_are_replaced_not_duplicated_on_recompute`.

The `run_stability` it writes is measured over the **headline** observations
only — averaging it with 2-run probe and persona rows would blend a real signal
with two noisy ones. The per-mission map still exposes every mission, probes and
personas included.

Written rows: the four headline rates + `run_stability` + `claims_new` +
`claims_open` at `scope="headline", scope_key="open_core"` (unit `ratio`, except
the two counts which are `unit="count"`); per-mission rows at
`scope="mission", scope_key=<mission_key>`; persona top3 at
`scope="persona", scope_key=<persona name>`. Pinned by
`::test_a_full_simulated_audit_persists_the_metric_set` and
`::test_the_persona_matrix_is_persisted_with_its_own_scoped_rows`.

The returned summary carries `headline_n`, `headline`, `run_stability` (with
`per_mission`), `claims`, `displacement`, `per_mission`, `persona_matrix`,
`probes` and `rows_written`.

`metric_key(row) -> str` is a **composite** key: headline rows are keyed by the
bare metric name, everything else `metric@scope_key`. Without this a per-mission
`mention_rate` would **overwrite** the headline `mention_rate` in the map and the
diff would compare the wrong numbers while looking perfectly plausible.

`metrics_as_map`, `fingerprint(session, audit_id) -> AuditFingerprint`, and
`diff(session, before_id, after_id)` which selects claims by **first-or-last-seen**
on both sides (filtering on `first_audit_id` reported 212 new / 306 resolved for
a pair that actually shares 273 claims — the M6 incident, recorded in the
function's own comment).

### 3.7 `app/buddy/` — the deterministic copilot

**Zero LLM calls, by construction.** Nothing in the package imports a client, a
runner or a network library.

**`router.py` — text in, intent name out. No database, no clock.**
`route(question, data_dir=None) -> (intent, matched_rule)` reads
`data/fixtures/buddy_intents.json` and matches with `if needle in haystack`
(after `_normalise`, which strips punctuation and collapses whitespace so
"top-3" and "top 3" are the same question).

**Ordering is the design, not an accident.** "How do I add a probe?" contains the
word "probe", and a generic rule tested first would swallow the specific
question. The fixture is ordered most-specific-first and the module walks it in
order rather than scoring. Anything unmatched falls through to the fixture's
`fallback_intent`, which is a **real answer** (it lists what Buddy is good at)
rather than an error. Pinned by
`tests/buddy/test_intent_router.py::test_the_fixture_carries_at_least_fifteen_rules`,
`::test_every_golden_intent_resolves_from_its_own_question`,
`::test_every_golden_intent_has_a_distinct_question`,
`::test_every_suggested_chip_reaches_a_real_intent`.

**`answers.py` — intent + session -> the frozen answer shape.**

```
{ intent, question, deterministic: true, llm_calls: 0,
  blocks: [ {type: "text"|"note", md} ],
  charts: [ {type: "ci", title, data: {value, ci_low, ci_high, n}} ] }
```

This is the only module that touches the database, and it only **reads**.

**Why it is deterministic, and why the numbers cannot drift.** Every number in an
answer is read through the same helper the screens use:
`app.scoring.service.metrics_as_map` and `app/api/facts.console_facts`. Headline
rates come from the stored `Metric` rows — the very rows the Visibility Report's
tiles read. The claim queue comes from the same claim counts the board renders.
Nothing here recomputes a rate, re-derives a CI, or formats a percentage. The
module docstring is explicit: *if a second implementation of a metric existed,
this file would be where it drifted, so it does not contain one.*

`_ci_chart(title, metric)` builds the chart payload from the stored row with the
four numbers **verbatim**, un-rounded. That object is what the golden
number-equality test reads, and it is not reformatted because *a rounded second
copy in chat would be a second truth*. Pinned by
`tests/buddy/test_golden_set.py::test_the_number_equality_answer_quotes_the_stored_metric_exactly`.

`_headline_row(metrics, key)` looks up `metrics[key]` and then **asserts
`row["scope"] == "headline"`** — a per-mission row arriving there would otherwise
answer a headline question with 10 observations and look entirely plausible.

The answer builders:

| Builder | Intent | What it does |
|---|---|---|
| `_empty(what)` | `empty` | The honest empty answer. "No audit yet" is a **STATE with a reason**, not a failure and not a zero. |
| `_rate_answer(intent, question, metrics, target_name)` | the four rates | **One** builder for four intents, on purpose: a per-metric copy would be four places for the 0.000 case to be phrased differently, and that phrasing is load-bearing. The `recommended_rate == 0.0` branch says "0 of {n} runs ranked you first" and adds that zero is a real finding about the model, not a gap in the data. Also adds a note when `ci_low <= 0.0 and ci_high > 0.0`: the interval reaches down, so this n cannot rule out a materially lower rate. |
| `_why_answer(...)` | `mention_rate_why` | Calls `_rate_answer("mention_rate", ...)` and **appends** to its blocks. An explanatory answer that retyped the rate would create a second copy of a metric — "the exact shape of the two honesty bugs this project has already shipped". Then names the three things the instrument CAN see (displacement, the noise floor, the named-vs-recommended gap) and states it cannot name a cause. |
| `_stability_answer(...)` | `run_stability` | Quotes the stored row; says it is the model's own run-to-run self-agreement, the context a movement is read against, not a result about you. |
| `_queue_answer(...)` | `claims_coverage` / `queue` | The review-queue count and the rule, in the reader's terms. |
| `_gluten_free_answer(...)` | `gluten_free_story` | **The demo story, told from the STORED verdict rather than asserted in prose.** The tempting version hardcodes "the retailer proved the gluten-free claim FALSE" — that would be a caption, not a measurement, and it would keep claiming a verdict on a database where nobody had judged anything. If a FALSE verdict exists, it names the claim, the correction and the verifier. If not, it says the claims are on the board waiting for a reviewer and lists the three most-observed (`-obs_runs`, then id). Pinned by `::test_the_gluten_free_story_never_asserts_an_unstored_verdict`. |
| `_auto_verify_answer(...)` | `auto_verify_needs` | **The list is the stored rows, not a hand-written one.** Every line is a claim id with a real UNKNOWN verdict against it, so the answer is the backlog or it is empty. `PUBLIC_FACT` UNKNOWNs are reported separately from `RETAILER_ONLY` ones because they wait on different evidence (a public page vs a data feed) — describing a public-page check as though it needed a feed is the category error this product exists to avoid. Pinned by `::test_the_auto_verify_answer_lists_the_live_unknown_needs_feed` and `::test_the_auto_verify_answer_separates_public_facts_from_feed_claims`. |
| `_fallback_answer(question)` | `fallback` | A real answer listing what Buddy is good at. |
| `NARRATIVES` | ~20 intents | Explanations of how the product works, so they have no numbers to stay equal to. Kept in one table so the fixture expansion has an obvious home. |

`ask(session, question, *, target_id=None)` routes then answers. `target_id`
scopes the read to ONE target, so Buddy can never quote one retailer's numbers
under another retailer's name. Pinned by `::test_buddy_never_quotes_another_targets_name`,
`::test_buddy_makes_no_network_call`, `::test_every_golden_intent_answers`, and
`::test_answers_are_byte_identical_on_unchanged_state`.

The fixture is a single source of content: 26 intents, 16 golden, 19 chips
(`CURRENT_STATE.md`).

### 3.8 `app/geo.py` — three scopes and one invariant

```
GEO_SCOPES         = ("market", "city", "global")
DEFAULT_GEO_SCOPE  = "market"
DEFAULT_MARKET     = "UK"
FALLBACK_CITY      = "London"
```

`resolve_scope(*, scope=None, value="", market=DEFAULT_MARKET) -> ResolvedGeo`
normalises the requested scope and resolves the persona city. **A `city` scope
with no city is REFUSED, not downgraded**: `InvalidGeoScope` with the message
*"refusing to silently render the market question instead"* — an audit that
claims to be city-scoped but renders the market question would report the wrong
instrument. Pinned by
`tests/test_geo_scopes.py::test_a_city_scope_without_a_city_is_refused_rather_than_downgraded`,
`::test_an_unknown_scope_is_refused` and `::test_only_three_scopes_exist`.

**The byte-identity invariant.** `render_mission(default_text, variants, geo) -> (text, used_default)`:

```
for variant in variants:
    if variant.geo_scope != geo.geo_scope:                      continue
    if geo is city   and variant.geo_value != geo.geo_value:    continue
    if geo is global and variant.geo_value:                     continue
    return variant.text, False
return default_text, True
```

For `geo_scope == "market"` with no authored market variant this returns
`default_text` **unchanged**. So the rendered prompt is byte-identical to the v1
pack fixture, which means **the cache keys are unchanged** — no re-validation, no
re-freeze, and the accepted UK instrument stands untouched. Scope is a new
dimension, not a redefinition of the existing one. Pinned by
`::test_the_default_rendering_is_the_default_text_unchanged`,
`::test_a_scope_with_no_authored_variant_falls_back_to_the_default_text`,
`::test_the_uk_default_renders_produce_cache_identical_prompts_to_the_fixtures`,
`::test_the_committed_pack_fixture_still_holds_the_v1_default_strings`, and
`::test_a_city_scope_produces_a_different_cache_key`.

`persona_city_for(geo, variants) -> str` resolves the `{city}` slot: a city scope
uses that city; a market or global scope uses the variant's
`representative_city` when authored; otherwise `FALLBACK_CITY`, so the sentence
stays well-formed rather than acquiring a blank. Pinned by
`::test_a_city_scope_puts_the_persona_in_that_city`,
`::test_a_market_scope_uses_the_variants_representative_city`,
`::test_with_no_representative_city_the_persona_still_gets_a_real_city`.

`lineage_suffix(geo) -> str` gives the short badge: `city:Manchester`, `global`,
or `market`. `GeoVariant` and `ResolvedGeo` are frozen dataclasses; nothing here
touches the database. The scope travels onto the audit row and into the diff
fingerprint, so a cross-scope comparison is blocked exactly like a cross-model
one.

### 3.9 `app/operator.py` — the password gate

**This is not auth, and the module says so.** There is no user, no session, no
identity and no tenancy. The operator is one person holding one password. The
trust model is documented in METHOD.md rather than enforced by a credential
system; V1 replaces this with real identity.

`OperatorGate(ttl_s=8*3600, max_failures=5, cooldown_s=300)` holds two
in-memory maps guarded by one `threading.Lock`: `_sessions` (token -> expires_at)
and `_attempts` (client key -> failures + locked_until).

Two details that are easy to get wrong and are therefore tested directly:

* **Constant-time compare** (`hmac.compare_digest`). A `==` on a shared secret
  leaks its length and a prefix-match count through timing, which is a real
  attack against a single global password.
* **A rate limit with a cooldown.** Five wrong attempts, then a 5-minute lockout.
  Without it the endpoint is an unlimited online oracle for one global secret.
  Pinned by `tests/test_operator_gate.py::test_five_wrong_attempts_trigger_a_cooldown`
  and `::test_the_failure_count_resets_after_a_correct_unlock`.

**Fail-closed is the load-bearing property.** With no
`ARGUS_OPERATOR_PASSWORD` configured, `require_operator` raises **503** and NO
operator action is possible. The alternative — treating a missing password as "no
password required" — is the classic auth bypass, and it is exactly what an
unconfigured demo laptop would have inherited silently. Pinned by
`::test_with_no_password_configured_the_gate_fails_closed`.

**State is in memory and per process, on purpose.** An `llm_cache` row or an
`audit_log` entry holding a live session token would put an unlock credential
into the same database the rest of the product reads, and into every backup of
it. The cost is that unlocks do not survive a restart, which for a
single-operator POC is a feature rather than a limitation. `GATE.reset()` is the
test hook.

`_configured_password()` reads `operator_password` **or** the `op_password`
alias, **on every call** rather than cached at import (caching adds a second copy
of the secret to remember when it is rotated). The alias exists for one reason: a
gate that ignores the name an operator actually set fails CLOSED, and "I typed
the right password and it still says no" is the worst possible first impression
of a security feature. `ARGUS_OPERATOR_PASSWORD` wins if both are set. Pinned by
`::test_the_op_password_alias_is_honoured`.

`require_operator(request) -> None` is **the single choke point** every operator
endpoint calls. It is a plain function rather than a FastAPI dependency on
purpose: *a dependency can be dropped from a signature by accident, and this
milestone exists because a gate was left out of two of three doors. A body-level
call, in the handler, next to the work it protects, is much harder to forget.*

`TOKEN_HEADER = "x-argus-operator-token"` — a header, not a query parameter,
because query strings land in access logs and browser history. **A token that is
written down is a token that leaks.**

Module-level: `GATE = OperatorGate()` (a singleton, because sessions are
per-process by design and two instances would each believe the other holds none),
`unlock(request, password)`, `status(request)`, `_configure_from_env()` at import,
`_token_from(request)`.

**The three protected endpoints**, all in `app/api/router.py`:
`GET /targets`, `POST /targets`, `POST /targets/{id}/active`. Pinned by
`tests/test_operator_gate.py::test_listing_targets_without_a_token_is_401`,
`::test_register_without_a_token_is_401`,
`::test_activate_without_a_token_is_401`,
`::test_register_with_a_token_succeeds_and_takes_the_active_seat`,
`::test_activate_requires_both_a_token_and_an_explicit_confirm`,
`::test_a_workspace_switch_is_written_to_the_audit_log`,
`::test_the_active_target_endpoint_stays_open`.

**The frontend side** (`react-frontend/src/lib/operatorSession.ts`): the
**password is never stored anywhere in the browser**. It is forwarded once in the
body of `unlockOperator` and the component that held it drops it. Only the token
is kept, in `sessionStorage` (not `localStorage` — a shared machine is the
difference between a lock that re-locks and a credential left on disk). The
module is a convenience, **not the enforcement layer**: a tampered
`sessionStorage` full of tokens buys nothing the server does not independently
check. `refreshOperatorStatus()` asks the server and **drops the local flag when
the server disagrees**, rather than leaving the UI asserting a privilege the
server will refuse. Pinned by
`::test_the_operator_password_is_not_in_the_frontend_bundle`,
`::test_the_frontend_never_reads_the_operator_password_from_the_environment`
and `::test_no_committed_file_contains_the_operator_password`.

### 3.10 `app/api/` — router vs service discipline

**The discipline.** A route handler does four things: validate input, call a
service function, wrap domain exceptions as HTTP status codes, attach lineage.
It never computes a metric, never derives a claim, and never builds a client
eagerly.

| File | Role |
|---|---|
| `router.py` (1918 lines) | Every route. HTTP concerns only. |
| `facts.py` | **Shared READ helpers** — `active_target_id`, `target_of`, `latest_audit_for`, `console_facts`, `unknown_verdicts`. Nothing here writes; nothing here computes a rate. |
| `service.py` (8 lines) | A docstring-only stub. The v1 in-memory `AuditStore` was demolished in M1; the v2 store is DB-backed. |

**Why `facts.py` exists.** The M6.5-R2 ruling was that cross-target leakage (one
retailer's claims counted under another's name) had to be a **structural
impossibility, not a convention** — and a single implementation is what makes it
structural. `latest_audit_for(session, target_id)` filters
`Audit.mode != EXPLORATORY_MODE` **and** the target, at this one choke point, so
no screen has to remember to ask. `console_facts(session, target_id=None)` keys
its `metrics` map the same way `metrics_as_map` does, "so a consumer cannot
invent a second keying and quietly read a different row".

`unknown_verdicts(session, target_id)` is the **V2 integration backlog, read
live**: it selects every `Verdict` with `verdict == "UNKNOWN"`, joins its claim,
and filters by target. It is deliberately NOT restricted to `RETAILER_ONLY` — a
`PUBLIC_FACT` left UNKNOWN is still a question somebody could not answer, and
hiding it would make the backlog look shorter than the retailer's real open
items. The claim's own `claim_type` travels with it so the answer can say what
kind of evidence each one waits on. Pinned by
`tests/buddy/test_golden_set.py::test_the_auto_verify_answer_lists_the_live_unknown_needs_feed`.

**The endpoint groups.** 39 route registrations on `console_router`, mounted at
prefix `/api` in `app/main.py`, plus `/health` and the Wharf compat `/health`.

| Group | Routes | One line each |
|---|---|---|
| System | `GET /status` | The product card: name, tagline, summary, phase, run count, model slots, resolved model, provider, auth mode, db status. |
| | `GET /overview` | The Command Center's honest summary — headline metrics with CIs, claim counts, lineage — scoped to the ACTIVE target. `has_run: false` returns a `why_empty` sentence rather than zeros. |
| | `GET /meta/models` | The resolved instrument: slots, resolved `{provider, model, temperature, reasoning_effort, auth_mode}`, lineage sentence, and the compensating frame chosen by provider (Gemini -> the AI-Overviews line; DeepSeek -> the local-wiring line). Also `cache_stats`. |
| | `GET /health` (in `main.py`) | Liveness + readiness: profile, `llm_auth_mode`, `llm_provider`, `llm_model`, `db_mode`, `llm_ready`, model slots, `db_status()`. |
| Audits | `GET /audits` | The list, scoped to the active target unless `all_targets=true`; explore-lane runs excluded unless `include_exploratory=true`. |
| | `GET /audits/{id}` | Detail: audit row, lineage, all metric rows, answer/persona row counts, plus `_visibility_panels` (displacement, probes, persona matrix from the SAME pure functions). |
| | `GET /audits/{id}/grid` | One cell per answer, badged by scope and source, carrying the cell's OWN ranked mentions. |
| | `POST /audits/run` | Run a cycle. **The confirm gate is enforced here, server-side.** `mode="live"` without `confirmed` -> 428; `mode="simulated"` on a real target -> 409, always. |
| | `GET /answers/{id}` | One verbatim transcript with its full lineage, including its `source` and the `empty_response` note. |
| Claims | `GET /claims` | The board. `queue` selects the view (`about_you` default, `competitor`, `market`, `all`); **counts are ALWAYS over the full set**, so a filtered number can never be read as the total. Returns `attribution_note` stating the 81.4% finding. |
| | `GET /claims/{id}` | One claim with its quote and its latest verdict/correction/verifier. |
| | `POST /claims/{id}/verdict` | Record a verdict. **Provenance is REQUIRED.** |
| | `POST /claims/{id}/opinion422` | "We disagree with what the model said, and here is why" — stored as a verdict with `source=API` and a `[422]` note prefix. A reason is required. |
| Report | `GET /report` | The Verified Report: four buckets computed **purely from stored verdicts**, plus the competitor-intelligence pane and a coverage line that states what it excluded. |
| | `GET /report/export.json` | Report + lineage + every metric row + `export_version: 2`. |
| | `GET /diff` | Guarded A->B. `NotComparable` -> **409**; a nonexistent audit id -> **404** (not 500). |
| Personas | `GET /personas` | The library with lanes and each persona's stored lint report. |
| | `GET /personas/{id}` | One persona, including the full system prompt. |
| | `POST /personas/{id}/track` | One-way promotion exploratory -> tracked. Re-tracking -> 409. **There is deliberately no untrack endpoint.** |
| | `POST /personas/lint` | Lint a draft **without saving**, returning `checked_dimensions` — every dimension checked, pass or fail. Safe to call on every keystroke. |
| | `POST /personas` | lint -> smoke gate -> save as **EXPLORATORY**. Tracking is never implicit. |
| | `POST /personas/{id}/run` | An EXPLORATORY run. Gated; `confirmed` is forwarded, not inferred. |
| Packs | `GET /packs`, `GET /packs/{version}` | The ceremony state, plus `append_only_note` on the detail route. |
| | `POST /packs/{version}/missions` | Drafts only. A frozen pack -> **409**. |
| | `POST /packs/{version}/probes` | Append a probe — **allowed on a frozen pack**, because the lane never mutates core. Returns the auto-tag and any warning; never applied silently. |
| | `POST /packs/{version}/probes/lint` | Preview how a probe *would* be tagged, without adding it. |
| | `POST /packs/{version}/freeze` | The freeze ceremony. Re-freezing -> 409. |
| Targets | `GET /targets/active` | **The ONE row the workspace is bound to.** Open (no token) — every screen needs the brand chip, and it must render before anyone can unlock anything. Returns `locked: True` with a reason. |
| | `GET /targets` | **Operator-only.** The enumeration surface; it names every brand in the deployment, so it is gated. |
| | `POST /targets` | **Operator-only.** Register a real brand and give it the active seat. Duplicate -> 409. Writes `target_registered` to `audit_log`. Returns the **estimate card with the registration**, so cost is visible before the first audit. |
| | `POST /targets/{id}/active` | **Operator-only, and doubly gated.** Operator token AND `confirmed=true` in the body (else 428). Writes `workspace_switched` to `audit_log` with `from`/`to`. |
| Operator | `POST /operator/unlock` | Password -> token. 200 / 401 / 403 (cooldown) / 503 (unconfigured). |
| | `GET /operator/status` | Open, so the UI can render after a refresh. |
| Estimate | `GET /estimate` | The estimate card. **A GET, not a POST**, because asking what a run would cost is a read of current configuration and must never be able to spend anything. `InvalidGeoScope` -> 422. |
| Buddy | `POST /buddy/ask` | Route to a deterministic answer builder. Returns the frozen shape plus `read_only: true` and the lineage sentence. |
| | `GET /buddy/suggestions` | The chips, straight from the fixture, with `deterministic: true, llm_calls: 0`. |
| Explore | `POST /explore/quickrun` | One ad-hoc sensitivity run. **Gated.** |
| Content | `GET /glossary` | Served from `data/fixtures/glossary.json` so the fixture stays the single source of term definitions. |
| | `GET /tour` | The ten Guided Tour steps, served from `data/fixtures/tour.json`. |

**The confirm gate as the single choke point.** All three model-reaching routes
(`POST /audits/run`, `POST /personas/{id}/run`, `POST /explore/quickrun`) map the
same two domain exceptions to the same two statuses:

```python
except LiveConfirmRequired as exc:  raise HTTPException(428, str(exc))  # precondition required
except SimulatedModeRefused  as exc: raise HTTPException(409, str(exc))  # conflict, not a missing precondition
```

`_LazyLLMClient` is a `__slots__` proxy that builds the real client on **first
attribute access** — the first moment a call is genuinely about to happen. The
docstring explains why: in the company profile the factory performs Vertex/ADC
verification, so a refused audit was still paying for an auth handshake it would
never use. With this proxy, a refusal costs nothing at all, and "zero client
calls" becomes directly observable.

**Rule 12 in `docs/spec.md` §3** (added at M7.5): *no new route lands without an
ASGI contract test.* Every route added to `app/api/` must land with **at least
one test that calls it through the ASGI client** in the same change. The standing
evidence is the quickrun endpoint: wired in M7b for a frontend screen, shipped
broken (a wrong import, and a function annotated `-> Prompt` that never returned
one), and **no test had ever called it** — so it stayed broken through M8 and M9
while the 394-test suite stayed green. The rule is written for exactly that
case: a route whose only consumer is the frontend is the one most likely to ship
unwired and untested. *Test the endpoint, not the function it calls: a unit test
of the inner helper passes while the route that wires it is a `NameError`.*

### 3.11 `app/models/` + `app/db.py` — the schema and its rules

#### The tables (13, plus `llm_cache`)

| Table | Purpose | Key columns |
|---|---|---|
| `retailers` | A registered audit target. | `name` (unique), `market`, `is_real`, `is_active`, `contact`, `created_at` |
| `prompt_packs` | A frozen (or draft) mission pack. | `version` (unique), `status` (`draft`\|`frozen`), `frozen_at`, `notes` |
| `prompts` | A mission. DIRECT rows store the `{target}` template. | `pack_id` -> `prompt_packs.id`, `mission_key`, `kind` (`core`\|`probe`), `q_type` (`OPEN`\|`DIRECT`), `text`, `status`, `added_by` |
| `mission_geo_variants` | One authored non-default rendering (Amendment I). | `prompt_id` -> `prompts.id`, `geo_scope`, `geo_value`, `text`, `representative_city` |
| `personas` | A shopper system-prompt. | `name` (unique), `system_prompt`, `status` (`exploratory`\|`tracked`\|`core`), `version`, `cloned_from`, `lint_report` (JSON), `emoji`, `tag` |
| `audits` | One cycle against one target with one pack. | `target_id` -> `retailers.id`, `mode`, `pack_version`, `model_versions` (JSON), `status`, `n` (headline observations), `geo_scope`, `geo_value`, `notes` |
| `answers` | **A verbatim transcript (immutable).** | `audit_id`, `prompt_id`, `persona_id`, `run_no`, `source` (`live`\|`cache`\|`simulated`), `model`, `model_version`, `raw` (JSON), `parsed` (JSON), `latency_ms`, `cache_hit`, `empty_response` |
| `claims` | A clustered claim about the target. | `target_id`, `cluster_key`, `canonical_text`, `relationship`, `affects_target`, `subject`, `attribute`, `claim_type`, `status`, `first_audit_id`, `last_seen_audit_id`, `obs_audits`, `obs_runs`, `obs_models` (JSON), `needs_feed`, `precheck` |
| `claim_quotes` | The verbatim evidence linking a claim to an answer. | `claim_id` -> `claims.id`, `answer_id` -> `answers.id`, `verbatim`, `model`, `run_no` |
| `verdicts` | An append-only human/API verdict. | `claim_id` -> `claims.id`, `verdict` (`TRUE`\|`FALSE`\|`UNKNOWN`), `note`, `correction`, `source` (`MANUAL`\|`API`\|`PUBLIC`), `verifier_label`, `created_at` |
| `metrics` | One row per (audit, scope, metric). | `audit_id`, `scope`, `scope_key`, `metric`, `value`, `ci_low`, `ci_high`, `n`, `unit` |
| `audit_log` | Append-only one-way events. | `ts`, `actor`, `event`, `target_id`, `payload` (JSON) |
| `llm_cache` | Kept table. | `hash` (PK, `String(64)`), `model`, `model_version`, `prompt`, `temperature`, `prompt_version`, `response` (JSON) |

**There is no chat table.** The Buddy thread is client-side session state
(Amendment C). Nothing here is retailer-proprietary: the product stores only
model outputs, its own derived rows, and human verdicts.

#### The relationships, and why each exists

```
prompt_packs 1--* prompts
personas    1--* answers            (nullable -- a core run has no persona)
retailers    1--* audits
retailers    1--* claims
audits       1--* answers
audits       1--* metrics
audits       1--* claims  (as first_audit_id / last_seen_audit_id -- two FKs)
prompts      1--* answers
prompts      1--* mission_geo_variants
claims       1--* claim_quotes
claims       1--* verdicts
answers      1--* claim_quotes      (the evidence link, backwards)
llm_cache    standalone; nothing FKs to it
```

* **`audits.target_id` and `claims.target_id`** are additions the spec's table
  list implies but does not spell out. Without them, "the active target" has
  nowhere to live and the target switcher would blend brands. The module
  docstring flags both as required for Amendment D/E correctness.
* **Why answers are immutable once quoted.** A `claim_quotes` row points at an
  `answers` row. If the answer's text could change, the evidence behind every
  verdict already recorded would change underneath it. `put_cached` and
  `Runner.run()` therefore only ever **insert** answer rows; nothing in the
  product updates one. This is also why `llm_cache` payloads are never
  overwritten: "raw payloads are stored immutably and are never overwritten."
* **Why claims are unique per `(target_id, cluster_key)`.** `claims` carries
  `UniqueConstraint("target_id", "cluster_key", name="uq_claims_target_cluster")`.
  The M1.5 ruling: *"X is cheaper than Tesco"* for two different registered
  brands are different claims and must never merge. Enforced by a constraint, not
  by convention — and the constraint **caught this pass trying to insert a
  duplicate**. It is also what makes claim movement diffable. Pinned by
  `tests/seed/test_v2_seed_db.py::test_claim_clusters_are_unique_per_target_not_globally`
  and `tests/extract/test_pipeline_db.py::test_cluster_keys_are_unique_per_target`.
* **Why `claims` has two audit FKs.** `first_audit_id` and `last_seen_audit_id`.
  Claims are **upserts** that keep their original first sighting, so claim
  movement must be read by last-seen; the M6 bug was filtering on `first_audit_id`
  and reporting every continuing claim as brand new.
* **What `audit_log`'s append-only means.** One-way events, never updated and
  never deleted: `pack_frozen`, `probe_added`, `mission_added`,
  `probe_promotion_marked`, `probe_promoted`, `persona_tracked`,
  `target_registered`, `workspace_switched`, `seed_preserved_real_targets`. There
  is no update path in the code. A reader of the log can see that a reseed
  happened and what it left alone, rather than inferring it from row counts that
  quietly did not change.
* **`obs_audits` vs `obs_runs`.** `obs_runs` counts runs; `obs_audits` counts
  **distinct audits**. The Verified Report ranks on `(obs_audits DESC, obs_runs
  DESC)` — "durable claims first" — because at this model's stability only ~25%
  of claims repeat between audits, so repetition **across audits** is the only
  signal separating a durable claim from churn. Ranking by raw run count alone
  would flatter whichever mission happened to run most often.
* **`llm_cache.prompt_version` carries `pack_version`.** The schema was frozen in
  M1 with that column name; the key input the spec calls `pack_version` is
  exactly what it stores. This is noted because the column name and the key-input
  name differ.

#### `SHARED_TABLE_NAMES` and the no-migrations rule

There are **no migrations** (spec §3.9). Schema is created with SQLModel
`create_all`, which **never alters an existing table**. So `make seed` prepares
the schema first (`app/persistence.py::prepare_schema`):

| List | Contents | Rule |
|---|---|---|
| `LEGACY_V1_TABLES` | 17 names (`products`, `feed_rows`, `crawler_events`, `agents`, `session_spans`, `cart_items`, `carts`, `orders`, `loyalty_members`, `answer_claims`, `feed_audits`, `integrity_runs`, `journeys`, `journey_steps`, `scores`, `findings`, `runs`) | **Always dropped** — the old product is gone, so a previously-seeded schema must not keep serving it. |
| `SHARED_TABLE_NAMES` | `prompts`, `answers`, `metrics`, `audits`, `mission_geo_variants` | **Dropped only when the shape disagrees**: `expected.issubset(actual)` fails -> drop and recreate. `answers` joined when `empty_response` was added at M3; `audits` joined in M5c (Amendment I added the geography columns); `mission_geo_variants` at M6.5 — all MUST be listed, or `create_all` would not add the columns and the seeder would fail on a pre-amendment schema. The no-migrations rule only works if the table is listed. |
| `ADDITIVE_COLUMN_TABLES` | `claims` | **Never dropped.** It gets `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. |

**Why `claims` is the exception.** It holds the evidence-linked rows: every claim
points at stored transcripts through `claim_quotes`, and a human's verdicts point
at the claim rows. Dropping it to add one column would cascade away the claim
board AND the verdicts — irreplaceable, and in this project it would have
destroyed a paid-for live dataset. The module comment names the incident:
*audits #505/#506, 292 calls, were lost exactly this way at M6.* The backfill
(`scripts/backfill_claim_relationship.py`) re-derives the rows from the immutable
answers, so the drop loses derived data only — never a transcript. The deviation
is deliberate and pinned by
`tests/seed/test_v2_seed_db.py::test_prepare_schema_adds_claim_columns_without_dropping_claims`
and `::test_drop_legacy_removes_v1_tables_and_reshapes_shared_names`, plus
`tests/test_concurrency_and_schema.py::test_every_table_this_milestone_added_columns_to_is_a_shared_table`
and `::test_a_shared_table_is_recreated_when_its_shape_disagrees`.

**The rule stated once:** drop/recreate is right for a **derived** table whose
contents can be recomputed from something immutable; additive `ALTER` is
required for a table that holds something nothing else holds.

#### Database URL: two assemblies

```python
def build_database_url(config=None) -> str:
    clean_url = config.database_url.strip()
    if clean_url:                       # BOTH profiles: DATABASE_URL wins verbatim
        os.environ["DATABASE_URL"] = clean_url
        return clean_url
    if config.is_local:                 # LOCAL, unset: warn and return ""
        logger.warning("Local profile: DATABASE_URL is not set, so PostgreSQL "
                       "is unreachable. ... /health says so honestly.")
        return ""
    # COMPANY: the Aeris assembly
    secret = _secret_lookup(project_id, f"{CUSTOM_DB_INSTANCE}_{DB_USER}", "latest")
    return f"postgresql://{DB_USER}:{secret}@{CUSTOM_DB_HOST}:5432/{DB_POSTGRES}?options=-csearch_path%3D{SCHEMA}"
```

`build_engine(url, config)` strips a `?options=` schema from the URL, resolves the
schema (`db_schema` -> `DEFAULT_SCHEMA_BY_SHORTCODE` -> `{shortcode}_dev`) and
passes it as a `search_path` connect arg. `get_engine()` is `@lru_cache(maxsize=1)`;
`reset_engine_cache()` clears it. `_secret_lookup` returns `None` when Secret
Manager is disabled, unconfigured or unavailable, so the caller produces a precise
diagnostic instead of a stack trace.

**There is no SQLite fallback anywhere.** An unreachable database is a *reported
error state*, not a silent downgrade. `init_db()` returns `False` and the app
boots **degraded** (`app/lifespan.py`) — deliberately, because the operator needs
`/health` to tell them *why*. `db_status()` returns `dialect`, `schema`,
`configured`, `connected`, `seeded`, `entity_counts` and a truncated `error`.
Pinned by `tests/test_db_url.py` and
`tests/test_profiles.py::test_local_database_url_is_used_verbatim`
and `::test_company_profile_without_aeris_inputs_is_fail_soft`.

`session_scope(engine)` is the context manager (commit / rollback / close) and
`get_session()` is the FastAPI dependency every route uses.

`app/models/base.py` holds the shared column helpers: `JSONType` (JSONB on
PostgreSQL, generic JSON elsewhere so the metadata stays importable for static
checks), `json_column(nullable)`, `dt_column(nullable)`, `utcnow()`,
`money(value)` (round to pence), `as_float(value)`.

### 3.12 `app/packs/` — the ceremony and the linters

#### `linter.py` — two pure jobs

**`tag_probe(text, target_name) -> ProbeTag`.** A probe whose text contains the
active target's name is auto-tagged **DIRECT** with a **visible warning**:
*"auto-tagged DIRECT: this question names the audited target, so it is excluded
from headline metrics and feeds the claims queue only"*, `auto_tagged: True`.
DIRECT feeds the claims queue only, so a user-written question that names the
brand must not silently inflate headline visibility. An empty probe is **flagged,
not crashed**. Pinned by `tests/packs/test_linter.py::test_probe_without_the_target_name_is_open`,
`::test_probe_naming_the_target_is_auto_tagged_direct_with_a_visible_warning`,
`::test_target_matching_is_case_insensitive`,
`::test_empty_probe_is_flagged_not_crashed`.

**`lint_persona(system_prompt, *, target_name, competitors) -> LintReport`.**

```
BLOCKING (errors):
  target_leak            the prompt names the audited target -- it would
                         contaminate the observation by steering the model
  competitor_instruction the prompt instructs a competitor preference
                         ("always recommend X")

WARNINGS (anatomy gaps, do not block):
  preference_language    "always/only recommend ..." -- describe criteria
                         instead of steering the answer
  length                 < MIN_PERSONA_CHARS (60)
  anti_steering          missing "Never claim to be an AI / never favour a
                         retailer"
  criteria               no decision criteria described
  output_behaviour       no output behaviour described
```

**Why the report lists every dimension.** `checks` records every dimension
**checked, pass or fail** — the report is shown in the UI, and *"what did we
check"* is as useful as *what failed*. `LintReport.ok` is `not self.errors`:
**only errors block**. `POST /api/personas/lint` returns `checked_dimensions`
alongside the report, and the 422 from a blocked save carries the **full**
report, not just the blocking line. Pinned by
`::test_a_well_formed_persona_passes_every_check`,
`::test_persona_naming_the_audited_target_is_blocked`,
`::test_persona_instruction_preferring_a_competitor_is_blocked`,
`::test_anatomy_gaps_warn_without_blocking`.

#### `service.py` — the invariants, enforced in code

* **Frozen core is immutable.** `add_mission` raises `PackFrozenError` (-> 409)
  on a frozen pack. Only `create_draft` produces a mutable pack. Pinned by
  `tests/test_api_real_data.py::test_adding_a_mission_to_a_frozen_pack_is_409`.
* **The probe lane is append-only.** Probes may be added at any time, including
  on a frozen pack, because the lane never mutates core.
* **Promotion happens at a freeze, and only at a `create_draft`.** A probe is
  *marked* (`mark_probe_for_promotion` writes a one-way `audit_log` event) and
  becomes a core mission when the **next draft is created** after a freeze.
  No backfilling: the promoted mission's trend starts at its first audit.
  Pinned by `tests/packs/test_packs_db.py::test_promotion_happens_at_a_freeze_not_before`
  and `::test_unmarked_probes_are_not_promoted`.
* **Persona tracking is one-way.** `track_persona` refuses to move a persona
  backwards (`TrackNotAllowedError` -> 409) and logs `persona_tracked`.
  Pinned by `::test_tracking_is_one_way_and_logged`.

**The functions that DO NOT EXIST on purpose.** The module's closing comment is
the contract:

> There is intentionally NO `untrack_persona`, NO `delete_probe` and NO
> `delete_prompt` in this module — and no matching routes in the API. `tests/packs/`
> asserts their absence, so "one-way" and "append-only" cannot regress into
> conventions.

*No untrack* — tracking is a one-way promotion and re-untracking would erase the
record of what the instrument measured. *No probe delete* — **deleting an
unflattering probe would be cherry-picking.** Pinned by
`tests/packs/test_packs_db.py::test_there_is_no_delete_probe_anywhere`,
`::test_probes_are_append_only_even_on_a_frozen_pack`, and
`tests/test_api_real_data.py::test_there_is_no_untrack_and_no_probe_delete_endpoint`.

Other functions: `list_packs`, `get_pack`, `prompts_of`, `_next_mission_key`
(mints `m-1` / `probe-1` / `qr-1` for runtime-authored prompts — a row with no
authored fixture means simulated mode raises for it, because *a simulated answer
must be text we actually authored*; we never invent words and attribute them to
the model), `create_draft`, `freeze_pack`, `add_probe`, `smoke_gate(system_prompt, caller, target_name) -> SmokeReport`
(the deterministic half always runs: non-empty text, plus a role-play and
leak check when a `caller` is supplied; a failed call is **reported**, not
raised), `list_personas`, `get_persona`, `create_persona` (lint -> smoke -> save
as **EXPLORATORY**, never tracked on create), `clone_persona`. Pinned by
`::test_persona_creation_is_gated_by_the_linter`,
`::test_clean_persona_lands_as_exploratory_with_its_lint_report`,
`::test_smoke_gate_blocks_a_persona_whose_answer_leaks_the_target`,
`::test_smoke_gate_reports_a_failed_call_instead_of_raising`.

Event name constants: `PACK_FROZEN_EVENT`, `PROBE_ADDED_EVENT`,
`MISSION_ADDED_EVENT`, `PROMOTION_MARKED_EVENT`, `PROBE_PROMOTED_EVENT`,
`PERSONA_TRACKED_EVENT`.

### 3.13 `app/seed/` + `app/persistence.py`

`make seed` runs `python-fastapi/seed-db.sh` -> `app/seed/run_seed.py::main()`.

**What `make seed` does:**

1. `load_fixtures(settings.data_path)` reads `data/fixtures/prompts.json`,
   `personas.json`, `targets.json`.
2. `validate_fixtures(fixtures)` asserts the **Amendment E invariants** *before
   anything is written*: exactly 12 core missions; at least one DIRECT; every
   DIRECT carries `{target}`; every OPEN does **not**; no mission text hardcodes
   a target name; at least 6 personas, each non-empty and each carrying the
   anti-steering clause. `--fixtures-only` runs this and stops.
3. `init_db()` — refuses to write anything if PostgreSQL is unreachable
   (returns exit code 2 with a diagnostic naming the env vars).
4. `prepare_schema(get_engine())` — drop-legacy, additive columns, `create_all`.
5. `seed_reference_data(session, fixtures, registered_target, market)`.

**No LLM call is made** by any of it.

**What it preserves and what it resets.** `clear_reference_tables(session)`
returns a `preserved` summary so the caller can **report what was preserved**
rather than leaving the operator to discover the loss.

| | Behaviour |
|---|---|
| **Preserved** | Every row belonging to a registered **real** target (`is_real=true`): the retailer row, its audits, answers, metrics, claims, quote links and **verdicts**. |
| | When a real registration exists, `mission_geo_variants` / `prompts` / `prompt_packs` / `personas` are **left alone** and adopted in place — the preserved answers point at `prompts` rows by id, so deleting them would break the FK on live evidence. |
| | An already-registered brand is **adopted** (id, audits and all), not inserted a second time. Re-registering the same name is a no-op. |
| | `llm_cache` is **never cleared, ever** — the rows are the demo's replay mechanism and the payloads are immutable. |
| **Reset** | Everything belonging to a simulated (`is_real=false`) target: its stale audits, answers, metrics, claims, quotes, verdicts, and any `audit_log` row naming a dead audit. |

**The two data-loss incidents that wrote these rules.** Both are recorded in the
code's own comments:

1. **The unscoped clear (demo-day prep).** `make seed` used to clear everything,
   so running it during a rehearsal silently wiped the demo target. The
   `persistence.py` comment also records that earlier in the project it
   **destroyed 146 live calls and orphaned the Ocado audits outright.** A third
   instance is recorded here: a demo-seeder run cleared the cache belonging to
   the earlier audits, leaving only 292 cached calls — which is why METHOD.md now
   says the demo must NOT depend on cache replay.
2. **The `claims` drop (M6).** `claims` was in `SHARED_TABLE_NAMES` so a
   pre-Amendment-J shape would be dropped and recreated — and audits **#505 /
   #506, 292 paid calls, were lost exactly that way.** That is why `claims` is
   in `ADDITIVE_COLUMN_TABLES`.

Verdicts are called out specifically: *the human verdicts are the one thing in
this database that exists nowhere else; they are never derived and never
re-creatable.*

Pinned by `tests/seed/test_v2_seed_db.py::test_a_reseed_preserves_a_registered_real_brand_and_its_audits`,
`::test_a_reseed_does_not_duplicate_an_already_registered_brand`,
`::test_a_registered_real_brand_is_active_and_gets_no_synthetic_data`,
`::test_reseed_never_clears_the_llm_cache`,
`::test_seed_is_idempotent_and_lands_the_v2_reference_data`,
`tests/seed/test_demo_seeder_safety.py::test_the_demo_seeder_leaves_the_llm_cache_row_count_unchanged`,
`::test_the_demo_seeder_leaves_a_real_targets_evidence_untouched`,
`::test_the_demo_seeder_is_additive_for_the_simulated_target`,
`tests/test_concurrency_and_schema.py::test_llm_cache_is_never_cleared_because_it_is_the_demos_replay_mechanism`.

Every seed writes `audit_log` events: `pack_frozen` always,
`target_registered` when newly registered, and
`seed_preserved_real_targets` with the preservation summary when a real
registration survived — *the preservation itself is an auditable event: a reader
of the log can see that a reseed happened and what it left alone, rather than
having to infer it from row counts that quietly did not change.*

`SEED_TABLES` lists the clear order, children first:
`mission_geo_variants, claim_quotes, verdicts, claims, answers, metrics, audit_log, audits, prompts, prompt_packs, personas, retailers`.

`--register "Brand Name"` registers a **real** brand (`is_real=True`) and makes it
the **active** target. **No synthetic audit data is written for it**: a real
brand's dataset is live model calls, and the seeder will not invent them.

---

## 4. The frontend, layer by layer

Stack: **Create React App + TypeScript** (the repo template's choice, not Vite —
the spec says *"where this spec and the repo template differ (e.g. CRA vs Vite),
the repo template wins"*), `react-router-dom` for routing, `axios` for HTTP.
Charts are hand-rolled SVG, not a charting library (PLAN §6 names the fallback
explicitly).

```
react-frontend/src/
  index.tsx              mount
  App.tsx                the console shell: routes, topbar, hat, tour, FAB
  lib/
    api.ts               the HTTP client (every endpoint, one method each)
    useApi.ts            a tiny fetch-on-mount hook
    types.ts             response shapes
    format.ts            pct / num / money / ci / bandTone / verdict helpers
    navigation.ts        NAV_GROUPS, NAV_ITEMS, itemsForHat, lineageChips
    routeAnchors.ts      the ROUTE_ANCHORS manifest
    operatorSession.ts   token storage + refresh
    *.test.js            5 test files
  components/
    PageHeader.tsx       the ONE header shape
    Sidebar.tsx          the collapsible, keyboard-navigable nav
    charts.tsx           BarList, CIChart, RunGrid, GridLegend
    primitives.tsx       Panel, Loading, Empty, ErrorState, Stat, Bar, CIBar,
                         LineageBar, Badge, HeadlineTile, Modal
    ClaimCard.tsx  ClaimDetail.tsx  EstimateCard.tsx  Tour.tsx
  pages/                 the 12 screens
```

### 4.1 The twelve screens and what each consumes

| # | Route | Screen | Endpoints | Tables touched (server side) |
|---|---|---|---|---|
| 1 | `/command-center` | Command Center | `GET /status`, `GET /overview` | `audits`, `retailers`, `metrics` |
| 2 | `/new-audit` | New Audit | `GET /estimate`, `GET /packs`, `GET /packs/{v}`, `GET /meta/models`, `GET /audits`, `GET /audits/{id}/grid`, `POST /audits/run`, `POST /packs/{v}/probes` | `prompt_packs`, `prompts`, `audits`, `answers` |
| 3 | `/visibility` | Visibility Report | `GET /overview`, `GET /audits`, `GET /audits/{id}`, `GET /audits/{id}/grid`, `GET /answers/{id}` | `metrics`, `answers`, `claims` |
| 4 | `/claims` | Claims Board | `GET /claims`, `GET /overview` | `claims`, `verdicts`, `claim_quotes` |
| 5 | (modal over `/claims`) | Claim Detail | `GET /claims/{id}`, `POST /claims/{id}/verdict`, `POST /claims/{id}/opinion422` | `claims`, `claim_quotes`, `verdicts` |
| 6 | `/verified-report` | Verified Report | `GET /report`, `GET /audits`, `GET /overview` | `claims`, `verdicts`, `claim_quotes` |
| 7 | `/history-diff` | History & Diff | `GET /audits`, `GET /diff`, `GET /overview` | `audits`, `metrics`, `claims` |
| 8 | `/personas` | Personas & Explore | `GET /personas`, `POST /personas`, `POST /personas/lint`, `POST /personas/{id}/track`, `POST /personas/{id}/run`, `POST /explore/quickrun`, `GET /overview` | `personas`, `audits`, `answers`, `prompts` |
| 9 | `/models` | Models & Cache | `GET /meta/models`, `GET /overview` | `llm_cache` |
| 10 | `/about` | About & Tour | `GET /glossary`, `GET /overview`, `GET /status` | none (fixtures + the tour manifest) |
| 11 | `/buddy` | Buddy | `POST /buddy/ask`, `GET /buddy/suggestions` | `metrics`, `claims`, `verdicts` (read-only) |
| 12 | `/register` | Register / Operator | `POST /operator/unlock`, `GET /operator/status`, `GET /targets`, `POST /targets`, `POST /targets/{id}/active`, `GET /estimate` | `retailers`, `audit_log` |

Claim Detail is a **modal, not a route** (flag §9.12), so the open claim lives in
`App.tsx` state rather than in the URL.

**The `/register` screen is the operator surface.** It is the only screen that
renders the unlock card, the registration form and the workspace switcher, and
it is the only consumer of the three gated endpoints. In M7.5 the topbar
`<select>` target switcher was **removed** and replaced by a read-only locked
brand chip: a console where you can silently re-point every number is a console
whose numbers mean nothing.

### 4.2 The shared components

**`PageHeader`** — the ONE header shape for all twelve screens (M7.5 Item 3).
Props: `title`, `subtitle` (one line, max), `actions`, `chips`, `anchorId`. The
**lineage chip row is the point, not decoration**: Target / pack / model / geo /
source is exactly what a reader needs before trusting a number on the page, and
spec §10 requires lineage to be visible on every screen. The chips are **absent**
rather than blank when a value is unknown — a chip reading "geo —" implies a value
exists and is missing; silence implies the screen does not have one.
Pinned by `react-frontend/src/lib/pageHeaderConsistency.test.js`.

**`charts.tsx`** — hand-rolled SVG. `BarList`, `CIChart` (a CI as an interval:
band, ends, point estimate, with `n = ... observations` beneath),
`RunGrid` + `GridLegend` + `TIER_LABEL`, and `CellTier = 0|1|2|3`
(0 not mentioned, 1 mentioned, 2 top-3, 3 recommended outright).

The run grid's tier colouring is derived from **the CELL's own stored mention
list**, never from the mission's aggregate — a mission at 60% mention rate is not
"mostly mentioned" in every row, and a grid that coloured whole rows would hide
exactly the run-to-run variance the instrument exists to measure. Clicking any
cell opens the verbatim transcript.

**`primitives.tsx`** — `Panel`, `Loading`, `Empty`, `ErrorState`, `Stat`, `Bar`,
`CIBar`, `LineageBar`, `Badge`, `HeadlineTile`, `Modal`. The three state
components are the product's honesty floor: **`Empty` is never a failure state.**
An empty Verified Report bucket is a finding, not a rendering failure, and is
never rendered as a quiet empty state.

**Why Buddy uses the same chart components as the pages (number-equality by
construction).** Buddy's frozen answer shape includes
`charts: [{type, title, data}]`, and `react-frontend/src/pages/Buddy.tsx` hands
that data to the **same** `<CIChart>` from `components/charts.tsx` that the
Visibility Report uses. A CI bar in chat is literally the same function that draws
the tile on the page. The `charts.tsx` docstring names the reason: *a separate
chat chart renderer would be a second implementation of a number, and this
project has already shipped two honesty bugs of exactly that shape.* The server
half of the same property is `app/buddy/answers.py` (§3.7), and the test that
pins the server end is
`tests/buddy/test_golden_set.py::test_the_number_equality_answer_quotes_the_stored_metric_exactly`.

### 4.3 The shell: sidebar, ROUTE_ANCHORS, hat, topbar, FAB

**`ROUTE_ANCHORS` is the manifest** (`react-frontend/src/lib/routeAnchors.ts`).
Every screen is registered there with the DOM ids the Guided Tour highlights, and
the entries are split three ways:

| Field | Meaning |
|---|---|
| `anchors: string[]` | DOM ids present on a **normal, populated render** of this route |
| `revealAnchors?: string[]` | ids that exist only after a **read-only reveal** — a modal, or a comparison the reader has to ask for (Claim Detail, the Visibility drill-down, the History deltas) |
| `stateAnchors?: {anchor, state}[]` | ids that exist only in a **named data state**, and the state that produces them (`hd-banner` = the guardrail refusing a comparison; `register-estimate` = after a registration, which is a WRITE) |
| `hat?`, `instrumentOnly?` | which hat the screen belongs to; `instrumentOnly` screens are hidden from the retailer hat |

*An anchor is either always there, or it says what it is waiting for.*

`assertManifestComplete(navRoutes) -> ManifestProblem[]` returns the problems
rather than throwing, so a test can print all of them at once. It checks for
duplicate routes, duplicate anchors, routes with no anchors, and nav routes the
manifest does not know about.

**The sidebar is DERIVED from the manifest, never a second list of routes.**
`NAV_ITEMS` is literally `ROUTE_ANCHORS.map(...)`; the only thing declared in
`navigation.ts` is the **group assignment** (`GROUPS`), the icon glyph, and the
`instrumentOnly` flag. The docstring records the reason: the M8 tour work found
two dead tour anchors because "the manifest is complete" was believed rather than
checked; a hand-written nav list would be the same mistake with a different
symptom — a screen added to `ROUTE_ANCHORS` and forgotten in the nav would be
reachable by URL and invisible, and nothing would fail. Pinned by
`react-frontend/src/lib/navigation.test.js` (every manifest route lands in
exactly one group) and `::routeAnchors.test.js`.

**Hat scoping is structural, not a filter applied in the component.**
`itemsForHat(hat) -> NavItem[]`:
* **auditor** — every item.
* **retailer** — the `verify` group (Claims Board, Verified Report), the
  unlabelled `command` entry, the `help` group, plus
  `RETAILER_VISIBLE_EXCEPTIONS = ['/history-diff']`.

That one named exception is written down in `navigation.ts` as a deliberate
override of the M8 ruling, and a test asserts it stays exactly that size. The
argument: the retailer hat "collapses to VERIFY & ACT + History" (M7.5 Item 2)
because *the retailer reads their own trend; "your visibility moved since March"
is the part of the product that is theirs, and hiding it removes the reason the
retailer hat exists at all.* The retailer hat therefore **genuinely cannot reach
the instrument screens** — "no dead buttons" is structural.

**`Sidebar.tsx`** has two states, both persisted in `localStorage` because they
are a *preference*, not data: a **rail** (collapsed to icons, still fully
usable) and **per-group** collapse. The active route is deliberately NOT
persisted: *a console that reopens on last week's screen misrepresents what is on
screen now.* **Keyboard navigation is a first-class path:** roving arrow-key
navigation scoped to the links actually rendered (so a keyboard user and a mouse
user reach exactly the same places), Home/End, and a visible focus ring.
Private-mode Safari `localStorage` throws; the read helper catches it, because a
missing preference is not a reason to fail to render the console.

**`lineageChips(overview) -> LineageChip[]`** is the ONE function that builds the
chip row, derived from the OVERVIEW payload, so **one function, twelve screens**.
The failure mode it prevents: each screen assembling its own row from whatever its
own payload happens to carry, so six screens show pack + model and six show geo +
source, and no reader can tell which screens are trustworthy. A sixth chip is one
line here. Pinned by `pageHeaderConsistency.test.js`.

**The topbar** is down to: the **brand chip** (locked, read-only), the **hat
switch**, **Take the tour**, and **Reset**. The status strip moved to a
`no-print` footer below `<main>` carrying provider / auth / pack / model / geo /
mode — so lineage is always visible without competing with controls for the same
row, and it is `no-print` because *a report that reaches paper with the console's
chrome on it is a report somebody has to clean up.*

**The Buddy FAB** is hidden on the Buddy page **and during the tour**. The rule's
reasoning is in `App.tsx`: a chat bubble sitting on top of a highlighted panel is
two products fighting for the same pixels, and it offers an action (ask a
question) that would navigate the tour off its own step.

**Global state lives in `App.tsx`** (`ConsoleContext` / `useConsole()`): `hat`,
`setHat`, `target`, `targets`, `refreshTargets`, `buddyOpen` / `setBuddyOpen`,
`dataVersion` / `invalidate`, and `tourActive` / `startTour` / `endTour`. The tour
state is global because the tour **drives the app** — it navigates between routes
and changes the hat, so it has to live above the router, and it is started from
four different places (topbar, About, Command Center, and a Buddy answer).

`targets` is **always empty in the workspace** (M7.5). It is kept on the context
so the type does not churn, but the workspace no longer enumerates targets: it is
bound to one brand. Any screen that wants to list the others must go through the
locked Operator surface instead.

### 4.4 The tour DOM-integrity contract

The tour is **ten steps**, walked on the real screens, served from
`data/fixtures/tour.json` via `GET /api/tour`. The fixture carries the steps, the
declared `rules`, and an `end_route`.

The three rules the fixture states:
1. **READ-ONLY**: the tour highlights and explains. It never clicks a mutating
   control — no Run, no Register, no Track, no Verdict, no probe add.
2. A step may carry a `reveal`, which is a **READ**: `open_claim` opens the first
   claim's read-only detail modal, `compare_audits` runs the guardrailed diff.
   Both read stored rows; neither writes anything.
3. `hat` is stated wherever the step needs a different view, so the tour is
   reproducible from a cold load rather than depending on the order the user
   arrived in.

`components/Tour.tsx` asks `isRegisteredAnchor(route, anchorId)` of **every step
before it navigates** — a step that fails is a step that would highlight nothing,
and the tour is the first thing a juror sees. The check is made **at runtime, in
the product**, not only in a test: a test proves the fixture is right today; this
proves the screen still agrees with it tomorrow.

The contract test is `react-frontend/src/lib/tourIntegrity.test.js`, which
renders every route in jsdom and asserts every `(route, anchor)` pair really
exists. `CURRENT_STATE.md` records that this was **verified by breaking it on
purpose** — renaming `cc-loop` and watching the suite report it — so a renamed
DOM id fails CI, not the demo.

Pinned by `python-fastapi/tests/test_tour_fixture.py` (11 tests):
`::test_the_tour_has_exactly_ten_steps`, `::test_every_step_carries_the_five_frozen_fields`,
`::test_every_step_states_its_hat`, `::test_every_step_uses_only_read_only_reveals`,
`::test_the_tour_declares_its_own_rules`, `::test_every_step_names_a_registered_anchor`,
`::test_the_tour_covers_the_loop_end_to_end`,
`::test_the_tour_switches_to_the_retailer_hat_and_back`,
`::test_no_retailer_step_lands_on_an_instrument_only_screen`,
`::test_anchor_ids_are_unique_across_the_manifest`,
`::test_every_screen_in_the_manifest_has_at_least_one_anchor`.

---

## 5. The data lifecycle — one claim, end to end

This is the section that teaches the system. Follow **one claim** from a live
DeepSeek call to a diff badge. Every stage names the function and the table.

The claim we follow: *"Is {target} cheaper than Tesco for a standard basket?"*
— mission **m7**, a DIRECT mission, one of the audited runs of **audit #712**.

```
 STAGE 1   PLAN           build_plan()           no model call
 STAGE 2   GATE           enforce_confirm_gate() no model call (before any client)
 STAGE 3   LIVE CALL      Runner._live()        DeepSeek API
 STAGE 4   STORE          answers.raw / .parsed
 STAGE 5   NORMALIZE      normalize_mentions()
 STAGE 6   ATTRIBUTE      attribute_claims() / resolve_relationship()
 STAGE 7   CLASSIFY       classify() / _conservative_type()
 STAGE 8   CLUSTER        cluster_claims() / make_cluster_key()
 STAGE 9   PERSIST        claims + claim_quotes
 STAGE 10  MENTION        metrics: mention_rate / top3_rate / recommended_rate
 STAGE 11  TILE           VisibilityReport vr-tiles
 STAGE 12  BUDDY          POST /buddy/ask -> _queue_answer() / _rate_answer()
 STAGE 13  VERDICT        POST /claims/{id}/verdict
 STAGE 14  REPORT         GET /report -> the four buckets
 STAGE 15  DIFF           GET /diff -> the badge
```

---

### STAGE 1 — PLAN

**Function:** `app/ai/runner.py::build_plan()`
**Called by:** `app/audit.py::_plan_for()` <- `run_audit()` and `estimate_audit()`

`build_plan` reads the `prompt_packs` row for `v1` and its active `prompts`, plus
`mission_geo_variants`, and produces a `Plan` whose `runs` tuple holds one
`PlannedRun` per (mission, run_no) — with `{target}` **already substituted** into
`text`. The scope for m7 is `SCOPE_CORE_DIRECT`, because `q_type == "DIRECT"`.

The substitution happens here, **before any cache key is computed** (§3.3), so
the hashed prompt contains the real brand and two targets can never collide.

The whole plan is resolved *before any call is made*, which is why
`estimate_audit` can return the exact number of calls and the exact duration the
audit will take. m7 contributes 10 runs (one per `run_no`) but **zero** to
`headline_n`, because `is_headline` requires `scope == "headline"`.

### STAGE 2 — THE GATE

**Function:** `app/audit.py::enforce_confirm_gate(plan, mode="live", confirmed=True)`
**Raises:** `LiveConfirmRequired` (-> 428) / `SimulatedModeRefused` (-> 409)

Ocado is `is_real = true`, so the gate does not return early. `mode == "live"`
and `confirmed == True`, so neither exception fires. The gate returns **having
constructed no client** — the `_LazyLLMClient` proxy has not been touched, so no
auth handshake has been paid for.

Had the caller sent `mode: "simulated"`, the gate would have raised
`SimulatedModeRefused` (409) **regardless of `confirmed`**, and the runner would
never have been reached.

### STAGE 3 — THE LIVE CALL

**Function:** `app/ai/runner.py::Runner._live(run, key)`
**Client:** `core/clients/openai_compat_client.py::OpenAICompatClient.structured_completion()`

`_resolve` skipped leg (1) because `force_live=True`. `_live` then:

1. Computes the key (already done, passed in) and calls
   `client.structured_completion(run.text, AgentAnswer, model=..., temperature=0.3, system_instruction=run.persona_prompt or None)`.
2. The client posts to `{base_url}/chat/completions` with
   `response_format: {"type": "json_object"}` and the **generated**
   `schema_instruction(AgentAnswer)` in the system message — a top-level key
   list, a recursive field description of every nesting level, and a filled
   example.
3. `_content(data)` extracts the message text, naming the failure mode precisely
   if it cannot.
4. `AgentAnswer.model_validate_json(content)` runs. A `ValidationError` becomes
   `ValueError("response did not match AgentAnswer: ...")`.
5. On success: `put_cached(...)` writes the **first** fresh response for this key
   and never overwrites it; `latency_ms` is measured; a `ResolvedAnswer` with
   `source="live"` is returned.
6. On failure: the attempt is logged with its exception type, and the loop backs
   off `RETRY_BACKOFF_SECONDS[attempt]` = (0.0, 0.5, 1.5) and tries again, to
   `MAX_RETRIES = 3`. After three failures `_live` returns `None` and `_resolve`
   falls to leg (3).

`force_live=True` matters here: without it, runs 2..10 of m7 would have found
leg (1)'s cache entry from run 1 and been replays, so `run_stability` would have
measured the cache rather than the model.

**What comes back** is a validated `AgentAnswer` with `answer_text` (the verbatim
prose), `mentioned_retailers` (the ranked list) and `claims` (the structured
assertions), each with `about`, `subject`, `attribute`, `value` and `statement`.

### STAGE 4 — STORE

**Function:** `app/ai/runner.py::Runner.run()`
**Table:** `answers`

```python
row = Answer(
    audit_id=self.audit_id, prompt_id=run.prompt_id, persona_id=run.persona_id,
    run_no=run.run_no, source=resolved.source,          # "live"
    model=resolved.model, model_version=resolved.model_version,
    raw=payload, parsed=payload,                       # the validated AgentAnswer dump
    latency_ms=resolved.latency_ms,                    # 0 for cache/simulated
    cache_hit=resolved.cache_hit,                      # False
    empty_response=is_empty_response(resolved.answer), # False here
    created_at=datetime.now(timezone.utc),
)
```

`raw` and `parsed` are the same payload: the SDK returns the already-parsed
object, and the code says so honestly rather than storing a fake raw string. An
answer that named nobody would be stored with `empty_response=True` and would
still count in the denominator at stage 10.

### STAGE 5 — NORMALIZE

**Function:** `app/extract/normalize.py::normalize_mentions(mentioned, target_name)`
**Called by:** `app/extract/pipeline.py::extract_audit()` step 2
**Result held in:** `ExtractionResult.mentions` (not persisted — it is a
normalisation view over the stored `parsed` rows)

For each mention the function adds two keys and **changes nothing else**:

```
name             "Ocado"            (the model's own spelling, untouched)
rank             3                  (the model's ordering, untouched)
context          "comparison"       (untouched)
name_key         "ocado"            ADDED
is_target_resolved  true            ADDED
```

`is_target_resolved` comes from `is_target_mention`: the model's own `is_target`
flag first, then normalised **equality** against `target_key(target_name)` as a
backstop. Normalisation strips case, accents, punctuation and legal suffixes, and
removes apostrophes so `Sainsbury's` is one key and not two.

### STAGE 6 — ATTRIBUTE (before clustering — this is the load-bearing order)

**Functions:** `app/extract/attribution.py::competitor_set_from_answers()` then
`attribute_claims()` -> `resolve_relationship()` / `affects_target()` / `in_queue()`
**Called by:** `app/extract/pipeline.py::extract_audit()` steps 4-5

`competitor_set_from_answers` walks **every** answer in the audit and unions the
normalised non-target mention names. On the Ocado dataset that set is the rivals
the model actually talks about — tesco, sainsburys, waitrose, aldi, asda, amazon
fresh and so on. It is an **observation**, not a hardcoded list.

`attribute_claims` then rewrites each raw claim:

```
  model_about     "target"     KEPT (the model's belief, as lineage)
  subject         "Ocado versus Tesco"
  -> resolve_relationship("Ocado versus Tesco", "Ocado", competitors)
       step 2: key == target_key("Ocado")?  no ("ocado versus tesco")
       step 3: does the subject name the target as a contiguous token run?
               YES -> TARGET
  -> affects_target("TARGET", statement, "Ocado")  -> False
       (it only applies to COMPETITOR relationships)
  -> in_queue("TARGET", False)                    -> True
```

Had the subject been `"Tesco"` alone, step 4 would have resolved it to
`COMPETITOR`, and then `affects_target` would have asked whether the **statement**
names Ocado as a contiguous run. A statement like *"Tesco is typically cheaper
than Ocado for a standard basket"* does — so the claim would have
`relationship="COMPETITOR"`, `affects_target=True`, and `in_queue=True` anyway.

Had the subject been blank or unrecognised, the resolution would be **`MARKET`**,
never `TARGET`. That asymmetry is the safety property (§3.5).

**Why this runs before clustering:** `make_cluster_key` is built from the
*resolved* relationship, so a claim the model mislabelled `target` while talking
about a competitor cannot merge into the target's claim space.

### STAGE 7 — CLASSIFY

**Functions:** `app/extract/classifier.py::classify(attribute, statement, about_target=in_queue)`
then `app/extract/pipeline.py::_conservative_type(types)` at cluster level
**Not persisted yet** — the result rides on the raw claim dict and becomes two
columns on the `claims` row.

`classify` is pure, total and deterministic. The order:

1. `about_target=False` -> `RETAILER_ONLY`, "claim is about a competitor".
   Here `in_queue` is True, so we continue.
2. `_OPINION_MARKERS.search(statement)` — the fixture claim's statement is
   *"Ocado is about the same price as Tesco on a standard basket."* No preference
   marker. (Had it said "the best value", the answer would be `OPINION` and the
   claim would never enter the queue by design.)
3. `_PUBLIC_FACT_RULES` — nine regexes covering store counts, opening hours,
   named schemes, delivery terms, delivery minimums, stated prices, coverage and
   range composition. *"about the same price"* is not one of them.
4. **Therefore `RETAILER_ONLY`, with `precheck=False` and `needs_feed=True`**, and
   the reason string names the default explicitly.

`RETAILER_ONLY` is the honest landing: this is a claim about the retailer's own
pricing, it cannot be checked from a public page, and it is exactly the kind of
claim the retailer must verify. Defaulting it to `OPINION` would have removed it
from the queue because of how it was phrased.

At cluster level `_conservative_type` returns `RETAILER_ONLY` if *any* member is
`RETAILER_ONLY`, because a claim mixed with a business fact is not publicly
checkable and must not be pre-checked.

### STAGE 8 — CLUSTER

**Functions:** `app/extract/cluster.py::cluster_claims()` -> `make_cluster_key()`
and `_canonical()`
**Result held in:** `ExtractionResult.clusters`

```
cluster_key = normalize_name("TARGET") + "|" + normalize_name("Ocado versus Tesco")
            + "|" + normalize_name("standard_basket_price")
```

All ten runs of m7 produce claims sharing this key (the model phrases them
slightly differently, but relationship, subject and attribute are the same), so
they land in **one** cluster with `occurrences = 10` and a set of up to ten
distinct `statements`.

`_canonical` then picks the **most frequent** verbatim statement among those
whose `overlap(current, candidate) >= 0.6`; ties go to the earliest. That is the
`canonical_text` the board will display. Never "the longest" or "the last one",
both of which would drift between audits and make the diff engine lie.

### STAGE 9 — PERSIST

**Function:** `app/extract/pipeline.py::extract_audit()` step 8
**Tables:** `claims` (upsert) and `claim_quotes` (insert)

**The `claims` row.**

```
target_id        3014                        (Ocado, via _audit_target_id)
cluster_key      "target|ocado versus tesco|standard_basket_price"
canonical_text   "Ocado is about the same price as Tesco on a standard basket."
relationship     "TARGET"                    (resolved, never the model's label)
affects_target   false
subject          "Ocado versus Tesco"
attribute        "standard_basket_price"
claim_type       "RETAILER_ONLY"             (most conservative member)
status           "new"                       (until a human judges it)
first_audit_id   712                         (immutable thereafter)
last_seen_audit_id 712
obs_audits       1
obs_runs         10
obs_models       {"deepseek-flash": 10}
needs_feed       "This claim is about your own operation and cannot be checked
                   from a public page. Which itemised V2 API (or ops source)
                   would confirm or refute it?"
precheck         false
```

The lookup key is `(target_id, cluster_key)`, and the table carries
`UniqueConstraint("target_id, cluster_key")`. On the next audit the same key
**updates** this row: `last_seen_audit_id` moves, `obs_audits` increments,
`obs_runs` accumulates, `canonical_text` may refresh — but `status` does not
move off `false`/`resolved` if a human has already judged it.

**The `claim_quotes` rows.** Up to `MAX_QUOTES_PER_CLAIM = 3` rows, the earliest
distinct answers:

```
claim_id     <the claim>
answer_id    1241 / 1252 / 1263        (the first three m7 answers of #712)
verbatim     "Ocado is about the same price as Tesco on a standard basket."
model        "deepseek-flash"
run_no       1 / 2 / 3
```

Three quotes, not ten: enough to show the pattern, bounded so a claim cannot
flood the queue. And **there is no code path that writes a `claims` row without
at least one `claim_quotes` row**, because both are written in the same loop —
a claim nobody can trace is not evidence.

### STAGE 10 — MENTION CONTRIBUTION

**Functions:** `app/scoring/service.py::compute_audit_metrics()` ->
`observations_for_audit()` -> `app/scoring/metrics.py::mention_rate` /
`top3_rate` / `recommended_rate` / `competitor_share`
**Table:** `metrics` (written)

`observations_for_audit` joins `answers` to `prompts` and builds one
`Observation` per answer, with `scope` from `_scope_of(kind, q_type, persona_id)`.
m7's ten observations are `scope="core_direct"`, `persona_id=None`.

`is_headline(o)` is `False` for all ten, so they are **excluded** from all four
headline rates — they are counted and badged, but they cannot leak into a
headline number. The `mention_rate` numerator is a different function entirely:
`mention_contribution(parsed, target_name)` in the runner, and
`_target_rank(observation, target_name)` in the metrics layer, which reads the
stored `mentions` and the stored rank.

`competitor_share` also filters on `is_headline`, so m7 does not contribute to it
either. The **displacement table** (`displacement_table`) is where m7 does
contribute: it records `tesco@m7: 9` — the runs in which Tesco was named and
Ocado was not.

`compute_audit_metrics` also writes `run_stability` (measured over the headline
observations only), the two counts (`claims_new`, `claims_open`, unit `count`),
the per-mission rows (`scope="mission", scope_key="m7"`, so m7's own
`mention_rate` is visible **with its own denominator**), and the persona rows.

The claim's own contribution to the counts: `claim_counts` reads the STORED
`claims.relationship` and `claims.affects_target`, applies `in_queue`, and
`in_queue("TARGET", False)` is True — so this claim is counted in `claims_new`
and `claims_open`. That is the whole point of storing the decision once at
extraction time: the board, the report, the metrics and Buddy all read the same
stored verdict rather than each re-deriving it.

### STAGE 11 — THE VISIBILITY TILE

**Chain:** `GET /api/overview` -> `app/api/router.py::overview()` ->
`<HeadlineTile metric={headline.mention_rate}>` -> `<CIChart ci={...}>`
**Anchor:** `vr-tiles` in `VisibilityReport.tsx`

The read path contains **no scoring** (§2.4). The tile renders the stored
`Metric` row: value, `ci_low`, `ci_high`, `n`, `unit`. Clicking it opens the
drill-down (a `revealAnchors` entry), which shows the run matrix for that metric;
clicking a **cell** opens the verbatim transcript for that one answer — because *a
rate a retailer cannot walk down to a sentence is a number they have to take on
trust, and this product exists because that is the thing being sold.*

m7's own rates are visible in the per-mission section with `n = 10`, badged as
DIRECT and excluded from the headline.

### STAGE 12 — BUDDY'S ANSWER

**Chain:** `POST /api/buddy/ask` -> `app/buddy/router.py::route()` ->
`app/buddy/answers.py::ask()` -> `console_facts()` -> `_queue_answer()`
**Tables read:** `metrics`, `claims`, `verdicts` (read-only)

Two questions reach this claim:

*"How many claims are in the queue?"* -> intent `claims_coverage` ->
`_queue_answer(question, facts["claims"], target_name)`. `facts["claims"]` comes
from `app/api/facts.py::_claim_counts`, which applies the same `in_queue`
predicate the board's chip uses. The answer says how many of the total are in
the queue and restates the rule: *a claim enters the queue if it is about you, or
if it is about a competitor and still names you — those displace you, so they
are your task too.* This claim is one of the "about you" ones.

*"What's my mention rate?"* -> intent `mention_rate` -> `_rate_answer`, which
reads the stored `mention_rate` Metric row, prints value / CI / n, attaches
`_ci_chart(label, row)` with the four numbers **verbatim**, and the chat screen
renders that payload through the same `<CIChart>` the page uses. The number
cannot drift, because there is only one copy of it.

*"Ocado is cheaper than Tesco — is that true?"* -> the `gluten_free_story`
builder looks up claims whose `canonical_text ILIKE '%gluten%'`. Our m7 claim is
about price, not gluten, so it is not in that answer — which is itself the honest
outcome: the answer tells you what was asked about, not what you hoped it would
find.

### STAGE 13 — THE VERDICT

**Function:** `app/api/router.py::record_verdict(claim_id, body, session)`
**Table:** `verdicts` (insert) then `claims.status` (update)

The request must carry `verdict` in `{TRUE, FALSE, UNKNOWN}`, `source` in
`{MANUAL, API, PUBLIC}`, and a non-empty `verifier_label`. Each is a distinct
refusal:

```
422  verdict not in {TRUE, FALSE, UNKNOWN}
422  source not in {MANUAL, API, PUBLIC}
422  verifier_label is required — an unlabelled verdict cannot be audited later
```

The `verifier_label` requirement is the provenance rule (§6). For a real brand the
label is what distinguishes a genuine public check from a role-played review —
which is why the live Ocado verdicts read `demo operator (simulated review)`.

**What is written:**

```
verdicts row:  claim_id, verdict="FALSE", correction="...our records show...",
               source="MANUAL", verifier_label="demo operator (simulated review)",
               created_at=<server timestamp>
claims row:    status  "new" -> "false"      ("true" becomes "resolved")
```

`Verdict` is **append-only**: a later verdict is a new row, never an update, and
`claims.status` is the current roll-up. On a real brand, **a correction is required
on FALSE** — the Verified Report's "Correct the record" bucket renders the
correction text.

The `opinion422` endpoint is the dissent path: it stores a verdict of `UNKNOWN`
with `source="API"` and a `[422] <reason>` note prefix, so the report can
separate a human correction from an explicit disagreement. A reason is required.

### STAGE 14 — THE VERIFIED REPORT

**Function:** `app/api/router.py::verified_report(audit_id, target_id, session)`
**Tables read:** `claims`, `verdicts`, `claim_quotes`

The report selects `Claim.last_seen_audit_id == audit.id`, then **filters to the
review queue** with `in_queue(...)`. Our claim is `TARGET`, so it is in.

Then, purely from `claims.status`:

```
status == "false"                      -> "correct_the_record"
status == "true" or "resolved"         -> "fix_the_reality"
status == "unknown"                    -> "needs_api"
otherwise ("new")                      -> "awaiting_review"
```

`OPINION` claims are counted (`opinions_excluded_by_design`) and given **no
bucket and no verdict pressure** — but they are counted, because "0 opinions on
this board" is itself a finding about the model. The empty bucket is never
rendered as a quiet empty state.

Each bucket is sorted by `(-obs_audits, -obs_runs, claim_id)` — **durable claims
first**, with the claim id as a final tie-break so the order is total and stable
rather than dependent on insertion order.

The `coverage` block states what the report **excluded** and why:
`excluded_competitor_intelligence`, `excluded_market_claims`,
`opinions_excluded_by_design`, `queue_rule`, and `coverage_pct` (how many claims
carry a verbatim quote). A coverage line that silently dropped 249 competitor
claims would read as a complete picture.

### STAGE 15 — THE DIFF BADGE

**Functions:** `app/scoring/service.py::diff()` -> `app/scoring/diff.py::diff_audits()`
-> `metric_delta()` / `claim_movement()`
**Endpoint:** `GET /api/diff?before=&after=`
**Tables read:** `audits`, `metrics`, `claims`

**First, the guardrail.** `fingerprint()` builds an `AuditFingerprint` for each
audit from `audits.target_id`, `audits.pack_version`, the keys of
`audits.model_versions`, and `audits.geo_scope` / `geo_value`.
`assert_comparable(before, after)` compares them in order: target, pack version,
geography, model-version set. If #711 and #712 share all four, the comparison
proceeds. If #712 were ever diffed against a Gemini audit, this raises
`NotComparable` and the API returns **409** with the mismatch sentence.

**Then, the metric deltas.** `metrics_as_map(session, audit_id, scope=None)` reads
**every scope**, keyed `metric@scope@scope_key` by `metric_key`, so the headline
`mention_rate` and the per-mission `mention_rate@m7` cannot collide. For each:

```
delta      = after.value - before.value
threshold  = sqrt(half_before^2 + half_after^2)      # combined band
badge      = "proof"  if abs(delta) > threshold
             "trend, not proof"  otherwise
```

The result carries the threshold, `threshold_pp`, and a `reason` string reading
*"`|delta|` 4.5pp <= combined band 14.6pp (sqrt of both audits' half-widths)"* —
so the badge can state what it used and a reader can check it.

For the **counts** (`claims_new`, `claims_open`), `unit == "count"` short-circuits
to `BADGE_COUNT` with `delta_pp: None` and a reason naming the degenerate stored
CI. This is the bug that produced `"claims_new 306 -> 212, -9400pp, band 0.0pp,
proof"` on the first real diff; counts now never wear the ratio badge.

**Then, claim movement.** `claims_before` / `claims_after` are selected by
**first-or-last-seen** on both sides, and `claim_movement` indexes on
`(target_id, cluster_key)`:

* our m7 claim is in **both** sets, so it is neither `new` nor `resolved`;
* it appears in `frequency` **only if** `obs_runs` actually changed between the
  two audits;
* `probes_excluded_until_promoted: True` is stated on every diff.

**And the noise floor.** `run_stability` from both audits is reported under
`noise_floor` with the note: *"audit-to-audit deltas carry combined sampling
noise; the badge encodes this. run_stability is the context, not a movement."*
It is never badged as a movement itself.

---

**The loop closes.** The next audit, with the same frozen pack, the same model
snapshot, the same temperature, the same reasoning default and the same
geography, will produce the same `cluster_key` for this claim — and the diff will
be able to say whether the model says it more often, less often, or not at all.

---

## 6. The safety & honesty map

**This is the section a skeptical reviewer reads first.** Every row is a rule
that the code enforces, with the exact place and the exact test that pins it. If
a row's test is green, the rule cannot silently regress; if a row's test were
deleted, the rule would still be true today but would be undefended tomorrow.

### 6.1 The money rules — a real target never spends without consent

| # | Rule | Where it lives | Test that pins it |
|---|---|---|---|
| 1 | **Confirm gate, all three entry points.** A real target never receives a model call without explicit confirmation, in ANY mode. `mode="simulated"` on a real target is refused outright (409) and is **not** `confirmed`-able — it is not a simulation: it leaves `force_live=False`, so the chain reaches live on a cache miss. | `app/audit.py::enforce_confirm_gate()`, called by `run_audit`, `run_exploratory_run`, `run_quick_run` | `tests/ai/test_confirm_gate.py` — `::test_no_confirm_live_makes_zero_client_calls`, `::test_no_confirm_simulated_makes_zero_client_calls`, `::test_confirmed_simulated_is_still_refused`, `::test_an_exploratory_persona_run_on_a_real_target_is_gated`, `::test_a_quick_run_on_a_real_target_is_gated`, `::test_a_refused_quick_run_leaves_no_prompt_row_behind`, `::test_the_428_message_does_not_recommend_simulated_mode` |
| | *(the same rule over HTTP)* | `app/api/router.py::run_audit_endpoint`, `::run_persona_endpoint`, `::quick_run` — both exceptions mapped to 428 / 409 | `tests/ai/test_confirm_gate_api.py` — `::test_no_confirm_live_is_428`, `::test_no_confirm_simulated_is_4xx_and_makes_no_calls`, `::test_the_persona_run_endpoint_is_gated`, `::test_the_quickrun_endpoint_is_gated`, `::test_no_refusal_is_reported_as_a_500` |
| | *(a FOURTH door cannot be added ungated)* | the structural AST check over `app/audit.py` | `tests/test_harness.py::test_every_model_calling_path_passes_the_confirm_gate` and `::test_the_confirm_gate_cannot_be_bypassed_with_a_second_definition` |
| 2 | **Operator gate.** Registration and workspace switching are operator actions. Fail-closed with no password (503). Constant-time compare. Five failures then a cooldown. The token travels in a **header**, never a URL or the bundle. Switching needs the token **and** `confirmed=true`. | `app/operator.py::require_operator()`, `OperatorGate.unlock`, `_configured_password`, `TOKEN_HEADER`; `app/api/router.py::list_targets`, `::register_target`, `::activate_target` | `tests/test_operator_gate.py` — `::test_unlock_with_the_right_password_returns_a_token`, `::test_unlock_with_the_wrong_password_is_401`, `::test_five_wrong_attempts_trigger_a_cooldown`, `::test_a_token_expires`, `::test_with_no_password_configured_the_gate_fails_closed`, `::test_register_without_a_token_is_401`, `::test_activate_requires_both_a_token_and_an_explicit_confirm`, `::test_a_workspace_switch_is_written_to_the_audit_log`, `::test_the_active_target_endpoint_stays_open`, `::test_the_operator_password_is_not_in_the_frontend_bundle`, `::test_no_committed_file_contains_the_operator_password` |
| 3 | **Real-target-never-simulated.** A registered brand's answers are `live` or `cache` only. Fixtures are attachable ONLY to `is_real=false` targets. | `app/ai/simulated.py::assert_fixture_allowed()` (raises `SimulatedTargetError`); `Runner._resolve` and `Runner._simulated` call it before the simulated leg | `tests/ai/test_runner_db.py::test_a_registered_target_never_receives_a_simulated_answer`; `tests/test_harness.py::test_amendment_e_no_audit_target_runtime_env_and_no_hardcoded_target`; `tests/seed/test_v2_fixtures.py::test_amendment_e_invariants_hold` |
| 4 | **No hardcoded price, duration or latency.** The card computes its duration from the rate budget, **measures** its p50 latency from stored live answers, and prints **no** money figure when no band is configured — rather than print a stale one. | `app/ai/runner.py::Plan.duration_estimate`, `::Plan.cost_band`; `app/ai/latency.py::resolve_latency_s`; `core/config.py::cost_per_call_low/high` (default `None`) | `tests/ai/test_runner_db.py::test_the_duration_is_computed_from_budget_and_latency_not_hardcoded`, `::test_the_card_measures_latency_from_stored_live_answers`, `::test_rpm_budget_is_configurable_and_profile_blind_copy_is_gone`; `tests/test_api_real_data.py::test_the_estimate_endpoint_never_shows_a_hardcoded_price` |

### 6.2 The evidence rules — nothing is a finding without provenance

| # | Rule | Where it lives | Test that pins it |
|---|---|---|---|
| 5 | **No claim without a quote.** A claim nobody can trace is not evidence. Quotes are written in the same loop as the claim, capped at **3**. | `app/extract/pipeline.py::extract_audit()` step 8, `MAX_QUOTES_PER_CLAIM = 3`; `app/api/router.py::verified_report` reports `coverage.with_verbatim_quote` / `coverage_pct` | `tests/extract/test_pipeline_db.py::test_extraction_writes_claims_with_quote_links`; `tests/test_api_real_data.py::test_claims_carry_verbatim_quotes` |
| 6 | **Structural explore exclusion.** An ad-hoc Explore-lane run can never move a trend or inflate n, **even if a screen forgets to badge it** — it is filtered at one choke point, not in each screen. | `app/audit.py::EXPLORATORY_MODE`; `app/api/facts.py::latest_audit_for` filters `Audit.mode != EXPLORATORY_MODE`; `app/scoring/metrics.py::is_headline`; `app/api/router.py::list_audits` excludes exploratory by default | `tests/test_api_real_data.py::test_an_exploratory_audit_never_becomes_a_headline_subject`; `tests/scoring/test_metrics_db.py::test_probe_persona_and_direct_rows_never_reach_a_headline_metric`; `tests/ai/test_runner_db.py::test_probe_rows_are_structurally_excluded_from_headline_n`, `::test_a_probe_added_at_runtime_is_not_counted_in_the_headline`; `tests/scoring/test_metrics.py::test_probe_results_are_excluded_from_the_headline_and_the_trend` |
| 7 | **OPEN/DIRECT segregation.** A DIRECT mission may never enter a headline number. A probe naming the target is auto-tagged DIRECT **with a visible warning**, never silently. | `app/ai/runner.py::SCOPE_CORE_DIRECT` and `build_plan`'s scope assignment; `app/scoring/metrics.py::is_headline`; `app/packs/linter.py::tag_probe` | `tests/ai/test_runner_db.py::test_probe_rows_are_structurally_excluded_from_headline_n`; `tests/packs/test_linter.py::test_probe_naming_the_target_is_auto_tagged_direct_with_a_visible_warning`; `tests/packs/test_packs_db.py::test_a_probe_naming_the_target_is_stored_as_DIRECT_with_the_warning_logged`; `tests/test_api_real_data.py::test_a_probe_added_to_a_frozen_pack_returns_its_autotag`; `tests/seed/test_v2_fixtures.py::test_the_core_pack_matches_the_ui_contract` |
| 8 | **Verdict provenance.** A verdict without `verifier_label` is refused. An invalid `verdict` or `source` is refused. A 422 opinion needs a reason. A FALSE verdict carries a correction. | `app/api/router.py::record_verdict`, `::record_422` | `tests/test_api_real_data.py::test_a_verdict_without_provenance_is_refused`, `::test_an_invalid_verdict_value_is_refused`, `::test_a_422_opinion_needs_a_reason` |
| 9 | **Relationship is derived, never the model's label.** The model's `about` is lineage only. Unresolved resolves to MARKET, **never** TARGET. | `app/extract/attribution.py::resolve_relationship`, `::attribute_claims`; `app/extract/cluster.py::make_cluster_key`; `app/extract/pipeline.py` re-attributes BEFORE clustering | `tests/extract/test_attribution.py::test_the_models_own_label_never_changes_the_outcome`, `::test_the_model_label_is_retained_as_lineage_not_logic`, `::test_an_unresolved_subject_is_never_resolved_as_the_target`, `::test_the_queue_is_about_you_or_displacing_you`, `::test_a_market_claim_can_never_carry_the_affects_you_marker`; `tests/extract/test_cluster.py::test_the_cluster_key_never_merges_two_relationships`, `::test_an_unknown_relationship_is_treated_as_market_never_target` |
| 10 | **Most-conservative classification.** An unresolved factual claim defaults to `RETAILER_ONLY`, **never** `OPINION` — a claim must not escape review because of how it was phrased. A cluster takes its most conservative member. | `app/extract/classifier.py::classify` (the final `return`); `app/extract/pipeline.py::_conservative_type` | `tests/extract/test_classifier.py::test_classification_is_pure_and_total`, `::test_needs_feed_is_set_for_retailer_only_claims_only`, `::test_a_claim_about_a_competitor_is_not_the_targets_verification_queue` |
| 11 | **Structural target binding.** Every per-target read resolves **ONE** target, so one retailer's numbers can never appear under another retailer's name. | `app/api/facts.py::active_target_id`, `::target_of`, `::latest_audit_for`, `::console_facts`; `app/api/router.py::_active_target_id`, `::_latest_audit_for`; `app/buddy/answers.py::ask(target_id=...)` | `tests/test_api_real_data.py::test_switching_targets_visibly_changes_every_per_target_surface`; `tests/test_workspace_binding.py::test_the_active_endpoint_returns_exactly_one_target`, `::test_no_open_workspace_endpoint_names_the_other_brand`, `::test_claims_are_scoped_to_the_active_target_by_id`, `::test_the_enumeration_endpoint_is_not_reachable_from_a_workspace`, `::test_the_workspace_declares_itself_locked`; `tests/buddy/test_golden_set.py::test_buddy_never_quotes_another_targets_name` |

### 6.3 The comparability and durability rules

| # | Rule | Where it lives | Test that pins it |
|---|---|---|---|
| 12 | **Combined-band diff badge.** A delta is `proof` only when it clears `sqrt(half_A^2 + half_B^2)` — about 1.4× a single-audit half-width at equal n. The threshold travels with the result, so the badge can state what it used. | `app/scoring/diff.py::combined_half_width`, `::metric_delta`; `app/scoring/service.py::diff` | `tests/scoring/test_diff.py::test_the_combined_band_is_the_root_sum_of_both_half_widths`, `::test_it_is_wider_than_either_single_audit_ci`, `::test_a_movement_inside_the_combined_band_is_a_trend_not_proof`, `::test_a_delta_at_exactly_the_threshold_is_not_proof`, `::test_the_badge_states_the_threshold_it_used` |
| 13 | **Counts never wear the ratio badge.** A count's stored CI is degenerate, so the combined band collapses to 0 and *any* change would badge as proof. Counts get the raw movement and an explicit no-inference badge. | `app/scoring/diff.py::metric_delta`, the `unit == "count"` branch | `tests/scoring/test_diff.py::test_a_metric_present_on_only_one_side_is_a_trend_not_a_fake_zero`; `::test_the_seeded_gf_movement_is_badged_proof` (the positive case) |
| 14 | **Comparable or blocked.** A different target, pack version, model-version set, or geography scope is a **409**, not a best-effort answer. | `app/scoring/diff.py::AuditFingerprint.mismatch_reason`, `::assert_comparable`; `app/api/router.py::diff_audits` | `tests/scoring/test_diff.py::test_a_different_prompt_pack_blocks_the_comparison`, `::test_a_different_model_blocks_the_comparison`, `::test_a_different_target_blocks_the_comparison`, `::test_a_deepseek_audit_can_never_be_diffed_against_a_gemini_audit`, `::test_the_model_set_comparison_ignores_order`; `tests/test_geo_scopes.py::test_a_cross_scope_diff_is_blocked_with_the_existing_banner`; `tests/test_deepseek_provider.py::test_a_deepseek_and_a_gemini_audit_can_never_be_diffed` |
| 15 | **Claim movement by resolved cluster.** Keyed on `(target_id, cluster_key)`, selected by **first-or-last-seen** on both sides. A frequency row appears only when `obs_runs` actually changed. | `app/scoring/diff.py::claim_movement`; `app/scoring/service.py::diff` (the claim selection) | `tests/scoring/test_diff.py::test_claim_movement_keys_on_cluster_identity`, `::test_claim_movement_ignores_another_targets_claims`, `::test_an_unchanged_claim_produces_no_frequency_row`; `tests/seed/test_v2_seed_db.py::test_claim_clusters_are_unique_per_target_not_globally` |
| 16 | **The noise floor is context, not a movement.** `run_stability` is reported alongside the deltas and never badged as one. It is the SAME measure the validation gate used. | `app/scoring/diff.py::diff_audits` (the `noise_floor` key); `app/scoring/metrics.py::mission_self_agreement` | `tests/scoring/test_diff.py::test_the_diff_reports_the_noise_floor_as_context_not_as_a_movement`; `tests/scoring/test_metrics.py::test_run_stability_needs_at_least_two_runs`, `::test_run_stability_reports_per_mission_because_the_aggregate_hides_the_structure` |
| 17 | **Immutability: answers once quoted.** An answer a `claim_quotes` row points at is never updated, or the evidence behind every recorded verdict would change underneath it. `llm_cache` payloads are never overwritten. | `app/ai/runner.py::Runner.run()` (insert-only); `app/ai/cache.py::put_cached` (early-return on an existing key) | `tests/ai/test_runner_db.py::test_a_live_call_is_stored_as_live_and_written_to_the_cache`; `tests/seed/test_v2_seed_db.py::test_reseed_never_clears_the_llm_cache`; `tests/test_concurrency_and_schema.py::test_llm_cache_is_never_cleared_because_it_is_the_demos_replay_mechanism` |
| 18 | **Never demote a resolved claim.** Re-running an audit must not silently reopen a closed question. | `app/extract/pipeline.py::extract_audit()` — the update path touches `claim_type` / `precheck` / `needs_feed` only `if row.status == "new"` | `tests/extract/test_pipeline_db.py::test_re_running_an_audit_does_not_reopen_a_resolved_claim` |
| 19 | **Append-only `audit_log` and `verdicts`.** One-way events; a verdict is a new row, never an update. | `app/packs/service.py::_log`; `app/api/router.py::record_verdict` (insert + a `claims.status` roll-up) | `tests/packs/test_packs_db.py::test_tracking_is_one_way_and_logged`; `tests/test_operator_gate.py::test_a_workspace_switch_is_written_to_the_audit_log`; `tests/seed/test_v2_seed_db.py::test_a_reseed_preserves_a_registered_real_brand_and_its_audits` |

### 6.4 The label and onboarding rules

| # | Rule | Where it lives | Test that pins it |
|---|---|---|---|
| 20 | **Source labels are never silent.** Every stored answer carries `live` / `cache` / `simulated`. A refusal-as-data is **stored**, not retried or dropped — an answer that omits you *is* the finding. | `app/ai/runner.py::Runner.run()` (`source=resolved.source`), `::is_empty_response`; `app/extract/normalize.py::is_empty` kept in step with it | `tests/ai/test_runner_refusal.py::test_a_successful_answer_naming_nobody_is_stored_as_an_observation`, `::test_empty_response_is_false_for_a_normal_answer`; `tests/test_api_real_data.py::test_an_answer_shows_its_source_and_the_empty_response_note`; `tests/ai/test_runner_db.py::test_a_fully_broken_client_falls_back_to_simulated_and_logs_every_failure` |
| 21 | **One-way and append-only surfaces.** No untrack, no probe delete, no untrack route. A mission on a frozen pack is 409. Promotion happens only at a `create_draft`, never mid-pack. | `app/packs/service.py` — the functions **deliberately do not exist**; `app/api/router.py::add_mission_endpoint` | `tests/packs/test_packs_db.py::test_there_is_no_delete_probe_anywhere`, `::test_probes_are_append_only_even_on_a_frozen_pack`, `::test_tracking_is_one_way_and_logged`, `::test_promotion_happens_at_a_freeze_not_before`, `::test_unmarked_probes_are_not_promoted`; `tests/test_api_real_data.py::test_there_is_no_untrack_and_no_probe_delete_endpoint`, `::test_adding_a_mission_to_a_frozen_pack_is_409` |
| 22 | **The estimate is computed, never asserted.** The card reads the CURRENT pack and probe lane, so a probe added during a demo moves the number. The confirm gate calls the same function. `GET /estimate` is a GET because a cost question must never be able to spend. | `app/audit.py::estimate_audit`; `app/ai/runner.py::build_plan`; `app/api/router.py::estimate` | `tests/ai/test_runner_db.py::test_the_estimate_is_computed_from_the_current_pack_and_probe_lane`, `::test_the_estimate_card_offers_a_quick_probe_labelled_partial`; `tests/ai/test_confirm_gate.py::test_the_estimate_card_says_a_real_target_requires_confirmation` |
| 23 | **Buddy is deterministic.** Zero LLM calls by construction, and every number it quotes is the stored `Metric` row **verbatim** — including in the chat chart, which is the same component the pages use. | `app/buddy/__init__.py` (no client import anywhere in the package); `app/buddy/answers.py::_ci_chart`, `::_headline_row`; `react-frontend/src/pages/Buddy.tsx` renders via the shared `<CIChart>` | `tests/buddy/test_golden_set.py::test_buddy_makes_no_network_call`, `::test_the_number_equality_answer_quotes_the_stored_metric_exactly`, `::test_answers_are_byte_identical_on_unchanged_state`, `::test_the_gluten_free_story_never_asserts_an_unstored_verdict`, `::test_the_auto_verify_answer_lists_the_live_unknown_needs_feed`, `::test_the_auto_verify_answer_separates_public_facts_from_feed_claims`; `tests/test_api_real_data.py::test_buddy_is_deterministic_and_makes_no_model_call`, `::test_buddy_quotes_the_stored_metric_exactly` |
| 24 | **Determinism everywhere below the model.** The same answers always produce the same claims, the same clusters and the same metrics. Simulated runs are byte-identical across audits. Concurrency changes only the wall clock, never the measurement. | `app/extract/cluster.py::cluster_claims` (no randomness, no clock, no set order); `app/scoring/metrics.py` (all pure); `app/ai/simulated.py::simulated_answer` (SHA-256 selection) | `tests/scoring/test_metrics.py::test_metrics_are_deterministic`; `tests/extract/test_cluster.py::test_identical_claims_collapse_into_one_cluster`; `tests/extract/test_attribution.py::test_resolution_is_pure_and_repeatable`; `tests/ai/test_runner_db.py::test_the_simulated_grid_is_deterministic_across_audits`; `tests/test_concurrency_and_schema.py::test_concurrent_and_sequential_runs_produce_identical_observations`, `::test_concurrency_actually_overlaps_the_calls` |
| 25 | **Cache keys cannot cross instruments.** Seven inputs including `target_name` and `reasoning_effort`, so two brands and two reasoning settings can never share an entry. | `app/ai/cache.py::KEY_INPUTS`, `::cache_key` | `tests/ai/test_ai_layer.py::test_the_key_inputs_are_the_five_the_spec_names_plus_the_target_addition`, `::test_the_target_name_participates_in_the_key`, `::test_cache_key_is_sha256_of_the_frozen_inputs`, `::test_cache_key_is_order_and_format_stable`; `tests/ai/test_runner_db.py::test_two_targets_never_share_cache_entries`; `tests/test_deepseek_provider.py::test_cache_keys_cannot_collide_across_providers`, `::test_reasoning_effort_is_part_of_the_cache_key` |
| 26 | **The tour cannot point at nothing.** Every step's `(route, anchor)` pair is checked at runtime **and** by a jsdom render test, and the nav is derived from the same manifest. | `react-frontend/src/lib/routeAnchors.ts::isRegisteredAnchor`; `react-frontend/src/lib/navigation.ts` (`NAV_ITEMS = ROUTE_ANCHORS.map(...)`); `react-frontend/src/lib/tourIntegrity.test.js` | `python-fastapi/tests/test_tour_fixture.py` — `::test_every_step_names_a_registered_anchor`, `::test_anchor_ids_are_unique_across_the_manifest`, `::test_every_screen_in_the_manifest_has_at_least_one_anchor`, `::test_the_tour_has_exactly_ten_steps`, `::test_every_step_uses_only_read_only_reveals`, `::test_no_retailer_step_lands_on_an_instrument_only_screen`; frontend `navigation.test.js`, `routeAnchors.test.js` |
| 27 | **No key, no secret, anywhere.** | `core/clients/openai_compat_client.py` (the key lives in `self._api_key` and is never logged); `react-frontend/src/lib/operatorSession.ts` (the password is never stored in the browser) | `tests/test_api_real_data.py::test_status_and_meta_never_leak_the_key`; `tests/test_profiles.py::test_health_never_leaks_the_key`; `tests/test_deepseek_provider.py::test_the_key_never_appears_in_logs_repr_or_reported_payloads`, `::test_no_secret_is_ever_committed`; `tests/test_operator_gate.py::test_the_operator_password_is_not_in_the_frontend_bundle`, `::test_the_frontend_never_reads_the_operator_password_from_the_environment`, `::test_no_committed_file_contains_the_operator_password` |

**The one rule that is a process, not a test:** `docs/spec.md` §3 rule 12 —
*no new route lands without an ASGI contract test.* Its standing evidence is the
quickrun endpoint, which was wired in M7b for a frontend screen, shipped broken,
and stayed broken through M8 and M9 while the 394-test suite stayed green. See
§8 for the note on what is not yet enforced mechanically.

---

## 7. Operational runbook pointers

**`RUNBOOK.md` owns the detail.** This section is deliberately pointers-level: what
to run, where to look, what to do when something is wrong. `make help` prints the
same list.

### 7.1 Running it locally

```bash
make dev          # backend :9000 + frontend :3000, in the background
make dev-stop     # stop them
make dev-backend  # FastAPI alone, in the foreground
make dev-frontend # CRA alone, in the foreground
make dev-proxy    # the node proxy on :3001 (optional locally; off by default)
```

`scripts/dev.sh` checks the interpreter (`python3 -c 'import uvicorn, fastapi,
sqlmodel'`) and the ports **before launching anything**, and reports what is
actually serving rather than what it intended to launch — a pid can be alive and
serving nothing, and a stack that cannot serve is reported as down.

You also need a database: `DATABASE_URL` in `.env` (the local profile uses it
verbatim), then `make seed` once.

```bash
make seed         # rebuild the v2 fixtures + reference tables (idempotent)
make seed -- --register "Brand Name"   # register a REAL brand as the active target
make test         # pytest (backend) + react-scripts test (frontend)
make build        # CRA production build
make health       # all processes + nginx route + DB
make verify       # health + test + build
```

The company path is untouched: `make up` / `make down` run `./launch-app dev` with
nginx and four processes.

### 7.2 Reading `/health`

`GET /health` is the first thing to look at. It resolves settings **per request**,
not at import, so the profile and ports reflect the environment this process is
actually running in.

| Field | What it tells you |
|---|---|
| `status` | `"ok"` — the process is up. **It does not mean the DB is reachable.** |
| `profile` | `local` or `company`. If you expected `company` and got `local`, your `.env` did not load. |
| `llm_provider` | `deepseek` or `gemini` — which assistant this deployment would actually call. |
| `llm_auth_mode` | `deepseek:key` / `gemini:key` / `adc` / `simulated_only`. **`simulated_only` means no model will be called at all** — cache and fixtures only. |
| `llm_model` | The resolved model string. |
| `db_mode` | `direct` (local) or `aeris` (company). |
| `llm_ready` | Whether a call would succeed. Never blocks anything. |
| `model_slots` | The three slots, with 2-3 usually empty (unconfigured reserves). |
| `simulated_agent_mode` | The offline safety net. **Not** a statement about whether a real model ran — read `answers.source` for that. |
| `database` | `dialect`, `schema`, `configured`, `connected`, `seeded`, `entity_counts`, `error`. `connected: false` is the degraded state. |
| `route_prefix` | The proxy path the compat router is mounted at. |

A database that is unreachable is a **reported error state, not a crash**:
`app/lifespan.py` boots degraded on purpose, because the operator needs `/health`
to tell them *why*. There is no SQLite fallback anywhere.

### 7.3 Logs and diagnostics

| Where | What |
|---|---|
| `.dev-logs/backend.log` | FastAPI (uvicorn) under `make dev`. |
| `.dev-logs/frontend.log` | The CRA dev server. |
| `.dev-logs/proxy.log` | The node proxy, when enabled. |
| `.dev-logs/dev.pid` | The pidfile `make dev-stop` sweeps. |
| `reports/model_validation.md` | Output of `make bakeoff` (the Amendment A validation table). |
| `make probe` | The environment probe: ADC, models, proxy, postgres path. |

For a live call, the runner logs `live <mission> run=<n> attempt=<n> <ms>` on
success, and on every failure `live call failed mission=... attempt=n/3:
<ExceptionType>: <message>`. **No failure is swallowed** — they also accumulate in
`Runner.failures` and surface in `AuditResult.errors`.

### 7.4 When a port is busy

`scripts/dev.sh` fails **before** launching anything:

```
[argus] ERROR: port 9000 is already in use — run 'make dev-stop' first.
```

Options, in order: `make dev-stop`; then `./scripts/dev.sh status` to see which
pids are alive; if the port is held by something else, set `APP_PORT` /
`FRONTEND_PORT` in the environment for that invocation.

Note the distinction `scripts/dev.sh` makes deliberately: a **pid** is not a
**verdict**. The status check probes the port, not the process, because a stack
that cannot serve must be reported as down. (`make dev` had a bug here: it
reported success while the backend was dead. Fixed in `9b24077`.)

### 7.5 The venv story

`python-fastapi/run-pytest.sh`, `run-python.sh` and `seed-db.sh` all source
`python-fastapi/_activate-env.sh` and call `activate_argus_env` — the backend
tools are expected to run inside the `argus-fastapi` **conda** environment.
`scripts/dev.sh` uses `${PYTHON:-python3}` and checks the interpreter's
importability first, printing the offending interpreter when it fails, so a wrong
interpreter is diagnosed rather than producing a stack trace three steps later.

The declared dependency list is `argus-fastapi.yml`. `RUNBOOK.md` §0 records that
a clean virtualenv built from exactly that list was verified to import the whole
backend and pass the suite, so the declaration is sufficient.

### 7.6 The two profiles in practice

| | local | company |
|---|---|---|
| Start it | `make dev` | `make up` (nginx + 4 processes) |
| API base | `http://localhost:9000/fastapi` | `<SVC_PROXY_PATH>/fastapi` |
| CORS | needed — `AppConfig.cors_origins` includes `localhost:3000`, `:9000`, `:8080` on both loopback hosts | not needed — same-origin through nginx |
| Database | `DATABASE_URL` verbatim, no assembly | Aeris assembly + GCP Secret Manager |
| LLM | `AI_PROVIDER` (DeepSeek or Gemini), key auth | Vertex/ADC, Gemini |
| npm | public registry | the lockfile is currently pinned to the public registry; re-pin for Artifactory with `python3 scripts/repin_npm_registry.py artifactory` |

**What is identical:** every product rule, every honesty rule, every score, and
the `answers.source` labels.

### 7.7 Cost expectations per audit

From the ledger (`progress.md`, M6 and M9):

* **Full grid**: **146 planned calls** = 120 core (12 × 10) + probe (2 per probe)
  + persona mini-set (2 personas × 2 tracked missions × 2 runs). Headline n = 90.
* **The first two live Ocado audits** (#505 / #506, now superseded by #711 /
  #712): 182.7 s and 175.0 s wall clock at concurrency 8, **zero failed cells**,
  306 and 212 claims respectively.
* **Quick probe**: 9 calls, `partial_evidence: True`, ~1 minute. Never a headline.
* **DeepSeek latency**: p50 ~8.9 s, p95 ~18.0 s measured over 30 calls at
  reasoning-on. The **duration floor is latency, not quota**, on the local
  profile — the card says which one binds (`governed_by`).
* **The replay safety net is thin.** Only the newest 292 live calls are cached, so
  **the demo must not depend on cache replay**. The evidence is the `answers`
  table, which is never touched. *Do not re-spend 292 calls to rebuild a safety
  net the demo is not supposed to rely on: a demo whose correctness depends on a
  cache is a demo that fails quietly on a cold database.*
* **The cost band prints nothing** unless `COST_PER_CALL_LOW` / `_HIGH` are set.
  That is deliberate.

### 7.8 What is verified, and what is not

`CURRENT_STATE.md` carries the authoritative table. The short form:

| Verified (real execution) | Not verified (and why) |
|---|---|
| **pytest 394 passed, 15 skipped, 0 failed** | `./launch-app` + nginx at the proxy path (no conda/nginx in the workspace) |
| `tsc --noEmit` exit 0; `CI=true react-scripts build` "Compiled successfully" | **A real-browser click-through of the whole console** — the ten-minute loop has still never been watched, first owed since M7 |
| **37 frontend tests**, including the tour DOM-integrity render suite | A headless-browser render of the overlay's CSS pulse |
| Live API against the real DB; Buddy number-equality `0.188889 [0.108022, 0.269756] n=90` | `npm ci` against the internal Artifactory (unreachable) |
| **A renamed DOM id fails CI, not the demo** — proved by renaming `cc-loop` | The quick-run / persona-run endpoints in `live` mode (would spend real calls) |

---

## 8. Known divergences & errata

This section exists so nobody "fixes" the code back toward a document. The code
is the authority; every item below is a place where a document and the code
disagree, or a defect found while reading.

### 8.1 `v2/ref.html` vs the current UI

`v2/ref.html` is the **read-only UI contract**. It has been updated at M7.5 (it
now carries the grouped sidebar, the locked brand chip and the operator unlock
card), but three things still diverge from the real UI:

| ref.html says | The real UI says | Note |
|---|---|---|
| `n=120` headline (in the Verified Report note, the History & Diff subtitle, the CI copy and the probe copy) | **`n = 90`** on the tiles; **"120 core runs · headline n = 90"** on New Audit and under the tiles | Recorded as errata in `docs/v2-migration-map.md` §9. The real UI supersedes it with the split numbers (the §11 copy contract). |
| The pack presented without the 9 OPEN / 3 DIRECT split | The split is visible in the grid, the tiles and the New Audit copy | Same errata. |
| "within noise — trend only" as the badge text | **"trend, not proof"** (`BADGE_TREND` in `app/scoring/diff.py`) | The spec §11 copy is authoritative. |

`docs/spec.md` §0 says this outright: *its "n = 120" copy is recorded errata in
the migration map and superseded by the real UI's split numbers.*

### 8.2 Spec vs code

| # | The spec says | The code does | Why |
|---|---|---|---|
| 1 | §3.4 names **five** cache key inputs | **Seven** (`app/ai/cache.py::KEY_INPUTS`) | `target_name` ratified at M3 (the OPEN-mission contradiction, §3.3) and `reasoning_effort` at M5b. Both are supersets that can only reduce sharing. The module docstring documents the reasoning in full. |
| 2 | §3.9 "no migrations", drop and recreate | `claims` gets an **additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`** (`app/persistence.py::ADDITIVE_COLUMN_TABLES`) | The no-migrations rule exists because schema churn is cheap; it does not apply to a table whose contents are the product's evidence. The module comment names the incident: audits #505/#506, 292 calls, lost exactly that way at M6. |
| 3 | The pre-M7.5 reading of the confirm gate: `mode="simulated"` on a real target "requires confirmation" | **Refused outright with 409**, not 428 | `simulated` is not `confirmed`-able. The runner's Amendment E refusal is kept as the *second* layer, but it only fires on the last leg, long after the money is gone. |
| 4 | §4.4 lists 3 stub routes (the M1 state) | **39 console routes** | The §4.4 set landed at M6 plus the M7/M7b/M8 additions. |
| 5 | §9 / METHOD.md quote the review-queue count as **58** on the live pair (and earlier as **66**) | **104** of 479, with 364 competitor intelligence and 11 market | METHOD.md's own analysis is that the old rule *over-counted rival claims mislabelled as ours and under-counted rival comparatives that concern us at the same time* — a rule that errs in both directions is uninterpretable. **METHOD.md still contains BOTH the old and the new numbers in two adjacent passages**; see §8.5. |
| 6 | §11 copy: the ~10.3pp band at n=90 | Proportions use the **normal** approximation (1.96), not t | The t-based helper would give ~10.5pp and would **silently contradict** the frozen copy. `stats.confidence_interval` (t) is used only around means. |
| 7 | §4.4 does not mention a geography dimension on the run/estimate endpoints | `geo_scope` / `geo_value` are on both (`POST /audits/run`, `GET /estimate`) and on the `audits` row | Amendment I folded in at M5c; the code comment calls this out on the column. |

### 8.3 The Acme / Audit-505-506 history, in one paragraph

`Acme Grocers` was the M1-era test registration of a "real" target, created before
open registration existed. It was already removed by a `make seed` before the
brand decision landed, so there was no lingering active real-brand placeholder
when the operator chose **Ocado** at M6; a `target_decision_recorded` event in
`audit_log` states exactly that, rather than claiming a deactivation that did not
happen. The first two live Ocado audits were **#505 and #506** — 146/146 live
rows each, 306 and 212 claims — and **both were destroyed at M6** when `claims`
was (wrongly) in `SHARED_TABLE_NAMES` and a `make seed` dropped and recreated it.
That is the incident that produced `ADDITIVE_COLUMN_TABLES`, the scoped
`clear_reference_tables`, and the "a real brand is user data" rule. The current
live pair is **#711 / #712**; METHOD.md also records that a later demo-seeder run
cleared the cache belonging to the earlier audits, which is why the replay safety
net is thin (§7.7).

### 8.4 Code findings — dead code and stale docstrings

Per the method: **found while reading, NOT fixed here.** This is a documentation
milestone and no code changes are in scope.

| Where | Finding |
|---|---|
| `app/audit.py:527` | An **unreachable `return prompt`** immediately after `run_quick_run`'s `return QuickRunResult(...)`, at the same indentation as it. Dead code left over from the M7.5 `_synth_quick_prompt` fix. Harmless (the function has already returned) but confusing. |
| `app/buddy/answers.py:947-954` | An **unreachable duplicate** of the `fallback` answer, after `ask()` already returns `_fallback_answer(question)` at line 945. A literal copy of the block in `_fallback_answer`, now dead. |
| `react-frontend/src/lib/api.ts:11` | The docstring says *"the contract test `tests/test_api_contract.py` asserts this method list against FastAPI's route table."* **No such file exists** anywhere in the repo. A stale promise. (Spec rule 12, §3.10, would be the thing to build.) |
| `app/api/facts.py:21` | `Metric` is imported but never used. |
| `app/scoring/service.py:10` | `from datetime import datetime, timezone` is imported but never used. |
| `app/scoring/diff.py:26-27` | `field`, `Iterable` and `Set` are imported but never used. |
| `app/scoring/metrics.py:35` | `field` is imported but never used. |
| `app/scoring/stats.py` | `List` is imported but never used. `weighted_mean()`, `quantise()` and `deterministic_spread()` are defined and have **no callers** anywhere in `app/`, `tests/` or `scripts/` — leftovers from the v1 scoring module. |
| `app/geo.py:22` | `Any`, `Iterable` and `List` are imported but never used. |
| `app/extract/classifier.py:22` | `Iterable` is imported but never used. |
| `app/extract/cluster.py:35` | `Iterable`, `Optional` and `Tuple` are imported but never used. |
| `app/extract/normalize.py:19` | `Iterable` is imported but never used. |
| `app/extract/pipeline.py:28,34` | `Tuple`, `COMPETITOR` and `TARGET` are imported but never used. |
| `core/clients/openai_compat_client.py:36` | `os` is imported but never used. |
| `app/models/base.py:31,36` | `money()` and `as_float()` are defined but have no callers. |
| `app/correlation.py` | `json_response` / `error_response` are defined; `json_response` is used only by `error_response`, and neither is called from any route. A template keep (the module docstring says so) that the v2 router no longer uses. |
| `app/api/service.py` | An 8-line **docstring-only stub** with no code. The v1 in-memory `AuditStore` it replaced is gone; the module is retained as a placeholder. |
| `app/__init__.py` | The docstring still describes the **v1 layout** (`app.estate`, `app.mockapi`, `app.sensors`, `app.journeys`) — all demolished in M1. |
| `react-frontend/src/pages/Register.tsx:351` | Renders `id="operator-switch"`, which is **not in `ROUTE_ANCHORS`**. Not a bug (the manifest governs what the *tour* may point at, and no tour step wants it), but it is a DOM id with no declared purpose. |

### 8.5 METHOD.md internal contradiction

`METHOD.md`'s v2 addendum contains **two adjacent passages giving different
review-queue counts for the same live pair**:

* one says *"of 479 claims, 104 are about the audited retailer or displace it,
  364 are competitor intelligence and 11 are market-level ... The old
  model's-label rule gives 58 on the same data"*;
* the next says *"the model's own label produced an 'About you' count of **58**;
  subject attribution gives **56** claims genuinely about the retailer, and a
  review queue of **66** ... (of 479 claims overall)"*.

`CURRENT_STATE.md` and `progress.md` both record **104 / 364 / 11** on the
current #711/#712 pair. The two METHOD.md passages appear to describe two
different points in the attribution work (M6.5 first pass vs. the corrected
count) and were never reconciled. **The code's answer, read from
`app/api/facts.py::_claim_counts` over the live rows, is the only current
truth.** This is a M10 rewrite item, not a code fix.

`METHOD.md` also still carries its entire v1 body below the addendum (the ARIS
score, Inbound, Integrity, the fix list). The addendum says plainly that the
rest of the file "is still the v1 METHOD ... and must not be quoted as current",
but the v1 sections are not marked in place — a reader who lands mid-file will
read v1 as current. Also a M10 rewrite item.

### 8.6 `progress.md` vs the code

Nothing material was found. Where `progress.md` describes behaviour, the code
matches it. The two places worth knowing about are both **flagged in
`progress.md` itself**:

1. The 69.9% validation figure vs the 59.7% live 10-run noise floor — a
   methodology finding, recorded in METHOD.md, not a regression.
2. `m8` (the gluten-free demo mission) is **chaotic live** (41-45% stable), so
   the loop-close demo beat must move to a stable mission (`m10` ~85%, `m11`
   ~80%, `m4` ~73%). The GF claim remains excellent material for the *variance*
   beat, not the clean close.

### 8.7 What this document could not verify

* **`pytest` did not run here.** The workspace has no `argus-fastapi` conda env
  and no `pytest` in any available interpreter, so the 394-test figure quoted
  throughout is **read from `CURRENT_STATE.md`**, not re-executed. The test
  *names* are real (they were read out of the files); the *counts* are the last
  recorded run's.
* **No frontend build or test run.** The same applies to the "37 frontend tests"
  and the `tsc`/build results in §7.8.
* **Line numbers** in §8.4 and in the `app/audit.py` gate table are as of the
  M7.5 commit and will drift with any edit above them.

---

## 9. Glossary

**Single source of truth: `data/fixtures/glossary.json`.** `GET /api/glossary`
serves it verbatim and the About & Tour page renders it verbatim, so a term can
never mean one thing in the glossary and another in a report. METHOD.md
references the fixture and never redefines a term. **Do not restate these
definitions anywhere else** — a second copy is a second truth waiting to drift.

### Product terms (from the fixture)

**Agent answer** — one verbatim response from the model, stored immutably. The
evidence layer: every claim links back to the exact answer text that produced it.

**OPEN mission** — a pack question that does **not** name the audited retailer, so
the model has no reason to mention it. OPEN runs are the only ones that feed the
headline visibility numbers.

**DIRECT mission** — a pack question that **does** name the audited retailer.
DIRECT runs are structurally excluded from headline metrics and feed the claims
queue only.

**Headline n = 90** — the denominator of the visibility tiles: 9 OPEN missions ×
10 runs. The grid is 120 core runs in total; the 3 DIRECT missions never enter a
headline number.

**95% CI** — the confidence interval around a rate, computed by **normal
approximation** over the runs. At n = 90 the widest possible interval is about
±10.3pp, which is the most a tile can honestly claim.

**Run stability** — mean per-mission self-agreement across runs: the model's own
noise floor. It is the context in which a movement is read, not itself a result.

**Probe lane** — user-added questions that run in every future audit at 2 runs
each. Discovery-only: excluded from headline n and from the trend until promoted at
a pack freeze. **There is no delete.**

**Explore lane** — personas and quick-runs, ad hoc and user-initiated. Results
carry an EXPLORATORY badge and are excluded from headline scopes until the persona
is tracked.

**Tracked persona** — a shopper system-prompt promoted into the audit grid: 2 OPEN
missions × 2 runs per audit. Tracking is **one-way** and logged; there is no
untrack.

**Claim** — a statement the model made, extracted from its structured output and
clustered across runs. A claim never exists without at least one stored
transcript behind it.

**Cluster key** — the stable identity of a claim: `(relationship, subject,
attribute)` for a given target. Claim movement between audits is only meaningful
because this key is stable.

**Relationship (TARGET / COMPETITOR / MARKET)** — who a claim is **ABOUT**,
derived deterministically from the claim's *subject* — never from the model's own
`about` label, which over-labels claims as being about the asked-about entity.
Unresolved resolves to MARKET.

**Affects you** — a claim about a competitor whose text still names the audited
retailer. It displaces the retailer, so it joins the review queue.

**Review queue** — claims about the target, plus competitor claims that displace
it. The Verified Report counts only this set and states what it excluded.

**Verdict** — a human judgement on a claim: TRUE, FALSE or UNKNOWN, always with
provenance (who, when, from what source). A correction is required on FALSE.
UNKNOWN is always available; the product never forces a judgement.

**Verified Report** — the four action buckets computed purely from stored
verdicts: Correct the record, Fix the reality, Needs an API, Awaiting review. An
empty bucket is a finding, not a rendering failure.

**Trend, not proof** — the badge on a metric delta smaller than the **combined**
sampling band of the two audits (`sqrt(halfA² + halfB²)`). A movement inside the
interval is not evidence of a change.

**Source label** — every stored answer is labelled `live`, `cache` or `simulated`.
The fallback chain is never silent.

**Estimate card** — the computed call count, duration and cost band shown before
an audit runs. It is derived from the current pack and probe lane, so adding a
probe moves the number.

**Governed by** — which limit sets the duration estimate: the rate quota or the
measured per-call latency. The card states which one binds.

### Terms this document uses that the fixture does not

| Term | Meaning |
|---|---|
| **Instrument** | The frozen five-tuple that produced a measurement: pack version + model snapshot + temperature + reasoning default + geography scope. §1.3. |
| **Prompt pack** | The frozen set of 12 core missions (9 OPEN + 3 DIRECT) plus the probe lane, in `prompt_packs` / `prompts`. |
| **The chain** | The four-leg answer-resolution order: cache → live(retry ×3) → cache → simulated. `app/ai/runner.py`. |
| **`force_live`** | The flag that skips the *up-front* cache check so every run is a real observation. §3.3. |
| **Structural** | A rule enforced by the data or by a filter at one choke point, so it holds **even if a screen forgets it** — as opposed to a rule a screen is trusted to remember. |
| **Canonical text** | The phrase shown for a cluster: the one the model used **most often**, with ties to the earliest. §3.5. |
| **Alias-lite** | The mention normaliser: case, punctuation and legal suffixes only — deliberately **no** hand-kept real-brand alias table. §3.5. |
| **The hat** | The frontend view switch: `auditor` (runs and reads the instrument) or `retailer` (works the review queue). Not an account. §4.3. |
| **`ROUTE_ANCHORS`** | The manifest registering every screen's DOM ids for the Guided Tour, and the single source the sidebar is derived from. §4.3. |
| **Provenance** | Who recorded a verdict, when, and from what source. Required, never optional. §6.2 row 8. |
| **Fixture target** | The fictional `is_real=false` brand whose answers are canned fixtures; attachable only to non-real targets. §1.2. |
| **Refusal-as-data** | An answer that named nobody and asserted nothing: stored with `empty_response=true`, counted in the denominator, never retried. §3.3. |

---

## Document maintenance

This document is **derived by reading the code**, so it has the code's shelf life.
When it is wrong, the code is right.

Things that will make it stale, and what to update with them:

| When you change | Update |
|---|---|
| the seven cache key inputs | §3.3, §8.2 row 1, §6.4 row 25 |
| a table or a column | §3.11 |
| an endpoint | §3.10 and the screen-to-endpoint table in §4.1 |
| a DOM anchor | §4.3, §4.4 (and `routeAnchors.ts` in the same commit) |
| an honesty rule or its test | §6 |
| the profile split | §2.2, §2.3, §7.6 |
| anything METHOD.md, spec.md or ref.html says | §8 |

**No code changes are in scope for this milestone.** The findings in §8.4 were
found while reading and are listed, not fixed.
