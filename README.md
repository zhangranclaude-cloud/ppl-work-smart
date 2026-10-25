# Ppl Work Smart

A browser tool for building and testing the transaction-flow Splunk query
(eComm → Enterprise → WS / Host) before running it on real indexes.

## Run it

Open `index.html` in a browser (double-click it). There's no build step, no server and nothing to install.
Your config saves in the browser automatically. Use **Settings → Export config** to share it or keep a copy.

## What it does

| Left panel | |
|---|---|
| **Scenario** | Build the call tree. Each eComm API can call any number of Enterprise APIs (or none, if it only runs rules). Each Enterprise API can call any number of WS calls and Host services (or none). A Host service is one main SvcCode plus one or more sub-codes. Set latencies, the number of sessions, interleaving and noise lines, or mark a call as "no response" to simulate a timeout. |
| **Parameters** | Add or remove parameters. Each one is written into the mock logs, extracted by its own `rex` in the SPL, and stamped into the `Params` column. You choose which layers it applies to, whether it's written on the request, the response or both, how its value is generated, and how the value is reused (per line, per call, per call tree, per session). |
| **Log Layers** | One card per log type: the base-search source and terms, the classify / session / direction / API regexes, and the mock log templates. Change these to match your real log format. |
| **Settings** | Session filter macro, the `?` / `!` symbols, fallback regexes, SPL comments on or off, and config import / export / reset. |
| **Input Logs** | Switch from mock logs to **your own pasted log lines**, so you can check the regexes against real data. |

| Right panel | |
|---|---|
| **Flow Result** | The table the query would produce: Step, EventTime, sessionId, the indented Flow, Params and ElapsedMs. A self-test chip shows whether every mock line was handled the way it was written. |
| **Extraction Debug** | For each input line: the layer it was written as, the layer it was classified as, and the direction, session, API and params extracted, plus why a line was filtered out. |
| **Mock Logs** | The generated logs, color-coded by layer. Copy them, or download one `.log` per source file. |
| **SPL Query** | The production query, generated from the config. Copy it and run it on real indexes. |
| **Splunk Test Harness** | The same query with the test lines built in through `makeresults`. Paste it into Splunk Search to run the **real** query on the mock or pasted lines without indexing anything. The output should match the Flow Result tab. |

## How "testing the query" works

- **In the browser:** `js/simulator.js` runs the same steps as the generated SPL (`js/spl.js`): classify, rex, direction, sort, API inheritance, params, elapsed time, render. Regex mistakes show up straight away in Flow Result and Extraction Debug.
- **In Splunk:** the Test Harness is the final check, because it runs the real SPL on the real Splunk engine against known input.

The simulator only mirrors the query this tool generates. It isn't a general SPL interpreter, so hand edits to the SPL aren't simulated.

## Notes

- Regexes are written the way Splunk (PCRE) uses them. Capture the value with a group named `(?<value>…)`; the tool renames it to the right Splunk field. A leading `(?i)` is supported in both the browser and Splunk.
- Layers are checked top to bottom, and an event goes to the first layer whose classify regex matches. That's why Host comes before WS: both come from the microservice logs.
- Pasted logs need one event per line. Join multi-line XML onto a single line first.
- `streamstats` pairing (elapsed time, WS URL inheritance) assumes calls to the same API don't overlap within one session.
- The ```` ``` ```` step comments need Splunk 8.0+. Turn them off in Settings for older versions.

## Files

```
index.html          page shell
css/style.css       styles (light and dark)
js/util.js          seeded random, time formatting, regex helpers
js/defaults.js      default layers, parameters, scenario; validation
js/generator.js     mock log generation, pasted-log parsing
js/simulator.js     in-browser run of the query pipeline
js/spl.js           SPL + test-harness builder
js/app.js           UI
```
