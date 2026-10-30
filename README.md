# Traceline

[![CI/CD](https://github.com/zhangranarz/traceline/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/zhangranarz/traceline/actions/workflows/ci-cd.yml)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222222?logo=githubpages&logoColor=white)](https://zhangranarz.github.io/traceline/)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?logo=javascript&logoColor=black)
![Splunk SPL](https://img.shields.io/badge/Splunk-SPL-000000?logo=splunk&logoColor=white)
![PlantUML](https://img.shields.io/badge/diagrams-PlantUML-1E88E5)
![Node.js tests](https://img.shields.io/badge/tests-Node.js%20%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![CodeQL](https://img.shields.io/badge/scan-CodeQL%20%2B%20gitleaks-6E40C9?logo=github&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Privacy](https://img.shields.io/badge/data-stays%20in%20your%20browser-success)

**Analyse any service flow in your Splunk logs.** Traceline traces each request and response across your service layers, draws it as a sequence diagram, works out the processing rules the flows follow, and builds the Splunk query that does the same on your real indexes. It works on real log lines you paste in or on mock logs it generates, and it runs entirely in your browser.

**▶ Live app: https://zhangranarz.github.io/traceline/**

## What it does

Paste lines from any Splunk log file, or generate mock ones, and the tool:

1. **Reads each line:** works out which layer logged it, whether it's a request or a response, the session it belongs to, the API it calls, and any parameters you've chosen.
2. **Rebuilds the flow:** orders every call by time, nests each call under the one that made it, and times each response against its request.
3. **Shows it four ways:** as a flow table, a sequence diagram, a set of processing rules, and the Splunk query that produces the same table on your real indexes.

```
Step  EventTime                Flow                                         HostServices             Params                    ElapsedMs
9     2026-10-25 10:00:00.398  eComm: /api/v1/payment/transfer [?]                                   TxnRefNo: TX1917377922
14    2026-10-25 10:00:00.575  --› Enterprise: FundTransfer [?]                                    TxnRefNo: TX1917377922
15    2026-10-25 10:00:00.581  ------› WS: https://…/ws/limitCheck [?]
16    2026-10-25 10:00:00.701  ------› WS: https://…/ws/limitCheck [!]                                                           120
17    2026-10-25 10:00:00.704  ------› Host: FT01 [?]                        FT01 ~ A01 | FT01 ~ A02  AcctNo: 1722464163
18    2026-10-25 10:00:00.938  ------› Host: FT01 [!]                        FT01 ~ A01 | FT01 ~ A02                            234
20    2026-10-25 10:00:00.995  eComm: /api/v1/payment/transfer [!]                                   TxnRefNo: …; HTTP: 200     597
```

`[?]` marks a request and `[!]` a response. Indentation shows which call made which. **HostServices** lists a Host message's `<SvcCode>` values as *service ~ sub-service* pairs, joined with ` | `.

The default setup models four layers, **eComm API → Enterprise API → WS (web service) / Host service**. Each layer's name, Splunk source, log pattern and regexes can be changed, so you can point them at your own services and log formats.

## Features

### Analyse flows
- **Flow Result:** every call in time order, indented by caller, with session, Host service pairs, parameters and elapsed time. The columns match the Splunk query: `Step EventTime sessionId Flow HostServices Params ElapsedMs`. Filter by session, or export as CSV.
- **Sequence Diagram:** PlantUML code for one session, with the **diagram drawn right below it**. WS calls can be drawn as internal processing of the Enterprise API (a self-call) or as their own participant. Params, elapsed time and timestamps can go on the arrows, and calls with no response are marked. It's drawn by a built-in renderer (`js/seqsvg.js`), so nothing is sent to a PlantUML server. You can download it as `.puml` or `.svg`.
- **Processing Rule:** reads the sequence diagram of the selected session as a three-column table:
  - **Step:** the diagram's step numbers for each call, request → response.
  - **Item:** one row per API or URL (entry APIs, the APIs they call, and WS URLs), indented under its caller.
  - **Processing rule:** who calls it; whether it is **processing rule only** or what it calls, in order; each Host call it makes (service code, sub-codes, steps, elapsed time, params, or a missing response); when it responded; and its request and response parameters.
  - It shares the session and the *WS as internal process* option with the Sequence Diagram tab. You can copy it or download it as a Markdown table.

### Work with real logs
- **Bring your own logs:** paste lines from Splunk and every view above is built from them.
- **Extraction Debug:** for every line, which layer, direction, session, API and parameters were extracted, or why the line was filtered out. This is the quickest way to tune the regexes to your format.
- **Editable log layers:** the classify, session, direction and API regexes and the Splunk source and search terms for each layer.
- **Dynamic parameters:** add or remove a field, and it's extracted with its own `rex` and shown in the `Params` column.

### Build and prove the Splunk query
- **Splunk Query:** the production SPL, generated from your layers and parameters.
- **Splunk Test Harness:** the same query with your test lines built in through `makeresults`. It runs the real query in Splunk without indexing anything, and Splunk's output should match the Flow Result.

### Generate test data
- **Multiple scenarios:** each named scenario has its own call tree, an on/off switch and a session count. Sessions from all enabled scenarios are mixed in time order, as in production. You can set latencies, noise lines and timeouts. Six scenarios are built in:

  | Scenario | What it covers |
  |---|---|
  | Login, eligibility and fund transfer | Rules-only call, two Enterprise APIs, WS then Host |
  | Bill payment | WS lookup, then a Host service with three sub-codes |
  | Account summary (several Host services) | One Enterprise API calling a WS and two Host services |
  | Rules only (no Enterprise call) | Entry APIs that never call downstream |
  | Profile update (Enterprise, no Host) | An Enterprise API with no WS or Host call |
  | Fund transfer with Host timeout | A Host request with no response logged |

- **Mock values:** each parameter's value can come from a pattern, a list, a number, a UUID or a sequence, and can stay the same per line, call, call tree or session.
- **Self-test:** every generated line is checked against the layer it was written for, so a broken regex shows up straight away.

### Private by design
No backend and no network requests: a strict Content-Security-Policy blocks them, and fonts are bundled. Your logs stay in your browser. See [SECURITY.md](SECURITY.md).

## Tabs

| Tab | Shows |
|---|---|
| **Flow Result** | Every call in time order, indented by caller |
| **Sequence Diagram** | PlantUML code with the diagram drawn below it |
| **Processing Rule** | Step / Item / Processing rule for each API and URL in the diagram |
| **Query & Logs** | Sub-tabs: **Extraction Debug** · **Mock Logs** · **Splunk Query** · **Splunk Test Harness** |

The left panel holds the inputs: **Scenario**, **Parameters**, **Log Layers**, **Settings** and **Input Logs**.

## Design

The UI follows a *Minimalism & Swiss* developer-tool style generated with the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) design skill: a slate "code dark" palette with a green accent, dense dashboard spacing, IBM Plex Sans for UI text and JetBrains Mono for code.

- **Themes:** Dark (default), Light or System, chosen in the header. Text and badge colours meet WCAG 4.5:1 contrast, and input borders 3:1, in both themes.
- **Accessibility:** a visible focus ring on every control, tabs that work with the arrow keys, Home and End, labelled SVG icon buttons (no emoji), 44px touch targets on touch screens, and reduced-motion support.
- **Fonts are bundled** in `css/fonts/` (SIL Open Font License, licences included), so the app still makes no network requests.

## Install

There's nothing to build and no dependencies.

```bash
git clone https://github.com/zhangranarz/traceline.git
cd traceline
```

You need a modern browser (Edge, Chrome, Firefox, Safari). [Node.js](https://nodejs.org/) 20+ is only needed to run the tests, and `npm install` isn't required.

## Run

**Online:** open the [live app](https://zhangranarz.github.io/traceline/).

**Locally:** pick one.

```bash
# 1. Open the file directly
start index.html          # Windows
open index.html           # macOS
xdg-open index.html       # Linux

# 2. Or serve it on localhost
python tools/serve.py 8080    # or: npm start  (localhost only, no browser caching)
# then browse to http://127.0.0.1:8080
```

**Tests:**

```bash
npm run check   # syntax check
npm test        # engine and security tests (Node's built-in runner)
```

## How to use it

**To analyse real logs:**
1. Search Splunk for the events you want, and copy the raw lines (one event per line).
2. Paste them into **Input Logs** and choose *Pasted logs*.
3. Open **Query & Logs → Extraction Debug**. If lines are missed or misread, adjust the regexes in **Log Layers** until every line is handled.
4. Read the result in **Flow Result**, **Sequence Diagram** and **Processing Rule**.
5. Copy **Query & Logs → Splunk Query** to run the same analysis on your indexes.

**To build and test a query before you have logs:**
1. **Scenario:** tick the scenarios to include, set sessions for each, and edit or add call flows.
2. **Parameters:** add the values you want stamped on each line.
3. Check **Flow Result**, then copy **Query & Logs → Splunk Test Harness** into Splunk Search to prove the query with real SPL.

Your config saves in the browser automatically. Use **Settings → Export / Import config** to share it.

## How the analysis works

`js/simulator.js` runs the same steps as the generated SPL (`js/spl.js`): classify, `rex`, direction, sort, API inheritance, params, elapsed time and render. What you see in the browser is therefore what the query will produce in Splunk. The Test Harness is the final check, because it runs the real SPL on Splunk against known input. The flow is then rebuilt into call trees for the diagram (`js/plantuml.js`) and the processing rules (`js/rules.js`), which use the same step numbers.

The simulator only mirrors the query this tool generates; it isn't a general SPL interpreter.

**Things to know:**
- Regexes are PCRE-style, as in Splunk. Capture with `(?<value>…)`, and the tool renames the group to the right field.
- Layers are checked top to bottom, and an event belongs to the first layer whose classify regex matches.
- Pasted logs need one event per line.
- Elapsed-time pairing assumes calls to the same API don't overlap within one session.
- The ```` ``` ```` step comments need Splunk 8.0+. Turn them off in Settings for older versions.

## CI/CD

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every push and pull request, and weekly:

| Job | |
|---|---|
| Test | Syntax check plus `npm test` |
| Secret scan | gitleaks over the full git history |
| CodeQL | `security-extended` analysis of the JavaScript and the workflows |
| Deploy | On `main` only, after all checks pass, publishes `index.html`, `css/` and `js/` to GitHub Pages |

## Project structure

```
index.html              page shell and Content-Security-Policy
css/style.css           design tokens and styles (dark, light, system)
css/fonts/              bundled IBM Plex Sans + JetBrains Mono (OFL)
js/util.js              seeded random, time formatting, regex helpers
js/defaults.js          default layers, parameters, scenarios; validation
js/generator.js         mock log generation, pasted-log parsing
js/simulator.js         in-browser run of the query pipeline
js/spl.js               SPL and test-harness builder
js/plantuml.js          PlantUML sequence diagram from the flow
js/seqsvg.js            local SVG renderer for that PlantUML
js/rules.js             call-tree rebuild and step-by-step processing rules
js/app.js               UI
tests/                  engine and security tests (node:test)
tools/serve.py          localhost dev server without caching
.github/                CI/CD workflow and Dependabot
```
