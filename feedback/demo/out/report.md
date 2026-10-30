# Traceline feedback report

## 1. Inputs

- **Export:** `export.csv`: 42 rows, 5 session(s).
- **Columns:** all 13 expected columns present.
- **EventTime format:** ms precision.
- **Raw log:** `raw.log`: 45 events (0 multi-line), 45 recognised as a layer request or response.
- **Clock offset:** log = export − 8 h (detected from 41 of 41 rows, applied before matching).
- **Tolerance:** ±500 ms after the offset (widened to the export's time precision when it has no milliseconds).

## 2. Alignment

Keys: sessionId, layer, direction and API (with any `Request`/`Response` suffix ignored), then the nearest timestamp. Full table: `alignment.csv`.

| Match | Meaning | Rows |
|---|---|---|
| EXACT | All keys match; same timestamp | 40 |
| NEAR | All keys match; timestamp within ±500 ms | 0 |
| TIME-MISMATCH | All keys match, but the timestamp is beyond tolerance | 1 |
| WEAK-API | Same session, layer and direction within tolerance; the API differs | 0 |
| NO-SID | Export row has no session; matched on layer, direction, API and time | 1 |
| NONE | No raw log line found | 0 |

## 3. Data quality checks

### 3.1 Rows with no sessionId

- row 40 (step 3, Enterprise Response AccountSummary): `(empty)` → log line 42 belongs to session `000000000014` (used in that diagram, marked "session inferred")

### 3.2 Missing request or response (in the export)

- Session `000000000007` row 27 (step 4, Host Request FT01): request with no response. The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.
- Session `000000000009` row 33 (step 3, WS Request /ws/fund/transfer): request with no response. **Raw log line 37 has the response**, so the export is missing a row (filtered out, or lost in export or desensitizing).

### 3.3 Timestamps beyond tolerance (±500 ms)

- row 18 (step 9, WS Response /wam/v1/limits): export 2026-10-27 09:15:12.685, log line 17 2026-10-27 01:15:10.685 (Δ -2000 ms after offset)

Weaker matches to review:

- row 40 (step 3, Enterprise Response AccountSummary) → log line 42 (NO-SID)

### 3.4 Export rows with no raw log line

None.

### 3.5 Raw log lines not mapped to any export row

- line 23 (2026-10-27 01:15:10.792, WS Request /ws/customer/notify, session 000000000006)
- line 24 (2026-10-27 01:15:10.814, WS Response /ws/customer/notify, session 000000000006)
- line 37 (2026-10-27 01:15:44.030, WS Response /ws/fund/transfer, session 000000000009)

### 3.6 Layers or hops in the log but not in the export

- line 23 (2026-10-27 01:15:10.792, WS Request /ws/customer/notify, session 000000000006): no export row for WS `/ws/customer/notify` in this session
- line 24 (2026-10-27 01:15:10.814, WS Response /ws/customer/notify, session 000000000006): no export row for WS `/ws/customer/notify` in this session

### 3.7 HopStatus that contradicts the raw response

- row 29 (step 6, Enterprise Response FundTransfer): export says **SUCCESS**, raw line 30 gives **FAILED** (http=200, code=-, errCode=E9001, errDesc=Downstream EAI timeout)

### 3.8 SessionStatus consistency

None.

## 4. Sequence diagrams

- `session-000000000005.puml`: session `fa4e0000-0000-4000-8000-000000000005`, SUCCESS
- `session-000000000006.puml`: session `fa4e0000-0000-4000-8000-000000000006`, SUCCESS
- `session-000000000007.puml`: session `fa4e0000-0000-4000-8000-000000000007`, FAILED, first failed: WS: /ws/fund/transfer
- `session-000000000009.puml`: session `fa4e0000-0000-4000-8000-000000000009`, FAILED, first failed: Host: FT01
- `session-000000000014.puml`: session `fa4e0000-0000-4000-8000-000000000014`, PARTIAL, first failed: Enterprise: RewardsBalance

## 5. Diagram vs evidence

**Session `000000000005`**

- **Directly supported:** 8 of 8 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000006`**

- **Directly supported:** 13 of 14 arrows match a raw log line with all keys and the timestamp.
- **Weaker evidence:** step 9 (TIME-MISMATCH).
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); downstream participants named from the URL prefix (`downstream` in the config); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.

**Session `000000000007`**

- **Directly supported:** 7 of 7 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.
- **No response logged:** step 4 Host FT01. The orange arrow shows that nothing came back, not why.

**Session `000000000009`**

- **Directly supported:** 7 of 7 arrows match a raw log line with all keys and the timestamp.
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); WS calls drawn as Enterprise calling itself (assumes WS is Enterprise's own web service); EAI as the caller's target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it.
- **No response logged:** step 3 WS /ws/fund/transfer. The orange arrow shows that nothing came back, not why.

**Session `000000000014`**

- **Directly supported:** 5 of 6 arrows match a raw log line with all keys and the timestamp.
- **Weaker evidence:** step 3 (NO-SID).
- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request); "internal processing only" for Enterprise AccountSummary, Enterprise RewardsBalance, because no downstream call was logged between its request and response.

## 6. Host SvcCode pairing checks

- No problems found in the logged Host messages: every message has main/sub pairs with one status per pair.

Always true of this diagram: the Host arrow is labelled with the **first** main code, and its colour reflects the **whole** message. A failed sub-service turns the hop red; the note lists each pair's status from the raw log so you can see which one.
