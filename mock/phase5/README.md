# Phase 5: mock log pre-validation

**All data here is fake and desensitized.** Session IDs start with `fa4e0000-`, references with `FAKE-TXN-`, and every JSON body carries `"_mock":"FAKE-DESENSITIZED"`. Timestamps are UTC and increase steadily.

This checks the logic of [queries/traceline.final.spl](../../queries/traceline.final.spl) before real logs are available. It is not the final deliverable.

## Files

| File | What it is |
|---|---|
| `logs/*.log` | Mock log lines, one file per source (eComm/Enterprise on `sit-01-online`, WS/Host on `ms` and `bfs`) |
| `expected-hops.csv` | Expected row for every event: step, layer, direction, API, HostServices, ElapsedMs, HopStatus |
| `expected-sessions.csv` | Expected SessionStatus and FirstFailedHop for every session |
| `phase5-test.spl` | Paste into Splunk: builds the mock events with `makeresults`, then runs the final SPL with the mock placeholder values |
| `generate.js` | Rebuilds all of the above: `node mock/phase5/generate.js` |
| `check.js` | Local pre-check, a JavaScript copy of the SPL logic compared with the expected files: `node mock/phase5/check.js` |

## Mock formats

- **eComm:** `<ts> INFO [ECOMM-Message][/sessionId] : <sid> <api>Request - Request - {"header":{…},"data":{…}}`
- **Enterprise:** `<ts> INFO [Enterprise-HostMessage]['sessionIdentity'] : <sid> <api>Request [Request] {"header":{…},"data":{…}}`
- **WS (text):** `<ts> INFO WSAppLog ["WS:" <sid>] request: URL?: POST: <url> "transactionRef : <ref>"`, and the response adds `status: <code>`
- **Host (XML):** `<ts> INFO [EAI-Gateway] Request Message <EAI><RqUID><ref></RqUID><SvcRq><SvcCode>main</SvcCode><SvcCode>sub</SvcCode>…</SvcRq></EAI>`; the response has one `<SvcRs>` per pair with `<StatusCode>`

JSON paths used: `header.sessionId`, `header.transactionRef`, `header.apiName`, `header.httpStatus`, `data.responseCode`, `data.errorCode`, `data.errorDescription`. These describe the mock only, not your real logs.

## Scenarios and expected results

Response HopStatus is listed in the order the responses occur. Every request is `N/A`.

| # | Scenario | Response HopStatus | SessionStatus | FirstFailedHop |
|---|---|---|---|---|
| A | eComm internal processing only | eComm SUCCESS | SUCCESS | |
| B | eComm → one Enterprise API (empty and `null` error fields) | Enterprise SUCCESS, eComm SUCCESS | SUCCESS | |
| C | eComm → three Enterprise APIs in sequence | 3 × Enterprise SUCCESS, eComm SUCCESS | SUCCESS | |
| D | Enterprise → EAI, one sub-service (`FT01 ~ A01`) | Host, WS, Enterprise, eComm all SUCCESS | SUCCESS | |
| E | Enterprise → EAI, three sub-services (`ACCT ~ INQ01 \| ACCT ~ BAL02 \| ACCT ~ LMT03`), on the bfs pod | all SUCCESS | SUCCESS | |
| F | Enterprise → EAI + OPI, WAM, CUS | Host, WS ×3 (downstream), WS, Enterprise, eComm all SUCCESS | SUCCESS | |
| G1 | Host request with no response; WS logs `status: 504 … EAI timeout` | WS FAILED, Enterprise FAILED, eComm FAILED (Host request has no response) | FAILED | `WS: /ws/fund/transfer` |
| G1b | Requests at every layer, no responses at all | none | UNKNOWN | |
| G2 | EAI response: `A01` status `0`, `A02` status `E102` | Host FAILED, WS SUCCESS, Enterprise FAILED, eComm FAILED | FAILED | `Host: FT01` |
| G3 | Enterprise HTTP 200 + `errorCode` + `errorDescription` | Enterprise FAILED, eComm FAILED | FAILED | `Enterprise: BillPayment` |
| G3b* | Enterprise HTTP 200 + `errorCode` only | Enterprise FAILED, eComm FAILED | FAILED | `Enterprise: CardActivation` |
| G4 | eComm non-success code + `errorDescription` | eComm FAILED | FAILED | `eComm: validatePayee` |
| G5* | Enterprise HTTP 503, no business code | Enterprise FAILED, eComm FAILED | FAILED | `Enterprise: LoanQuote` |
| G6* | eComm returns success code `0000` **and** an `errorDescription` | eComm FAILED (by the current definition: a description means failure) | FAILED | `eComm: getStatements` |
| T* | eComm and Enterprise requests in the same millisecond, and their responses in the same millisecond | Enterprise, eComm SUCCESS; order must be eComm ? → Enterprise ? → Enterprise ! → eComm ! | SUCCESS | |
| H | Two sessions like D, starting 4 ms apart | all SUCCESS in both | SUCCESS, SUCCESS | |
| I1 | One Enterprise API succeeds, one fails; eComm returns `0000` | Enterprise SUCCESS, Enterprise FAILED, eComm SUCCESS | **PARTIAL** | `Enterprise: RewardsBalance` |
| I2 | Same, but eComm returns an error | Enterprise SUCCESS, Enterprise FAILED, eComm FAILED | **FAILED** | `Enterprise: RewardsBalance` |

\* Not in the brief. Added so that every HopStatus rule (error code alone, HTTP status alone, description alone) and the equal-timestamp sort order decide at least one scenario. Removing any one of these rules from `check.js` makes the check fail.

## Assumptions made for the mock

- **OPI, WAM and CUS (F)** are logged by WS as `WSAppLog … Response:` lines, so they appear as WS rows. If they are logged somewhere else, the SPL needs another layer (Phase 0 Q7).
- **A missing response (G1)** is not FAILED by itself, so FirstFailedHop points to the WS timeout, not to the Host that never answered (Phase 0 Q18).
- **WS reports transport status only (G2):** WS is SUCCESS with status 200 even though the Host failed underneath it.

## Running it in Splunk

Paste `phase5-test.spl` into Splunk Search and run it over any time range. Compare the output with `expected-hops.csv` and `expected-sessions.csv`. The local check shows the logic is consistent. Splunk-specific behaviour (`json_extract` on numbers, `| search` on `makeresults` events, `eventstats count(eval(…))`) is only confirmed by the Splunk run.
