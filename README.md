# Traceline

Splunk queries that trace a single request end to end across four service layers, linking the log events by a shared ID and ordering them by time.

## Purpose

Extract the sequence of a transaction flow, sorted by timestamp, and stamp each step with useful parameters:

- The app calls an **eComm** API. eComm routes to the **Enterprise** server, which calls its **WebService (WS)**. When needed, Enterprise starts **Host** services.
- `[?]` marks a request and `[!]` marks a response.
- Parameters are shown next to each API to make the flow easier to read. For WS, the query works out which API URL Enterprise called.

Call patterns the flow must handle:

- One eComm API may call several Enterprise APIs, or none (it processes rules itself).
- One Enterprise API may call several Host services, or none.
- A Host service has one main service code and one or more sub-service codes.

## Layers

| # | Layer | Log source | Event stamp | Request / response marker |
|---|-------|------------|-------------|---------------------------|
| 1 | eComm (called by the app) | `/var/log/pods/sit-01-online-*.log` | `[ECOMM-Message]` | `- Request -` / `- Response -` |
| 2 | Enterprise (called by eComm) | `/var/log/pods/sit-01-online-*.log` | `[Enterprise-HostMessage]` | `[Request]` / `[Response]` |
| 3 | Enterprise WebService | `/var/log/pods/microservice-sit-01-ms-*.log`<br>`/var/log/pods/microservice-sit-01_rewards*.log`<br>`/var/log/pods/microservice-sit-01_bfs*.log` | `WSAppLog` | `request:` / `RESPONSE from Enterprise` or `Response:` |
| 4 | Host (called by WebService) | same as layer 3 | `<EAI>` and `<SvcCode>` | `Request Message` / `Response Message` |

Each layer can handle a call itself or fan out to one or more calls in the next layer down. A parent never calls the same child API more than once at the same time.

## Usage

1. Open [queries/traceline.spl](queries/traceline.spl) and paste it into Splunk Search.
2. Pick a narrow time range.
3. To trace one session, replace `"*"` in step 5 (`| search sessionId="*"`) with the session ID.

Output columns: `sessionId`, `Step`, `EventTime`, `Flow` (indented by layer, `?` = request, `!` = response), `HostServices`, `Params`, `ElapsedMs`, `LinkKey`, `LinkedBy`.

## Mock log tool

[web/index.html](web/index.html) is a single-page tool for testing the query without real traffic. Use it online at https://zhangranarz.github.io/traceline/ or open the file in a browser; nothing to install.

- **Flow:** build the call tree (eComm APIs → Enterprise calls → Host services with main and sub-service codes), and add or remove parameters on any node. Parameter values can use `{uuid}`, `{num:N}`, `{pick:A|B}` and `{seq}`.
- **Templates:** the log line format for each layer and direction, and the log source paths. Edit these to match real log lines.
- **Settings:** number of sessions, interleaving, step gap and jitter, and optional noise events the query should filter out.
- **Expected trace:** the flow as generated, in true order, with elapsed times.
- **Test SPL:** the mock events embedded in a `makeresults` search, followed by the query. Paste it into Splunk and compare the output with the expected trace; no data upload needed.
- **Query:** the query under test. It defaults to a bundled copy of `queries/traceline.spl`; use **Load .spl file** after changing the query file.

The scenario is saved in the browser and can be exported or imported as JSON.

## How events are linked

1. **Directly by session ID:** layers 1–3 log a session ID in a known pattern.
2. **Through `LinkKey`:** events without a session ID (usually Host) take the session ID of any event that shares the same `LinkKey` value (`eventstats first(sessionId) by LinkKey`).
3. **Fallback:** the first UUID in the event, then `unlinked`.

`LinkedBy` shows which rule applied; rows marked `any-UUID` or `none` need checking. The session filter runs after linking, so filtering never drops Host events that lack the session ID.

Elapsed time pairs each response with the most recent request having the same `sessionId`, `Layer` and `PairKey`.

The ```` ``` ```` lines in the query are SPL comments and need Splunk 8.1 or later.

## Open items

- **Host link key:** the `<RqUID>` rex in step 3 is a placeholder. Replace it with the Host XML tag that carries an ID also logged by the WS layer.
- **Endpoint regexes:** `Endpoint1`, `Endpoint2`, `Endpoint3` and `EnterpriseEndpoint` are unverified against real events. `Endpoint1` matches `<prefix>Request` or a bare `Response` because of alternation precedence.
- **Transaction ref:** the regex captures everything up to the next `"`.
- **Host `PairKey`:** uses `EnterpriseEndpoint`. If Host requests and responses differ there, pair on `mvindex(SvcCode,0)` instead.
- **Host service codes:** `HostServices` groups the `<SvcCode>` values in pairs (`A ~ B | C ~ D`). With one main code and several sub-service codes this is wrong; for example `main, sub1, sub2` shows as `main ~ sub1 | sub2 ~ sub2`. The fix depends on how the main and sub codes appear in the Host XML.
