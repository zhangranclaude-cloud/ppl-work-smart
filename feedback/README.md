# Traceline feedback loop (Phase 6)

Aligns a desensitized Splunk export of `queries/traceline.final.spl` with the desensitized raw request/response log, checks data quality, and draws one PlantUML sequence diagram per session.

```
node feedback/traceline-feedback.js --excel <export.csv|export.xlsx> --log <raw.log> [--config <config.json>] [--out <dir>] [--tolerance <ms>]
```

Node.js only, no packages. Output goes to `<dir of export>/out/` unless `--out` is given.

## Inputs

**Export (CSV preferred, XLSX accepted):** the 13 columns of the final SPL, with the header row:
`Step EventTime sessionId Flow HostServices Params ElapsedMs RespCode ErrCode ErrDesc HopStatus SessionStatus FirstFailedHop`.
Export straight from Splunk (Export → CSV). If you open and save it in Excel, Excel may rewrite `EventTime` and drop the milliseconds; the tool still reads it, but matching gets weaker and the report says so.

**Raw log:** one file, one event per line, each starting with its timestamp (`YYYY-MM-DD HH:MM:SS.mmm`). Lines that don't start with a timestamp are treated as the continuation of the previous event.

**Desensitizing:** replace each real value with the **same** fake value everywhere, in both files. If session `abc…` becomes `SESSION_01` in the export, it must become `SESSION_01` in the log too. Keep the layer tags, direction markers, JSON keys and XML tag names unchanged; the tool relies on them.

## Config

Defaults describe the Phase 5 mock format. For real logs, copy the block below to a file, change the values and pass `--config`:

```json
{
  "toleranceMs": 500,
  "json": { "session": "header.sessionId", "sessionKey": "sessionId", "txnRef": "header.transactionRef",
            "endpoint": "header.apiName", "httpStatus": "header.httpStatus", "respCode": "data.responseCode",
            "errCode": "data.errorCode", "errDesc": "data.errorDescription" },
  "httpSuccess": ["200"],
  "successCodes": ["0000", "00000"],
  "hostSuccess": ["0"],
  "failPattern": "\\b(exception|timed? ?out)\\b",
  "hostLinkRegex": "<RqUID>([^<]+)</RqUID>",
  "hostStatusRegex": "<StatusCode>([^<]+)</StatusCode>",
  "wsStatusRegex": "(?:RESPONSE from Enterprise|Response:).*\\bstatus:\\s*(\\d{3})",
  "downstream": { "^/opi/": "OPI", "^/wam/": "WAM", "^/cus/": "CUS" },
  "wsAsSelfCall": true
}
```

Use the same values as the placeholders in the SPL, so that "HopStatus contradicts the raw response" means a real contradiction and not a config difference.

## Outputs

| File | Content |
|---|---|
| `report.md` | Inputs confirmed, alignment summary, data quality checks, diagram vs evidence, SvcCode pairing checks |
| `alignment.csv` | One line per export row: the matched log line, the time difference and the match level |
| `session-<id>.puml` | One sequence diagram per session |
| `rules.md` | Phase 7, written only with 2+ sessions: coverage, routing decision table, EAI/downstream mapping, sequence, failure handling, propagation, latency baseline, failure patterns, confidence and gaps. Marked "Hypotheses only" with fewer than 5 sessions or no behaviour seen twice |
| `decision-flow.puml` | Phase 7: activity diagram of the observed decision flow; green = observed, grey = inferred, notes = observed failures |
| `summary.md` | Phase 7: one-page plain-language summary for a business analyst |

`svcSystems` in the config maps a main SvcCode to the system behind EAI (for example `{ "FT01": "BWC" }`). Without it, the mapping table flags every SvcCode as having no downstream log.

## Rendering the diagrams

- **Local (recommended for bank data):** `java -jar plantuml.jar -charset UTF-8 -tsvg out/*.puml` (or `-tpng`). Sequence diagrams don't need Graphviz. `-charset UTF-8` matters on Windows: the labels contain `·` and `›`.
- **VS Code:** the *PlantUML* extension (jebbs.plantuml) previews `.puml` files with Alt+D; set `plantuml.render` to `Local` so nothing leaves the machine.
- **Online server:** paste into https://www.plantuml.com/plantuml/uml/. The diagram is sent to a third-party server. Even desensitized, check your bank's policy first, or run the PlantUML server internally. URLs from the server use PlantUML's own deflate + base64 encoding, not plain URL encoding, and long diagrams can exceed URL length limits; paste the text instead of building URLs by hand.

## Rehearsal

`node feedback/demo/make-demo.js` builds a fake export and log from the Phase 5 mock data with six planted defects (`feedback/demo/planted-defects.txt`), then:

```
node feedback/traceline-feedback.js --excel feedback/demo/export.csv --log feedback/demo/raw.log
```
