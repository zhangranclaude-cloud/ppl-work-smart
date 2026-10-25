# Ppl Work Smart

[![CI/CD](https://github.com/zhangranclaude-cloud/ppl-work-smart/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/zhangranclaude-cloud/ppl-work-smart/actions/workflows/ci-cd.yml)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222222?logo=githubpages&logoColor=white)](https://zhangranclaude-cloud.github.io/ppl-work-smart/)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?logo=javascript&logoColor=black)
![Splunk SPL](https://img.shields.io/badge/Splunk-SPL-000000?logo=splunk&logoColor=white)
![Node.js tests](https://img.shields.io/badge/tests-Node.js%20%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![CodeQL](https://img.shields.io/badge/scan-CodeQL%20%2B%20gitleaks-6E40C9?logo=github&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Privacy](https://img.shields.io/badge/data-stays%20in%20your%20browser-success)

Generate mock transaction-flow logs, build the Splunk flow query, and test it before it touches Splunk.

The flow it models: **eComm API → Enterprise API → WS (web service) / Host service**. A request is stamped `[?]`, a response `[!]`, and every line is ordered by timestamp, with any parameters you choose shown on the line.

```
Step  EventTime                Flow                                          Params                  ElapsedMs
1     2026-10-25 10:00:00.398  eComm: /api/v1/payment/transfer [?]           TxnRefNo=TX1917377922
2     2026-10-25 10:00:00.401  --> Enterprise: AccountInquiry [?]            TxnRefNo=TX1917377922
3     2026-10-25 10:00:00.407  -----> WS: https://…/ws/accountInquiry [?]
4     2026-10-25 10:00:00.546  -----> WS: https://…/ws/accountInquiry [!]                            139
5     2026-10-25 10:00:00.704  -----> Host: FT01.A01,A02 [?]                 AcctNo=1722464163
6     2026-10-25 10:00:00.938  -----> Host: FT01.A01,A02 [!]                                         234
7     2026-10-25 10:00:00.995  eComm: /api/v1/payment/transfer [!]           TxnRefNo=…; HTTP=200    597
```

**▶ Live app: https://zhangranclaude-cloud.github.io/ppl-work-smart/**

## Features

- **Multiple scenarios:** each named scenario has its own call tree, an on/off switch and a session count, and the mock file mixes all enabled scenarios in time order (sessions overlap, as they do in production). Each eComm API calls zero or more Enterprise APIs; each Enterprise API calls zero or more WS calls and Host services, and a Host service is one main SvcCode with sub-codes. You can set latencies, noise lines and timeouts. Six scenarios are built in:
  | Scenario | What it covers |
  |---|---|
  | Login, eligibility and fund transfer | Rules-only call, two Enterprise APIs, WS then Host |
  | Bill payment | WS lookup, then a Host service with three sub-codes |
  | Account summary (several Host services) | One Enterprise API calling a WS and two Host services |
  | Rules only (no Enterprise call) | eComm APIs that never reach Enterprise |
  | Profile update (Enterprise, no Host) | An Enterprise API with no WS or Host call |
  | Fund transfer with Host timeout | A Host request with no response logged |
- **Dynamic parameters:** add or remove a parameter, and it is written into the mock logs, extracted with its own `rex`, and shown in the `Params` column. Its value can come from a pattern, a list, a number, a UUID or a sequence, and can be reused per line, per call, per call tree or per session.
- **Editable log layers:** the classify, session, direction and API regexes and the log templates for each log type, so they can match your real format.
- **Flow result and extraction debug:** an in-browser run of the generated query, with a self-test that checks every mock line was handled as intended.
- **Sequence diagram:** turns the Flow Result into PlantUML code and **draws the diagram right below it**, one session at a time (App → eComm → Enterprise → WS / Host). By default a WS call is drawn as **internal processing of the Enterprise API** (a self-call on the Enterprise lifeline) rather than as its own participant; untick the option to give WS its own column. Params, elapsed time and timestamps can be shown on the arrows, and calls without a response are marked. The diagram is drawn in your browser by a small built-in renderer (`js/seqsvg.js`), so nothing is sent to a PlantUML server. You can copy the code, or download it as `.puml` or `.svg`.
- **SPL generator:** the production query, ready to paste into Splunk.
- **Splunk test harness:** the same query with your test lines built in through `makeresults`, so the real query runs in Splunk without indexing anything.
- **Bring your own logs:** paste real lines to check the regexes against them.
- **Private by design:** no backend, no network requests (enforced by CSP), and nothing leaves your browser. See [SECURITY.md](SECURITY.md).

## Install

There's nothing to build and no dependencies.

```bash
git clone https://github.com/zhangranclaude-cloud/ppl-work-smart.git
cd ppl-work-smart
```

You need a modern browser (Edge, Chrome, Firefox, Safari). [Node.js](https://nodejs.org/) 20+ is only needed to run the tests, and `npm install` isn't required.

## Run

**Online:** open the [live app](https://zhangranclaude-cloud.github.io/ppl-work-smart/).

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

1. **Scenario:** tick the scenarios to include, set sessions for each, and edit or add call flows.
2. **Parameters:** add the values you want stamped on each line.
3. **Log Layers:** make the regexes and templates match your real logs. Pasting real lines into **Input Logs** and watching **Extraction Debug** is the quickest way to do this.
4. Check **Flow Result** (and the **Sequence Diagram** if you want a picture of it), then copy the **Splunk Query** to run on your indexes.
5. To prove the query in real Splunk, copy the **Splunk Test Harness**, run it in Splunk Search, and compare the output with Flow Result.

Your config saves in the browser automatically. Use **Settings → Export / Import config** to share it.

## How testing works

`js/simulator.js` runs the same steps as the generated SPL (`js/spl.js`): classify, `rex`, direction, sort, API inheritance, params, elapsed time and render. Regex mistakes therefore show up straight away. The Test Harness is the final check, because it runs the real SPL on Splunk against known input.

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
css/style.css           styles (light and dark)
js/util.js              seeded random, time formatting, regex helpers
js/defaults.js          default layers, parameters, scenario; validation
js/generator.js         mock log generation, pasted-log parsing
js/simulator.js         in-browser run of the query pipeline
js/spl.js               SPL and test-harness builder
js/plantuml.js          PlantUML sequence diagram from the flow
js/seqsvg.js            local SVG renderer for that PlantUML
js/app.js               UI
tests/                  engine and security tests (node:test)
.github/                CI/CD workflow and Dependabot
```
